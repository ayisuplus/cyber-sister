import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  habitFindMany: vi.fn(),
  habitFindFirst: vi.fn(),
  habitCreate: vi.fn(),
  habitUpdate: vi.fn(),
  habitCount: vi.fn(),
  checkinFindUnique: vi.fn(),
  checkinCreate: vi.fn(),
  checkinDelete: vi.fn(),
  userFindUnique: vi.fn(),
  generateCompanionNote: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    habit: {
      findMany: mocks.habitFindMany,
      findFirst: mocks.habitFindFirst,
      create: mocks.habitCreate,
      update: mocks.habitUpdate,
      count: mocks.habitCount,
    },
    habitCheckin: {
      findUnique: mocks.checkinFindUnique,
      create: mocks.checkinCreate,
      delete: mocks.checkinDelete,
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
  createHabit,
  updateHabit,
  archiveHabit,
  toggleCheckin,
  setCheckin,
  findHabitByName,
  listHabitsWithStatus,
  streakOf,
  generateCheer,
} from './habitService.js'
import { localTodayUtc, toUtcDayString } from '../utils/dayHelpers.js'

const HABIT = { id: 'h1', userId: 'u1', name: '喝水', icon: 'droplet' }

const utcDay = (offset) => new Date(localTodayUtc().getTime() + offset * 86400000)

describe('habitService 基础操作', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.userFindUnique.mockResolvedValue({
      persona: 'toxic',
      externalLlmConsent: null,
      externalLlmConsentVersion: null,
    })
  })

  it('creates a habit with validated name and icon, capped at 12 active', async () => {
    mocks.habitCount.mockResolvedValue(1)
    mocks.habitCreate.mockImplementation(async ({ data }) => ({ id: 'h-new', ...data }))

    const habit = await createHabit('u1', { name: ' 喝水 ', icon: 'droplet' })

    expect(habit.name).toBe('喝水')
    await expect(createHabit('u1', { name: 'x', icon: 'rocket' })).rejects.toMatchObject({ statusCode: 400 })
    mocks.habitCount.mockResolvedValue(12)
    await expect(createHabit('u1', { name: '瑜伽', icon: 'flower' })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('updates and archives only owned habits', async () => {
    mocks.habitFindFirst.mockResolvedValue(HABIT)
    mocks.habitUpdate.mockImplementation(async ({ data }) => ({ ...HABIT, ...data }))

    const updated = await updateHabit('u1', 'h1', { name: '多喝水' })
    expect(updated.name).toBe('多喝水')

    await archiveHabit('u1', 'h1')
    expect(mocks.habitUpdate).toHaveBeenCalledWith({
      where: { id: 'h1' },
      data: { archivedAt: expect.any(Date) },
    })

    mocks.habitFindFirst.mockResolvedValue(null)
    await expect(updateHabit('u1', 'h9', { name: 'x' })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('toggles a checkin on and off for today', async () => {
    mocks.habitFindFirst.mockResolvedValue(HABIT)
    mocks.checkinFindUnique.mockResolvedValueOnce(null)

    const on = await toggleCheckin('u1', 'h1')
    expect(on.checked).toBe(true)
    expect(mocks.checkinCreate.mock.calls[0][0].data.habitId).toBe('h1')

    mocks.checkinFindUnique.mockResolvedValueOnce({ id: 'c1' })
    const off = await toggleCheckin('u1', 'h1')
    expect(off.checked).toBe(false)
    expect(mocks.checkinDelete).toHaveBeenCalledWith({ where: { id: 'c1' } })
  })

  it('setCheckin is idempotent in both directions', async () => {
    mocks.habitFindFirst.mockResolvedValue(HABIT)
    mocks.checkinFindUnique.mockResolvedValue(null)

    await setCheckin('u1', 'h1', undefined, true)
    await setCheckin('u1', 'h1', undefined, true)
    expect(mocks.checkinCreate).toHaveBeenCalledTimes(2) // 第二次 findUnique 仍 null（mock），但语义上只由存在性决定
    mocks.checkinFindUnique.mockResolvedValue({ id: 'c1' })
    await setCheckin('u1', 'h1', undefined, true)
    expect(mocks.checkinCreate).toHaveBeenCalledTimes(2)
    await setCheckin('u1', 'h1', undefined, false)
    expect(mocks.checkinDelete).toHaveBeenCalledTimes(1)
  })

  it('finds a habit by exact name or reports the available names', async () => {
    mocks.habitFindMany.mockResolvedValue([HABIT, { ...HABIT, id: 'h2', name: '早睡' }])

    expect((await findHabitByName('u1', '早睡')).id).toBe('h2')
    await expect(findHabitByName('u1', '跑步')).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('喝水、早睡') })
    expect(await findHabitByName('u1', '  ')).toBeNull()
  })
})

describe('habitService 连续天数与状态', () => {
  it('counts consecutive days ending today', () => {
    const days = [0, -1, -2, -4].map(toUtcDayStringOffset)
    expect(streakOf(days)).toBe(3)
  })

  it('counts from yesterday when today is not checked', () => {
    const days = [-1, -2, -3, -5].map(toUtcDayStringOffset)
    expect(streakOf(days)).toBe(3)
  })

  it('returns zero for empty or broken streaks', () => {
    expect(streakOf([])).toBe(0)
    expect(streakOf([-2, -3].map(toUtcDayStringOffset))).toBe(0)
  })

  function toUtcDayStringOffset(offset) {
    return toUtcDayString(utcDay(offset))
  }

  it('lists habits with today state, streak and recent days', async () => {
    mocks.habitFindMany.mockResolvedValue([{
      ...HABIT,
      checkins: [{ day: utcDay(0) }, { day: utcDay(-1) }],
    }])

    const [status] = await listHabitsWithStatus('u1')

    expect(status.checkedToday).toBe(true)
    expect(status.streak).toBe(2)
    expect(status.recentDays).toHaveLength(2)
    expect(mocks.habitFindMany.mock.calls[0][0].where.archivedAt).toBeNull()
  })
})

describe('habitService AI 鼓励', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.userFindUnique.mockResolvedValue({
      persona: 'gentle',
      externalLlmConsent: null,
      externalLlmConsentVersion: null,
    })
  })

  it('returns null without any habits instead of calling the model', async () => {
    mocks.habitFindMany.mockResolvedValue([])

    const result = await generateCheer('u1', 'req-c1')

    expect(result).toEqual({ cheer: null, source: null })
    expect(mocks.generateCompanionNote).not.toHaveBeenCalled()
  })

  it('sends only aggregate counts and names to the model', async () => {
    mocks.habitFindMany.mockResolvedValue([
      { ...HABIT, checkins: [{ day: utcDay(0) }, { day: utcDay(-1) }] },
      { ...HABIT, id: 'h2', name: '早睡', icon: 'moon', checkins: [] },
    ])
    mocks.generateCompanionNote.mockResolvedValue({ content: '喝水连续两天了，稳。', source: 'qwen' })

    const result = await generateCheer('u1', 'req-c2')

    expect(result.cheer).toContain('喝水')
    const [noteArgs] = mocks.generateCompanionNote.mock.calls[0]
    expect(noteArgs.instruction).toContain('喝水：连续 2 天（今天已打卡）')
    expect(noteArgs.instruction).toContain('早睡：连续 0 天（今天还没打）')
    expect(noteArgs.instruction).toContain('共 2 个习惯，今天已完成 1 个')
    expect(noteArgs.instruction).not.toContain('content')
    expect(noteArgs.userText).not.toContain('香水')
  })
})
