import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PhotoError, preparePhoto } from './preparePhoto'

// jsdom 不解码图片、也没有 canvas：用替身记下画了多大、存成什么格式
function fakeImage({ width = 4000, height = 3000, fails = false } = {}) {
  return class {
    naturalWidth = width
    naturalHeight = height
    decode() { return fails ? Promise.reject(new Error('bad')) : Promise.resolve() }
  }
}

let drawn
beforeEach(() => {
  drawn = []
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext() {
    const canvas = this
    return { fillRect: vi.fn(), drawImage: () => drawn.push([canvas.width, canvas.height]), set fillStyle(_value) {} }
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function toBlob(callback, type, quality) {
    callback(new Blob([`${this.width}x${this.height}`], { type }))
    drawn.push({ type, quality })
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('收藏的照片先在这台设备上重画', () => {
  it('原图最长边 1600、缩略图 480，都存成 JPEG', async () => {
    vi.stubGlobal('Image', fakeImage())
    const result = await preparePhoto(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))

    expect(drawn).toContainEqual([1600, 1200])
    expect(drawn).toContainEqual([480, 360])
    expect(drawn.filter((entry) => entry.type)).toEqual([{ type: 'image/jpeg', quality: 0.85 }, { type: 'image/jpeg', quality: 0.8 }])
    expect(result.photo.type).toBe('image/jpeg')
    expect(result.thumb.type).toBe('image/jpeg')
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('小图不放大', async () => {
    vi.stubGlobal('Image', fakeImage({ width: 300, height: 200 }))
    await preparePhoto(new File(['x'], 'a.png', { type: 'image/png' }))
    expect(drawn.filter(Array.isArray)).toEqual([[300, 200], [300, 200]])
  })

  it('读不了就如实报错，不退回原文件；不是图片直接拒绝', async () => {
    vi.stubGlobal('Image', fakeImage({ fails: true }))
    await expect(preparePhoto(new File(['x'], 'a.heic', { type: 'image/heic' }))).rejects.toEqual(new PhotoError('这张图读不了，换一张试试'))
    await expect(preparePhoto(new File(['x'], 'a.txt', { type: 'text/plain' }))).rejects.toBeInstanceOf(PhotoError)
    expect(drawn).toEqual([])
  })
})
