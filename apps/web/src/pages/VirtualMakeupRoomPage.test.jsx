import { fireEvent, render, screen } from '@testing-library/react'
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
import VirtualMakeupRoomPage from './VirtualMakeupRoomPage'

const renderPage = () => render(<MemoryRouter><VirtualMakeupRoomPage /></MemoryRouter>)

const pickPhoto = async (user, name = 'selfie.png') => {
  const file = new File(['pixels'], name, { type: 'image/png' })
  await user.upload(screen.getByLabelText('选择照片'), file)
}

describe('VirtualMakeupRoomPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    virtualStudioService.getImageGenStatus.mockResolvedValue({
      available: false,
      configured: false,
      reason: 'IMAGE_GEN_NOT_CONFIGURED',
    })
    virtualStudioService.requestGeneration.mockRejectedValue({
      response: { status: 503, data: { error: '生图能力接入中，暂未开放', code: 'IMAGE_GEN_NOT_CONFIGURED' } },
    })
  })

  it('walks photo pick, look pick, and a 503 submit into the honest placeholder', async () => {
    const user = userEvent.setup()
    renderPage()

    // 生成按钮：未选照片时禁用并给出原因
    const generate = screen.getByRole('button', { name: /生成预览/ })
    expect(generate).toBeDisabled()
    expect(screen.getByText('先在第一步选择一张照片')).toBeInTheDocument()

    // 进入页面即检查生图能力状态 → 诚实占位
    expect(await screen.findByText('生图能力接入中')).toBeInTheDocument()
    expect(screen.getByText(/外部生图 API 接通后/)).toBeInTheDocument()
    expect(screen.getByText('照片不出浏览器 · 生图接入中')).toBeInTheDocument()

    // 第一步：本地选图预览，绝不上传
    await pickPhoto(user)
    expect(screen.getByRole('img', { name: '已选照片预览：selfie.png' })).toHaveAttribute('src', 'blob:mock-preview')
    expect(screen.getByText('照片只在这台设备上预览，不会上传')).toBeInTheDocument()
    expect(generate).toBeDisabled()
    expect(screen.getByText('再在第二步选择一款妆容')).toBeInTheDocument()

    // 第二步：目录单选
    const look = screen.getByRole('radio', { name: /清透日常妆/ })
    await user.click(look)
    expect(look).toHaveAttribute('aria-checked', 'true')
    expect(generate).toBeEnabled()

    // 第三步：提交后收到 503 诚实接缝，停留在占位面板，不出现假结果
    await user.click(generate)
    expect(virtualStudioService.requestGeneration).toHaveBeenCalledWith({ scene: 'makeup', itemId: 'clear-daily' })
    expect(await screen.findByText('生图能力接入中，暂未开放')).toBeInTheDocument()
    expect(screen.getByText('生图能力接入中')).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('guards non-image and oversized picks with honest errors', () => {
    renderPage()
    const input = screen.getByLabelText('选择照片')

    fireEvent.change(input, { target: { files: [new File(['text'], 'note.txt', { type: 'text/plain' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('只支持图片文件，请重新选择')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    const oversized = new File(['pixels'], 'huge.png', { type: 'image/png' })
    Object.defineProperty(oversized, 'size', { value: 11 * 1024 * 1024 })
    fireEvent.change(input, { target: { files: [oversized] } })
    expect(screen.getByRole('alert')).toHaveTextContent('照片不能超过 10MB')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('revokes the local preview when replacing or removing a photo', async () => {
    const user = userEvent.setup()
    renderPage()

    await pickPhoto(user, 'first.png')
    expect(screen.getByRole('img', { name: '已选照片预览：first.png' })).toBeInTheDocument()

    await pickPhoto(user, 'second.png')
    expect(URL.revokeObjectURL).toHaveBeenCalled()
    expect(screen.getByRole('img', { name: '已选照片预览：second.png' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '移除照片' }))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('先在第一步选择一张照片')).toBeInTheDocument()
  })

  it('recovers from a failed status check via the retry button', async () => {
    const user = userEvent.setup()
    virtualStudioService.getImageGenStatus.mockRejectedValueOnce(new Error('network down'))
    renderPage()

    expect(await screen.findByText('没能连上能力检查接口，请检查网络后重试。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重新检查' }))
    expect(virtualStudioService.getImageGenStatus).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('生图能力接入中')).toBeInTheDocument()
  })

  it('lets the user re-check the capability status from the placeholder', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('生图能力接入中')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新检查' }))

    expect(virtualStudioService.getImageGenStatus).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('生图能力接入中')).toBeInTheDocument()
  })
})
