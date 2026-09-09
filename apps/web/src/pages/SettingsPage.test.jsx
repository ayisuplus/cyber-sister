import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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

vi.mock('../services/userService', () => ({
  profileService: { get: vi.fn(), update: vi.fn() },
}))

import { toolsService } from '../services/toolsService'
import { useToolsStore } from '../stores/toolsStore'
import { profileService } from '../services/userService'
import SettingsPage from './SettingsPage'

const renderPage = () => render(
  <MemoryRouter initialEntries={['/settings']}>
    <Routes>
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/profile/memories" element={<h1>记忆页</h1>} />
    </Routes>
  </MemoryRouter>,
)

describe('SettingsPage', () => {
  beforeEach(() => {
    useToolsStore.setState({ reminders: [] })
    toolsService.getReminders.mockResolvedValue([
      { id: 'r-water', type: 'water', time: '08:00', isActive: true },
      { id: 'r-sleep', type: 'sleep', time: '23:00', isActive: true },
      { id: 'r-period', type: 'period', time: '09:00', isActive: true },
    ])
    profileService.get.mockResolvedValue({ careEnabled: true })
    profileService.update.mockImplementation(async (payload) => payload)
  })

  const toggleOf = (label) => screen.getByText(label).closest('div').querySelector('button')

  it('renders the three server-backed reminder switches enabled by default', async () => {
    renderPage()

    expect(toolsService.getReminders).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      for (const label of ['喝水提醒', '睡觉提醒', '大姨妈提醒']) {
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
  })

  it('navigates to the memory management page', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /记忆管理/ }))

    expect(await screen.findByRole('heading', { name: '记忆页' })).toBeInTheDocument()
  })

  it('shows no proactive toggle, dead buttons or fake account deletion', async () => {
    renderPage()
    await waitFor(() => expect(toolsService.getReminders).toHaveBeenCalled())

    for (const text of ['主动关怀消息', '清空所有记忆', '一键清空对话记录', '用户协议', '注销账号']) {
      expect(screen.queryByText(text)).not.toBeInTheDocument()
    }
  })

  it('flips 她来想你 off and on through the server (real users.care_enabled)', async () => {
    const user = userEvent.setup()
    renderPage()

    const careToggle = await screen.findByRole('button', { name: '她来想你总开关' })
    await waitFor(() => expect(careToggle.querySelector('svg')).toHaveClass('text-brand-pink'))

    await user.click(careToggle)
    expect(profileService.update).toHaveBeenCalledWith({ careEnabled: false })
    await waitFor(() => expect(careToggle.querySelector('svg')).toHaveClass('text-text-muted'))

    await user.click(careToggle)
    expect(profileService.update).toHaveBeenCalledWith({ careEnabled: true })
    await waitFor(() => expect(careToggle.querySelector('svg')).toHaveClass('text-brand-pink'))
  })

  it('respects a server-disabled 她来想你 on load', async () => {
    profileService.get.mockResolvedValue({ careEnabled: false })
    renderPage()

    const careToggle = await screen.findByRole('button', { name: '她来想你总开关' })
    await waitFor(() => expect(careToggle.querySelector('svg')).toHaveClass('text-text-muted'))
  })

  it('shows static app information', () => {
    renderPage()

    expect(screen.getByText('1.0.0')).toBeInTheDocument()
  })
})
