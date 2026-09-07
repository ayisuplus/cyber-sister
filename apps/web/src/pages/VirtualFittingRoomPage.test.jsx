import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/virtualStudioService', () => ({
  virtualStudioService: {
    getImageGenStatus: vi.fn(),
    requestGeneration: vi.fn(),
  },
}))

import { virtualStudioService } from '../services/virtualStudioService'
import VirtualFittingRoomPage from './VirtualFittingRoomPage'

const renderPage = () => render(<MemoryRouter><VirtualFittingRoomPage /></MemoryRouter>)

const arrangeSelection = async (user) => {
  await user.upload(screen.getByLabelText('选择照片'), new File(['pixels'], 'outfit.png', { type: 'image/png' }))
  await user.click(screen.getByRole('radio', { name: /卡其色风衣/ }))
}

describe('VirtualFittingRoomPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    virtualStudioService.getImageGenStatus.mockResolvedValue({
      available: false,
      configured: true,
      provider: 'comfy',
      reason: 'IMAGE_GEN_UNAVAILABLE',
    })
    virtualStudioService.requestGeneration.mockRejectedValue({
      response: { status: 503, data: { error: '本地生图服务暂不可用，请稍后重试', code: 'IMAGE_GEN_UNAVAILABLE' } },
    })
  })

  it('walks photo pick, item pick, and a 503 submit into the honest error without losing the selection', async () => {
    const user = userEvent.setup()
    renderPage()

    const generate = screen.getByRole('button', { name: /生成预览/ })
    expect(generate).toBeDisabled()
    expect(await screen.findByText('生图能力接入中')).toBeInTheDocument()

    await arrangeSelection(user)
    expect(screen.getByRole('img', { name: '已选照片预览：outfit.png' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /卡其色风衣/ })).toHaveAttribute('aria-checked', 'true')
    expect(generate).toBeEnabled()

    await user.click(generate)
    expect(virtualStudioService.requestGeneration).toHaveBeenCalledWith({
      scene: 'fitting',
      itemId: 'khaki-trench',
      photo: expect.any(File),
    })
    expect(await screen.findByText('本地生图服务暂不可用，请稍后重试')).toBeInTheDocument()
    // 选择不丢：照片与单品仍在，可直接重试
    expect(screen.getByRole('img', { name: '已选照片预览：outfit.png' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /卡其色风衣/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('renders a real try-on preview when the capability is available', async () => {
    const user = userEvent.setup()
    virtualStudioService.getImageGenStatus.mockResolvedValue({
      available: true,
      configured: true,
      provider: 'comfy',
      reason: null,
    })
    virtualStudioService.requestGeneration.mockResolvedValue({
      imageDataUrl: 'data:image/png;base64,Rk9P',
      scene: 'fitting',
      itemId: 'khaki-trench',
      provider: 'comfy',
    })
    renderPage()

    await arrangeSelection(user)
    await user.click(screen.getByRole('button', { name: /生成预览/ }))

    expect(await screen.findByRole('img', { name: '卡其色风衣生成预览' })).toHaveAttribute('src', 'data:image/png;base64,Rk9P')
    expect(screen.getByRole('link', { name: '保存预览' })).toHaveAttribute('download', '赛博姐妹预览.png')
  })

  it('shows the server-provided message on the 503 seam and a gentle note otherwise', async () => {
    const user = userEvent.setup()
    virtualStudioService.requestGeneration.mockRejectedValue({
      response: { status: 503, data: { code: 'IMAGE_GEN_NOT_CONFIGURED' } },
    })
    renderPage()
    await arrangeSelection(user)

    await user.click(screen.getByRole('button', { name: /生成预览/ }))
    expect(await screen.findByText('生图能力接入中，暂未开放')).toBeInTheDocument()

    virtualStudioService.requestGeneration.mockRejectedValue(new Error('network down'))
    await user.click(screen.getByRole('button', { name: /生成预览/ }))
    expect(await screen.findByText('这次请求没有成功，请稍后重试')).toBeInTheDocument()
  })

  it('reflects a ready capability status honestly', async () => {
    virtualStudioService.getImageGenStatus.mockResolvedValue({ available: true, configured: true, provider: 'comfy', reason: null })
    renderPage()

    expect(await screen.findByText('生图能力已就绪')).toBeInTheDocument()
  })
})
