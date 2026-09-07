import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  diaryUpsert: vi.fn(),
  diaryFindUnique: vi.fn(),
  diaryFindMany: vi.fn(),
  diaryUpdate: vi.fn(),
  diaryDelete: vi.fn(),
  userFindUnique: vi.fn(),
  generateCompanionNote: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    diaryEntry: {
      upsert: mocks.diaryUpsert,
      findUnique: mocks.diaryFindUnique,
      findMany: mocks.diaryFindMany,
      update: mocks.diaryUpdate,
      delete: mocks.diaryDelete,
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

import {
  upsertEntry,
  listMonth,
  getEntry,
  deleteEntry,
  generateComment,
} from './diaryService.js'

const ENTRY = {
  id: 'd1',
  day: new Date('2026-09-04T00:00:00.000Z'),
  mood: 'happy',
  content: '今天很开心',
  aiComment: null,
  aiCommentSource: null,
  updatedAt: new Date('2026-09-04T01:00:00.000Z'),
}

describe('diaryService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.userFindUnique.mockResolvedValue({
      persona: 'gentle',
      externalLlmConsent: null,
      externalLlmConsentVersion: null,
    })
  })

  it('upserts an entry per user and day with validated mood', async () => {
    mocks.diaryUpsert.mockImplementation(async ({ create }) => ({ ...ENTRY, ...create }))

    const result = await upsertEntry('u1', '2026-09-04', { content: '  今天很开心  ', mood: 'happy' })

    expect(result.day).toBe('2026-09-04')
    expect(result.content).toBe('今天很开心')
    expect(mocks.diaryUpsert.mock.calls[0][0].update.aiComment).toBeNull()
  })

  it('rejects invalid mood, overlong content and malformed dates', async () => {
    await expect(upsertEntry('u1', '2026-09-04', { content: 'x', mood: 'ecstatic' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(upsertEntry('u1', '2026-09-04', { content: 'x'.repeat(2001), mood: 'happy' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(upsertEntry('u1', '2026-13-40', { content: 'x', mood: 'happy' })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('lists entries of a month in descending day order', async () => {
    mocks.diaryFindMany.mockResolvedValue([ENTRY])

    const result = await listMonth('u1', '2026-09')

    expect(result).toHaveLength(1)
    expect(mocks.diaryFindMany.mock.calls[0][0].where.day).toEqual({
      gte: new Date('2026-09-01T00:00:00.000Z'),
      lt: new Date('2026-10-01T00:00:00.000Z'),
    })
    await expect(listMonth('u1', '2026-9')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('gets and deletes an entry by day with ownership scoping', async () => {
    mocks.diaryFindUnique.mockResolvedValue(ENTRY)

    expect((await getEntry('u1', '2026-09-04')).id).toBe('d1')
    expect(mocks.diaryFindUnique.mock.calls[0][0].where.userId_day).toEqual({
      userId: 'u1',
      day: new Date('2026-09-04T00:00:00.000Z'),
    })

    await deleteEntry('u1', '2026-09-04')
    expect(mocks.diaryDelete).toHaveBeenCalledWith({ where: { id: 'd1' } })

    mocks.diaryFindUnique.mockResolvedValue(null)
    await expect(getEntry('u1', '2026-09-04')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('reuses an existing comment instead of calling the model again', async () => {
    mocks.diaryFindUnique.mockResolvedValue({ ...ENTRY, aiComment: '我在', aiCommentSource: 'qwen' })

    const result = await generateComment('u1', '2026-09-04', 'req-d1')

    expect(result).toEqual({ aiComment: '我在', source: 'qwen', reused: true })
    expect(mocks.generateCompanionNote).not.toHaveBeenCalled()
  })

  it('generates and persists a persona comment for uncommented entries', async () => {
    mocks.diaryFindUnique.mockResolvedValue(ENTRY)
    mocks.generateCompanionNote.mockResolvedValue({ content: '今天这么开心，我也跟着亮起来了。', source: 'qwen' })
    mocks.diaryUpdate.mockImplementation(async ({ data }) => ({ ...ENTRY, ...data }))

    const result = await generateComment('u1', '2026-09-04', 'req-d2')

    expect(result.aiComment).toContain('开心')
    const [noteArgs, requestId, modelOptions] = mocks.generateCompanionNote.mock.calls[0]
    expect(noteArgs.persona).toBe('gentle')
    expect(noteArgs.instruction).toContain('开心')
    expect(noteArgs.userText).toBe('今天很开心')
    expect(requestId).toBe('req-d2')
    expect(modelOptions.allowExternal).toBe(false)
    expect(mocks.diaryUpdate.mock.calls[0][0].data).toEqual({
      aiComment: '今天这么开心，我也跟着亮起来了。',
      aiCommentSource: 'qwen',
    })
  })

  it('requires an existing entry before commenting', async () => {
    mocks.diaryFindUnique.mockResolvedValue(null)

    await expect(generateComment('u1', '2026-09-04', 'req-d3')).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.generateCompanionNote).not.toHaveBeenCalled()
  })
})
