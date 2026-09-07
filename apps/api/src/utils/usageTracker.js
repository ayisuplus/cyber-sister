/**
 * 合规使用计时器
 *
 * 根据《人工智能拟人化互动服务管理暂行办法》要求：
 * - 连续使用 2 小时需弹出提醒
 * - 每日累计使用时长需跟踪
 *
 * 当前为内存实现，生产环境可替换为 Redis。
 */
import logger from './logger.js'

// 2 小时提醒阈值（毫秒）
const TWO_HOURS_MS = 2 * 60 * 60 * 1000
// 每日重置间隔（24 小时检查一次）
const DAILY_CHECK_MS = 60 * 60 * 1000
// 业务日界按 Asia/Shanghai 计算：UTC 日界会让北京时间 0-8 点的会话被错误清零
// （该时段对中国用户仍是“今天”，UTC 却已跨入“明天”）
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

class UsageTracker {
  constructor() {
    // userId -> { sessionStart, dailyTotal, lastActivity, sessionCount }
    this.sessions = new Map()

    // 每小时清理一次过期会话（超过 6 小时无活动的会话自动结束）
    this._cleanupInterval = setInterval(() => this._cleanup(), DAILY_CHECK_MS)
  }

  /**
   * 开始或恢复会话
   */
  start(userId) {
    let session = this.sessions.get(userId)
    const now = Date.now()

    if (!session) {
      session = {
        sessionStart: now,
        dailyTotal: 0,       // 今日累计使用（毫秒）
        lastActivity: now,
        sessionCount: 1,
        currentDate: this._getDateKey(),
        active: true,
      }
      this.sessions.set(userId, session)
      logger.debug('使用计时开始', { userId, sessionStart: new Date(now).toISOString() })
    } else {
      // 跨天重置
      const todayKey = this._getDateKey()
      if (session.currentDate !== todayKey) {
        session.dailyTotal = 0
        session.currentDate = todayKey
        session.sessionCount = 1
      }
      session.sessionStart = now
      session.lastActivity = now
      session.sessionCount++
      session.active = true
    }

    return this._getStatus(session)
  }

  /**
   * 更新活动时间（心跳）
   */
  heartbeat(userId) {
    const session = this.sessions.get(userId)
    if (!session) return null

    session.lastActivity = Date.now()
    return this._getStatus(session)
  }

  /**
   * 结束会话
   */
  end(userId) {
    const session = this.sessions.get(userId)
    if (!session) return { minutes: 0, shouldRemind: false }

    const now = Date.now()
    const sessionDuration = now - session.sessionStart
    session.dailyTotal += sessionDuration
    session.lastActivity = now
    // 结束后时钟必须停下：否则后续 status/heartbeat 会把同一段时长重复计入
    session.active = false

    logger.debug('使用计时结束', {
      userId,
      sessionMinutes: Math.round(sessionDuration / 60000),
      dailyTotalMinutes: Math.round(session.dailyTotal / 60000),
    })

    return this._getStatus(session)
  }

  /**
   * 获取当前使用状态
   */
  getStatus(userId) {
    const session = this.sessions.get(userId)
    if (!session) {
      return { minutes: 0, shouldRemind: false, isActive: false }
    }

    // 检查是否跨天
    const todayKey = this._getDateKey()
    if (session.currentDate !== todayKey) {
      session.dailyTotal = 0
      session.currentDate = todayKey
    }

    return this._getStatus(session)
  }

  /**
   * 计算状态
   */
  _getStatus(session) {
    const now = Date.now()
    const isActive = session.active !== false
    const currentSessionDuration = isActive ? now - session.sessionStart : 0
    const totalDailyMs = session.dailyTotal + currentSessionDuration
    const continuousMinutes = Math.round(currentSessionDuration / 60000)
    const dailyMinutes = Math.round(totalDailyMs / 60000)

    return {
      minutes: continuousMinutes,
      dailyMinutes,
      shouldRemind: currentSessionDuration >= TWO_HOURS_MS,
      isActive,
      sessionCount: session.sessionCount,
    }
  }

  /**
   * 清理过期会话（超过 6 小时无活动）
   */
  _cleanup() {
    const now = Date.now()
    const SIX_HOURS = 6 * 60 * 60 * 1000
    let cleaned = 0

    for (const [userId, session] of this.sessions) {
      if (now - session.lastActivity > SIX_HOURS) {
        this.sessions.delete(userId)
        cleaned++
      }
    }

    if (cleaned > 0) {
      logger.debug('清理过期会话', { cleaned, remaining: this.sessions.size })
    }
  }

  _getDateKey(now = Date.now()) {
    const parts = SHANGHAI_DATE_FORMATTER.formatToParts(now)
    const pick = (type) => parts.find((part) => part.type === type).value
    return `${pick('year')}-${pick('month')}-${pick('day')}`
  }

  /**
   * 销毁计时器（用于 graceful shutdown）
   */
  destroy() {
    clearInterval(this._cleanupInterval)
    this.sessions.clear()
    logger.info('使用计时器已销毁')
  }
}

// 单例
const usageTracker = new UsageTracker()
export default usageTracker
