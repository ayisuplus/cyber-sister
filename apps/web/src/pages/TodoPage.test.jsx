import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/toolsService', () => ({
  toolsService: {
    getTodos: vi.fn(),
    createTodo: vi.fn(),
    updateTodo: vi.fn(),
    deleteTodo: vi.fn(),
  },
}))

import { toolsService } from '../services/toolsService'
import { useToolsStore } from '../stores/toolsStore'
import TodoPage from './TodoPage'

const renderPage = () => render(<MemoryRouter><TodoPage /></MemoryRouter>)

// 固定「今天」为 2026-09-05（本地日历日），分组断言不随运行日期漂移
const FROZEN_NOW = new Date(2026, 8, 5, 10, 0, 0)
const dayIso = (yyyyMmDd) => `${yyyyMmDd}T00:00:00.000Z`

const makeTodo = (overrides) => ({
  id: Math.random().toString(36).slice(2),
  content: '日程',
  isDone: false,
  dueDate: null,
  dueTime: null,
  createdAt: FROZEN_NOW.toISOString(),
  ...overrides,
})

describe('TodoPage（日程）', () => {
  beforeEach(() => {
    vi.setSystemTime(FROZEN_NOW)
    useToolsStore.setState({ todos: [] })
    toolsService.getTodos.mockResolvedValue([])
    toolsService.createTodo.mockImplementation(async (content, dueDate, dueTime) => makeTodo({
      id: 'new-1',
      content,
      dueDate: dueDate ? dayIso(dueDate) : null,
      dueTime: dueTime || null,
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads todos from the server on mount', async () => {
    toolsService.getTodos.mockResolvedValue([makeTodo({ id: 't9', content: '来自服务端的日程' })])
    renderPage()

    expect(toolsService.getTodos).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('来自服务端的日程')).toBeInTheDocument()
  })

  it('shows the empty state without any todos', async () => {
    renderPage()

    expect(await screen.findByText('暂无日程')).toBeInTheDocument()
  })

  it('shows a loading status until the first load settles', () => {
    toolsService.getTodos.mockReturnValue(new Promise(() => {}))
    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent('加载中…')
  })

  it('shows a retryable error when loading fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    toolsService.getTodos.mockRejectedValueOnce(new Error('offline'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('加载失败，请检查网络后重试')

    toolsService.getTodos.mockResolvedValue([makeTodo({ id: 't1', content: '恢复的日程' })])
    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('恢复的日程')).toBeInTheDocument()
    expect(toolsService.getTodos).toHaveBeenCalledTimes(2)
  })

  it('creates a schedule item with date and time', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /添加日程/ }))
    await user.type(screen.getByLabelText('日程内容'), '  给妈妈打电话  ')
    await user.type(screen.getByLabelText('日期（可选）'), '2026-09-06')
    await user.type(screen.getByLabelText('时间（可选）'), '09:30')
    await user.click(screen.getByRole('button', { name: '添加' }))

    expect(toolsService.createTodo).toHaveBeenCalledWith('给妈妈打电话', '2026-09-06', '09:30')
    expect(await screen.findByText('给妈妈打电话')).toBeInTheDocument()
    expect(screen.queryByLabelText('日程内容')).not.toBeInTheDocument()
  })

  it('adds an undated item by pressing Enter', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /添加日程/ }))
    await user.type(screen.getByLabelText('日程内容'), '喝水{Enter}')

    expect(toolsService.createTodo).toHaveBeenCalledWith('喝水', undefined, undefined)
    expect(await screen.findByText('喝水')).toBeInTheDocument()
  })

  it('does not add an item while the IME is composing', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /添加日程/ }))
    const input = screen.getByLabelText('日程内容')
    await user.type(input, '喝水')
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    Object.defineProperty(event, 'isComposing', { value: true })
    fireEvent(input, event)

    expect(toolsService.createTodo).not.toHaveBeenCalled()
    expect(input).toHaveValue('喝水')
  })

  it('refuses a time without a date and keeps the draft', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /添加日程/ }))
    await user.type(screen.getByLabelText('日程内容'), '复诊')
    await user.type(screen.getByLabelText('时间（可选）'), '08:00')
    await user.click(screen.getByRole('button', { name: '添加' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('先选日期，再选时间')
    expect(toolsService.createTodo).not.toHaveBeenCalled()
    expect(screen.getByLabelText('日程内容')).toHaveValue('复诊')
  })

  it('refuses to create a blank todo', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /添加日程/ }))
    await user.click(screen.getByRole('button', { name: '添加' }))

    expect(toolsService.createTodo).not.toHaveBeenCalled()
  })

  it('cancelling the input discards the draft', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /添加日程/ }))
    await user.type(screen.getByLabelText('日程内容'), '不要的草稿')
    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.queryByLabelText('日程内容')).not.toBeInTheDocument()
    expect(toolsService.createTodo).not.toHaveBeenCalled()
  })

  it('groups items into an overdue → today → tomorrow → later → undated → done timeline', async () => {
    toolsService.getTodos.mockResolvedValue([
      makeTodo({ id: 't-today-late', content: '今天下午的事', dueDate: dayIso('2026-09-05'), dueTime: '14:00' }),
      makeTodo({ id: 't-done', content: '已完成的事', isDone: true }),
      makeTodo({ id: 't-undated', content: '没定日子的事' }),
      makeTodo({ id: 't-today-early', content: '今天一早的事', dueDate: dayIso('2026-09-05'), dueTime: '09:00' }),
      makeTodo({ id: 't-later', content: '下周的事', dueDate: dayIso('2026-09-10') }),
      makeTodo({ id: 't-tomorrow', content: '明天的事', dueDate: dayIso('2026-09-06') }),
      makeTodo({ id: 't-overdue', content: '前天没做完', dueDate: dayIso('2026-09-03') }),
    ])
    renderPage()

    // 分组标题全部出现
    expect(await screen.findByText('已过期 (1)')).toBeInTheDocument()
    expect(screen.getByText('今天 · 9月5日 (2)')).toBeInTheDocument()
    expect(screen.getByText('明天 · 9月6日 (1)')).toBeInTheDocument()
    expect(screen.getByText(/9月10日/)).toBeInTheDocument()
    expect(screen.getByText('无日期 (1)')).toBeInTheDocument()
    expect(screen.getByText('已完成 (1)')).toBeInTheDocument()

    // 组顺序：已过期在最前，已完成在最后
    const headings = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(headings[0]).toBe('已过期 (1)')
    expect(headings[headings.length - 1]).toBe('已完成 (1)')

    // 今天组内按时间升序
    const todayCard = screen.getByText('今天 · 9月5日 (2)').closest('div').parentElement
    const times = within(todayCard).getAllByText(/^([01]\d|2[0-3]):[0-5]\d$/).map(el => el.textContent)
    expect(times).toEqual(['09:00', '14:00'])

    // 已过期组显示原始日期，已完成加删除线
    const overdueCard = screen.getByText('已过期 (1)').closest('div').parentElement
    expect(within(overdueCard).getByText(/9月3日/)).toBeInTheDocument()
    expect(screen.getByText('已完成的事')).toHaveClass('line-through')
  })

  it('moves an item to the done group when toggled', async () => {
    const user = userEvent.setup()
    toolsService.updateTodo.mockResolvedValue(makeTodo({ id: 't1', content: '日程', isDone: true }))
    toolsService.getTodos.mockResolvedValue([makeTodo({ id: 't1', content: '日程' })])
    renderPage()

    await user.click(await screen.findByRole('button', { name: '标记完成：日程' }))

    expect(toolsService.updateTodo).toHaveBeenCalledWith('t1', { isDone: true })
    expect(await screen.findByText('已完成 (1)')).toBeInTheDocument()
  })

  it('deletes an item', async () => {
    const user = userEvent.setup()
    toolsService.deleteTodo.mockResolvedValue({})
    toolsService.getTodos.mockResolvedValue([makeTodo({ id: 't1', content: '将被删除' })])
    renderPage()

    await user.click(await screen.findByRole('button', { name: '删除：将被删除' }))

    expect(toolsService.deleteTodo).toHaveBeenCalledWith('t1')
    expect(await screen.findByText('暂无日程')).toBeInTheDocument()
  })
})
