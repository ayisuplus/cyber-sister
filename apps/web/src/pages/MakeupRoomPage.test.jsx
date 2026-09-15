import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSession } from '../services/sessionLifecycle'

const mocks = vi.hoisted(() => ({ preview: vi.fn(), engine: vi.fn(), pipeline: vi.fn(), getUserMedia: vi.fn(), presets: { list: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn() } }))
vi.mock('../services/workMediaService', () => ({ workMediaService: { previewMakeup: mocks.preview } }))
vi.mock('../services/makeupPresetService', () => ({ makeupPresetService: mocks.presets }))
vi.mock('../features/beauty/beautyEngine', () => ({ createBeautyEngine: mocks.engine }))
vi.mock('../features/beauty/beautyPipeline', () => ({ createBeautyPipeline: mocks.pipeline }))
import MakeupRoomPage from './MakeupRoomPage'

const NATURAL = { smooth: 25, whiten: 20, slim: 10, eye: 10 }
const RESULT = { source: 'cloud_mock', execution: { mode: 'mock', cloudConnected: false, persisted: false }, result: { kind: 'image', imageUrl: null, params: NATURAL, message: '模拟校验已完成，尚未连接云端服务，未生成或保存图片。' } }
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const renderPage = () => render(<MemoryRouter initialEntries={['/tools/makeup-room']}><MakeupRoomPage /></MemoryRouter>)
const selectPhoto = (name = 'photo.png') => {
  const file = new File(['image-bytes'], name, { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('选择照片', { selector: 'input' }), { target: { files: [file] } })
  return file
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.presets.list.mockResolvedValue([])
  mocks.preview.mockResolvedValue(RESULT)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: mocks.getUserMedia } })
  vi.mocked(URL.createObjectURL).mockImplementation(file => `blob:${file.name}`)
})

describe('化妆间云端接口模拟', () => {
  it('requires explicit submission, keeps the original unchanged, and never starts local inference', async () => {
    renderPage()
    expect(screen.getByRole('button', { name: '提交模拟预览' })).toBeDisabled()
    const file = selectPhoto()
    expect(await screen.findByAltText('原图预览：photo.png')).toHaveAttribute('src', 'blob:photo.png')
    fireEvent.change(screen.getByRole('slider', { name: '磨皮' }), { target: { value: '62' } })
    expect(mocks.preview).not.toHaveBeenCalled()
    expect(mocks.engine).not.toHaveBeenCalled()
    expect(mocks.pipeline).not.toHaveBeenCalled()
    expect(mocks.getUserMedia).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '提交模拟预览' }))
    expect(await screen.findByRole('status', { name: '模拟预览结果' })).toHaveTextContent('未生成或保存图片')
    expect(mocks.preview).toHaveBeenCalledWith(file, { ...NATURAL, smooth: 62 }, { signal: expect.any(AbortSignal) })
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '保存到相册' })).not.toBeInTheDocument()
    expect(screen.queryByText('照片不上传')).not.toBeInTheDocument()
  })

  it('shows backend errors and retries the selected photo without discarding input', async () => {
    mocks.preview.mockRejectedValueOnce({ response: { data: { error: '图片内容与格式不符' } } })
    renderPage()
    const file = selectPhoto()
    fireEvent.click(screen.getByRole('button', { name: '提交模拟预览' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('图片内容与格式不符')
    expect(screen.queryByRole('status', { name: '模拟预览结果' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '提交模拟预览' }))
    expect(await screen.findByRole('status', { name: '模拟预览结果' })).toBeVisible()
    expect(mocks.preview.mock.calls[1][0]).toBe(file)
  })

  it('invalidates settled results when params change and ignores an in-flight result after changing photos', async () => {
    renderPage()
    selectPhoto()
    fireEvent.click(screen.getByRole('button', { name: '提交模拟预览' }))
    await screen.findByRole('status', { name: '模拟预览结果' })
    fireEvent.click(screen.getByRole('button', { name: '清透', exact: true }))
    expect(screen.queryByRole('status', { name: '模拟预览结果' })).not.toBeInTheDocument()
    const pending = deferred()
    mocks.preview.mockReturnValueOnce(pending.promise)
    fireEvent.click(screen.getByRole('button', { name: '提交模拟预览' }))
    const signal = mocks.preview.mock.calls[1][2].signal
    selectPhoto('new.png')
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve(RESULT))
    expect(screen.queryByRole('status', { name: '模拟预览结果' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提交模拟预览' })).toBeEnabled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo.png')
  })

  it('aborts requests, clears photos and ignores stale replies across session changes', async () => {
    const pending = deferred()
    mocks.preview.mockReturnValueOnce(pending.promise)
    const view = renderPage()
    selectPhoto()
    fireEvent.click(screen.getByRole('button', { name: '提交模拟预览' }))
    const signal = mocks.preview.mock.calls[0][2].signal
    act(() => resetSession())
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve(RESULT))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: '模拟预览结果' })).not.toBeInTheDocument()
    selectPhoto('second.png')
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:second.png')
  })

  it('cleans an outstanding upload on unmount', async () => {
    const pending = deferred()
    mocks.preview.mockReturnValueOnce(pending.promise)
    const view = renderPage()
    selectPhoto()
    fireEvent.click(screen.getByRole('button', { name: '提交模拟预览' }))
    const signal = mocks.preview.mock.calls[0][2].signal
    view.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve(RESULT))
  })

  it('only opens the camera on request and stops late streams after leaving camera mode', async () => {
    const pending = deferred()
    const stop = vi.fn()
    mocks.getUserMedia.mockReturnValueOnce(pending.promise)
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '打开相机' }))
    selectPhoto()
    await act(async () => pending.resolve({ getTracks: () => [{ stop }] }))
    expect(stop).toHaveBeenCalledOnce()
    expect(mocks.preview).not.toHaveBeenCalled()
  })

  it('captures a raw camera snapshot without running the beauty pipeline and stops the stream', async () => {
    const stop = vi.fn()
    mocks.getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] })
    const drawImage = vi.fn()
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage })
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['raw'], { type: 'image/jpeg' })))
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '打开相机' }))
    await waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalledOnce())
    const video = screen.getByLabelText('相机原始预览')
    Object.defineProperties(video, { videoWidth: { value: 1280 }, videoHeight: { value: 720 } })
    fireEvent.loadedMetadata(video)
    fireEvent.click(screen.getByRole('button', { name: '拍一张' }))
    expect(await screen.findByAltText('原图预览：camera.jpg')).toBeVisible()
    expect(drawImage).toHaveBeenCalled()
    expect(stop).toHaveBeenCalledOnce()
    expect(mocks.engine).not.toHaveBeenCalled()
    expect(mocks.pipeline).not.toHaveBeenCalled()
    context.mockRestore(); toBlob.mockRestore()
  })

  it('shows delete errors inside the confirmation and keeps the failed action retryable', async () => {
    mocks.presets.list.mockResolvedValue([{ id: 'p1', name: '日常妆', ...NATURAL }])
    mocks.presets.remove.mockRejectedValueOnce({ response: { data: { error: '删除暂时失败' } } }).mockResolvedValueOnce(undefined)
    renderPage()
    await screen.findByRole('button', { name: '日常妆', exact: true })
    fireEvent.click(screen.getByRole('button', { name: '删除', exact: true }))
    const dialog = screen.getByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '删除', exact: true }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('删除暂时失败')
    fireEvent.click(within(dialog).getByRole('button', { name: '删除', exact: true }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocks.presets.remove).toHaveBeenCalledTimes(2)
  })

  it('keeps preset create, select, rename and confirmed delete on their existing server API', async () => {
    const preset = { id: 'p1', name: '日常妆', ...NATURAL }
    mocks.presets.create.mockResolvedValue(preset)
    mocks.presets.rename.mockResolvedValue({ ...preset, name: '通勤妆' })
    mocks.presets.remove.mockResolvedValue(undefined)
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '把当前存为妆容' }))
    fireEvent.change(screen.getByLabelText('妆容名字'), { target: { value: '日常妆' } })
    fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }))
    expect(await screen.findByRole('button', { name: '日常妆', exact: true })).toBeVisible()
    expect(mocks.presets.create).toHaveBeenCalledWith({ name: preset.name, ...NATURAL })
    fireEvent.click(screen.getByRole('button', { name: '日常妆', exact: true }))
    expect(screen.getByRole('slider', { name: '磨皮' })).toHaveValue('25')
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    fireEvent.change(screen.getByLabelText('妆容名字'), { target: { value: '通勤妆' } })
    fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }))
    expect(await screen.findByRole('button', { name: '通勤妆', exact: true })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '删除', exact: true }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '删除', exact: true }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '通勤妆', exact: true })).not.toBeInTheDocument())
    expect(mocks.presets.remove).toHaveBeenCalledWith('p1')
    expect(mocks.preview).not.toHaveBeenCalled()
  })
})
