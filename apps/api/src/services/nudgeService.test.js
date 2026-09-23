import { beforeEach, describe, expect, it, vi } from 'vitest'

const reminders = vi.hoisted(() => ({
  listDueReminders: vi.fn(),
  listTodaysDeliveries: vi.fn(),
  ackDelivery: vi.fn(),
  claimTaskDelivery: vi.fn(),
  completeTaskDelivery: vi.fn(),
  failTaskDelivery: vi.fn(),
}))
const care = vi.hoisted(() => ({ listTodaysCare: vi.fn(), dismissTouchpoint: vi.fn() }))
const letters = vi.hoisted(() => ({ generateDueLetter: vi.fn(), findLatestLetter: vi.fn() }))

const followUps = vi.hoisted(() => ({ listDueFollowUps: vi.fn(), listAskedToday: vi.fn(), markFollowUpAsked: vi.fn() }))

vi.mock('./reminderService.js', () => reminders)
vi.mock('./followUpService.js', () => followUps)
vi.mock('./careService.js', () => care)
vi.mock('./letterService.js', () => letters)
vi.mock('../utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { ackNudge, describeRecentNudges, listNudges } from './nudgeService.js'

const NOW = new Date('2026-09-20T09:00:00.000Z')
const task = (overrides = {}) => ({ id: 'd1', status: 'pending', result: null, reminder: { id: 'r1', content: '总结日记', instruction: '帮我总结' }, ...overrides })

beforeEach(() => {
  vi.clearAllMocks()
  followUps.listDueFollowUps.mockResolvedValue([])
  followUps.listAskedToday.mockResolvedValue([])
  followUps.markFollowUpAsked.mockResolvedValue({ success: true })
  reminders.listDueReminders.mockResolvedValue([])
  care.listTodaysCare.mockResolvedValue([])
  letters.generateDueLetter.mockResolvedValue({ letter: null, created: false })
  letters.findLatestLetter.mockResolvedValue(null)
})

describe('她主动说的话', () => {
  it('到点提醒、关心和她的来信合成一条时间线，每条都说得清为什么出现', async () => {
    reminders.listDueReminders.mockResolvedValue([{ id: 'd9', status: 'pending', result: null, reminder: { content: '喝水', freq: 'daily', time: '10:00', instruction: null } }])
    care.listTodaysCare.mockResolvedValue([{ key: 'birthday:profile:2026-09-20', kind: 'birthday', title: '今天是你生日', body: '生日快乐。', reason: '你在资料里填的生日', action: { to: '/chat', label: '去找她聊聊' }, dismissed: false }])
    letters.findLatestLetter.mockResolvedValue({ id: 'l1', content: '见信好。', readAt: null })

    const nudges = await listNudges('user-1', NOW)

    expect(nudges.map((nudge) => nudge.id)).toEqual(['reminder:d9', 'care:birthday:profile:2026-09-20', 'letter:l1'])
    expect(nudges[0]).toMatchObject({ kind: 'reminder', content: '喝水', reason: '你在日历上定的（每天 10:00）' })
    expect(nudges[1]).toMatchObject({ kind: 'care', content: '今天是你生日\n生日快乐。', reason: '你在资料里填的生日', action: { to: '/chat', label: '去找她聊聊' } })
    expect(nudges[2]).toMatchObject({ kind: 'letter', content: '见信好。', reason: '她写给你的信' })
    expect(letters.generateDueLetter).toHaveBeenCalledWith('user-1', { now: NOW })
  })

  it('最新那封读过就不再出便签', async () => {
    letters.findLatestLetter.mockResolvedValue({ id: 'l1', content: '见信好。', readAt: new Date() })

    expect(await listNudges('user-1', NOW)).toEqual([])
  })

  it('来信便签带上信的 id 和逐条建议；她自己的上下文仍然只看正文', async () => {
    const suggestions = [{ kind: 'edit_memory', title: '把这条改准确', quote: '喜欢桂花味', chatText: '就按你信里说的改吧', decided: null }]
    letters.findLatestLetter.mockResolvedValue({ id: 'l1', content: '见信好。', readAt: null, suggestions })
    reminders.listTodaysDeliveries.mockResolvedValue([])

    const [nudge] = await listNudges('user-1', NOW)

    expect(nudge).toMatchObject({ id: 'letter:l1', kind: 'letter', letterId: 'l1', suggestions })
    expect(await describeRecentNudges('user-1', NOW)).toEqual([{ kind: 'letter', content: '见信好。' }])
  })

  it('没有建议的来信也带空数组，不缺字段', async () => {
    letters.findLatestLetter.mockResolvedValue({ id: 'l1', content: '见信好。', readAt: null })

    expect((await listNudges('user-1', NOW))[0].suggestions).toEqual([])
  })

  it('云端执行没接通的任务保持待处理，重复打开也不领取、不执行、不推进调度', async () => {
    reminders.listDueReminders.mockResolvedValue([
      task(),
      { id: 'd2', status: 'pending', result: null, reminder: { content: '喝水', instruction: null } },
      task({ id: 'd3', result: '之前真实完成的结果' }),
    ])

    const first = await listNudges('user-1', NOW)
    const second = await listNudges('user-1', NOW)

    expect(first.map((nudge) => nudge.id)).toEqual(['reminder:d2', 'reminder:d3'])
    expect(first.find((nudge) => nudge.id === 'reminder:d3')).toMatchObject({ detail: '之前真实完成的结果', reason: '你交给她的事' })
    expect(second.map((nudge) => nudge.id)).toEqual(first.map((nudge) => nudge.id))
    expect(reminders.claimTaskDelivery).not.toHaveBeenCalled()
    expect(reminders.completeTaskDelivery).not.toHaveBeenCalled()
    expect(reminders.failTaskDelivery).not.toHaveBeenCalled()
  })

  it('一处取不到不影响其它几处，也不让对话打不开', async () => {
    reminders.listDueReminders.mockRejectedValue(new Error('db down'))
    care.listTodaysCare.mockResolvedValue([{ key: 'mood:2026-09-20', body: '昨天不太好过', reason: '昨天的心情', dismissed: false }])
    letters.generateDueLetter.mockRejectedValue(new Error('db down'))

    const nudges = await listNudges('user-1', NOW)

    expect(nudges.map((nudge) => nudge.id)).toEqual(['care:mood:2026-09-20'])
  })

  it('「知道了」按来源交回各自的领域服务', async () => {
    expect(await ackNudge('user-1', 'reminder:d1', 'shown')).toEqual({ success: true })
    expect(reminders.ackDelivery).toHaveBeenCalledWith('d1', 'user-1', 'shown')
    await ackNudge('user-1', 'reminder:d1', 'dismissed')
    expect(reminders.ackDelivery).toHaveBeenLastCalledWith('d1', 'user-1', 'dismissed')

    await ackNudge('user-1', 'care:birthday:profile:2026-09-20')
    expect(care.dismissTouchpoint).toHaveBeenCalledWith('user-1', 'birthday:profile:2026-09-20')

    // 信的「知道了」只收起便签，不写读过（读没读由看信页记）
    expect(await ackNudge('user-1', 'letter:l1')).toEqual({ success: true })
  })

  it('不认识的来源和空引用一律 404', async () => {
    for (const id of ['', 'nope', 'reminder:', 'unknown:x']) {
      await expect(ackNudge('user-1', id)).rejects.toMatchObject({ statusCode: 404 })
    }
    expect(reminders.ackDelivery).not.toHaveBeenCalled()
  })
})

describe('她今天说过的话（给她自己的上下文）', () => {
  beforeEach(() => {
    reminders.listTodaysDeliveries.mockResolvedValue([{ id: 'd1', status: 'acked', reminder: { content: '该喝水啦' } }])
    care.listTodaysCare.mockResolvedValue([{ key: 'mood:x', title: '', body: '昨天好像不太开心', reason: '你昨天的心情', dismissed: true }])
    letters.findLatestLetter.mockResolvedValue({ id: 'l1', content: '你们聊了 23 轮', readAt: new Date() })
  })

  it('点过「知道了」的也算，信读没读都算', async () => {
    const said = await describeRecentNudges('u1', NOW)

    expect(said).toEqual([
      { kind: 'reminder', content: '该喝水啦' },
      { kind: 'care', content: '昨天好像不太开心' },
      { kind: 'letter', content: '你们聊了 23 轮' },
    ])
  })

  it('只读：不建投递、不顺手写信', async () => {
    await describeRecentNudges('u1', NOW)

    expect(reminders.listDueReminders).not.toHaveBeenCalled()
    expect(letters.generateDueLetter).not.toHaveBeenCalled()
    expect(care.dismissTouchpoint).not.toHaveBeenCalled()
  })

  it('一处取不到（包括同步抛错）就当那处没有，其余照常', async () => {
    reminders.listTodaysDeliveries.mockImplementation(() => { throw new Error('db down') })
    letters.findLatestLetter.mockRejectedValue(new Error('db down'))

    const said = await describeRecentNudges('u1', NOW)

    expect(said).toEqual([{ kind: 'care', content: '昨天好像不太开心' }])
  })
})

describe('她惦记的事', () => {
  it('到了日子，她在对话末尾问一句，并说清为什么', async () => {
    followUps.listDueFollowUps.mockResolvedValue([{ id: 'f1', about: '周三答辩', ask: '答辩怎么样了？', askOn: new Date('2026-09-24T00:00:00Z') }])

    const nudges = await listNudges('u1', NOW)

    expect(nudges).toContainEqual({ id: 'followup:f1', kind: 'followup', content: '答辩怎么样了？', reason: '你之前说过：周三答辩' })
  })

  it('点「知道了」就记为问过', async () => {
    await ackNudge('u1', 'followup:f1', 'dismissed')
    expect(followUps.markFollowUpAsked).toHaveBeenCalledWith('u1', 'f1')
  })

  it('她知道自己今天问过什么，好接住你的回答', async () => {
    reminders.listTodaysDeliveries.mockResolvedValue([])
    care.listTodaysCare.mockResolvedValue([])
    letters.findLatestLetter.mockResolvedValue(null)
    followUps.listAskedToday.mockResolvedValue([{ ask: '答辩怎么样了？' }])

    expect(await describeRecentNudges('u1', NOW)).toEqual([{ kind: 'followup', content: '答辩怎么样了？' }])
  })

  it('她主动说的一天至多三条：惦记的事在前，其次关心，最后是信；你定的到点提醒不算在内', async () => {
    reminders.listDueReminders.mockResolvedValue([
      { id: 'd1', status: 'pending', result: null, reminder: { content: '喝水', instruction: null } },
      { id: 'd2', status: 'pending', result: null, reminder: { content: '吃药', instruction: null } },
    ])
    followUps.listDueFollowUps.mockResolvedValue([{ id: 'f1', about: '周三答辩', ask: '答辩怎么样了？' }])
    care.listTodaysCare.mockResolvedValue([
      { key: 'task-today:all', body: '甲', reason: '安排', dismissed: false },
      { key: 'task-soon:t2', body: '乙', reason: '安排', dismissed: false },
      { key: 'mood:x', body: '丙', reason: '心情', dismissed: false },
    ])
    letters.findLatestLetter.mockResolvedValue({ id: 'l1', content: '见信好。', readAt: null })

    const nudges = await listNudges('u1', NOW)

    expect(nudges.map((nudge) => nudge.id)).toEqual(['reminder:d1', 'reminder:d2', 'followup:f1', 'care:task-today:all', 'care:task-soon:t2'])
  })

  it('今天已经问过、点过的也占位，收起一条不会让后面的补上来', async () => {
    followUps.listAskedToday.mockResolvedValue([{ id: 'f0', about: '面试', ask: '面试顺利吗？' }])
    care.listTodaysCare.mockResolvedValue([
      { key: 'task-today:all', body: '甲', reason: '安排', dismissed: true },
      { key: 'task-soon:t2', body: '乙', reason: '安排', dismissed: false },
      { key: 'mood:x', body: '丙', reason: '心情', dismissed: false },
    ])
    letters.findLatestLetter.mockResolvedValue({ id: 'l1', content: '见信好。', readAt: null })

    expect((await listNudges('u1', NOW)).map((nudge) => nudge.id)).toEqual(['care:task-soon:t2'])
    // 她今天说过的，也是同样这三条
    reminders.listTodaysDeliveries.mockResolvedValue([])
    letters.findLatestLetter.mockResolvedValue(null)
    expect((await describeRecentNudges('u1', NOW)).map((item) => item.content)).toEqual(['面试顺利吗？', '甲', '乙'])
  })

  it('这一处取不到也不影响其他的', async () => {
    followUps.listDueFollowUps.mockRejectedValue(new Error('db down'))
    reminders.listDueReminders.mockResolvedValue([{ id: 'd9', status: 'pending', result: null, reminder: { content: '喝水', freq: 'daily', time: '10:00', instruction: null } }])

    const nudges = await listNudges('u1', NOW)

    expect(nudges.map((nudge) => nudge.kind)).toEqual(['reminder'])
  })
})
