import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareChatImage } from './imageResize'

// URL.createObjectURL 在 test/setup.js 统一 mock 为 'blob:mock-preview'
function stubImage({ width = 2000, height = 1000, decodeError = null } = {}) {
  class FakeImage {
    constructor() {
      this.naturalWidth = width
      this.naturalHeight = height
    }

    decode() {
      return decodeError ? Promise.reject(decodeError) : Promise.resolve()
    }
  }
  vi.stubGlobal('Image', FakeImage)
}

describe('prepareChatImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('非图片文件直接拒绝', async () => {
    await expect(prepareChatImage(new Blob(['x'], { type: 'text/plain' })))
      .rejects.toThrow('只支持图片文件')
  })

  it('解码失败回退原文件（服务端 8MB 白名单兜底）', async () => {
    stubImage({ decodeError: new Error('bad image') })
    const file = new Blob(['raw'], { type: 'image/png' })

    const result = await prepareChatImage(file)

    expect(result.blob).toBe(file)
    expect(result.previewUrl).toBe('blob:mock-preview')
  })

  it('jsdom 无 canvas（getContext 返回 null）→ 回退原文件', async () => {
    stubImage()
    const file = new Blob(['raw'], { type: 'image/png' })

    const result = await prepareChatImage(file)

    expect(result.blob).toBe(file)
    expect(result.previewUrl).toBe('blob:mock-preview')
  })

  it('正常路径：等比缩放到 ≤1024 并导出 JPEG 0.85', async () => {
    stubImage({ width: 2000, height: 1000 })
    const exported = new Blob(['jpeg-bytes'], { type: 'image/jpeg' })
    const ctx = { drawImage: vi.fn() }
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
      toBlob: vi.fn((callback) => callback(exported)),
    }
    const realCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) =>
      (tag === 'canvas' ? canvas : realCreateElement(tag)))

    const file = new Blob(['raw'], { type: 'image/png' })
    const result = await prepareChatImage(file)

    expect(canvas.width).toBe(1024)
    expect(canvas.height).toBe(512)
    expect(ctx.drawImage).toHaveBeenCalled()
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85)
    expect(result.blob).toBe(exported)
    expect(result.previewUrl).toBe('blob:mock-preview')
  })

  it('toBlob 产不出 blob → 回退原文件', async () => {
    stubImage()
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
      toBlob: vi.fn((callback) => callback(null)),
    }
    const realCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) =>
      (tag === 'canvas' ? canvas : realCreateElement(tag)))

    const file = new Blob(['raw'], { type: 'image/png' })
    const result = await prepareChatImage(file)

    expect(result.blob).toBe(file)
  })
})
