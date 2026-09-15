import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../components/chat/CompanionStatePanel', () => ({ default: () => <section aria-label="她的状态" /> }))
vi.mock('./MemoriesPage', () => ({ default: () => <p>已记住列表</p> }))
vi.mock('../components/memory/MemoryReviewPanel', () => ({ default: ({ relations }) => <p>{relations ? '关系列表' : '待确认列表'}</p> }))
vi.mock('../services/authService', () => ({ authService: { updatePersona: vi.fn() } }))

import { authService } from '../services/authService'
import { useAuthStore } from '../stores/authStore'
import HerPage from './HerPage'

const renderPage = (url = '/her') => render(<MemoryRouter initialEntries={[url]}><HerPage /></MemoryRouter>)

describe('HerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ token: 't', isLoggedIn: true, user: { id: 'u1', persona: 'gentle' } })
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
    expect(screen.getByRole('button', { name: /安静/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('tells users on a retired persona that it has been merged, without selecting anything', () => {
    useAuthStore.setState({ user: { id: 'u1', persona: 'energetic' } })
    renderPage()

    expect(screen.getByText('你之前选的「元气炸弹」已经合并了，选一种新的吧。')).toBeInTheDocument()
    for (const name of [/温柔/, /直爽/, /安静/]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('keeps her rhythm and what she remembers on the same page', async () => {
    const user = userEvent.setup()
    renderPage('/her?tab=pending')

    expect(screen.getByRole('region', { name: '她的状态' })).toBeInTheDocument()
    expect(screen.getByText('待确认列表')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '关系' }))
    expect(screen.getByText('关系列表')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '已记住' }))
    expect(screen.getByText('已记住列表')).toBeInTheDocument()
  })
})
