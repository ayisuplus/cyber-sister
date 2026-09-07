import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// 必须在导入被测模块前安装假时钟：UsageTracker 单例在构造时创建 setInterval
vi.useFakeTimers()

const { default: usageTracker } = await import('./usageTracker.js')

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

describe('usageTracker 使用计时', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-08-30T10:00:00.000Z'))
    usageTracker.sessions.clear()
  })

  afterEach(() => {
    usageTracker.sessions.clear()
  })

  it('首次开始创建会话并返回活跃状态', () => {
    const status = usageTracker.start('u1')
    expect(status).toMatchObject({
      minutes: 0,
      dailyMinutes: 0,
      shouldRemind: false,
      isActive: true,
      sessionCount: 1,
    })
  })

  it('同一天再次开始复用会话并累加 sessionCount', () => {
    usageTracker.start('u1')
    vi.advanceTimersByTime(30 * 60 * 1000)
    const status = usageTracker.start('u1')
    expect(status.sessionCount).toBe(2)
    // 新会话从当前时刻重新计时
    expect(status.minutes).toBe(0)
  })

  it('跨天开始时清零当日累计并重新开始计数', () => {
    usageTracker.start('u1')
    const session = usageTracker.sessions.get('u1')
    session.dailyTotal = 60 * 60 * 1000

    vi.setSystemTime(new Date('2026-08-31T09:00:00.000Z'))
    const status = usageTracker.start('u1')

    expect(status.dailyMinutes).toBe(0)
    expect(status.sessionCount).toBe(2)
    expect(session.currentDate).toBe('2026-08-31')
  })

  it('连续使用满两小时触发提醒', () => {
    usageTracker.start('u1')
    vi.advanceTimersByTime(2 * HOUR_MS)
    const status = usageTracker.getStatus('u1')
    expect(status.minutes).toBe(120)
    expect(status.shouldRemind).toBe(true)
  })

  it('心跳更新活动时间，无会话时返回 null', () => {
    expect(usageTracker.heartbeat('nobody')).toBeNull()

    usageTracker.start('u1')
    vi.advanceTimersByTime(10 * 60 * 1000)
    const status = usageTracker.heartbeat('u1')
    expect(status.minutes).toBe(10)
    expect(usageTracker.sessions.get('u1').lastActivity).toBe(Date.now())
  })

  it('结束会话把本次时长计入当日累计，无会话时返回零值', () => {
    expect(usageTracker.end('nobody')).toEqual({ minutes: 0, shouldRemind: false })

    usageTracker.start('u1')
    vi.advanceTimersByTime(45 * 60 * 1000)
    const status = usageTracker.end('u1')
    // 结束后时钟停止：当前会话时长归零，当日累计保留 45 分钟
    expect(status.minutes).toBe(0)
    expect(status.dailyMinutes).toBe(45)
    expect(status.isActive).toBe(false)

    // 结束后状态不再随时间继续增长
    vi.advanceTimersByTime(10 * 60 * 1000)
    expect(usageTracker.getStatus('u1').dailyMinutes).toBe(45)

    // 结束后再次开始，累计值保留在同一天内
    vi.advanceTimersByTime(15 * 60 * 1000)
    const restarted = usageTracker.start('u1')
    expect(restarted.dailyMinutes).toBe(45)
  })

  it('未开始的用户查询状态返回未激活', () => {
    expect(usageTracker.getStatus('ghost')).toEqual({
      minutes: 0,
      shouldRemind: false,
      isActive: false,
    })
  })

  it('跨天查询状态会清零当日累计', () => {
    usageTracker.start('u1')
    const session = usageTracker.sessions.get('u1')
    session.dailyTotal = 30 * 60 * 1000

    vi.setSystemTime(new Date('2026-08-31T08:00:00.000Z'))
    const status = usageTracker.getStatus('u1')
    expect(session.dailyTotal).toBe(0)
    // 跨天的连续会话仍在计时，时长计入新的一天
    expect(status.dailyMinutes).toBe(22 * 60)
    expect(status.shouldRemind).toBe(true)
  })

  it('定时清理移除超过 6 小时无活动的会话', () => {
    usageTracker.start('stale')
    usageTracker.start('fresh')

    // stale 用户停在原地，fresh 用户在 5 小时后仍有心跳
    vi.advanceTimersByTime(5 * HOUR_MS)
    usageTracker.heartbeat('fresh')
    // 再推进 2 小时：stale 已 7 小时无活动，fresh 只有 2 小时
    vi.advanceTimersByTime(2 * HOUR_MS)
    usageTracker._cleanup()

    expect(usageTracker.sessions.has('stale')).toBe(false)
    expect(usageTracker.sessions.has('fresh')).toBe(true)
  })

  it('清理间隔由 setInterval 每小时触发一次', () => {
    usageTracker.start('u1')
    vi.advanceTimersByTime(7 * HOUR_MS)
    // 7 小时内清理 interval 已运行多次，过期会话被自动移除
    expect(usageTracker.sessions.has('u1')).toBe(false)
  })

  it('destroy 清空会话并停止清理计时器', () => {
    usageTracker.start('u1')
    usageTracker.destroy()
    expect(usageTracker.sessions.size).toBe(0)

    // interval 已清除：推进时间不再触发任何清理逻辑
    usageTracker.start('u2')
    vi.advanceTimersByTime(DAY_MS)
    expect(usageTracker.sessions.has('u2')).toBe(true)
  })
})
describe('业务日界（Asia/Shanghai）', () => {
  beforeEach(() => {
    usageTracker.sessions.clear()
  })

  it('UTC 2026-08-31 17:00（北京 9/1 01:00）的日期键是 2026-09-01', () => {
    const utcEvening = new Date('2026-08-31T17:00:00.000Z').getTime()
    expect(usageTracker._getDateKey(utcEvening)).toBe('2026-09-01')
  })

  it('会话跨过 UTC 零点但未到北京零点时不清零当日累计', () => {
    // 北京 2026-08-31 00:30（UTC 8/30 16:30）开始，当日已累计 60 分钟
    vi.setSystemTime(new Date('2026-08-30T16:30:00.000Z'))
    usageTracker.start('tz-user')
    const session = usageTracker.sessions.get('tz-user')
    session.dailyTotal = 60 * 60 * 1000
    expect(session.currentDate).toBe('2026-08-31')

    // UTC 已跨入 2026-08-31（00:30Z），但北京仍是 8/31 08:30，不得清零
    vi.setSystemTime(new Date('2026-08-31T00:30:00.000Z'))
    usageTracker.getStatus('tz-user')
    expect(session.currentDate).toBe('2026-08-31')
    expect(session.dailyTotal).toBe(60 * 60 * 1000)
  })

  it('跨过北京零点才清零当日累计', () => {
    // 北京 2026-08-31 23:30（UTC 15:30）开始
    vi.setSystemTime(new Date('2026-08-31T15:30:00.000Z'))
    usageTracker.start('tz-user-2')
    const session = usageTracker.sessions.get('tz-user-2')
    session.dailyTotal = 30 * 60 * 1000

    // 北京 2026-09-01 00:30（UTC 8/31 16:30）→ 清零
    vi.setSystemTime(new Date('2026-08-31T16:30:00.000Z'))
    usageTracker.getStatus('tz-user-2')
    expect(session.currentDate).toBe('2026-09-01')
    expect(session.dailyTotal).toBe(0)
  })
})
