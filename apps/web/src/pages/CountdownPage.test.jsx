import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { differenceInDays } from 'date-fns'
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
import CountdownPage from './CountdownPage'

const renderPage = () => render(<MemoryRouter><CountdownPage /></MemoryRouter>)

const expectedDays = (targetDate) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return differenceInDays(new Date(targetDate), today)
}

describe('CountdownPage', () => {
  beforeEach(() => {
    useToolsStore.setState({ countdowns: [] })
    toolsService.getCountdowns.mockResolvedValue([])
  })

  it('loads countdowns from the server on mount', async () => {
    toolsService.getCountdowns.mockResolvedValue([{ id: 'c8', title: '服务端倒数日', targetDate: '2099-12-31' }])
    renderPage()

    expect(toolsService.getCountdowns).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('服务端倒数日')).toBeInTheDocument()
  })
  it('shows the empty state without countdowns', async () => {
    renderPage()

    expect(await screen.findByText('暂无倒数日')).toBeInTheDocument()
  })

  it('shows a loading status until the first load settles', () => {
    toolsService.getCountdowns.mockReturnValue(new Promise(() => {}))
    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent('加载中…')
  })

  it('shows a retryable error when loading fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    toolsService.getCountdowns.mockRejectedValueOnce(new Error('offline'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('加载失败，请检查网络后重试')

    toolsService.getCountdowns.mockResolvedValue([{ id: 'c1', title: '恢复的倒数日', targetDate: '2099-12-31' }])
    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('恢复的倒数日')).toBeInTheDocument()
    expect(toolsService.getCountdowns).toHaveBeenCalledTimes(2)
  })

  it('counts down the remaining days for a future date', async () => {
    toolsService.getCountdowns.mockResolvedValue([{ id: 'c1', title: '纪念日', targetDate: '2099-12-31' }])
    renderPage()

    expect(await screen.findByText(String(expectedDays('2099-12-31')))).toBeInTheDocument()
    expect(screen.getByText('天后')).toBeInTheDocument()
    expect(screen.getByText('2099-12-31')).toBeInTheDocument()
  })

  it('marks a past date as already elapsed', async () => {
    toolsService.getCountdowns.mockResolvedValue([{ id: 'c1', title: '上次旅行', targetDate: '2000-01-01' }])
    renderPage()

    expect(await screen.findByText(`已过 ${Math.abs(expectedDays('2000-01-01'))} 天`)).toBeInTheDocument()
  })

  it('creates a countdown through the form', async () => {
    const user = userEvent.setup()
    toolsService.createCountdown.mockImplementation(async (title, targetDate) => ({ id: 'c9', title, targetDate }))
    renderPage()

    await user.click(screen.getByRole('button', { name: /添加倒数日/ }))
    await user.type(screen.getByPlaceholderText('倒数日名称'), '  演唱会  ')
    // jsdom 不支持原生日期选择器，直接触发 change
    fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '2099-05-01' } })
    await user.click(screen.getByRole('button', { name: '添加' }))

    expect(toolsService.createCountdown).toHaveBeenCalledWith('演唱会', '2099-05-01')
    expect(await screen.findByText('演唱会')).toBeInTheDocument()
  })

  it('refuses to add a countdown without title or date', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /添加倒数日/ }))
    await user.click(screen.getByRole('button', { name: '添加' }))

    expect(toolsService.createCountdown).not.toHaveBeenCalled()
  })

  it('cancelling the form hides it again', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /添加倒数日/ }))
    expect(screen.getByPlaceholderText('倒数日名称')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByPlaceholderText('倒数日名称')).not.toBeInTheDocument()
  })

  it('deletes a countdown', async () => {
    const user = userEvent.setup()
    toolsService.deleteCountdown.mockResolvedValue({})
    toolsService.getCountdowns.mockResolvedValue([{ id: 'c1', title: '将被删除', targetDate: '2099-12-31' }])
    renderPage()

    const card = (await screen.findByText('将被删除')).closest('div').parentElement.parentElement
    const deleteButton = card.querySelector('button')
    await user.click(deleteButton)

    expect(toolsService.deleteCountdown).toHaveBeenCalledWith('c1')
    expect(await screen.findByText('暂无倒数日')).toBeInTheDocument()
  })
})
