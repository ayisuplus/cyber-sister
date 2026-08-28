/**
 * Redis 客户端
 * 开发环境：连接失败自动降级为无缓存模式，不影响核心功能
 * 生产环境：连接失败记录告警日志
 */
import Redis from 'ioredis'
import logger from './logger.js'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

let redis = null
let redisAvailable = false

async function initRedis() {
  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 2,
      retryStrategy(times) {
        if (times > 3) return null  // 3 次后放弃
        return Math.min(times * 200, 2000)
      },
      lazyConnect: true,
    })

    redis.on('error', (err) => {
      if (redisAvailable) {
        logger.warn('Redis 连接错误', { error: err.message })
      }
      redisAvailable = false
    })

    redis.on('connect', () => {
      redisAvailable = true
      logger.info('Redis 连接成功')
    })

    await redis.connect()
  } catch (error) {
    redisAvailable = false
    logger.warn('Redis 不可用，将跳过缓存（功能不受影响）', { error: error.message })
  }
}

/**
 * 获取缓存值，自动 JSON 解析
 */
export async function cacheGet(key) {
  if (!redisAvailable || !redis) return null
  try {
    const val = await redis.get(key)
    return val ? JSON.parse(val) : null
  } catch {
    return null
  }
}

/**
 * 设置缓存，自动 JSON 序列化
 * @param {number} ttl - 过期时间（秒），默认 300 秒
 */
export async function cacheSet(key, value, ttl = 300) {
  if (!redisAvailable || !redis) return
  try {
    const serialized = JSON.stringify(value)
    if (ttl > 0) {
      await redis.setex(key, ttl, serialized)
    } else {
      await redis.set(key, serialized)
    }
  } catch (err) {
    logger.debug('缓存写入失败', { key, error: err.message })
  }
}

/**
 * 删除缓存（用于缓存失效）
 */
export async function cacheDel(...keys) {
  if (!redisAvailable || !redis || keys.length === 0) return
  try {
    await redis.del(...keys)
  } catch (err) {
    logger.debug('缓存删除失败', { keys, error: err.message })
  }
}

/**
 * 按模式批量删除缓存
 */
export async function cacheDelPattern(pattern) {
  if (!redisAvailable || !redis) return
  try {
    const keys = await redis.keys(pattern)
    if (keys.length > 0) {
      await redis.del(...keys)
    }
  } catch (err) {
    logger.debug('缓存模式删除失败', { pattern, error: err.message })
  }
}

/**
 * 原子递增（用于计数场景如登录失败次数）
 */
export async function cacheIncr(key, ttl = 900) {
  if (!redisAvailable || !redis) return 0
  try {
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, ttl)  // 首次设置过期
    return count
  } catch {
    return 0
  }
}

/**
 * 检查 Redis 是否可用
 */
export function isRedisAvailable() {
  return redisAvailable
}

/**
 * 关闭 Redis 连接（用于 graceful shutdown）
 */
export async function closeRedis() {
  if (redis) {
    try {
      await redis.quit()
      logger.info('Redis 连接已关闭')
    } catch (err) {
      logger.warn('关闭 Redis 连接失败', { error: err.message })
    }
  }
}

// 启动时初始化
initRedis()

export default { cacheGet, cacheSet, cacheDel, cacheDelPattern, cacheIncr, isRedisAvailable, closeRedis }
