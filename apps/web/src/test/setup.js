import * as domMatchers from '@testing-library/jest-dom/matchers'
import { cleanup } from '@testing-library/react'
import { afterEach, expect, vi } from 'vitest'
import axios from 'axios'

expect.extend(domMatchers)

// 单元测试不得访问本机开发 API；服务测试可显式提供自己的 adapter 或 mock。
if (axios.defaults) {
  axios.defaults.adapter = async () => { throw new Error('Unit tests must mock API requests') }
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

Element.prototype.scrollIntoView = vi.fn()
// jsdom 不解码媒体；播放生命周期由 AmbientMedia 的专项测试模拟验证。
HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
HTMLMediaElement.prototype.pause = vi.fn()
// jsdom 未实现 ObjectURL；本地照片预览依赖它，统一 mock 供各测试断言
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = vi.fn(() => 'blob:mock-preview')
  URL.revokeObjectURL = vi.fn()
}
// jsdom 未实现 ImageData；美颜滤镜的纯像素计算测试只需要 width/height/data 三元组
if (typeof globalThis.ImageData !== 'function') {
  globalThis.ImageData = class ImageData {
    // 支持 new ImageData(w, h) 与 new ImageData(Uint8ClampedArray, w, h) 两种重载
    constructor(widthOrData, heightOrWidth, maybeHeight) {
      if (widthOrData instanceof Uint8ClampedArray) {
        this.data = widthOrData
        this.width = heightOrWidth
        this.height = maybeHeight ?? widthOrData.length / 4 / heightOrWidth
      } else {
        this.width = widthOrData
        this.height = heightOrWidth
        this.data = new Uint8ClampedArray(widthOrData * heightOrWidth * 4)
      }
    }
  }
}
