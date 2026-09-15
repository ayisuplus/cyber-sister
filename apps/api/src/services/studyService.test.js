import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sessionCreate: vi.fn(),
  sessionFindMany: vi.fn(),
  sessionFindFirst: vi.fn(),
  sessionUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  generateCompanionNote: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    studySession: {
      create: mocks.sessionCreate,
      findMany: mocks.sessionFindMany,
      findFirst: mocks.sessionFindFirst,
      update: mocks.sessionUpdate,
    },
    user: { findUnique: mocks.userFindUnique },
  },
}))

vi.mock('./llmService.js', () => ({
  generateCompanionNote: mocks.generateCompanionNote,
}))

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { cancelSession, finishSession, generateSessionComment, getActiveSession, getSummary, listSessions, recordSession, startSession } from './studyService.js'

const SESSION = {
  id: 's1',
  userId: 'u1',
  subject: '数学',
  plannedMinutes: 25,
  actualMinutes: 23,
  note: '微积分终于顺了一点',
  aiComment: null,
  aiCommentSource: null,
  startedAt: new Date('2026-09-06T10:00:00.000Z'),
  createdAt: new Date('2026-09-06T10:30:00.000Z'),
}

describe('studyService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.userFindUnique.mockResolvedValue({
      persona: 'gentle',
      externalLlmConsent: null,
      externalLlmConsentVersion: null,
    })
  })

  afterEach(() => {
    for (const userId of ['u1', 'u2']) {
      const run = getActiveSession(userId)
      if (run) cancelSession(userId, run.id)
    }
    vi.useRealTimers()
  })

  it('rejects 0 or 241 minutes and overlong subject', async () => {
    await expect(recordSession('u1', { actualMinutes: 0 })).rejects.toMatchObject({ statusCode: 400, message: '专注时长必须为1到240分钟' })
    await expect(recordSession('u1', { actualMinutes: 241 })).rejects.toMatchObject({ statusCode: 400, message: '专注时长必须为1到240分钟' })
    await expect(recordSession('u1', { actualMinutes: 25, subject: '这'.repeat(21) })).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.sessionCreate).not.toHaveBeenCalled()
  })

  it('defaults plannedMinutes to actualMinutes', async () => {
    mocks.sessionCreate.mockImplementation(async ({ data }) => ({ ...SESSION, ...data }))

    const session = await recordSession('u1', { actualMinutes: 45 })

    expect(mocks.sessionCreate.mock.calls[0][0].data).toMatchObject({ plannedMinutes: 45, actualMinutes: 45 })
    expect(session.actualMinutes).toBe(45)
  })

  it('summarizes today, week and streak over local calendar days', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 6, 12, 0, 0)) // 本地 2026-09-06 中午
    mocks.sessionFindMany.mockResolvedValue([
      { createdAt: new Date(2026, 8, 6, 9, 0), actualMinutes: 30 },
      { createdAt: new Date(2026, 8, 5, 21, 0), actualMinutes: 20 },
      { createdAt: new Date(2026, 7, 27, 9, 0), actualMinutes: 50 },
    ])

    const summary = await getSummary('u1')

    expect(summary).toEqual({ todayMinutes: 30, weekMinutes: 50, streak: 2, totalSessions: 3 })
  })

  it('reuses an existing session comment instead of calling the model again', async () => {
    mocks.sessionFindFirst.mockResolvedValue({ ...SESSION, aiComment: '辛苦了', aiCommentSource: 'local_model' })

    const result = await generateSessionComment('u1', 's1', 'req-s1')

    expect(result).toEqual({ aiComment: '辛苦了', source: 'local_model', reused: true })
    expect(mocks.generateCompanionNote).not.toHaveBeenCalled()
  })

  it('returns an explicit cloud mock without model calls or persisted comments', async () => {
    mocks.sessionFindFirst.mockResolvedValue(SESSION)

    const result = await generateSessionComment('u1', 's1', 'req-s2')

    expect(mocks.sessionFindFirst).toHaveBeenCalledWith({ where: { id: 's1', userId: 'u1' } })
    expect(result).toMatchObject({ source: 'cloud_mock', reused: false, execution: { mode: 'mock', cloudConnected: false, persisted: false } })
    expect(result.aiComment).toContain('模拟')
    expect(mocks.generateCompanionNote).not.toHaveBeenCalled()
    expect(mocks.userFindUnique).not.toHaveBeenCalled()
    expect(mocks.sessionUpdate).not.toHaveBeenCalled()
  })

  it('owns one active run per user and resumes it with server time', () => {
    vi.useFakeTimers()
    const run = startSession('u1', { plannedMinutes: 25, subject: ' 数学 ' })
    expect(run).toMatchObject({ status: 'running', subject: '数学', execution: { storage: 'memory', persisted: false } })
    expect(getActiveSession('u1').id).toBe(run.id)
    expect(getActiveSession('u2')).toBe(null)
    expect(() => finishSession('u2', run.id)).toThrow('不存在')
    expect(() => cancelSession('u2', run.id)).toThrow('不存在')
    expect(() => startSession('u1', { plannedMinutes: 25 })).toThrow('未处理')
    expect(mocks.sessionCreate).not.toHaveBeenCalled()
  })

  it('freezes server-measured duration and ignores forged client timing on save', async () => {
    vi.useFakeTimers()
    mocks.sessionCreate.mockImplementation(async ({ data }) => ({ ...SESSION, ...data }))
    const run = startSession('u1', { plannedMinutes: 25, subject: '数学' })
    await expect(recordSession('u1', { runId: run.id })).rejects.toMatchObject({ statusCode: 409 })
    vi.advanceTimersByTime(61000)
    const finished = finishSession('u1', run.id)
    expect(finished.actualMinutes).toBe(2)
    vi.advanceTimersByTime(60000)
    expect(finishSession('u1', run.id).finishedAt).toBe(finished.finishedAt)
    const [first, second] = await Promise.all([
      recordSession('u1', { runId: run.id, actualMinutes: 240, plannedMinutes: 240, subject: '伪造', note: '完成一节' }),
      recordSession('u1', { runId: run.id, actualMinutes: 240 }),
    ])
    expect(first).toEqual(second)
    expect(mocks.sessionCreate).toHaveBeenCalledTimes(1)
    expect(mocks.sessionCreate.mock.calls[0][0].data).toMatchObject({ subject: '数学', actualMinutes: 2, plannedMinutes: 25, note: '完成一节' })
    expect(getActiveSession('u1').status).toBe('saved')
    await recordSession('u1', { runId: run.id })
    expect(mocks.sessionCreate).toHaveBeenCalledTimes(1)
    expect(startSession('u1', { plannedMinutes: 45 }).id).not.toBe(run.id)
  })

  it('retains finished drafts after save failures and expires unsaved runs after 24h', async () => {
    vi.useFakeTimers()
    const run = startSession('u1', { plannedMinutes: 1 })
    vi.advanceTimersByTime(120000)
    expect(finishSession('u1', run.id).actualMinutes).toBe(1)
    mocks.sessionCreate.mockRejectedValueOnce(new Error('offline'))
    await expect(recordSession('u1', { runId: run.id })).rejects.toThrow('offline')
    expect(getActiveSession('u1').status).toBe('finished')
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(getActiveSession('u1')).toBe(null)
    await expect(recordSession('u1', { runId: run.id })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('does not cancel a run while its confirmed record is being saved', async () => {
    let complete
    mocks.sessionCreate.mockReturnValue(new Promise(resolve => { complete = resolve }))
    const run = startSession('u1', { plannedMinutes: 25 })
    finishSession('u1', run.id)
    const saving = recordSession('u1', { runId: run.id })
    expect(() => cancelSession('u1', run.id)).toThrow('正在保存')
    expect(() => startSession('u1', { plannedMinutes: 25 })).toThrow('未处理')
    complete(SESSION)
    await saving
    expect(cancelSession('u1', run.id)).toEqual({ cancelled: true })
    expect(getActiveSession('u1')).toBe(null)
  })

  it('requires an existing session before commenting', async () => {
    mocks.sessionFindFirst.mockResolvedValue(null)

    await expect(generateSessionComment('u1', 'missing', 'req-s3')).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.generateCompanionNote).not.toHaveBeenCalled()
  })

  it('stores note, subject and an explicit startedAt', async () => {
    mocks.sessionCreate.mockImplementation(async ({ data }) => ({ ...SESSION, ...data }))

    await recordSession('u1', { actualMinutes: 25, subject: ' 数学 ', note: ' 背完一章 ', startedAt: '2026-09-06T10:00:00.000Z' })

    expect(mocks.sessionCreate.mock.calls[0][0].data).toMatchObject({
      subject: '数学',
      note: '背完一章',
      startedAt: new Date('2026-09-06T10:00:00.000Z'),
    })
  })

  it('rejects an unparseable startedAt and overlong note', async () => {
    await expect(recordSession('u1', { actualMinutes: 25, startedAt: 'not-a-date' }))
      .rejects.toMatchObject({ statusCode: 400, message: '开始时间格式不正确' })
    await expect(recordSession('u1', { actualMinutes: 25, note: '感'.repeat(201) }))
      .rejects.toMatchObject({ statusCode: 400, message: '收获不能超过200个字符' })
    expect(mocks.sessionCreate).not.toHaveBeenCalled()
  })

  it('lists sessions within a day window and rejects bad day ranges', async () => {
    mocks.sessionFindMany.mockResolvedValue([SESSION])

    const sessions = await listSessions('u1', 7)

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ id: 's1', actualMinutes: 23 })
    const where = mocks.sessionFindMany.mock.calls[0][0].where
    expect(where.userId).toBe('u1')
    expect(where.createdAt.gte).toBeInstanceOf(Date)

    await expect(listSessions('u1', 0)).rejects.toMatchObject({ statusCode: 400 })
    await expect(listSessions('u1', 366)).rejects.toMatchObject({ statusCode: 400 })
  })
})
