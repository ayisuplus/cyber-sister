import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../components/chat/CompanionStatePanel', () => ({ default: () => <section aria-label="她的状态" /> }))
vi.mock('./MemoriesPage', () => ({ default: () => <p>已记住列表</p> }))
vi.mock('../services/authService', () => ({ authService: { updatePersona: vi.fn() } }))
vi.mock('../services/userService', () => ({ profileService: { get: vi.fn(), update: vi.fn() } }))
vi.mock('../services/letterService', () => ({
  letterService: Object.fromEntries(['generate', 'list', 'get', 'read', 'decide'].map((name) => [name, vi.fn()])),
}))

import { authService } from '../services/authService'
import { profileService } from '../services/userService'
import { letterService } from '../services/letterService'
import { useAuthStore } from '../stores/authStore'
import HerPage from './HerPage'

const LETTER = { id: 'l1', periodStart: '2026-09-09T00:00:00.000Z', content: '见信好。\n\n正文一段。', suggestions: [] }

const renderPage = (url = '/her') => render(<MemoryRouter initialEntries={[url]}><HerPage /></MemoryRouter>)

describe('HerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ token: 't', isLoggedIn: true, user: { id: 'u1', persona: 'gentle' } })
    profileService.get.mockResolvedValue({ letterFreqDays: 3 })
    profileService.update.mockImplementation(async (payload) => payload)
    letterService.generate.mockResolvedValue({ letter: LETTER, created: false, reason: 'not_due' })
    letterService.list.mockResolvedValue([LETTER])
    letterService.read.mockResolvedValue({ success: true })
  })

  it('offers three speaking styles with the current one pressed', () => {
    renderPage()

    expect(screen.getByRole('button', { name: /温柔/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /直爽/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /安静/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('元气炸弹')).not.toBeInTheDocument()
  })

  it('switches the speaking style for the next message', async () => {
    const user = userEvent.setup()
    authService.updatePersona.mockResolvedValue({ persona: 'cool' })
    renderPage()

    await user.click(screen.getByRole('button', { name: /安静/ }))

    expect(authService.updatePersona).toHaveBeenCalledWith('cool')
    expect(await screen.findByText('换好了，下一条消息就用这种方式和你说话')).toBeInTheDocument()
  })

  it('tells users on a retired persona that it has been merged, without selecting anything', () => {
    useAuthStore.setState({ user: { id: 'u1', persona: 'energetic' } })
    renderPage()

    expect(screen.getByText('你之前选的「元气炸弹」已经合并了，选一种新的吧。')).toBeInTheDocument()
    for (const name of [/温柔/, /直爽/, /安静/]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('进页面先到期就写信，再显示最新一封与频率三档', async () => {
    renderPage()

    expect(await screen.findByText('见信好。')).toBeInTheDocument()
    expect(letterService.generate).toHaveBeenCalled()
    expect(letterService.list).toHaveBeenCalled()
    for (const label of ['不写了', '三天一封', '七天一封']) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('radio', { name: '三天一封' })).toBeChecked()
  })

  it('改频率立即保存（null|3|7），失败退回原选择', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('radio', { name: '三天一封' })).toBeChecked())

    await user.click(screen.getByRole('radio', { name: '七天一封' }))
    expect(profileService.update).toHaveBeenCalledWith({ letterFreqDays: 7 })
    expect(await screen.findByText('记下了，到了日子她会写。')).toBeInTheDocument()

    profileService.update.mockRejectedValueOnce(new Error('offline'))
    await user.click(screen.getByRole('radio', { name: '不写了' }))
    expect(await screen.findByText('没保存成功，请重试。')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '七天一封' })).toBeChecked()
  })

  it('没开写信、还没到日子和沉默期各有各的空态', async () => {
    letterService.generate.mockResolvedValue({ letter: null, created: false, reason: 'not_due' })
    letterService.list.mockResolvedValue([])
    const { unmount } = renderPage()
    expect(await screen.findByText('她还没写好第一封，到了日子她会写的。')).toBeInTheDocument()
    unmount()

    letterService.generate.mockResolvedValue({ letter: null, created: false, reason: 'quiet' })
    renderPage()
    expect(await screen.findByText('这几天没什么可写的，她想攒点话再给你写。')).toBeInTheDocument()
  })

  it('keeps her rhythm, her letters and what she remembers on the same page; 旧的 tab 深链直接忽略', async () => {
    renderPage('/her?tab=pending')

    expect(screen.getByRole('region', { name: '她的状态' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '她的来信' })).toBeInTheDocument()
    expect(screen.getByText('已记住列表')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '待确认' })).not.toBeInTheDocument()
  })
})
