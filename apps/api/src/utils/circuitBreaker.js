/**
 * 熔断器（Circuit Breaker）
 *
 * 当 LLM 推理服务连续失败达到阈值后，自动跳过 LLM 调用直接走 fallback，
 * 避免所有请求卡住等待超时。一段时间后自动进入半开状态探测恢复。
 *
 * 状态转换：
 *   CLOSED（正常）-- 连续失败 N 次 --> OPEN（熔断）
 *   OPEN -- 等待 resetTimeout --> HALF_OPEN（探测）
 *   HALF_OPEN -- 成功 --> CLOSED
 *   HALF_OPEN -- 失败 --> OPEN
 */
import logger from './logger.js'

const DEFAULT_THRESHOLD = 5
const DEFAULT_RESET_TIMEOUT = 60000  // 60 秒后尝试恢复

export class CircuitBreaker {
  constructor(name = 'default', threshold = DEFAULT_THRESHOLD, resetTimeout = DEFAULT_RESET_TIMEOUT) {
    this.name = name
    this.threshold = threshold
    this.resetTimeout = resetTimeout
    this.failureCount = 0
    this.successCount = 0
    this.lastFailureTime = null
    this.state = 'CLOSED'  // CLOSED | OPEN | HALF_OPEN
    this.lastError = null
  }

  /**
   * 尝试执行 - 如果熔断器打开则直接返回 null
   * 调用方检查 null 来决定是否走 fallback
   */
  async call(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
        logger.info(`[熔断器:${this.name}] OPEN → HALF_OPEN，开始探测`)
        this.state = 'HALF_OPEN'
      } else {
        return null  // 熔断中，调用方应走 fallback
      }
    }

    try {
      const result = await fn()
      this._onSuccess()
      return result
    } catch (error) {
      this._onFailure(error)
      return null  // 失败时也让调用方走 fallback
    }
  }

  _onSuccess() {
    this.successCount++
    if (this.state === 'HALF_OPEN') {
      logger.info(`[熔断器:${this.name}] HALF_OPEN → CLOSED（探测成功）`)
      this.state = 'CLOSED'
      this.failureCount = 0
    } else {
      // CLOSED 状态成功，重置失败计数
      this.failureCount = Math.max(0, this.failureCount - 1)
    }
  }

  _onFailure(error) {
    this.failureCount++
    this.lastFailureTime = Date.now()
    this.lastError = error.message

    if (this.state === 'HALF_OPEN') {
      logger.warn(`[熔断器:${this.name}] HALF_OPEN → OPEN（探测失败: ${error.message}）`)
      this.state = 'OPEN'
    } else if (this.failureCount >= this.threshold) {
      logger.error(`[熔断器:${this.name}] CLOSED → OPEN（连续失败 ${this.failureCount} 次: ${error.message}）`)
      this.state = 'OPEN'
    }
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastError: this.lastError,
      lastFailureTime: this.lastFailureTime,
    }
  }
}
