import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
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
  },
}))
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

import { toolsService } from '../services/toolsService'
import { reminderService } from '../services/reminderService'
import { useToolsStore } from '../stores/toolsStore'
import PlannerPage from './PlannerPage'

const renderPage = (entry = '/tools/planner') =>
  render(<MemoryRouter initialEntries={[entry]}><PlannerPage /></MemoryRouter>)

describe('PlannerPage（日程与提醒）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useToolsStore.setState({ todos: [], countdowns: [], scheduledReminders: [], dueDeliveries: [] })
    toolsService.getTodos.mockResolvedValue([])
    toolsService.getCountdowns.mockResolvedValue([])
    reminderService.list.mockResolvedValue([])
  })

  it('默认渲染「日程」页签', async () => {
    renderPage()

    expect(await screen.findByText('暂无日程')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /添加日程/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '日程' })).toHaveAttribute('aria-pressed', 'true')
    expect(toolsService.getTodos).toHaveBeenCalledTimes(1)
    expect(toolsService.getCountdowns).not.toHaveBeenCalled()
  })

  it('?tab=countdown 落到「倒数日」页签', async () => {
    renderPage('/tools/planner?tab=countdown')

    expect(await screen.findByText('暂无倒数日')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '倒数日' })).toHaveAttribute('aria-pressed', 'true')
    expect(toolsService.getCountdowns).toHaveBeenCalledTimes(1)
    expect(toolsService.getTodos).not.toHaveBeenCalled()
  })

  it('?tab=reminders 落到「提醒」页签', async () => {
    renderPage('/tools/planner?tab=reminders')

    expect(await screen.findByText('还没有自定义提醒')).toBeInTheDocument()
    expect(reminderService.list).toHaveBeenCalledTimes(1)
  })

  it('点击页签切换内容并同步 URL', async () => {
    const user = userEvent.setup()
    // MemoryRouter 不写 window.location，用探针读取路由内 location
    let capturedSearch = ''
    const LocationProbe = () => { capturedSearch = useLocation().search; return null }
    render(
      <MemoryRouter initialEntries={['/tools/planner']}>
        <PlannerPage />
        <LocationProbe />
      </MemoryRouter>,
    )

    expect(await screen.findByText('暂无日程')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '倒数日' }))
    expect(await screen.findByText('暂无倒数日')).toBeInTheDocument()
    expect(screen.queryByText('暂无日程')).not.toBeInTheDocument()
    expect(capturedSearch).toBe('?tab=countdown')

    await user.click(screen.getByRole('button', { name: '提醒' }))
    expect(await screen.findByText('还没有自定义提醒')).toBeInTheDocument()
    expect(capturedSearch).toBe('?tab=reminders')
  })
})
