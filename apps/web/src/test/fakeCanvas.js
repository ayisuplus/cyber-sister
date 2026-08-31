// jsdom 无 2D canvas 实现：这里提供可断言调用的假 canvas/ctx，供 beauty 渲染链路测试使用。
import { vi } from 'vitest'

export function makeFakeCanvas(width = 0, height = 0, doc = null) {
  const ctx = {
    canvas: null,
    drawImage: vi.fn(),
    getImageData: vi.fn((x, y, w, h) => new ImageData(w, h)),
    putImageData: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    setTransform: vi.fn(),
  }
  const canvas = {
    width,
    height,
    getContext: vi.fn(() => ctx),
    ownerDocument: doc,
  }
  ctx.canvas = canvas
  return canvas
}

/** 共享假文档：createElement('canvas') 返回新的假 canvas，ownerDocument 自指 */
export function makeFakeDocument() {
  const doc = { createElement: null }
  doc.createElement = vi.fn(() => makeFakeCanvas(0, 0, doc))
  return doc
}

export const makeFakeCanvasWithDoc = (width, height) => {
  const doc = makeFakeDocument()
  const canvas = makeFakeCanvas(width, height, doc)
  return { canvas, doc, ctx: canvas.getContext('2d') }
}
