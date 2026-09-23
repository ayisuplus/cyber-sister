import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/reminderService', () => ({
  reminderService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    listDue: vi.fn(),
    ack: vi.fn(),
  },
}))
vi.mock('../services/toolsService', () => ({
  toolsService: {
    getPeriodRecords: vi.fn(),
    createPeriodRecord: vi.fn(),
    getPeriodSummary: vi.fn(),
    updatePeriodRecord: vi.fn(),
    deletePeriodRecord: vi.fn(),
    getPeriodConsent: vi.fn(),
    setPeriodConsent: vi.fn(),
    getPeriodTone: vi.fn(),
    setPeriodTone: vi.fn(),
  },
}))
vi.mock('../services/diaryService', () => ({
  diaryService: {
    listMonth: vi.fn(),
    getDay: vi.fn(),
    saveDay: vi.fn(),
    removeDay: vi.fn(),
  },
}))
vi.mock('../services/readingService', () => ({
  readingService: {
    listBooks: vi.fn(),
    addBook: vi.fn(),
    updateBook: vi.fn(),
    deleteBook: vi.fn(),
    saveProgress: vi.fn(),
    listNotes: vi.fn(),
    addNote: vi.fn(),
    listNotesBetween: vi.fn(),
    listRecentNotes: vi.fn(),
    logNote: vi.fn(),
    deleteNote: vi.fn(),
  },
}))

import { reminderService } from '../services/reminderService'
import { toolsService } from '../services/toolsService'
import { diaryService } from '../services/diaryService'
import { readingService } from '../services/readingService'
import { useToolsStore } from '../stores/toolsStore'
import CalendarPage from './CalendarPage'

// 固定本地时间：2026-09-15（周二）10:00；只伪造 Date，不影响 RTL 的等待计时
const NOW = new Date(2026, 8, 15, 10, 0)
const at = (day, hour, minute = 0) => new Date(2026, 8, day, hour, minute).toISOString()

const makeTask = (overrides) => ({
  id: 't1', content: '取快递', freq: 'once', time: '18:00', weekdays: [], monthDay: null,
  nextFireAt: at(15, 18), status: 'active', instruction: null,
  ...overrides,
})

const renderPage = () => render(<MemoryRouter><CalendarPage /></MemoryRouter>)
const dayPanel = () => screen.getByRole('group', { name: '这一天' })
// 「记一件事」有两个入口：面板里的（预填选中日）与底部条的
const openForm = () => fireEvent.click(screen.getAllByRole('button', { name: '记一件事' }).at(-1))
const openFormForDay = () => fireEvent.click(within(dayPanel()).getByRole('button', { name: '记一件事' }))
const save = () => fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }))
// 一处事可能同时出现在「这一天」和分组列表里：行内按钮点任一处都行，取第一个
const clickWhenReady = async (label) => {
  await vi.waitFor(() => expect(screen.getAllByRole('button', { name: label })[0]).toBeEnabled())
  fireEvent.click(screen.getAllByRole('button', { name: label })[0])
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.clearAllMocks()
  useToolsStore.setState({ scheduledReminders: [], periodRecords: [] })
  reminderService.list.mockResolvedValue([])
  reminderService.create.mockImplementation(async (payload) => makeTask({ id: 'new-1', nextFireAt: at(16, 9), ...payload }))
  reminderService.update.mockImplementation(async (id, payload) => makeTask({ id, ...payload }))
  reminderService.remove.mockResolvedValue({ ok: true })
  toolsService.getPeriodConsent.mockResolvedValue({ accepted: true, updatedAt: '2026-09-01T00:00:00.000Z' })
  toolsService.getPeriodRecords.mockResolvedValue([])
  toolsService.getPeriodSummary.mockResolvedValue({ nextDate: null, daysUntil: null })
  toolsService.getPeriodTone.mockResolvedValue({ enabled: false, updatedAt: null })
  toolsService.setPeriodConsent.mockResolvedValue({ accepted: true, updatedAt: '2026-09-01T00:00:00.000Z' })
  toolsService.createPeriodRecord.mockImplementation(async (startDate, endDate, cycleDays) => ({ id: 'p-new', startDate, endDate, cycleDays }))
  toolsService.updatePeriodRecord.mockImplementation(async (id, payload) => ({ id, startDate: '2026-09-10', endDate: '2026-09-12', ...payload }))
  toolsService.deletePeriodRecord.mockResolvedValue({ success: true })
  // 默认：这天还没有日记（404）、也没有读书笔记
  diaryService.getDay.mockRejectedValue({ response: { status: 404 } })
  readingService.listNotesBetween.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('月历合一（安排与经期同一页）', () => {
  it('经期日标「经期中」，有事的日子标「有 N 件事」，点开就看到当天的事', async () => {
    reminderService.list.mockResolvedValue([
      makeTask({ id: 't1', content: '复诊', freq: 'once', time: '09:30', nextFireAt: at(19, 9, 30) }),
    ])
    toolsService.getPeriodRecords.mockResolvedValue([{ id: 'p1', startDate: '2026-09-12', endDate: '2026-09-16', cycleDays: 28 }])
    toolsService.getPeriodSummary.mockResolvedValue({ nextDate: '2026-10-10', daysUntil: 21, overdueDays: 0 })
    renderPage()

    expect(await screen.findByRole('button', { name: '9月13日，经期中', exact: true })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '9月19日，有 1 件事', exact: true }))
    expect(within(dayPanel()).getByText('复诊')).toBeInTheDocument()
  })

  it('恰标出记录里的每个经期日，含开始与结束那天，还能翻月', async () => {
    toolsService.getPeriodRecords.mockResolvedValue([{ id: 'p1', startDate: '2026-08-29', endDate: '2026-08-31', cycleDays: 28 }])
    renderPage()
    await screen.findByRole('button', { name: '9月15日', exact: true })

    const heading = screen.getByText(/^\d{4}年\d{1,2}月$/)
    fireEvent.click(screen.getByRole('button', { name: '上个月' }))
    expect(heading).toHaveTextContent('2026年8月')
    expect(screen.getByRole('button', { name: '8月29日，经期中', exact: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '8月30日，经期中', exact: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '8月31日，经期中', exact: true })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /，经期中/ })).toHaveLength(3)

    fireEvent.click(screen.getByRole('button', { name: '下个月' }))
    expect(heading).toHaveTextContent('2026年9月')
  })

  it('倒数按服务端的预测显示，不在本地另算一套', async () => {
    toolsService.getPeriodRecords.mockResolvedValue([{ id: 'p1', startDate: '2026-09-01', endDate: null, cycleDays: 28 }])
    toolsService.getPeriodSummary.mockResolvedValue({ nextDate: '2026-09-19', daysUntil: 4 })
    const { container } = renderPage()
    await screen.findByRole('button', { name: '9月15日', exact: true })

    expect(container.querySelector('.text-6xl')).toHaveTextContent('4')
    expect(screen.getByText(/预计 9月19日/)).toBeInTheDocument()
  })

  it('晚了就如实写晚了几天，不钉在「还有 0 天」', async () => {
    toolsService.getPeriodSummary.mockResolvedValue({ nextDate: '2026-09-17', daysUntil: 0, overdueDays: 4 })
    renderPage()

    expect((await screen.findByText('比预计晚了')).parentElement).toHaveTextContent(/^比预计晚了4天/)
    expect(screen.queryByText('距离下次大姨妈还有')).not.toBeInTheDocument()
  })
})

describe('经期同意', () => {
  it('没同意可查看旧记录，但不推算或画标注；点同意才开始', async () => {
    toolsService.getPeriodConsent.mockResolvedValue({ accepted: false, updatedAt: null })
    toolsService.getPeriodRecords.mockResolvedValue([{ id: 'p1', startDate: '2026-09-12', endDate: '2026-09-16', cycleDays: 28 }])
    toolsService.setPeriodConsent.mockResolvedValue({ accepted: true, updatedAt: '2026-09-19T00:00:00.000Z' })
    renderPage()

    expect(await screen.findByRole('heading', { name: '记录经期之前' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '同意并开始记录' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /经期中/ })).not.toBeInTheDocument()
    expect(await screen.findByText('已有记录')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除 2026-09-12 的记录' })).toBeInTheDocument()
    expect(toolsService.getPeriodRecords).toHaveBeenCalled()
    expect(toolsService.getPeriodSummary).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '同意并开始记录' }))
    await vi.waitFor(() => expect(toolsService.setPeriodConsent).toHaveBeenCalledWith(true))
    await vi.waitFor(() => expect(toolsService.getPeriodRecords).toHaveBeenCalled())
  })

  it('撤回后仍能删除旧记录', async () => {
    toolsService.getPeriodConsent.mockResolvedValue({ accepted: false, updatedAt: null })
    toolsService.getPeriodRecords.mockResolvedValue([{ id: 'p1', startDate: '2026-09-12', endDate: null, cycleDays: 28 }])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '删除 2026-09-12 的记录' }))
    const dialog = screen.getByRole('alertdialog', { name: '删除经期记录' })
    fireEvent.click(within(dialog).getByRole('button', { name: '删除记录' }))
    await vi.waitFor(() => expect(toolsService.deletePeriodRecord).toHaveBeenCalledWith('p1'))
  })

  it('撤回同意后不再读取，「顾及周期」的开关跟着消失', async () => {
    toolsService.setPeriodConsent.mockResolvedValue({ accepted: false, updatedAt: null })
    renderPage()

    await screen.findByRole('switch', { name: '聊天时让她顾及你的周期' })
    fireEvent.click(screen.getByRole('button', { name: '撤回同意' }))
    await vi.waitFor(() => expect(toolsService.setPeriodConsent).toHaveBeenCalledWith(false))
    expect(await screen.findByRole('heading', { name: '记录经期之前' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: '聊天时让她顾及你的周期' })).not.toBeInTheDocument()
  })

  it('「顾及周期」是记录同意之外单独的一项开关', async () => {
    toolsService.setPeriodTone.mockResolvedValue({ enabled: true, updatedAt: '2026-09-21T00:00:00.000Z' })
    renderPage()

    const tone = await screen.findByRole('switch', { name: '聊天时让她顾及你的周期' })
    expect(screen.getByText(/她不会主动提起，也不会记下来/)).toBeInTheDocument()
    await vi.waitFor(() => expect(tone).toBeEnabled())
    expect(tone).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(tone)
    expect(toolsService.setPeriodTone).toHaveBeenCalledWith(true)
    await vi.waitFor(() => expect(tone).toHaveAttribute('aria-checked', 'true'))
  })
})

describe('这一天的面板', () => {
  it('点某天后，「在这天记经期」和「记一件事」都带着这一天', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '9月20日', exact: true }))

    fireEvent.click(within(dayPanel()).getByRole('button', { name: '在这天记经期' }))
    expect(screen.getByLabelText('开始日期')).toHaveValue('2026-09-20')
    fireEvent.click(screen.getByRole('button', { name: '取消', exact: true }))

    openFormForDay()
    expect(screen.getByLabelText('日期')).toHaveValue('2026-09-20')
  })

  it('在这天记经期：保存就按这一天新建记录', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '9月20日', exact: true }))
    fireEvent.click(within(dayPanel()).getByRole('button', { name: '在这天记经期' }))
    fireEvent.click(screen.getByRole('button', { name: '保存记录', exact: true }))
    await vi.waitFor(() => expect(toolsService.createPeriodRecord).toHaveBeenCalledWith('2026-09-20', null, 28))
  })

  it('保存失败保留表单里的改动，重试成功才落库并刷新预测', async () => {
    toolsService.getPeriodRecords.mockResolvedValue([{ id: 'p1', startDate: '2026-09-10', endDate: '2026-09-12', cycleDays: 28 }])
    toolsService.updatePeriodRecord
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(async (_id, payload) => {
        toolsService.getPeriodRecords.mockResolvedValue([{ id: 'p1', startDate: '2026-09-10', endDate: '2026-09-12', ...payload }])
        toolsService.getPeriodSummary.mockResolvedValue({ nextDate: '2026-09-30', daysUntil: 15 })
        return { id: 'p1', startDate: '2026-09-10', endDate: '2026-09-12', ...payload }
      })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: '9月10日，经期中', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: '编辑 2026-09-10 的记录' }))
    fireEvent.change(screen.getByLabelText('周期天数'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: '保存记录', exact: true }))
    expect(await screen.findByRole('alert')).toHaveTextContent('记录内容已保留')
    expect(screen.getByLabelText('周期天数')).toHaveValue(30)

    fireEvent.click(screen.getByRole('button', { name: '保存记录', exact: true }))
    await vi.waitFor(() => expect(screen.getByText('周期 30 天')).toBeInTheDocument())
    expect(toolsService.updatePeriodRecord).toHaveBeenLastCalledWith('p1', { startDate: '2026-09-10', endDate: '2026-09-12', cycleDays: 30 })
    expect(toolsService.getPeriodSummary).toHaveBeenCalledTimes(2)
  })

  it('删除经期记录要确认；删失败记录还在，确认成功才消失', async () => {
    toolsService.getPeriodRecords.mockResolvedValue([{ id: 'p1', startDate: '2026-09-10', endDate: '2026-09-12', cycleDays: 28 }])
    toolsService.deletePeriodRecord
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(async () => {
        toolsService.getPeriodRecords.mockResolvedValue([])
        return { success: true }
      })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: '9月10日，经期中', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: '删除 2026-09-10 的记录' }))
    expect(toolsService.deletePeriodRecord).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog', { name: '删除经期记录' })
    expect(within(dialog).getByText('删除后无法恢复，确定删除这条记录吗？')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: '删除记录', exact: true }))
    expect(await within(screen.getByRole('alertdialog', { name: '删除经期记录' })).findByRole('alert')).toHaveTextContent('删除失败')
    expect(screen.getByRole('button', { name: '删除 2026-09-10 的记录' })).toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('alertdialog', { name: '删除经期记录' })).getByRole('button', { name: '删除记录', exact: true }))
    await vi.waitFor(() => expect(toolsService.deletePeriodRecord).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: /，经期中/ })).not.toBeInTheDocument())
  })
})

describe('那天的记录', () => {
  const note = {
    id: 'n1', bookId: 'b1', book: '活着', page: 3, content: '记下这一段',
    quote: '人是为了活着本身而活着的', locator: 'loc-3', aiComment: null, aiCommentSource: null,
    createdAt: '2026-09-15T21:00:00.000Z',
  }

  it('当天有日记、读书笔记、又在经期里：三类行都在，读书笔记能回到书里这一处', async () => {
    diaryService.getDay.mockResolvedValue({ id: 'd1', day: '2026-09-15', mood: 'happy', content: '今天走了很远' })
    readingService.listNotesBetween.mockResolvedValue([note])
    toolsService.getPeriodRecords.mockResolvedValue([{ id: 'p1', startDate: '2026-09-12', endDate: '2026-09-16', cycleDays: 28 }])
    renderPage()

    const block = await screen.findByRole('group', { name: '那天的记录' })
    expect(within(block).getByText('今天走了很远')).toBeInTheDocument()
    expect(within(block).getByText('开心')).toBeInTheDocument()
    expect(within(block).getByText(/《活着》/)).toBeInTheDocument()
    expect(within(block).getByText('人是为了活着本身而活着的')).toBeInTheDocument()
    expect(within(block).getByRole('link', { name: '回到书里这一处' })).toHaveAttribute('href', '/tools/reading/b1?at=loc-3')
    expect(within(block).getByText('经期中')).toBeInTheDocument()
    await vi.waitFor(() => expect(diaryService.getDay).toHaveBeenCalledWith('2026-09-15'))
    expect(readingService.listNotesBetween).toHaveBeenCalledWith({ from: '2026-09-15', to: '2026-09-15' })
  })

  it('当天没有日记、没有读书笔记、不在经期里：「那天的记录」整块不出现', async () => {
    renderPage()
    await screen.findByRole('group', { name: '这一天' })
    await vi.waitFor(() => expect(diaryService.getDay).toHaveBeenCalled())
    await vi.waitFor(() => expect(readingService.listNotesBetween).toHaveBeenCalled())
    expect(screen.queryByRole('group', { name: '那天的记录' })).not.toBeInTheDocument()
  })
})

describe('事的列表', () => {
  it.each(['daily', 'weekly', 'monthly', 'yearly'])('结束 %s 的整个重复系列，并移入已完成', async freq => {
    const task = makeTask({ content: '散步', freq })
    reminderService.list.mockResolvedValue([task])
    reminderService.update.mockResolvedValue({ ...task, status: 'done' })
    renderPage()
    await clickWhenReady('结束重复：散步')
    await vi.waitFor(() => expect(reminderService.update).toHaveBeenCalledWith('t1', { status: 'done' }))
    await vi.waitFor(() => expect(screen.queryAllByText('散步')).toHaveLength(0))
    fireEvent.click(screen.getByRole('button', { name: /已完成 · 1/ }))
    expect(screen.getByText('散步')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '结束重复：散步' })).not.toBeInTheDocument()
  })

  it('按今天 / 接下来 / 重复 / 已暂停分组，接下来显示还有几天，已完成默认收起', async () => {
    reminderService.list.mockResolvedValue([
      makeTask({ id: 'a', content: '复诊', nextFireAt: at(15, 18) }),
      makeTask({ id: 'b', content: '面试', nextFireAt: at(16, 9) }),
      makeTask({ id: 'c', content: '妈妈生日', freq: 'yearly', time: '09:00', nextFireAt: at(20, 9) }),
      makeTask({ id: 'd', content: '打卡：喝水', freq: 'daily', time: '21:00', nextFireAt: at(15, 21) }),
      makeTask({ id: 'e', content: '交房租', freq: 'monthly', monthDay: 1, time: '09:00', status: 'paused', nextFireAt: at(30, 9) }),
      makeTask({ id: 'f', content: '寄快递', status: 'done', nextFireAt: at(14, 9) }),
    ])
    renderPage()

    const today = await screen.findByRole('region', { name: '今天' })
    expect(within(today).getByText('复诊')).toBeInTheDocument()
    expect(within(today).getByText('今天 18:00')).toBeInTheDocument()

    const upcoming = screen.getByRole('region', { name: '接下来' })
    expect(within(upcoming).getByText('明天')).toBeInTheDocument()
    expect(within(upcoming).getByText('还有 5 天')).toBeInTheDocument()
    expect(within(upcoming).getByText('每年 9月20日 09:00')).toBeInTheDocument()

    expect(within(screen.getByRole('region', { name: '重复' })).getByText('每天 21:00')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '已暂停' })).getByText('交房租')).toBeInTheDocument()

    expect(screen.queryByText('寄快递')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /已完成 · 1/ }))
    expect(screen.getByText('寄快递')).toBeInTheDocument()
  })

  it('完成、暂停、继续与删除都走 store 动作', async () => {
    const tasks = [
      makeTask({}),
      makeTask({ id: 't2', content: '打卡：喝水', freq: 'daily', time: '21:00', status: 'paused', nextFireAt: at(15, 21) }),
    ]
    reminderService.list.mockResolvedValue(tasks)
    reminderService.update.mockImplementation(async (id, payload) => ({ ...tasks.find(task => task.id === id), ...payload }))
    renderPage()
    await screen.findByRole('region', { name: '今天' })

    await clickWhenReady('完成：取快递')
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /已完成 · 1/ })).toBeInTheDocument())
    expect(reminderService.update).toHaveBeenCalledWith('t1', { status: 'done' })

    expect(screen.queryByLabelText('完成：打卡：喝水')).not.toBeInTheDocument()
    await clickWhenReady('继续：打卡：喝水')
    await vi.waitFor(() => expect(screen.getAllByLabelText('暂停：打卡：喝水').length).toBeGreaterThan(0))
    expect(reminderService.update).toHaveBeenCalledWith('t2', { status: 'active' })

    await clickWhenReady('暂停：打卡：喝水')
    await vi.waitFor(() => expect(screen.getAllByLabelText('继续：打卡：喝水').length).toBeGreaterThan(0))
    expect(reminderService.update).toHaveBeenCalledWith('t2', { status: 'paused' })

    await clickWhenReady('删除：打卡：喝水')
    await vi.waitFor(() => expect(screen.queryAllByText('打卡：喝水')).toHaveLength(0))
    expect(reminderService.remove).toHaveBeenCalledWith('t2')
  })

  it('删除失败保留记录并可再次提交', async () => {
    reminderService.list.mockResolvedValue([makeTask({})])
    reminderService.remove.mockRejectedValueOnce(new Error('offline'))
    renderPage()
    await screen.findByRole('region', { name: '今天' })
    await clickWhenReady('删除：取快递')
    expect(await screen.findByRole('alert')).toHaveTextContent('记录还在')
    expect(screen.getAllByText('取快递').length).toBeGreaterThan(0)
    await clickWhenReady('删除：取快递')
    expect(await screen.findByText('日历还是空的')).toBeInTheDocument()
  })

  it('空列表给出安静的引导，也提示可以在对话里说', async () => {
    renderPage()
    expect(await screen.findByText('日历还是空的')).toBeInTheDocument()
    expect(screen.getByText(/明天九点提醒我复诊/)).toBeInTheDocument()
  })

  it('加载失败时给出重试', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    reminderService.list.mockRejectedValueOnce(new Error('offline'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('日历没加载出来')
    reminderService.list.mockResolvedValue([makeTask({})])
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findByRole('region', { name: '今天' })).toBeInTheDocument()
  })
})

describe('记一件事的表单', () => {
  it('一次的事缺日期、时间已过都拦在前端，不调接口', async () => {
    renderPage()
    await screen.findByText('日历还是空的')
    openForm()
    fireEvent.change(screen.getByLabelText('要记的事'), { target: { value: '取快递' } })
    fireEvent.change(screen.getByLabelText('时间'), { target: { value: '18:00' } })
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('一次的事要选日期')

    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-09-15' } })
    fireEvent.change(screen.getByLabelText('时间'), { target: { value: '08:00' } })
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('这个时间已经过去了')
    expect(reminderService.create).not.toHaveBeenCalled()
  })

  it('每天的小习惯：保存后收起表单并出现在「重复」里', async () => {
    renderPage()
    await screen.findByText('日历还是空的')
    openForm()
    fireEvent.click(screen.getByRole('button', { name: '每天', exact: true }))
    fireEvent.change(screen.getByLabelText('要记的事'), { target: { value: '放下手机' } })
    fireEvent.change(screen.getByLabelText('时间'), { target: { value: '23:00' } })
    save()
    const repeating = await screen.findByRole('region', { name: '重复' })
    expect(within(repeating).getByText('放下手机')).toBeInTheDocument()
    expect(reminderService.create).toHaveBeenCalledWith({ content: '放下手机', freq: 'daily', time: '23:00' })
    expect(screen.queryByRole('form', { name: '记一件事' })).not.toBeInTheDocument()
  })

  it('每年的事要选日期；每年的日子适合生日和纪念日', async () => {
    renderPage()
    await screen.findByText('日历还是空的')
    openForm()
    fireEvent.click(screen.getByRole('button', { name: '每年', exact: true }))
    expect(screen.getByText(/适合生日和纪念日/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('要记的事'), { target: { value: '妈妈生日' } })
    fireEvent.change(screen.getByLabelText('时间'), { target: { value: '09:00' } })
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('每年的事要选日期')
    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '1970-10-01' } })
    save()
    await vi.waitFor(() => expect(reminderService.create).toHaveBeenCalledWith({ content: '妈妈生日', freq: 'yearly', time: '09:00', date: '1970-10-01' }))
  })

  it('先写下要记的事才能存', async () => {
    renderPage()
    await screen.findByText('日历还是空的')
    openForm()
    fireEvent.change(screen.getByLabelText('时间'), { target: { value: '18:00' } })
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('先写下要记的事吧')
    expect(reminderService.create).not.toHaveBeenCalled()
  })

  it('交给她：缺指令拦截；保存后如实标注云端执行未接通', async () => {
    reminderService.create.mockRejectedValueOnce(new Error('offline'))
    renderPage()
    await screen.findByText('日历还是空的')
    openForm()
    fireEvent.click(screen.getByRole('button', { name: '交给她去做' }))
    expect(screen.getByText(/云端执行还没接通，到点不会自动去做/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '每天', exact: true }))
    fireEvent.change(screen.getByLabelText('这件事叫什么'), { target: { value: '早安打气' } })
    fireEvent.change(screen.getByLabelText('时间'), { target: { value: '08:00' } })
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('告诉她具体要做什么')

    fireEvent.change(screen.getByLabelText('要她做什么'), { target: { value: '给我一句带劲的早安加油' } })
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败')
    expect(screen.getByLabelText('要她做什么')).toHaveValue('给我一句带劲的早安加油')

    save()
    await vi.waitFor(() => expect(screen.getAllByText('云端执行未接通 · 到点暂不执行').length).toBeGreaterThan(0))
    expect(reminderService.create).toHaveBeenLastCalledWith({ content: '早安打气', freq: 'daily', time: '08:00', instruction: '给我一句带劲的早安加油' })
  })
})
