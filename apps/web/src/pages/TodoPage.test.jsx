import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/toolsService', () => ({
  toolsService: {
    getTodos: vi.fn(),
    createTodo: vi.fn(),
    updateTodo: vi.fn(),
    deleteTodo: vi.fn(),
    getCountdowns: vi.fn(),
    createCountdown: vi.fn(),
    deleteCountdown: vi.fn(),
    getPeriodRecords: vi.fn(),
    createPeriodRecord: vi.fn(),
    getReminders: vi.fn(),
    updateReminder: vi.fn(),
    getWeather: vi.fn(),
  },
}))

import { toolsService } from '../services/toolsService'
import { useToolsStore } from '../stores/toolsStore'
import TodoPage from './TodoPage'

const renderPage = () => render(<MemoryRouter><TodoPage /></MemoryRouter>)

describe('TodoPage', () => {
  beforeEach(() => {
    useToolsStore.setState({ todos: [] })
    toolsService.getTodos.mockResolvedValue([])
  })

  it('loads todos from the server on mount', async () => {
    toolsService.getTodos.mockResolvedValue([{ id: 't9', content: '来自服务端的待办', isDone: false }])
    renderPage()

    expect(toolsService.getTodos).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('来自服务端的待办')).toBeInTheDocument()
  })
  it('shows the empty state without any todos', () => {
    renderPage()

    expect(screen.getByText('暂无待办事项')).toBeInTheDocument()
  })

  it('creates a todo from the inline input', async () => {
    const user = userEvent.setup()
    toolsService.createTodo.mockImplementation(async (content) => ({ id: 't1', content, isDone: false }))
    renderPage()

    await user.click(screen.getByRole('button', { name: /添加待办/ }))
    const input = screen.getByPlaceholderText('输入待办内容...')
    await user.type(input, '  给妈妈打电话  ')
    await user.click(screen.getByRole('button', { name: '添加' }))

    expect(toolsService.createTodo).toHaveBeenCalledWith('给妈妈打电话', undefined)
    expect(await screen.findByText('给妈妈打电话')).toBeInTheDocument()
    // 输入框收起，等待下一条
    expect(screen.queryByPlaceholderText('输入待办内容...')).not.toBeInTheDocument()
  })

  it('adds a todo by pressing Enter', async () => {
    const user = userEvent.setup()
    toolsService.createTodo.mockImplementation(async (content) => ({ id: 't1', content, isDone: false }))
    renderPage()

    await user.click(screen.getByRole('button', { name: /添加待办/ }))
    await user.type(screen.getByPlaceholderText('输入待办内容...'), '喝水{Enter}')

    expect(toolsService.createTodo).toHaveBeenCalledWith('喝水', undefined)
    expect(await screen.findByText('喝水')).toBeInTheDocument()
  })

  it('refuses to create a blank todo', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /添加待办/ }))
    await user.click(screen.getByRole('button', { name: '添加' }))

    expect(toolsService.createTodo).not.toHaveBeenCalled()
  })

  it('cancelling the input discards the draft', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /添加待办/ }))
    await user.type(screen.getByPlaceholderText('输入待办内容...'), '不要的草稿')
    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.queryByPlaceholderText('输入待办内容...')).not.toBeInTheDocument()
    expect(toolsService.createTodo).not.toHaveBeenCalled()
  })

  it('splits pending and done todos into their own sections', async () => {
    toolsService.getTodos.mockResolvedValue([
      { id: 't1', content: '未完成的事', isDone: false, dueDate: '2026-08-30' },
      { id: 't2', content: '已完成的事', isDone: true },
    ])
    renderPage()

    expect(await screen.findByText('待完成 (1)')).toBeInTheDocument()
    expect(screen.getByText('已完成 (1)')).toBeInTheDocument()
    expect(screen.getByText('已完成的事')).toHaveClass('line-through')
    expect(screen.getByText('2026-08-30')).toBeInTheDocument()
  })

  it('moves a todo to the done section when toggled', async () => {
    const user = userEvent.setup()
    toolsService.updateTodo.mockResolvedValue({ id: 't1', content: '待办', isDone: true })
    toolsService.getTodos.mockResolvedValue([{ id: 't1', content: '待办', isDone: false }])
    renderPage()

    const pendingSection = (await screen.findByText('待完成 (1)')).closest('div').parentElement
    await user.click(within(pendingSection).getAllByRole('button')[0])

    expect(toolsService.updateTodo).toHaveBeenCalledWith('t1', { isDone: true })
    expect(await screen.findByText('已完成 (1)')).toBeInTheDocument()
  })

  it('deletes a todo', async () => {
    const user = userEvent.setup()
    toolsService.deleteTodo.mockResolvedValue({})
    toolsService.getTodos.mockResolvedValue([{ id: 't1', content: '将被删除', isDone: false }])
    renderPage()

    const row = (await screen.findByText('将被删除')).closest('div').parentElement
    const buttons = within(row).getAllByRole('button')
    await user.click(buttons[buttons.length - 1])

    expect(toolsService.deleteTodo).toHaveBeenCalledWith('t1')
    expect(await screen.findByText('暂无待办事项')).toBeInTheDocument()
  })
})
