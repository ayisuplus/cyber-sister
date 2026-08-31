import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/authService', () => ({
  authService: {
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    updatePersona: vi.fn(),
  },
}))

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

import { authService } from '../services/authService'
import { useAuthStore } from '../stores/authStore'
import { toolsService } from '../services/toolsService'
import { useToolsStore } from '../stores/toolsStore'
import { useChatStore } from '../stores/chatStore'
import SettingsPage from './SettingsPage'

const renderPage = () => render(
  <MemoryRouter initialEntries={['/settings']}>
    <Routes>
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/login" element={<h1>登录页</h1>} />
      <Route path="/profile/memories" element={<h1>记忆页</h1>} />
    </Routes>
  </MemoryRouter>,
)

describe('SettingsPage', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: 'token',
      user: { id: 'u1' },
      isLoggedIn: true,
    })
    useChatStore.setState({ conversations: [], currentConversationId: null, messages: [] })
    useToolsStore.setState({ reminders: [] })
    toolsService.getReminders.mockResolvedValue([
      { id: 'r-water', type: 'water', time: '08:00', isActive: true },
      { id: 'r-sleep', type: 'sleep', time: '23:00', isActive: true },
      { id: 'r-period', type: 'period', time: '09:00', isActive: true },
    ])
  })

  const toggleOf = (label) => screen.getByText(label).closest('div').querySelector('button')

  it('renders all four notification switches enabled by default', async () => {
    renderPage()

    expect(toolsService.getReminders).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      for (const label of ['主动关怀消息', '喝水提醒', '睡觉提醒', '大姨妈提醒']) {
        expect(toggleOf(label).querySelector('svg')).toHaveClass('text-brand-pink')
      }
    })
  })

  it('flips a reminder switch off and back on through the server', async () => {
    const user = userEvent.setup()
    toolsService.updateReminder
      .mockResolvedValueOnce({ id: 'r-water', type: 'water', isActive: false })
      .mockResolvedValueOnce({ id: 'r-water', type: 'water', isActive: true })
    renderPage()

    await waitFor(() => expect(toggleOf('喝水提醒').querySelector('svg')).toHaveClass('text-brand-pink'))

    await user.click(toggleOf('喝水提醒'))
    expect(toolsService.updateReminder).toHaveBeenCalledWith('r-water', { isActive: false })
    await waitFor(() => expect(toggleOf('喝水提醒').querySelector('svg')).toHaveClass('text-text-muted'))

    await user.click(toggleOf('喝水提醒'))
    expect(toolsService.updateReminder).toHaveBeenCalledWith('r-water', { isActive: true })
    await waitFor(() => expect(toggleOf('喝水提醒').querySelector('svg')).toHaveClass('text-brand-pink'))

    // 其它开关不受影响
    expect(toggleOf('睡觉提醒').querySelector('svg')).toHaveClass('text-brand-pink')
  })

  it('disables reminder switches the server has no record for', async () => {
    toolsService.getReminders.mockResolvedValue([])
    renderPage()

    await waitFor(() => expect(toggleOf('喝水提醒')).toBeDisabled())
    expect(toggleOf('喝水提醒').querySelector('svg')).toHaveClass('text-text-muted')
    // 本地开关不受影响
    expect(toggleOf('主动关怀消息').querySelector('svg')).toHaveClass('text-brand-pink')
  })

  it('navigates to the memory management page', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /记忆管理/ }))

    expect(await screen.findByRole('heading', { name: '记忆页' })).toBeInTheDocument()
  })

  it('asks for confirmation before deleting the account and can cancel', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /注销账号/ }))
    expect(screen.getByText('确认注销？')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByText('确认注销？')).not.toBeInTheDocument()
    expect(authService.logout).not.toHaveBeenCalled()
  })

  it('logs out and returns to login after confirming account deletion', async () => {
    const user = userEvent.setup()
    authService.logout.mockResolvedValue({ success: true })
    renderPage()

    await user.click(screen.getByRole('button', { name: /注销账号/ }))
    await user.click(screen.getByRole('button', { name: '确认注销' }))

    expect(authService.logout).toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: '登录页' })).toBeInTheDocument()
    expect(useAuthStore.getState().isLoggedIn).toBe(false)
  })

  it('shows static app information', () => {
    renderPage()

    expect(screen.getByText('1.0.0')).toBeInTheDocument()
    expect(screen.getByText('用户协议')).toBeInTheDocument()
  })
})
