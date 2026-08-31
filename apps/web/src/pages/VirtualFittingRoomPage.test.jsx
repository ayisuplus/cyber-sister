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
      reason: 'IMAGE_GEN_NOT_IMPLEMENTED',
    })
    virtualStudioService.requestGeneration.mockResolvedValue({})
  })

  it('walks photo pick, item pick, and shows the honest placeholder after submit', async () => {
    const user = userEvent.setup()
    renderPage()

    const generate = screen.getByRole('button', { name: /生成预览/ })
    expect(generate).toBeDisabled()
    expect(await screen.findByText('生图能力接入中')).toBeInTheDocument()

    await arrangeSelection(user)
    expect(screen.getByRole('img', { name: '已选照片预览：outfit.png' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /卡其色风衣/ })).toHaveAttribute('aria-checked', 'true')
    expect(generate).toBeEnabled()

    // 本期成功路径不可达：即便接口意外成功，也只展示诚实提示，不渲染结果图
    await user.click(generate)
    expect(virtualStudioService.requestGeneration).toHaveBeenCalledWith({ scene: 'fitting', itemId: 'khaki-trench' })
    expect(await screen.findByText('生图能力接入中，暂未开放')).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(1)
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
    virtualStudioService.getImageGenStatus.mockResolvedValue({ available: true, configured: true })
    renderPage()

    expect(await screen.findByText('生图能力已就绪')).toBeInTheDocument()
  })
})
