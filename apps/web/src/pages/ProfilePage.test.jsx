import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  consentGet: vi.fn(),
  consentUpdate: vi.fn(),
  authState: {
    user: { nickname: '小赛', persona: 'gentle' },
    updatePersona: vi.fn(),
    logout: vi.fn(),
  },
}))

vi.mock('../services/consentService', () => ({
  consentService: {
    get: mocks.consentGet,
    update: mocks.consentUpdate,
  },
}))

vi.mock('../stores/authStore', () => ({
  useAuthStore: selector => selector(mocks.authState),
}))

import ProfilePage from './ProfilePage'

const renderPage = () => render(<MemoryRouter><ProfilePage /></MemoryRouter>)

describe('ProfilePage cloud fallback consent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.consentGet.mockResolvedValue({
      accepted: null,
      version: 'qwen-fallback-v1',
      updatedAt: null,
    })
  })

  it('presents cloud use as optional fallback without blocking local chat', async () => {
    renderPage()

    expect(await screen.findByText(/qwen-fallback-v1 · 尚未选择/)).toBeInTheDocument()
    expect(screen.getByText(/始终优先使用本地模型/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保持仅本地' })).toBeEnabled()
  })

  it('records explicit acceptance for cloud fallback', async () => {
    const user = userEvent.setup()
    mocks.consentUpdate.mockResolvedValue({ accepted: true, version: 'qwen-fallback-v1' })
    renderPage()

    await user.click(await screen.findByRole('button', { name: '允许云端备用' }))

    expect(mocks.consentUpdate).toHaveBeenCalledWith(true)
    expect(screen.getByText('已允许本地模型失败时使用云端备用')).toBeInTheDocument()
  })

  it('records refusal or withdrawal while keeping the local mode available', async () => {
    const user = userEvent.setup()
    mocks.consentUpdate.mockResolvedValue({ accepted: false, version: 'qwen-fallback-v1' })
    renderPage()

    await user.click(await screen.findByRole('button', { name: '保持仅本地' }))

    expect(mocks.consentUpdate).toHaveBeenCalledWith(false)
    expect(screen.getByText('已关闭云端备用，聊天不会外发给模型供应商')).toBeInTheDocument()
  })
})
