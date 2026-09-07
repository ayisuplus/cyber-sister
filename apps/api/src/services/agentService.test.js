import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  todoFindMany: vi.fn(),
  todoCreate: vi.fn(),
  todoUpdate: vi.fn(),
  todoFindFirst: vi.fn(),
  todoDelete: vi.fn(),
  countdownFindMany: vi.fn(),
  countdownCreate: vi.fn(),
  countdownFindFirst: vi.fn(),
  countdownDelete: vi.fn(),
  periodFindMany: vi.fn(),
  periodCreate: vi.fn(),
  reminderFindMany: vi.fn(),
  reminderFindFirst: vi.fn(),
  reminderUpdate: vi.fn(),
  reminderUpsert: vi.fn(),
  diaryUpsert: vi.fn(),
  diaryFindUnique: vi.fn(),
  habitFindMany: vi.fn(),
  habitFindFirst: vi.fn(),
  checkinFindUnique: vi.fn(),
  checkinCreate: vi.fn(),
  checkinDelete: vi.fn(),
  bookFindFirst: vi.fn(),
  bookCreate: vi.fn(),
  bookUpdate: vi.fn(),
  noteCreate: vi.fn(),
  sessionCreate: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    todo: {
      findMany: db.todoFindMany,
      create: db.todoCreate,
      update: db.todoUpdate,
      findFirst: db.todoFindFirst,
      delete: db.todoDelete,
    },
    countdown: {
      findMany: db.countdownFindMany,
      create: db.countdownCreate,
      findFirst: db.countdownFindFirst,
      delete: db.countdownDelete,
    },
    periodRecord: { findMany: db.periodFindMany, create: db.periodCreate },
    reminder: {
      findMany: db.reminderFindMany,
      findFirst: db.reminderFindFirst,
      update: db.reminderUpdate,
      upsert: db.reminderUpsert,
    },
    diaryEntry: {
      upsert: db.diaryUpsert,
      findUnique: db.diaryFindUnique,
    },
    habit: {
      findMany: db.habitFindMany,
      findFirst: db.habitFindFirst,
    },
    habitCheckin: {
      findUnique: db.checkinFindUnique,
      create: db.checkinCreate,
      delete: db.checkinDelete,
    },
    book: {
      findFirst: db.bookFindFirst,
      create: db.bookCreate,
      update: db.bookUpdate,
    },
    readingNote: {
      create: db.noteCreate,
    },
    studySession: {
      create: db.sessionCreate,
    },
  },
}))

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  buildToolSystemPrompt,
  classifyToolPrefix,
  executeToolCall,
  executeToolCallOnce,
  parseCompleteToolCall,
  registerWorkTool,
} from './agentService.js'

describe('classifyToolPrefix', () => {
  it('classifies plain text as natural immediately', () => {
    expect(classifyToolPrefix('我')).toBe('natural')
    expect(classifyToolPrefix('  你好呀')).toBe('natural')
    expect(classifyToolPrefix('')).toBe('pending')
    expect(classifyToolPrefix('  \n ')).toBe('pending')
  })
  it('stays pending while the JSON object is incomplete', () => {
    expect(classifyToolPrefix('  {"tool":"add_t')).toBe('pending')
    expect(classifyToolPrefix('{"tool":"add_todo","args":{"content":"还没写完')).toBe('pending')
  })

  it('parses a complete registered tool call with string-aware brace balancing', () => {
    const text = '{"tool":"add_todo","args":{"content":"带}括号的}待办"}}'
    expect(classifyToolPrefix(text)).toEqual({ name: 'add_todo', args: { content: '带}括号的}待办' } })
  })

  it('treats JSON without a registered tool name as natural', () => {
    expect(classifyToolPrefix('{"foo":1}')).toBe('natural')
    expect(classifyToolPrefix('{"tool":"drop_database","args":{}}')).toBe('natural')
    expect(classifyToolPrefix('{"tool":123}')).toBe('natural')
  })

  it('defaults missing or non-object args to an empty object', () => {
    expect(classifyToolPrefix('{"tool":"list_todos"}')).toEqual({ name: 'list_todos', args: {} })
    expect(classifyToolPrefix('{"tool":"list_todos","args":[1]}')).toEqual({ name: 'list_todos', args: {} })
  })

  it('flushes oversized unbalanced prefixes as natural text', () => {
    expect(classifyToolPrefix(`{${'x'.repeat(4096)}`)).toBe('natural')
  })
})

describe('parseCompleteToolCall', () => {
  it('returns the call when the whole reply is one tool JSON object', () => {
    expect(parseCompleteToolCall(' {"tool":"record_period","args":{"startDate":"2026-09-04"}} '))
      .toEqual({ name: 'record_period', args: { startDate: '2026-09-04' } })
  })

  it('returns null for natural language, malformed JSON and trailing garbage', () => {
    expect(parseCompleteToolCall('好的，已帮你记下')).toBeNull()
    expect(parseCompleteToolCall('{"tool":"add_todo",')).toBeNull()
    expect(parseCompleteToolCall(123)).toBeNull()
  })
})

describe('buildToolSystemPrompt', () => {
  it('lists every registered tool and the day anchor without leaking internals', () => {
    const prompt = buildToolSystemPrompt('chat', new Date(2026, 8, 4))
    for (const name of ['add_todo', 'list_todos', 'complete_todo', 'delete_todo', 'add_countdown', 'list_countdowns', 'delete_countdown', 'record_period', 'period_status', 'list_reminders', 'set_reminder', 'add_diary', 'diary_status', 'check_habit', 'habit_status', 'log_reading', 'log_study', 'web_search']) {
      expect(prompt).toContain(`"tool":"${name}"`)
    }
    expect(prompt).toContain('今天是 2026-09-04')
    expect(prompt).not.toContain('memory')
    expect(prompt).not.toContain('generate_image')
    expect(prompt).not.toContain('browser_open')
    expect(prompt).not.toContain('use_skill')
  })
})

describe('executeToolCall', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a todo and returns a chip summary plus model feedback', async () => {
    db.todoCreate.mockImplementation(async ({ data }) => ({ id: 't1', ...data }))

    const run = await executeToolCall('u1', { name: 'add_todo', args: { content: '  周六复诊  ', dueDate: '2026-09-06' } })

    expect(run.ok).toBe(true)
    expect(run.summary).toBe('已添加日程「周六复诊」')
    expect(db.todoCreate).toHaveBeenCalledWith({ data: { userId: 'u1', content: '周六复诊', dueDate: new Date('2026-09-06'), dueTime: null } })
    const feedback = JSON.parse(run.feedback.replace('工具执行结果：', '').split('（')[0])
    expect(feedback).toMatchObject({ tool: 'add_todo', ok: true, result: { id: 't1', content: '周六复诊', dueDate: '2026-09-06' } })
  })

  it('lists todos as compact JSON with ids for follow-up calls', async () => {
    db.todoFindMany.mockResolvedValue([
      { id: 't1', content: '复诊', dueDate: new Date('2026-09-06T00:00:00Z'), isDone: false },
    ])

    const run = await executeToolCall('u1', { name: 'list_todos', args: {} })

    expect(run.ok).toBe(true)
    const feedback = JSON.parse(run.feedback.replace('工具执行结果：', '').split('（')[0])
    expect(feedback.result).toHaveLength(1)
    expect(feedback.result[0]).toMatchObject({ id: 't1', isDone: false })
  })

  it('completes a todo through ownership-checked update', async () => {
    db.todoFindFirst.mockResolvedValue({ id: 't1', userId: 'u1' })
    db.todoUpdate.mockImplementation(async ({ data }) => ({ id: 't1', content: '复诊', ...data }))

    const run = await executeToolCall('u1', { name: 'complete_todo', args: { id: 't1' } })

    expect(run.ok).toBe(true)
    expect(db.todoUpdate).toHaveBeenCalledWith({ where: { id: 't1' }, data: { isDone: true } })
  })

  it('reports validation failures to the model instead of throwing', async () => {
    const run = await executeToolCall('u1', { name: 'add_todo', args: { content: '' } })

    expect(run.ok).toBe(false)
    expect(run.summary).toContain('待办内容')
    expect(run.feedback).toContain('"ok":false')
    expect(db.todoCreate).not.toHaveBeenCalled()
  })

  it('rejects an unknown reminder type with a 400-family reason', async () => {
    const run = await executeToolCall('u1', { name: 'set_reminder', args: { type: 'lunch' } })

    expect(run.ok).toBe(false)
    expect(run.summary).toContain('water')
    expect(db.reminderUpdate).not.toHaveBeenCalled()
  })

  it('enables a reminder by type through the materialized list', async () => {
    db.reminderFindMany.mockResolvedValue([{ id: 'r1', userId: 'u1', type: 'water', time: '10:00', isActive: false }])
    db.reminderFindFirst.mockResolvedValue({ id: 'r1', userId: 'u1' })
    db.reminderUpdate.mockImplementation(async ({ data }) => ({ id: 'r1', type: 'water', time: '08:30', ...data }))

    const run = await executeToolCall('u1', { name: 'set_reminder', args: { type: 'water', time: '08:30', isActive: true } })

    expect(run.ok).toBe(true)
    expect(run.summary).toBe('已开启喝水提醒（08:30）')
    expect(db.reminderUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { time: '08:30', isActive: true } })
  })

  it('predicts the next period from the latest record in local calendar days', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 8, 4, 10, 30))
      db.periodFindMany.mockResolvedValue([{ id: 'p1', startDate: new Date(2026, 7, 20), cycleDays: 28 }])

      const run = await executeToolCall('u1', { name: 'period_status', args: {} })

      expect(run.ok).toBe(true)
      expect(run.summary).toBe('预计 13 天后下次经期')
      const feedback = JSON.parse(run.feedback.replace('工具执行结果：', '').split('（')[0])
      expect(feedback.result).toMatchObject({ nextDate: '2026-09-17', daysUntil: 13, cycleDays: 28 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('masks unexpected infrastructure failures as a generic reason', async () => {
    db.todoFindMany.mockRejectedValue(new Error('database gone'))

    const run = await executeToolCall('u1', { name: 'list_todos', args: {} })

    expect(run.ok).toBe(false)
    expect(run.summary).toBe('工具暂时不可用')
    expect(run.feedback).not.toContain('database gone')
  })

  it('never throws for an unknown tool name', async () => {
    const run = await executeToolCall('u1', { name: 'nope', args: {} })

    expect(run.ok).toBe(false)
    expect(run.feedback).toContain('未知工具')
  })

  it('log_reading shelves a missing book and records a note with advanced page', async () => {
    db.bookFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'b1', userId: 'u1', title: '活着', status: 'reading', totalPages: null, currentPage: 0 })
    db.bookCreate.mockResolvedValue({ id: 'b1', title: '活着', status: 'reading', totalPages: null, currentPage: 0 })
    db.noteCreate.mockImplementation(async ({ data }) => ({ id: 'n1', ...data }))
    db.bookUpdate.mockImplementation(async ({ data }) => ({ id: 'b1', title: '活着', status: 'reading', totalPages: null, currentPage: 0, ...data }))

    const run = await executeToolCall('u1', { name: 'log_reading', args: { book: '活着', page: 30, note: '有庆那段看得心里发紧' } })

    expect(run.ok).toBe(true)
    expect(run.summary).toBe('已记下《活着》的阅读')
    expect(db.bookCreate).toHaveBeenCalled()
    expect(db.bookUpdate).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { currentPage: 30 } })
    const feedback = JSON.parse(run.feedback.replace('工具执行结果：', '').split('（')[0])
    expect(feedback.result).toMatchObject({ bookId: 'b1', title: '活着', currentPage: 30 })
  })

  it('log_study records focused minutes', async () => {
    db.sessionCreate.mockImplementation(async ({ data }) => ({ id: 's1', ...data }))

    const run = await executeToolCall('u1', { name: 'log_study', args: { minutes: 25, subject: '数学' } })

    expect(run.ok).toBe(true)
    expect(run.summary).toBe('已记下 25 分钟自习')
    expect(db.sessionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', plannedMinutes: 25, actualMinutes: 25, subject: '数学' }),
    })
  })

  it('log_reading in work mode is rejected by the mode gate without side effects', async () => {
    const run = await executeToolCall('u1', { name: 'log_reading', args: { book: '活着' } }, 'work')

    expect(run.ok).toBe(false)
    expect(run.summary).toBe('当前模式不支持该操作')
    expect(db.bookCreate).not.toHaveBeenCalled()
  })
})

describe('executeToolCallOnce（回路级去重）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('executes an identical call only once and feeds back a dedupe notice', async () => {
    db.todoCreate.mockImplementation(async ({ data }) => ({ id: 't1', ...data }))
    const executed = new Set()

    const first = await executeToolCallOnce('u1', { name: 'add_todo', args: { content: '复诊' } }, executed)
    const second = await executeToolCallOnce('u1', { name: 'add_todo', args: { content: '复诊' } }, executed)

    expect(first.ok).toBe(true)
    expect(db.todoCreate).toHaveBeenCalledTimes(1)
    expect(second).toMatchObject({ ok: true, deduplicated: true })
    expect(second.feedback).toContain('请勿重复调用')
  })

  it('treats different args as distinct operations', async () => {
    db.todoCreate.mockImplementation(async ({ data }) => ({ id: 't1', ...data }))
    const executed = new Set()

    await executeToolCallOnce('u1', { name: 'add_todo', args: { content: '复诊' } }, executed)
    const other = await executeToolCallOnce('u1', { name: 'add_todo', args: { content: '喝水' } }, executed)

    expect(other.ok).toBe(true)
    expect(db.todoCreate).toHaveBeenCalledTimes(2)
  })
})

describe('智能体日记与手帐工具', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('add_diary upserts today\'s entry with a default mood', async () => {
    db.diaryUpsert.mockImplementation(async ({ create }) => ({
      id: 'd1', day: create.day, mood: create.mood, content: create.content,
    }))

    const run = await executeToolCall('u1', { name: 'add_diary', args: { content: '今天很开心' } })

    expect(run.ok).toBe(true)
    expect(run.summary).toContain('已记下今天的日记')
    expect(db.diaryUpsert).toHaveBeenCalledOnce()
  })

  it('add_diary surfaces validation errors without writing', async () => {
    const run = await executeToolCall('u1', { name: 'add_diary', args: { content: 'x', mood: 'ecstatic' } })

    expect(run.ok).toBe(false)
    expect(run.summary).toContain('心情')
    expect(db.diaryUpsert).not.toHaveBeenCalled()
  })

  it('diary_status reports written and unwritten days', async () => {
    db.diaryFindUnique.mockResolvedValue({ id: 'd1', mood: 'happy', day: new Date(), updatedAt: new Date() })
    const written = await executeToolCall('u1', { name: 'diary_status', args: {} })
    expect(written.summary).toContain('已写日记')

    db.diaryFindUnique.mockResolvedValue(null)
    const unwritten = await executeToolCall('u1', { name: 'diary_status', args: {} })
    expect(unwritten.summary).toContain('还没写日记')
  })

  it('check_habit sets today checked exactly once per day', async () => {
    db.habitFindMany.mockResolvedValue([{ id: 'h1', name: '喝水', icon: 'droplet', checkins: [] }])
    db.habitFindFirst.mockResolvedValue({ id: 'h1', userId: 'u1', name: '喝水' })
    db.checkinFindUnique.mockResolvedValue(null)

    const run = await executeToolCall('u1', { name: 'check_habit', args: { name: '喝水' } })

    expect(run.ok).toBe(true)
    expect(run.summary).toBe('已打卡「喝水」')
    expect(db.checkinCreate).toHaveBeenCalledOnce()
  })

  it('check_habit is idempotent when today is already checked', async () => {
    const todayStr = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())).toISOString().slice(0, 10)
    db.habitFindMany.mockResolvedValue([{ id: 'h1', name: '喝水', icon: 'droplet', checkins: [{ day: new Date(`${todayStr}T00:00:00.000Z`) }] }])
    db.habitFindFirst.mockResolvedValue({ id: 'h1', userId: 'u1', name: '喝水' })

    const run = await executeToolCall('u1', { name: 'check_habit', args: { name: '喝水' } })

    expect(run.summary).toBe('「喝水」今天已经打过卡了')
    expect(db.checkinCreate).not.toHaveBeenCalled()
  })

  it('check_habit reports the available names for an unknown habit', async () => {
    db.habitFindMany.mockResolvedValue([{ id: 'h1', name: '喝水', icon: 'droplet', checkins: [] }])

    const run = await executeToolCall('u1', { name: 'check_habit', args: { name: '跑步' } })

    expect(run.ok).toBe(false)
    expect(run.summary).toContain('喝水')
    expect(db.checkinCreate).not.toHaveBeenCalled()
  })

  it('habit_status returns compact names, streaks and today state', async () => {
    const todayStr = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())).toISOString().slice(0, 10)
    db.habitFindMany.mockResolvedValue([{ id: 'h1', name: '喝水', icon: 'droplet', checkins: [{ day: new Date(`${todayStr}T00:00:00.000Z`) }] }])

    const run = await executeToolCall('u1', { name: 'habit_status', args: {} })

    expect(run.ok).toBe(true)
    const feedback = JSON.parse(run.feedback.replace('工具执行结果：', '').split('（')[0])
    expect(feedback.result).toEqual([{ name: '喝水', streak: 1, checkedToday: true }])
  })
})

describe('add_diary 按天去重签名', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deduplicates same-day diary writes even with different args', async () => {
    db.diaryUpsert.mockImplementation(async ({ create }) => ({ id: 'd1', day: create.day, mood: create.mood, content: create.content }))
    const executed = new Set()

    const first = await executeToolCallOnce('u1', { name: 'add_diary', args: { content: '上午开心' } }, executed)
    const second = await executeToolCallOnce('u1', { name: 'add_diary', args: { content: '下午也开心', mood: 'happy' } }, executed)

    expect(first.ok).toBe(true)
    expect(db.diaryUpsert).toHaveBeenCalledTimes(1)
    expect(second).toMatchObject({ ok: true, deduplicated: true })
  })
})

describe('工作模式注册表与模式门', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('buildToolSystemPrompt work 目录含日程/计算/浏览器/生图/终端工具，不含陪伴类工具', () => {
    const prompt = buildToolSystemPrompt('work')
    for (const name of ['add_todo', 'list_todos', 'complete_todo', 'delete_todo', 'calc_convert', 'browser_open', 'browser_read', 'browser_click', 'browser_type', 'browser_close', 'generate_image', 'bash_run', 'web_search', 'use_skill']) {
      expect(prompt).toContain(`"tool":"${name}"`)
    }
    for (const name of ['add_diary', 'add_countdown', 'record_period', 'set_reminder', 'check_habit', 'log_reading', 'log_study']) {
      expect(prompt).not.toContain(`"tool":"${name}"`)
    }
  })

  it('工作模式调用聊天专属工具：模式门拒绝且不执行任何副作用', async () => {
    const run = await executeToolCall('u1', { name: 'add_diary', args: { content: '今天很开心' } }, 'work')

    expect(run.ok).toBe(false)
    expect(run.summary).toBe('当前模式不支持该操作')
    expect(run.feedback).toContain('此模式不可用')
    expect(db.diaryUpsert).not.toHaveBeenCalled()
  })

  it('聊天模式调用工作专属工具同样被模式门拒绝', async () => {
    const run = await executeToolCall('u1', { name: 'calc_convert', args: { expression: '1+1' } }, 'chat')

    expect(run.ok).toBe(false)
    expect(run.summary).toBe('当前模式不支持该操作')
  })

  it('calc_convert 计算算式、换算单位，错误反馈给模型而不抛出', async () => {
    const calc = await executeToolCall('u1', { name: 'calc_convert', args: { expression: '(3+5)*2' } }, 'work')
    expect(calc.ok).toBe(true)
    expect(calc.summary).toBe('已算出 16')

    const conv = await executeToolCall('u1', { name: 'calc_convert', args: { value: 1, from: 'kg', to: 'jin' } }, 'work')
    expect(conv.ok).toBe(true)
    expect(conv.feedback).toContain('"value":2')

    const zero = await executeToolCall('u1', { name: 'calc_convert', args: { expression: '1/0' } }, 'work')
    expect(zero.ok).toBe(false)
    expect(zero.summary).toBe('算式无效')

    const cross = await executeToolCall('u1', { name: 'calc_convert', args: { value: 1, from: 'kg', to: 'm' } }, 'work')
    expect(cross.ok).toBe(false)
    expect(cross.summary).toBe('不支持该单位换算')
  })

  it('浏览器未启用时浏览器工具如实失败而不抛出', async () => {
    delete process.env.BROWSER_ENABLED
    const run = await executeToolCall('u1', { name: 'browser_open', args: { url: 'https://example.com' } }, 'work')
    expect(run.ok).toBe(false)
    expect(run.summary).toBe('工具暂时不可用')
  })

  it('联网搜索未启用时 web_search 如实失败而不抛出', async () => {
    delete process.env.SEARCH_ENABLED
    const run = await executeToolCall('u1', { name: 'web_search', args: { query: 'x' } }, 'work')
    expect(run.ok).toBe(false)
    expect(run.summary).toBe('工具暂时不可用')
  })

  it('web_search 关键词为空时 400 原文透传给模型', async () => {
    process.env.SEARCH_ENABLED = 'true'
    try {
      const run = await executeToolCall('u1', { name: 'web_search', args: { query: '  ' } }, 'work')
      expect(run.ok).toBe(false)
      expect(run.feedback).toContain('搜索关键词不能为空')
    } finally {
      delete process.env.SEARCH_ENABLED
    }
  })

  it('生图服务未配置时 generate_image 如实失败而不抛出', async () => {
    delete process.env.IMAGE_GEN_BASE_URL
    const run = await executeToolCall('u1', { name: 'generate_image', args: { prompt: 'a cat' } }, 'work')
    expect(run.ok).toBe(false)
    expect(run.summary).toBe('工具暂时不可用')
  })

  it('bash_run 未启用时如实失败而不抛出；聊天模式被模式门拒绝', async () => {
    delete process.env.BASH_ENABLED
    const off = await executeToolCall('u1', { name: 'bash_run', args: { command: 'echo hi' } }, 'work')
    expect(off.ok).toBe(false)
    expect(off.summary).toBe('工具暂时不可用')

    const wrongMode = await executeToolCall('u1', { name: 'bash_run', args: { command: 'echo hi' } }, 'chat')
    expect(wrongMode.ok).toBe(false)
    expect(wrongMode.summary).toBe('当前模式不支持该操作')
  })

  it('bash_run 启用时执行命令并回传退出码与输出', async () => {
    process.env.BASH_ENABLED = 'true'
    try {
      const run = await executeToolCall('u1', { name: 'bash_run', args: { command: `${JSON.stringify(process.execPath)} -e "console.log('agent-bash-ok')"` } }, 'work')
      expect(run.ok).toBe(true)
      expect(run.summary).toContain('已执行')
      expect(run.feedback).toContain('"exitCode":0')
      expect(run.feedback).toContain('agent-bash-ok')
    } finally {
      delete process.env.BASH_ENABLED
    }
  })
  it('use_skill 未启用时如实失败而不抛出；聊天模式被模式门拒绝', async () => {
    delete process.env.SKILLS_ENABLED
    const off = await executeToolCall('u1', { name: 'use_skill', args: { name: 'x' } }, 'work')
    expect(off.ok).toBe(false)
    expect(off.summary).toBe('工具暂时不可用')

    const wrongMode = await executeToolCall('u1', { name: 'use_skill', args: { name: 'x' } }, 'chat')
    expect(wrongMode.ok).toBe(false)
    expect(wrongMode.summary).toBe('当前模式不支持该操作')
  })

  it('use_skill 启用但技能不存在时 404 原文透传给模型', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'skills-'))
    process.env.SKILLS_ENABLED = 'true'
    process.env.SKILLS_DIR = dir
    try {
      const run = await executeToolCall('u1', { name: 'use_skill', args: { name: 'ghost' } }, 'work')
      expect(run.ok).toBe(false)
      expect(run.feedback).toContain('没有这个技能')
    } finally {
      delete process.env.SKILLS_ENABLED
      delete process.env.SKILLS_DIR
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('registerWorkTool（扩展注册口）', () => {
  it('注册后流式前缀门立即识别，工作模式可执行', async () => {
    const ok = registerWorkTool('ext_smoke_probe', {
      description: '{"tool":"ext_smoke_probe","args":{}} 冒烟探针',
      run: async () => ({ summary: '探针已执行', result: { probe: 1 } }),
    })
    expect(ok).toBe(true)
    expect(classifyToolPrefix('{"tool":"ext_smoke_probe","args":{}}')).toEqual({ name: 'ext_smoke_probe', args: {} })
    const run = await executeToolCall('u1', { name: 'ext_smoke_probe', args: {} }, 'work')
    expect(run.ok).toBe(true)
    expect(run.summary).toBe('探针已执行')
  })

  it('非法名与重名注册返回 false 且原工具不被覆盖', async () => {
    expect(registerWorkTool('Bad-Name', { description: 'x', run: async () => ({}) })).toBe(false)
    expect(registerWorkTool('add_todo', { description: 'x', run: async () => ({ summary: '覆盖版', result: null }) })).toBe(false)
    expect(registerWorkTool('ext_dup', { description: '{"tool":"ext_dup","args":{}}', run: async () => ({ summary: '原版', result: null }) })).toBe(true)
    expect(registerWorkTool('ext_dup', { description: 'x', run: async () => ({ summary: '覆盖版', result: null }) })).toBe(false)
    const run = await executeToolCall('u1', { name: 'ext_dup', args: {} }, 'work')
    expect(run.summary).toBe('原版')
  })
})
