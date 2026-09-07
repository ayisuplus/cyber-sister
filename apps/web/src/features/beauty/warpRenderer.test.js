import { describe, expect, it, vi } from 'vitest'
import { makeFakeCanvas, makeFakeCanvasWithDoc } from '../../test/fakeCanvas'
import { drawWarpedTriangles } from './warpRenderer'

const makeCtxRecording = (canvas) => canvas.getContext('2d')

describe('drawWarpedTriangles', () => {
  it('每个三角形：clip 目标三角形 + setTransform(src→dst 仿射) + drawImage', () => {
    const { canvas: source } = makeFakeCanvasWithDoc(20, 20)
    const { canvas: target } = makeFakeCanvasWithDoc(20, 20)
    const ctx = makeCtxRecording(target)

    // src (0,0)(10,0)(0,10) → dst (5,5)(25,5)(5,45)：x 缩放 2、y 缩放 4、平移 (5,5)
    const triangles = [{
      srcTri: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
      dstTri: [{ x: 5, y: 5 }, { x: 25, y: 5 }, { x: 5, y: 45 }],
    }]
    const result = drawWarpedTriangles(source, triangles, target)

    expect(result).toBe(target)
    expect(target.width).toBe(20)
    expect(target.height).toBe(20)
    // 先整图铺底，再逐三角形覆盖
    expect(ctx.drawImage).toHaveBeenCalledTimes(2)
    expect(ctx.drawImage).toHaveBeenCalledWith(source, 0, 0)
    expect(ctx.setTransform).toHaveBeenCalledTimes(1)
    const [a, b, c, d, e, f] = ctx.setTransform.mock.calls[0]
    expect([a, b, c, d, e, f].map(v => Math.round(v * 1e9) / 1e9)).toEqual([2, 0, 0, 4, 5, 5])
    // clip 路径包住目标三角形（外扩防抖缝，顶点在 dst 附近）
    expect(ctx.save).toHaveBeenCalled()
    expect(ctx.clip).toHaveBeenCalled()
    expect(ctx.restore).toHaveBeenCalled()
    const pathPoints = [ctx.moveTo.mock.calls[0], ...ctx.lineTo.mock.calls]
    const cx = (5 + 25 + 5) / 3
    for (const [px, py] of pathPoints) {
      expect(Math.abs(px - cx)).toBeLessThan(15)
      expect(py).toBeGreaterThan(0)
    }
  })

  it('退化三角形（零面积）被跳过', () => {
    const { canvas: source } = makeFakeCanvasWithDoc(20, 20)
    const { canvas: target } = makeFakeCanvasWithDoc(20, 20)
    const ctx = makeCtxRecording(target)

    drawWarpedTriangles(source, [{
      srcTri: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
      dstTri: [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }],
    }], target)

    expect(ctx.drawImage).toHaveBeenCalledTimes(1) // 仅铺底
    expect(ctx.setTransform).not.toHaveBeenCalled()
  })

  it('dst 相对 src 翻转（高形变折叠）的三角形被跳过，保留铺底原图', () => {
    const { canvas: source } = makeFakeCanvasWithDoc(20, 20)
    const { canvas: target } = makeFakeCanvasWithDoc(20, 20)
    const ctx = makeCtxRecording(target)

    // src 逆时针；(5,5)(5,25)(15,5) 环绕方向相反 → 视为折叠
    drawWarpedTriangles(source, [{
      srcTri: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
      dstTri: [{ x: 5, y: 5 }, { x: 5, y: 25 }, { x: 15, y: 5 }],
    }], target)

    expect(ctx.drawImage).toHaveBeenCalledTimes(1) // 仅铺底
    expect(ctx.setTransform).not.toHaveBeenCalled()
  })

  it('不传 targetCanvas 时按源画布同源创建', () => {
    const { canvas: source, doc } = makeFakeCanvasWithDoc(8, 6)
    const result = drawWarpedTriangles(source, [])
    expect(doc.createElement).toHaveBeenCalledWith('canvas')
    expect(result.width).toBe(8)
    expect(result.height).toBe(6)
    expect(result.getContext('2d').drawImage).toHaveBeenCalledWith(source, 0, 0)
  })

  it('拿不到 2d 上下文时安全返回目标画布', () => {
    const source = makeFakeCanvas(8, 8)
    const target = makeFakeCanvas(8, 8)
    target.getContext = vi.fn(() => null)
    expect(drawWarpedTriangles(source, [], target)).toBe(target)
  })

  it('同尺寸目标画布不重写 width/height（避免 backing store 重分配），尺寸变化才写', () => {
    const { canvas: source } = makeFakeCanvasWithDoc(20, 20)
    const target = makeFakeCanvas(20, 20)
    const widthSetter = vi.fn()
    const heightSetter = vi.fn()
    let w = 20
    let h = 20
    Object.defineProperty(target, 'width', { get: () => w, set: widthSetter })
    Object.defineProperty(target, 'height', { get: () => h, set: heightSetter })

    drawWarpedTriangles(source, [], target)
    expect(widthSetter).not.toHaveBeenCalled()
    expect(heightSetter).not.toHaveBeenCalled()

    // 源尺寸变化：写一次新尺寸
    source.width = 32
    drawWarpedTriangles(source, [], target)
    expect(widthSetter).toHaveBeenCalledTimes(1)
    expect(widthSetter).toHaveBeenCalledWith(32)
    expect(heightSetter).not.toHaveBeenCalled()
  })
})
