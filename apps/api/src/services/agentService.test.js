import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
afterEach(() => vi.unstubAllEnvs())

const search = vi.hoisted(() => ({ searchWeb: vi.fn() }))

const db = vi.hoisted(() => ({
  taskCreate: vi.fn(),
  taskFindMany: vi.fn(),
  taskFindFirst: vi.fn(),
  taskUpdate: vi.fn(),
  taskDelete: vi.fn(),
  periodFindMany: vi.fn(),
  periodCreate: vi.fn(),
  diaryUpsert: vi.fn(),
  diaryFindUnique: vi.fn(),
  bookFindFirst: vi.fn(),
  bookCreate: vi.fn(),
  bookUpdate: vi.fn(),
  noteCreate: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    scheduledReminder: {
      create: db.taskCreate,
      findMany: db.taskFindMany,
      findFirst: db.taskFindFirst,
      update: db.taskUpdate,
      delete: db.taskDelete,
    },
    periodRecord: { findMany: db.periodFindMany, create: db.periodCreate },
    diaryEntry: {
      upsert: db.diaryUpsert,
      findUnique: db.diaryFindUnique,
    },
    book: {
      findFirst: db.bookFindFirst,
      create: db.bookCreate,
      update: db.bookUpdate,
    },
    readingNote: {
      create: db.noteCreate,
    },
  },
}))

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('./searchService.js', () => ({ searchWeb: search.searchWeb }))

import {
  buildNativeTools,
  buildToolSystemPrompt,
  executeToolCall,
  executeToolCallOnce,
} from './agentService.js'

// 日程、倒数日、两套提醒、手帐打卡与专注自习已由「安排」四件替代
const RETIRED_TOOLS = [
  'add_todo', 'list_todos', 'complete_todo', 'delete_todo', 'add_countdown', 'list_countdowns', 'delete_countdown',
  'list_reminders', 'set_reminder', 'add_scheduled_reminder', 'list_scheduled_reminders', 'delete_scheduled_reminder',
  'check_habit', 'habit_status', 'log_study',
]
const parseFeedback = (run) => JSON.parse(run.feedback.replace('工具执行结果：', '').split('（')[0])

describe('buildToolSystemPrompt', () => {
  it('lists every registered tool and the day anchor without leaking internals', () => {
    vi.stubEnv('SEARCH_ENABLED', 'true')
    const prompt = buildToolSystemPrompt(new Date(2026, 8, 4))
    for (const name of ['add_task', 'list_tasks', 'update_task', 'delete_task', 'record_period', 'period_status', 'add_diary', 'diary_status', 'log_reading', 'web_search']) {
      expect(prompt).toContain(`"tool":"${name}"`)
    }
    for (const name of RETIRED_TOOLS) {
      expect(prompt).not.toContain(`"tool":"${name}"`)
    }
    expect(prompt).toContain('今天是 2026-09-04')
    expect(prompt).not.toContain('memory')
    expect(prompt).not.toContain('generate_image')
    expect(prompt).not.toContain('browser_open')
    expect(prompt).not.toContain('use_skill')
  })

  it('网页版没有工具目录，也不执行任何工具', async () => {
    vi.stubEnv('APP_DISTRIBUTION', 'web')
    expect(buildToolSystemPrompt()).toContain('当前是网页版，仅进行聊天')
    expect(buildToolSystemPrompt()).not.toContain('"tool":')
    const run = await executeToolCall('u1', { name: 'add_task', args: { content: '复诊', date: '2026-09-19', time: '09:00' } })
    expect(run).toMatchObject({ ok: false, summary: '网页版不执行工具' })
    expect(db.taskCreate).not.toHaveBeenCalled()
  })
})

describe('executeToolCall', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('add_task creates a one-time task and returns a chip summary plus model feedback', async () => {
    db.taskCreate.mockImplementation(async ({ data }) => ({ id: 't1', ...data }))

    const run = await executeToolCall('u1', { name: 'add_task', args: { content: '  周六复诊  ', date: '2026-09-19', time: '09:30' } })

    expect(run.ok).toBe(true)
    expect(run.summary).toBe('已安排「周六复诊」')
    expect(db.taskCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: 'u1', content: '周六复诊', freq: 'once', time: '09:30', instruction: null,
      fireAt: new Date(2026, 8, 19, 9, 30), nextFireAt: new Date(2026, 8, 19, 9, 30),
    }) })
    expect(parseFeedback(run)).toMatchObject({ tool: 'add_task', ok: true, result: { id: 't1', freq: 'once' } })
  })

  it('add_task expresses birthdays as yearly and habits as daily', async () => {
    db.taskCreate.mockImplementation(async ({ data }) => ({ id: 't1', ...data }))

    expect((await executeToolCall('u1', { name: 'add_task', args: { content: '妈妈生日', freq: 'yearly', date: '1970-10-01', time: '09:00' } })).ok).toBe(true)
    expect(db.taskCreate).toHaveBeenLastCalledWith({ data: expect.objectContaining({ freq: 'yearly', fireAt: new Date(1970, 9, 1, 9, 0) }) })
    expect(db.taskCreate.mock.lastCall[0].data.nextFireAt.getMonth()).toBe(9)

    expect((await executeToolCall('u1', { name: 'add_task', args: { content: '打卡：喝水', freq: 'daily', time: '21:00' } })).ok).toBe(true)
    expect(db.taskCreate).toHaveBeenLastCalledWith({ data: expect.objectContaining({ freq: 'daily', time: '21:00', fireAt: null }) })
  })

  it('list_tasks returns compact JSON with ids, status and days left for dated tasks', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 8, 15, 22, 0))
      db.taskFindMany.mockResolvedValue([
        { id: 't1', content: '复诊', freq: 'once', time: '09:00', weekdays: [], monthDay: null, nextFireAt: new Date(2026, 8, 19, 9), status: 'active', instruction: null },
        { id: 't2', content: '打卡：喝水', freq: 'daily', time: '21:00', weekdays: [], monthDay: null, nextFireAt: new Date(2026, 8, 16, 21), status: 'paused', instruction: null },
        { id: 't3', content: '晨间简报', freq: 'daily', time: '08:00', weekdays: [], monthDay: null, nextFireAt: new Date(2026, 8, 16, 8), status: 'active', instruction: '查天气' },
      ])

      const run = await executeToolCall('u1', { name: 'list_tasks', args: {} })

      expect(run.summary).toBe('已查询3条安排')
      const { result } = parseFeedback(run)
      expect(result[0]).toMatchObject({ id: 't1', status: 'active', daysLeft: 4, isTask: false })
      expect(result[1]).toMatchObject({ id: 't2', status: 'paused' })
      expect(result[1]).not.toHaveProperty('daysLeft')
      expect(result[2]).toMatchObject({ id: 't3', isTask: true })
      expect(JSON.stringify(result)).not.toContain('查天气')
    } finally {
      vi.useRealTimers()
    }
  })

  it('update_task completes, pauses and reschedules through the ownership-checked service', async () => {
    const current = { id: 't1', userId: 'u1', content: '复诊', freq: 'once', time: '09:00', fireAt: new Date(2026, 8, 19, 9), weekdays: [], monthDay: null, status: 'active' }
    db.taskFindFirst.mockResolvedValue(current)
    db.taskUpdate.mockImplementation(async ({ data }) => ({ ...current, ...data }))

    const done = await executeToolCall('u1', { name: 'update_task', args: { id: 't1', status: 'done' } })
    expect(done.summary).toBe('已完成「复诊」')
    expect(db.taskUpdate).toHaveBeenLastCalledWith({ where: { id: 't1' }, data: { status: 'done' } })
    expect(db.taskFindFirst).toHaveBeenCalledWith({ where: { id: 't1', userId: 'u1' } })

    expect((await executeToolCall('u1', { name: 'update_task', args: { id: 't1', status: 'paused' } })).summary).toBe('已暂停「复诊」')

    const moved = await executeToolCall('u1', { name: 'update_task', args: { id: 't1', time: '15:00' } })
    expect(moved.summary).toBe('已改期「复诊」')
    expect(db.taskUpdate).toHaveBeenLastCalledWith({ where: { id: 't1' }, data: expect.objectContaining({ time: '15:00', nextFireAt: new Date(2026, 8, 19, 15) }) })
  })

  it('update_task needs at least one change and never touches another user\'s task', async () => {
    const empty = await executeToolCall('u1', { name: 'update_task', args: { id: 't1' } })
    expect(empty.ok).toBe(false)
    expect(empty.summary).toContain('至少一项')

    db.taskFindFirst.mockResolvedValue(null)
    const foreign = await executeToolCall('u1', { name: 'update_task', args: { id: 't9', status: 'done' } })
    expect(foreign.ok).toBe(false)
    expect(foreign.summary).toContain('不存在')
    expect(db.taskUpdate).not.toHaveBeenCalled()
  })

  it('delete_task removes an owned task', async () => {
    db.taskFindFirst.mockResolvedValue({ id: 't1', userId: 'u1' })
    db.taskDelete.mockResolvedValue({ id: 't1' })

    const run = await executeToolCall('u1', { name: 'delete_task', args: { id: 't1' } })

    expect(run).toMatchObject({ ok: true, summary: '已删除安排' })
    expect(db.taskDelete).toHaveBeenCalledWith({ where: { id: 't1' } })
  })

  it('reports validation failures to the model instead of throwing', async () => {
    const run = await executeToolCall('u1', { name: 'add_task', args: { content: '', time: '09:00', date: '2026-09-19' } })

    expect(run.ok).toBe(false)
    expect(run.summary).toContain('内容')
    expect(run.feedback).toContain('"ok":false')
    expect(db.taskCreate).not.toHaveBeenCalled()
  })

  it.each(RETIRED_TOOLS)('retired tool %s is unknown, with no side effects', async (name) => {
    const run = await executeToolCall('u1', { name, args: { content: '复诊', type: 'water', name: '喝水', minutes: 25 } })

    expect(run.ok).toBe(false)
    expect(run.feedback).toContain('未知工具')
    expect(db.taskCreate).not.toHaveBeenCalled()
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
    db.taskFindMany.mockRejectedValue(new Error('database gone'))

    const run = await executeToolCall('u1', { name: 'list_tasks', args: {} })

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

})

describe('executeToolCallOnce（回路级去重）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('executes an identical call only once and feeds back a dedupe notice', async () => {
    db.taskCreate.mockImplementation(async ({ data }) => ({ id: 't1', ...data }))
    const executed = new Map()

    const first = await executeToolCallOnce('u1', { name: 'add_task', args: { content: '复诊', date: '2026-09-19', time: '09:00' } }, executed)
    const second = await executeToolCallOnce('u1', { name: 'add_task', args: { content: '复诊', date: '2026-09-19', time: '09:00' } }, executed)

    expect(first.ok).toBe(true)
    expect(db.taskCreate).toHaveBeenCalledTimes(1)
    expect(second).toMatchObject({ ok: true, deduplicated: true })
    expect(second.feedback).toContain('请勿重复调用')
  })

  it('replays a failed result without claiming success or repeating a possible partial write', async () => {
    db.taskCreate.mockRejectedValue(new Error('database unavailable'))
    const executed = new Map()
    const call = { name: 'add_task', args: { content: '复诊', date: '2026-09-19', time: '09:00' } }

    const first = await executeToolCallOnce('u1', call, executed)
    const second = await executeToolCallOnce('u1', call, executed)

    expect(first).toMatchObject({ ok: false, summary: '工具暂时不可用' })
    expect(second).toMatchObject({ ok: false, summary: first.summary, deduplicated: true })
    expect(second.feedback).toContain('"ok":false')
    expect(second.feedback).not.toContain('已成功执行')
    expect(db.taskCreate).toHaveBeenCalledTimes(1)
  })

  it('shares an in-flight execution without reporting success before it finishes', async () => {
    let release
    db.taskCreate.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    const executed = new Map()
    const call = { name: 'add_task', args: { content: '复诊', date: '2026-09-19', time: '09:00' } }
    const first = executeToolCallOnce('u1', call, executed)
    let duplicateSettled = false
    const second = executeToolCallOnce('u1', call, executed).then((result) => {
      duplicateSettled = true
      return result
    })
    await Promise.resolve()

    expect(db.taskCreate).toHaveBeenCalledTimes(1)
    expect(duplicateSettled).toBe(false)
    release({ id: 't1', content: '复诊', freq: 'once', nextFireAt: new Date(2026, 8, 19, 9) })
    const [initial, duplicate] = await Promise.all([first, second])
    expect(initial.ok).toBe(true)
    expect(duplicate).toMatchObject({ ok: true, deduplicated: true })
    expect(duplicate.feedback).toContain('"id":"t1"')
  })

  it('allows corrected arguments after a validation failure', async () => {
    db.taskCreate.mockImplementation(async ({ data }) => ({ id: 't1', ...data }))
    const executed = new Map()
    const failed = await executeToolCallOnce('u1', { name: 'add_task', args: { content: '复诊', date: '2026-09-19' } }, executed)
    const corrected = await executeToolCallOnce('u1', { name: 'add_task', args: { content: '复诊', date: '2026-09-19', time: '09:00' } }, executed)

    expect(failed.ok).toBe(false)
    expect(corrected.ok).toBe(true)
    expect(db.taskCreate).toHaveBeenCalledTimes(1)
  })

  it('treats different args as distinct operations', async () => {
    db.taskCreate.mockImplementation(async ({ data }) => ({ id: 't1', ...data }))
    const executed = new Map()

    await executeToolCallOnce('u1', { name: 'add_task', args: { content: '复诊', date: '2026-09-19', time: '09:00' } }, executed)
    const other = await executeToolCallOnce('u1', { name: 'add_task', args: { content: '喝水', freq: 'daily', time: '10:00' } }, executed)

    expect(other.ok).toBe(true)
    expect(db.taskCreate).toHaveBeenCalledTimes(2)
  })

  it('does not repeat a side effect when the model reorders argument keys', async () => {
    db.taskCreate.mockImplementation(async ({ data }) => ({ id: 't1', ...data }))
    const executed = new Map()
    await executeToolCallOnce('u1', { name: 'add_task', args: { content: '复诊', date: '2026-09-13', time: '09:00', metadata: { a: 1, b: 2 } } }, executed)
    const repeated = await executeToolCallOnce('u1', { name: 'add_task', args: { metadata: { b: 2, a: 1 }, time: '09:00', date: '2026-09-13', content: '复诊' } }, executed)

    expect(repeated).toMatchObject({ ok: true, deduplicated: true })
    expect(db.taskCreate).toHaveBeenCalledTimes(1)
  })
})

describe('智能体日记工具', () => {
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

})

describe('add_diary 按天去重签名', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deduplicates same-day diary writes even with different args', async () => {
    db.diaryUpsert.mockImplementation(async ({ create }) => ({ id: 'd1', day: create.day, mood: create.mood, content: create.content }))
    const executed = new Map()

    const first = await executeToolCallOnce('u1', { name: 'add_diary', args: { content: '上午开心' } }, executed)
    const second = await executeToolCallOnce('u1', { name: 'add_diary', args: { content: '下午也开心', mood: 'happy' } }, executed)

    expect(first.ok).toBe(true)
    expect(db.diaryUpsert).toHaveBeenCalledTimes(1)
    expect(second).toMatchObject({ ok: true, deduplicated: true })
  })
})

describe('唯一工具目录', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('一份目录同时含陪伴、安排与办事工具，外加做事规则；不含已删除或未启用的执行类工具', () => {
    vi.stubEnv('SEARCH_ENABLED', 'true')
    const prompt = buildToolSystemPrompt()
    for (const name of ['add_task', 'list_tasks', 'update_task', 'delete_task', 'add_diary', 'record_period', 'log_reading', 'calc_convert', 'web_search']) {
      expect(prompt).toContain(`"tool":"${name}"`)
    }
    expect(prompt).toContain('用户交办任务')
    expect(prompt).toContain('保持你的说话方式')
    for (const name of RETIRED_TOOLS) {
      expect(prompt).not.toContain(`"tool":"${name}"`)
    }
    for (const name of ['browser_open', 'generate_image', 'bash_run', 'use_skill']) {
      expect(prompt).not.toContain(`"tool":"${name}"`)
    }
  })

  it('记日记与计算在同一目录里都能执行，不再有模式门', async () => {
    db.diaryUpsert.mockImplementation(async ({ create }) => ({ id: 'd1', day: create.day, mood: create.mood, content: create.content }))
    expect((await executeToolCall('u1', { name: 'add_diary', args: { content: '今天很开心' } })).ok).toBe(true)
    expect((await executeToolCall('u1', { name: 'calc_convert', args: { expression: '1+1' } })).summary).toBe('已算出 2')
  })

  it('原生函数工具覆盖整份目录，每个都有参数结构', () => {
    vi.stubEnv('WORK_NATIVE_TOOLS', 'true')
    const tools = buildNativeTools()
    for (const name of ['add_task', 'record_period', 'add_diary', 'log_reading', 'calc_convert']) {
      expect(tools.find(tool => tool.function.name === name)?.function.parameters).toMatchObject({ type: 'object' })
    }
    expect(tools.every(tool => tool.function.parameters?.type === 'object')).toBe(true)
    expect(buildNativeTools(['list_tasks']).map(tool => tool.function.name)).toEqual(['list_tasks'])
  })

  it('未配置搜索时不向模型虚报联网工具', () => {
    vi.stubEnv('SEARCH_ENABLED', 'false')
    const prompt = buildToolSystemPrompt()
    expect(prompt).not.toContain('"tool":"web_search"')
    expect(prompt).toContain('联网搜索未启用')
  })

  it('原型属性不是可执行工具，取消的请求不再执行', async () => {
    expect((await executeToolCall('u1', { name: 'constructor', args: {} })).ok).toBe(false)
    const controller = new AbortController()
    controller.abort()
    await expect(executeToolCall('u1', { name: 'calc_convert', args: { expression: '1+1' } }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('calc_convert 计算算式、换算单位，错误反馈给模型而不抛出', async () => {
    const calc = await executeToolCall('u1', { name: 'calc_convert', args: { expression: '(3+5)*2' } })
    expect(calc.ok).toBe(true)
    expect(calc.summary).toBe('已算出 16')

    const conv = await executeToolCall('u1', { name: 'calc_convert', args: { value: 1, from: 'kg', to: 'jin' } })
    expect(conv.ok).toBe(true)
    expect(conv.feedback).toContain('"value":2')

    const zero = await executeToolCall('u1', { name: 'calc_convert', args: { expression: '1/0' } })
    expect(zero.ok).toBe(false)
    expect(zero.summary).toBe('算式无效')

    const cross = await executeToolCall('u1', { name: 'calc_convert', args: { value: 1, from: 'kg', to: 'm' } })
    expect(cross.ok).toBe(false)
    expect(cross.summary).toBe('不支持该单位换算')
  })


  it('联网搜索上游 503 时如实失败而不抛出', async () => {
    search.searchWeb.mockRejectedValue(Object.assign(new Error('联网搜索未启用'), { statusCode: 503 }))
    const run = await executeToolCall('u1', { name: 'web_search', args: { query: 'x' } })
    expect(run.ok).toBe(false)
    expect(run.summary).toBe('工具暂时不可用')
  })

  it('web_search 关键词为空时 400 原文透传给模型', async () => {
    search.searchWeb.mockRejectedValue(Object.assign(new Error('搜索关键词不能为空'), { statusCode: 400 }))
    const run = await executeToolCall('u1', { name: 'web_search', args: { query: '  ' } })
    expect(run.ok).toBe(false)
    expect(run.feedback).toContain('搜索关键词不能为空')
  })

})
