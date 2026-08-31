import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { processImageMock, getUserMediaMock } = vi.hoisted(() => ({
  processImageMock: vi.fn(),
  getUserMediaMock: vi.fn(),
}))

vi.mock('../features/beauty/presets', () => ({
  BEAUTY_PRESETS: [
    { id: 'off', name: '原图', settings: { smooth: 0, whiten: 0, slim: 0, eye: 0 } },
    { id: 'natural', name: '自然', settings: { smooth: 25, whiten: 20, slim: 10, eye: 10 } },
    { id: 'clear', name: '清透', settings: { smooth: 40, whiten: 45, slim: 15, eye: 15 } },
    { id: 'stereo', name: '立体', settings: { smooth: 30, whiten: 25, slim: 40, eye: 35 } },
  ],
}))
vi.mock('../features/beauty/beautyEngine', () => ({
  createBeautyEngine: vi.fn(() => ({ kind: 'fake-engine' })),
}))
vi.mock('../features/beauty/beautyPipeline', () => ({
  createBeautyPipeline: vi.fn(() => ({ processImage: processImageMock })),
}))

import BeautyCameraPage from './BeautyCameraPage'

const NATURAL_SETTINGS = { smooth: 25, whiten: 20, slim: 10, eye: 10 }
const OFF_SETTINGS = { smooth: 0, whiten: 0, slim: 0, eye: 0 }

function renderPage() {
  return render(<MemoryRouter><BeautyCameraPage /></MemoryRouter>)
}

function makeStream() {
  const track = { stop: vi.fn() }
  return { stream: { getTracks: () => [track] }, track }
}

async function renderCameraReady() {
  const { stream, track } = makeStream()
  getUserMediaMock.mockResolvedValue(stream)
  const utils = renderPage()
  const captureButton = await screen.findByRole('button', { name: '拍一张' })
  await waitFor(() => expect(captureButton).not.toBeDisabled())
  return { ...utils, track, captureButton }
}

async function captureStill() {
  const utils = await renderCameraReady()
  fireEvent.click(utils.captureButton)
  await waitFor(() => expect(processImageMock).toHaveBeenCalled())
  return utils
}

async function pickPhoto() {
  fireEvent.click(screen.getByRole('tab', { name: '选照片' }))
  fireEvent.change(screen.getByLabelText('选择照片', { selector: 'input' }), {
    target: { files: [new File(['fake-image'], 'photo.png', { type: 'image/png' })] },
  })
  const preview = await screen.findByAltText('已选照片预览：photo.png')
  fireEvent.load(preview)
  await waitFor(() => expect(processImageMock).toHaveBeenCalled())
}

beforeEach(() => {
  processImageMock.mockReset()
  processImageMock.mockImplementation((source) => {
    const canvas = document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height
    return canvas
  })
  getUserMediaMock.mockReset()
  getUserMediaMock.mockResolvedValue(makeStream().stream)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    writable: true,
    value: { getUserMedia: getUserMediaMock },
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockReturnValue(undefined)
  URL.createObjectURL.mockClear?.()
  URL.revokeObjectURL.mockClear?.()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BeautyCameraPage', () => {
  it('默认进入拍一张模式，以不超过 1280 宽的限制打开相机', async () => {
    renderPage()

    expect(screen.getByRole('tab', { name: '拍一张' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('全部处理都在这台设备上，照片不上传')).toBeInTheDocument()
    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalledWith({
      video: { facingMode: 'user', width: { ideal: 1280 } },
      audio: false,
    }))
  })

  it('相机权限被拒绝时展示诚实错误，不做虚假引导', async () => {
    getUserMediaMock.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('相机权限被拒绝或相机不可用。请检查设备的相机权限，或改用「选照片」。')
    expect(screen.queryByRole('button', { name: '拍一张' })).not.toBeInTheDocument()
  })

  it('设备不支持相机时提示改用选照片', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, writable: true, value: undefined })
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('这台设备打不开相机，可以改用「选照片」。')
  })

  it('可以切换到选照片模式，选中图片后立刻本地处理', async () => {
    renderPage()

    await pickPhoto()

    expect(screen.getByRole('tab', { name: '选照片' })).toHaveAttribute('aria-selected', 'true')
    expect(processImageMock).toHaveBeenLastCalledWith(expect.anything(), NATURAL_SETTINGS)
    expect(screen.getByRole('img', { name: '美颜效果' })).toBeInTheDocument()
  })

  it('拍照捕获当前帧后进入处理流程', async () => {
    await captureStill()

    expect(processImageMock).toHaveBeenLastCalledWith(expect.anything(), NATURAL_SETTINGS)
    expect(screen.getByRole('img', { name: '美颜效果' })).toBeInTheDocument()
  })

  it('滑杆改变会用新参数重新处理', async () => {
    await captureStill()
    processImageMock.mockClear()

    fireEvent.change(screen.getByLabelText('磨皮'), { target: { value: '80' } })

    await waitFor(() => expect(processImageMock).toHaveBeenCalled())
    expect(processImageMock).toHaveBeenLastCalledWith(expect.anything(), { ...NATURAL_SETTINGS, smooth: 80 })
  })

  it('选择预设会应用整组参数', async () => {
    await captureStill()
    processImageMock.mockClear()

    fireEvent.click(screen.getByRole('button', { name: '原图' }))

    await waitFor(() => expect(processImageMock).toHaveBeenCalled())
    expect(processImageMock).toHaveBeenLastCalledWith(expect.anything(), OFF_SETTINGS)
    expect(screen.getByRole('button', { name: '原图' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('长按看原图期间切换为原图，松开恢复效果图', async () => {
    await captureStill()
    const holdButton = screen.getByRole('button', { name: '长按看原图' })

    fireEvent.pointerDown(holdButton)
    expect(await screen.findByRole('img', { name: '原图' })).toBeInTheDocument()

    fireEvent.pointerUp(holdButton)
    expect(await screen.findByRole('img', { name: '美颜效果' })).toBeInTheDocument()
  })

  it('保存到相册会把处理结果导出为 PNG 下载', async () => {
    await captureStill()
    const toBlobSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })))
    // jsdom 不会真的下载，拦掉 a.click() 避免触发「未实现导航」噪音
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    fireEvent.click(screen.getByRole('button', { name: '保存到相册' }))

    expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), 'image/png')
    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  it('美颜引擎失败时展示诚实错误并回退到原图', async () => {
    processImageMock.mockImplementation(() => { throw new Error('wasm load failed') })
    const { captureButton } = await renderCameraReady()

    fireEvent.click(captureButton)

    expect(await screen.findByRole('alert')).toHaveTextContent('美颜引擎启动失败')
    expect(screen.getByRole('img', { name: '美颜效果' })).toBeInTheDocument()
  })

  it('卸载时停止相机轨道并取消动画帧', async () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
    const utils = await renderCameraReady()

    utils.unmount()

    expect(utils.track.stop).toHaveBeenCalled()
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('卸载时释放选照片模式创建的 ObjectURL', async () => {
    const utils = renderPage()
    await pickPhoto()

    utils.unmount()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-preview')
  })
})
describe('性能自适应降级', () => {
  const originalVideoWidth = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoWidth')
  const originalVideoHeight = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoHeight')
  let rafCallback = null

  const flushMicrotasks = async (rounds = 20) => {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve()
  }

  // 手动驱动一帧 rAF：时间轴完全由测试里的假时钟控制
  const runFrame = async () => {
    const cb = rafCallback
    await act(async () => {
      cb(performance.now())
      await flushMicrotasks()
    })
  }

  const renderCameraStreaming = async () => {
    getUserMediaMock.mockResolvedValue(makeStream().stream)
    const utils = renderPage()
    await act(async () => { await flushMicrotasks() })
    return utils
  }

  beforeEach(() => {
    rafCallback = null
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { rafCallback = cb; return 1 })
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1920 })
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 1080 })
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalVideoWidth) Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', originalVideoWidth)
    if (originalVideoHeight) Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', originalVideoHeight)
  })

  it('设备较慢时自动降档：帧宽度收窄到 960，预览角落出现温和提示', async () => {
    // 模拟慢设备：每帧处理耗时 200ms
    processImageMock.mockImplementation((source) => {
      vi.advanceTimersByTime(200)
      const canvas = document.createElement('canvas')
      canvas.width = source.width
      canvas.height = source.height
      return canvas
    })
    await renderCameraStreaming()
    expect(screen.queryByText('当前设备较慢，已自动降低画质保持流畅')).not.toBeInTheDocument()

    // 第一帧：换档冷却（3000ms）已过，EMA=200ms 远超阈值 → 降到 1 档
    vi.advanceTimersByTime(3000)
    await runFrame()

    expect(screen.getByText('当前设备较慢，已自动降低画质保持流畅')).toBeInTheDocument()
    expect(processImageMock.mock.calls[0][0].width).toBe(1280) // 降档前仍是最高画质

    // 第二帧：按 1 档（960 宽、66ms 间隔）处理
    vi.advanceTimersByTime(100)
    await runFrame()

    expect(processImageMock).toHaveBeenCalledTimes(2)
    expect(processImageMock.mock.calls[1][0].width).toBe(960)
  })

  it('降档后拍照不受影响：静态捕获仍按 1280 上限处理', async () => {
    processImageMock.mockImplementation((source) => {
      vi.advanceTimersByTime(200)
      const canvas = document.createElement('canvas')
      canvas.width = source.width
      canvas.height = source.height
      return canvas
    })
    await renderCameraStreaming()
    vi.advanceTimersByTime(3000)
    await runFrame()
    expect(screen.getByText('当前设备较慢，已自动降低画质保持流畅')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '拍一张' }))
    await act(async () => { await flushMicrotasks() })

    const lastCall = processImageMock.mock.calls.at(-1)
    expect(lastCall[0].width).toBe(1280)
    expect(screen.getByRole('img', { name: '美颜效果' })).toBeInTheDocument()
  })

  it('处理够快时不降档也不提示', async () => {
    await renderCameraStreaming()

    for (let frame = 0; frame < 5; frame += 1) {
      vi.advanceTimersByTime(50)
      await runFrame()
    }

    expect(processImageMock).toHaveBeenCalled()
    for (const call of processImageMock.mock.calls) {
      expect(call[0].width).toBe(1280)
    }
    expect(screen.queryByText('当前设备较慢，已自动降低画质保持流畅')).not.toBeInTheDocument()
  })
})
