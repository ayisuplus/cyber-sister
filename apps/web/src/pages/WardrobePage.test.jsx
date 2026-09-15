import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSession } from '../services/sessionLifecycle'
const service = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), remove: vi.fn(), preview: vi.fn() }))
vi.mock('../services/wardrobeService', () => ({ wardrobeService: service }))
vi.mock('../services/workMediaService', () => ({ workMediaService: { previewWardrobe: service.preview } }))
vi.mock('@google/model-viewer', () => ({}))
import WardrobePage from './WardrobePage'

const ITEM = { id: 'i1', name: '黑色风衣', createdAt: '2026-09-08T00:00:00.000Z', sourceUrl: '/api/wardrobe/i1/source', modelUrl: '/api/wardrobe/i1/model' }
const RESULT = { source: 'cloud_mock', execution: { mode: 'mock', cloudConnected: false, persisted: false }, result: { kind: 'model', modelUrl: null, name: '上衣', message: '模拟校验已完成，尚未连接云端服务，未生成模型，也未添加到衣柜。' } }
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
const renderPage = () => render(<MemoryRouter initialEntries={['/tools/wardrobe']}><WardrobePage /></MemoryRouter>)
const selectPhoto = (name = 'coat.png') => {
  const file = new File(['image-bytes'], name, { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('选择单品照片'), { target: { files: [file] } })
  return file
}
beforeEach(() => {
  vi.clearAllMocks()
  service.list.mockResolvedValue([])
  service.preview.mockResolvedValue(RESULT)
  service.remove.mockResolvedValue(undefined)
  vi.mocked(URL.createObjectURL).mockImplementation(file => `blob:${file.name}`)
})

describe('衣柜云端接口模拟', () => {
  it('requires a photo and displays mock results separately without creating or downloading a fake artifact', async () => {
    renderPage()
    await screen.findByText('衣柜还空着')
    expect(screen.getByRole('button', { name: '提交模拟预览' })).toBeDisabled()
    const file = selectPhoto()
    fireEvent.change(screen.getByLabelText('单品名字'), { target: { value: '上衣' } })
    fireEvent.click(screen.getByRole('button', { name: '提交模拟预览' }))
    expect(await screen.findByRole('status', { name: '模拟预览结果' })).toHaveTextContent('未添加到衣柜')
    expect(service.preview).toHaveBeenCalledWith(file, '上衣', { signal: expect.any(AbortSignal) })
    expect(service.create).not.toHaveBeenCalled()
    expect(screen.getByText('衣柜还空着')).toBeVisible()
    expect(screen.queryByRole('link', { name: '下载模型' })).not.toBeInTheDocument()
    expect(document.querySelector('model-viewer')).toBeNull()
  })
  it('retains actual stored model viewing, downloading and confirmed deletion', async () => {
    service.list.mockResolvedValue([ITEM])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /黑色风衣/ }))
    expect(document.querySelector('model-viewer')).toHaveAttribute('src', ITEM.modelUrl)
    expect(screen.getByRole('link', { name: '下载模型' })).toHaveAttribute('href', ITEM.modelUrl)
    fireEvent.click(screen.getByRole('button', { name: '删除', exact: true }))
    expect(service.remove).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '删除', exact: true }))
    await screen.findByText('衣柜还空着')
    expect(service.remove).toHaveBeenCalledWith(ITEM.id)
  })
  it('keeps a failed request retryable and clears the old result on name changes', async () => {
    service.preview.mockRejectedValueOnce({ response: { data: { error: '请求暂时失败' } } })
    renderPage()
    selectPhoto()
    fireEvent.click(screen.getByRole('button', { name: '提交模拟预览' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请求暂时失败')
    fireEvent.click(screen.getByRole('button', { name: '提交模拟预览' }))
    await screen.findByRole('status', { name: '模拟预览结果' })
    fireEvent.change(screen.getByLabelText('单品名字'), { target: { value: '新名字' } })
    expect(screen.queryByRole('status', { name: '模拟预览结果' })).not.toBeInTheDocument()
    expect(service.preview).toHaveBeenCalledTimes(2)
  })
  it('aborts a replaced image request, ignores stale completion and releases object URLs', async () => {
    const pending = deferred()
    service.preview.mockReturnValueOnce(pending.promise)
    const view = renderPage()
    selectPhoto()
    fireEvent.click(screen.getByRole('button', { name: '提交模拟预览' }))
    const signal = service.preview.mock.calls[0][2].signal
    selectPhoto('new.png')
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve(RESULT))
    expect(screen.queryByRole('status', { name: '模拟预览结果' })).not.toBeInTheDocument()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:coat.png')
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:new.png')
  })
  it('clears existing items and pending previews across identity changes', async () => {
    service.list.mockResolvedValue([ITEM])
    const pending = deferred()
    service.preview.mockReturnValueOnce(pending.promise)
    renderPage()
    await screen.findByRole('button', { name: /黑色风衣/ })
    selectPhoto()
    fireEvent.click(screen.getByRole('button', { name: '提交模拟预览' }))
    const signal = service.preview.mock.calls[0][2].signal
    act(() => resetSession())
    await act(async () => pending.resolve(RESULT))
    expect(signal.aborted).toBe(true)
    expect(screen.queryByRole('button', { name: /黑色风衣/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: '模拟预览结果' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '提交模拟预览' })).toBeDisabled())
  })
})
