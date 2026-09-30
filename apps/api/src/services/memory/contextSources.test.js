import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 只 mock 数据库；关心卡片、便签与分寸输入都用真实服务——以前「懂你」检验集把便签整个 mock 成空，
// 经期卡片从「你今天主动对她说过」进了模型，测试却看不见（路线图 C23）。
const db = vi.hoisted(() => ({
  user: null,
  period: null,
}))

vi.mock('../../prisma/client.js', () => ({
  default: {
    user: { findUnique: vi.fn(() => Promise.resolve(db.user)) },
    // 人设卡查找：null → 默认卡（关怀卡的句库按它的口吻底子取）
    persona: { findFirst: vi.fn(() => Promise.resolve(null)) },
    scheduledReminder: { findMany: vi.fn(() => Promise.resolve([])) },
    periodRecord: { findFirst: vi.fn(() => Promise.resolve(db.period)) },
    diaryEntry: { findFirst: vi.fn(() => Promise.resolve(null)), findMany: vi.fn(() => Promise.resolve([])) },
    careDismissal: { findMany: vi.fn(() => Promise.resolve([])) },
    message: { findMany: vi.fn(() => Promise.resolve([])) },
    memory: { findMany: vi.fn(() => Promise.resolve([])) },
    inference: { findMany: vi.fn(() => Promise.resolve([])) },
  },
}))
// 其余几处来源与这里无关：到点提醒、惦记的事、来信都当作今天没有
vi.mock('../reminderService.js', () => ({ ackDelivery: vi.fn(), listDueReminders: vi.fn(() => Promise.resolve([])), listTodaysDeliveries: vi.fn(() => Promise.resolve([])) }))
vi.mock('../followUpService.js', () => ({ listAskedToday: vi.fn(() => Promise.resolve([])), listDueFollowUps: vi.fn(() => Promise.resolve([])), markFollowUpAsked: vi.fn() }))
vi.mock('../letterService.js', () => ({ findLatestLetter: vi.fn(() => Promise.resolve(null)), scheduleDueLetter: vi.fn() }))
vi.mock('../../utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { allowedSensitive, CONTEXT_SOURCES, loadChatSources } from './contextSources.js'
import { consentsOf } from '../consents.js'

// 北京时间 9 月 20 日上午；上次经期 8 月 20 日、周期 28 天 → 预计 9 月 17 日，已经晚了 3 天
const NOW = new Date('2026-09-20T02:00:00.000Z')
const LATE_PERIOD = { id: 'p1', startDate: new Date('2026-08-20T00:00:00.000Z'), endDate: null, cycleDays: 28 }

function userWith({ tone }) {
  return {
    persona: 'gentle', birthDate: null, careEnabled: true,
    externalLlmConsent: true, externalLlmConsentVersion: 'cloud-primary-v4',
    periodConsentAt: new Date('2026-09-01T00:00:00.000Z'),
    periodToneAt: tone ? new Date('2026-09-02T00:00:00.000Z') : null,
  }
}

function chatSources(user) {
  db.user = user
  return loadChatSources({ userId: 'u1', user, consents: consentsOf('u1', user), conversationId: 'c1', now: NOW })
}

describe('读取闸口：经期只经两项同意进模型', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    db.period = LATE_PERIOD
  })
  afterEach(() => vi.useRealTimers())

  it('只同意了记录、没开「顾及周期」：经期卡片照样是便签，但不进聊天上下文', async () => {
    const sources = await chatSources(userWith({ tone: false }))

    expect(sources.recentNudges.some((item) => item.sensitive === 'period')).toBe(false)
    expect(JSON.stringify(sources)).not.toContain('比预计晚了')
    expect(sources.companionInputs.cyclePhase).toBeNull()
  })

  it('两项都开着：经期卡片作为她今天说过的话交给模型', async () => {
    const sources = await chatSources(userWith({ tone: true }))

    expect(sources.recentNudges).toContainEqual(expect.objectContaining({ kind: 'care', sensitive: 'period', content: expect.stringContaining('比预计晚了 3 天') }))
  })

})

describe('敏感类别的判断', () => {
  const both = consentsOf('u1', userWith({ tone: true }))
  const recordOnly = consentsOf('u1', userWith({ tone: false }))

  it('没有敏感类别的照常给', () => {
    expect(allowedSensitive('recentNudges', undefined, recordOnly)).toBe(true)
  })

  it('经期要两项都开着', () => {
    expect(allowedSensitive('recentNudges', 'period', recordOnly)).toBe(false)
    expect(allowedSensitive('recentNudges', 'period', both)).toBe(true)
  })

  it('没登记过的类别、没登记敏感规则的来源，一律不给', () => {
    expect(allowedSensitive('recentNudges', 'unknown', both)).toBe(false)
    expect(allowedSensitive('history', 'period', both)).toBe(false)
  })
})

describe('来源表', () => {
  it('每个来源都写明层级、用途、同意与标注', () => {
    for (const [id, source] of Object.entries(CONTEXT_SOURCES)) {
      expect(['root', 'organization', 'record'], id).toContain(source.layer)
      expect(source.purposes.length, id).toBeGreaterThan(0)
      expect(source.consent, id).toContain('cloud')
      expect(typeof source.label, id).toBe('string')
      for (const needs of Object.values(source.sensitive ?? {})) expect(needs, id).toEqual(['periodTone'])
    }
  })
})
