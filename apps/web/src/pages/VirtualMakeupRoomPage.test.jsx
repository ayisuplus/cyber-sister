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
      provider: 'comfy',
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
    expect(screen.getByText(/本机 ComfyUI 生图服务在线后/)).toBeInTheDocument()
    expect(screen.getAllByText('照片只在本机处理（本地 ComfyUI 生图），不出这台设备')).toHaveLength(2)

    // 第一步：本机选图预览
    await pickPhoto(user)
    expect(screen.getByRole('img', { name: '已选照片预览：selfie.png' })).toHaveAttribute('src', 'blob:mock-preview')
    expect(generate).toBeDisabled()
    expect(screen.getByText('再在第二步选择一款妆容')).toBeInTheDocument()

    // 第二步：目录单选
    const look = screen.getByRole('radio', { name: /清透日常妆/ })
    await user.click(look)
    expect(look).toHaveAttribute('aria-checked', 'true')
    expect(generate).toBeEnabled()

    // 第三步：提交后收到 503 诚实接缝，停留在占位面板，不出现假结果，选择不丢
    await user.click(generate)
    expect(virtualStudioService.requestGeneration).toHaveBeenCalledWith({
      scene: 'makeup',
      itemId: 'clear-daily',
      photo: expect.any(File),
    })
    expect(await screen.findByText('生图能力接入中，暂未开放')).toBeInTheDocument()
    expect(screen.getByText('生图能力接入中')).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(look).toHaveAttribute('aria-checked', 'true')
  })

  it('generates and saves a real preview when the capability is available', async () => {
    const user = userEvent.setup()
    virtualStudioService.getImageGenStatus.mockResolvedValue({
      available: true,
      configured: true,
      provider: 'comfy',
      reason: null,
    })
    virtualStudioService.requestGeneration.mockResolvedValue({
      imageDataUrl: 'data:image/png;base64,QUJD',
      scene: 'makeup',
      itemId: 'peach-date',
      provider: 'comfy',
    })
    renderPage()

    expect(await screen.findByText('生图能力已就绪')).toBeInTheDocument()
    await pickPhoto(user)
    await user.click(screen.getByRole('radio', { name: /蜜桃约会妆/ }))
    await user.click(screen.getByRole('button', { name: /生成预览/ }))

    // 真实结果图 + 保存链接 + 重新生成
    const result = await screen.findByRole('img', { name: '蜜桃约会妆生成预览' })
    expect(result).toHaveAttribute('src', 'data:image/png;base64,QUJD')
    const saveLink = screen.getByRole('link', { name: '保存预览' })
    expect(saveLink).toHaveAttribute('href', 'data:image/png;base64,QUJD')
    expect(saveLink).toHaveAttribute('download', '赛博姐妹预览.png')
    expect(screen.getByRole('button', { name: /重新生成/ })).toBeEnabled()

    const request = virtualStudioService.requestGeneration.mock.calls[0][0]
    expect(request.scene).toBe('makeup')
    expect(request.itemId).toBe('peach-date')
    expect(request.photo).toBeInstanceOf(File)
    expect(request.photo.name).toBe('selfie.png')
  })

  it('clears a stale result when the selection changes', async () => {
    const user = userEvent.setup()
    virtualStudioService.getImageGenStatus.mockResolvedValue({
      available: true,
      configured: true,
      provider: 'comfy',
      reason: null,
    })
    virtualStudioService.requestGeneration.mockResolvedValue({
      imageDataUrl: 'data:image/png;base64,QUJD',
      scene: 'makeup',
      itemId: 'peach-date',
      provider: 'comfy',
    })
    renderPage()

    await pickPhoto(user)
    await user.click(screen.getByRole('radio', { name: /蜜桃约会妆/ }))
    await user.click(screen.getByRole('button', { name: /生成预览/ }))
    expect(await screen.findByRole('img', { name: '蜜桃约会妆生成预览' })).toBeInTheDocument()

    // 换妆容后旧结果作废，不出现张冠李戴
    await user.click(screen.getByRole('radio', { name: /微醺烟熏妆/ }))
    expect(screen.queryByRole('img', { name: /生成预览/ })).not.toBeInTheDocument()
  })

  it('guards non-image and oversized picks with honest errors', () => {
    renderPage()
    const input = screen.getByLabelText('选择照片')

    fireEvent.change(input, { target: { files: [new File(['text'], 'note.txt', { type: 'text/plain' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('只支持图片文件，请重新选择')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    const oversized = new File(['pixels'], 'huge.png', { type: 'image/png' })
    Object.defineProperty(oversized, 'size', { value: 9 * 1024 * 1024 })
    fireEvent.change(input, { target: { files: [oversized] } })
    expect(screen.getByRole('alert')).toHaveTextContent('照片不能超过 8MB')
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
