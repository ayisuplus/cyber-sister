import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const wardrobeApi = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('../services/wardrobeService', () => ({ wardrobeService: wardrobeApi }))
// jsdom 无 WebGL，model-viewer 注册替换为空模块
vi.mock('@google/model-viewer', () => ({}))

import WardrobePage from './WardrobePage'

const renderPage = () => render(<MemoryRouter><WardrobePage /></MemoryRouter>)

const ITEM = {
  id: 'i1',
  name: '黑色风衣',
  createdAt: '2026-09-08T00:00:00.000Z',
  sourceUrl: '/api/wardrobe/i1/source',
  modelUrl: '/api/wardrobe/i1/model',
}

beforeEach(() => {
  wardrobeApi.list.mockReset()
  wardrobeApi.list.mockResolvedValue([])
  wardrobeApi.create.mockReset()
  wardrobeApi.remove.mockReset()
})

describe('WardrobePage', () => {
  it('渲染介绍区与空衣柜提示', async () => {
    renderPage()

    expect(screen.getAllByRole('heading', { name: '3D 衣柜' }).length).toBeGreaterThan(0)

    expect(screen.getByText('3D 生成走外部服务，未接好时如实提示')).toBeInTheDocument()
    expect(await screen.findByText('衣柜还空着，传一张单品照试试。')).toBeInTheDocument()
  })

  it('列表渲染单品并可进入详情', async () => {
    wardrobeApi.list.mockResolvedValue([ITEM])
    renderPage()

    const card = await screen.findByRole('button', { name: /黑色风衣/ })
    fireEvent.click(card)

    expect(await screen.findByRole('link', { name: '下载模型' })).toHaveAttribute('href', '/api/wardrobe/i1/model')
    expect(document.querySelector('model-viewer')).not.toBeNull()
    expect(document.querySelector('model-viewer').getAttribute('src')).toBe('/api/wardrobe/i1/model')
  })

  it('未选图时生成按钮不可用', async () => {
    renderPage()

    expect(screen.getByRole('button', { name: '生成 3D 模型' })).toBeDisabled()
  })

  it('上传后 503 IMAGE_TO_3D_NOT_CONFIGURED → 展示「还没接好」文案，无假成功', async () => {
    wardrobeApi.create.mockRejectedValue({
      response: { data: { code: 'IMAGE_TO_3D_NOT_CONFIGURED', error: '3D 生成服务还没接好，开放后第一时间告诉你' } },
    })
    renderPage()

    fireEvent.change(screen.getByLabelText('选择单品照片'), {
      target: { files: [new File(['fake'], 'coat.png', { type: 'image/png' })] },
    })
    fireEvent.change(screen.getByLabelText('单品名字'), { target: { value: '黑色风衣' } })
    fireEvent.click(screen.getByRole('button', { name: '生成 3D 模型' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('3D 生成服务还没接好，开放后第一时间告诉你')
    expect(screen.queryByRole('button', { name: /黑色风衣/ })).not.toBeInTheDocument()
  })

  it('上传成功后新品出现在列表头部', async () => {
    wardrobeApi.create.mockResolvedValue(ITEM)
    renderPage()

    fireEvent.change(screen.getByLabelText('选择单品照片'), {
      target: { files: [new File(['fake'], 'coat.png', { type: 'image/png' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: '生成 3D 模型' }))

    expect(await screen.findByRole('button', { name: /黑色风衣/ })).toBeInTheDocument()
    const formData = wardrobeApi.create.mock.calls[0][0]
    expect(formData.get('image')).toBeInstanceOf(File)
  })

  it('详情里删除经确认后从列表消失并返回列表', async () => {
    wardrobeApi.list.mockResolvedValue([ITEM])
    wardrobeApi.remove.mockResolvedValue({ success: true })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /黑色风衣/ }))
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    fireEvent.click(screen.getAllByRole('button', { name: '删除' }).pop()) // ConfirmDialog 确认钮

    await waitFor(() => expect(wardrobeApi.remove).toHaveBeenCalledWith('i1'))
    await waitFor(() => expect(screen.queryByRole('button', { name: /黑色风衣/ })).not.toBeInTheDocument())
    expect(await screen.findByText('衣柜还空着，传一张单品照试试。')).toBeInTheDocument()
  })
})
