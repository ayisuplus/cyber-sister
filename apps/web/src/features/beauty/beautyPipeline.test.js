import { describe, expect, it, vi } from 'vitest'
import { makeFakeCanvasWithDoc } from '../../test/fakeCanvas'
import { makeSyntheticLandmarks } from '../../test/syntheticFace'
import { createBeautyPipeline } from './beautyPipeline'

// 两个非退化三角形：含额头 10 / 下巴 152 / 下颌 148（slim 作用点）/ 左眼 263（eye 作用点）
const TESSELATION = [
  { start: 10, end: 152 }, { start: 152, end: 148 }, { start: 148, end: 10 },
  { start: 10, end: 263 }, { start: 263, end: 152 }, { start: 152, end: 10 },
]

const makeEngine = (landmarks = makeSyntheticLandmarks()) => ({
  tessellation: TESSELATION,
  detectImage: vi.fn(async () => landmarks),
})

describe('createBeautyPipeline', () => {
  it('engine 缺失或没有 detectImage 时抛 TypeError', () => {
    expect(() => createBeautyPipeline({})).toThrow(TypeError)
    expect(() => createBeautyPipeline({ engine: {} })).toThrow(TypeError)
  })

  it('原图设置（全 0）：返回源图拷贝，不做滤镜与形变', async () => {
    const { canvas: source, doc } = makeFakeCanvasWithDoc(20, 20)
    const engine = makeEngine()
    const pipeline = createBeautyPipeline({ engine })

    const out = await pipeline.processImage(source, { smooth: 0, whiten: 0, slim: 0, eye: 0 })

    expect(engine.detectImage).toHaveBeenCalledWith(source)
    expect(out).not.toBe(source)
    expect(doc.createElement).toHaveBeenCalledWith('canvas')
    const outCtx = out.getContext('2d')
    expect(outCtx.drawImage).toHaveBeenCalledWith(source, 0, 0) // 拷贝
    expect(outCtx.putImageData).not.toHaveBeenCalled()
    expect(outCtx.setTransform).not.toHaveBeenCalled()
  })

  it('检测不到人脸：返回原图拷贝，不做任何修饰', async () => {
    const { canvas: source } = makeFakeCanvasWithDoc(20, 20)
    const engine = makeEngine(null)
    const pipeline = createBeautyPipeline({ engine })

    const out = await pipeline.processImage(source, { smooth: 80, whiten: 80, slim: 80, eye: 80 })
    const outCtx = out.getContext('2d')
    expect(outCtx.putImageData).not.toHaveBeenCalled()
    expect(outCtx.setTransform).not.toHaveBeenCalled()
  })

  it('磨皮/美白：皮肤滤镜写回工作画布', async () => {
    const { canvas: source } = makeFakeCanvasWithDoc(20, 20)
    const engine = makeEngine()
    const pipeline = createBeautyPipeline({ engine })

    const out = await pipeline.processImage(source, { smooth: 0, whiten: 100, slim: 0, eye: 0 })
    const outCtx = out.getContext('2d')
    expect(outCtx.putImageData).toHaveBeenCalledTimes(1)
    const [imageData] = outCtx.putImageData.mock.calls[0]
    expect(imageData).toBeInstanceOf(ImageData)
    // 假 canvas 源图为全 0；whiten=100 会把皮肤区像素提亮
    expect([...imageData.data].some(v => v > 0)).toBe(true)
    // 无形变
    expect(outCtx.setTransform).not.toHaveBeenCalled()
  })

  it('瘦脸/大眼：按 tessellation 逐三角形仿射绘制到新画布', async () => {
    const { canvas: source, doc } = makeFakeCanvasWithDoc(20, 20)
    const engine = makeEngine()
    const pipeline = createBeautyPipeline({ engine })

    // slim=50：148 内收但未贴到中轴线（slim=100 会恰好与 10/152 共线退化成零面积）
    const out = await pipeline.processImage(source, { smooth: 0, whiten: 0, slim: 50, eye: 0 })

    expect(out).not.toBe(source)
    expect(doc.createElement).toHaveBeenCalledTimes(2) // 工作拷贝 + 形变目标
    const outCtx = out.getContext('2d')
    expect(outCtx.setTransform).toHaveBeenCalledTimes(2) // 两个三角形
    expect(outCtx.clip).toHaveBeenCalledTimes(2)
    // slim=50 时含 148 的三角形 dst ≠ src → 仿射不是单位矩阵
    const calls = outCtx.setTransform.mock.calls
    expect(calls.some(([a, b, c, d, e, f]) => a !== 1 || b !== 0 || c !== 0 || d !== 1 || e !== 0 || f !== 0)).toBe(true)
  })

  it('engine 无 tessellation 时形变退化为拷贝', async () => {
    const { canvas: source } = makeFakeCanvasWithDoc(20, 20)
    const engine = { detectImage: vi.fn(async () => makeSyntheticLandmarks()) }
    const pipeline = createBeautyPipeline({ engine })

    const out = await pipeline.processImage(source, { slim: 50 })
    const outCtx = out.getContext('2d')
    expect(outCtx.setTransform).not.toHaveBeenCalled()
    expect(outCtx.drawImage).toHaveBeenCalled()
  })

  it('同一 landmarkKey 的连续调用只检测一次：滑杆调整只重跑滤镜/形变', async () => {
    const { canvas: source } = makeFakeCanvasWithDoc(20, 20)
    const engine = makeEngine()
    const pipeline = createBeautyPipeline({ engine })

    await pipeline.processImage(source, { whiten: 50 }, { landmarkKey: 1 })
    await pipeline.processImage(source, { whiten: 80 }, { landmarkKey: 1 })
    await pipeline.processImage(source, { slim: 40, eye: 40 }, { landmarkKey: 1 })

    expect(engine.detectImage).toHaveBeenCalledTimes(1)
  })

  it('landmarkKey 变化（换图）重新检测；不传 key 时每次调用都检测（相机逐帧语义）', async () => {
    const { canvas: source } = makeFakeCanvasWithDoc(20, 20)
    const engine = makeEngine()
    const pipeline = createBeautyPipeline({ engine })

    await pipeline.processImage(source, { whiten: 50 }, { landmarkKey: 1 })
    await pipeline.processImage(source, { whiten: 50 }, { landmarkKey: 2 })
    await pipeline.processImage(source, { whiten: 50 }) // 无 key：相机模式逐帧检测
    await pipeline.processImage(source, { whiten: 50 }, { landmarkKey: 2 }) // 仍命中 key=2 缓存

    expect(engine.detectImage).toHaveBeenCalledTimes(3)
  })

  it('形变目标画布跨帧复用：第二次同尺寸调用不再新建 canvas', async () => {
    const { canvas: source, doc } = makeFakeCanvasWithDoc(20, 20)
    const engine = makeEngine()
    const pipeline = createBeautyPipeline({ engine })

    const first = await pipeline.processImage(source, { slim: 50 })
    const second = await pipeline.processImage(source, { slim: 60 })

    expect(second).toBe(first) // 同一块复用画布
    // 每次调用仍有 1 个工作拷贝：2 次拷贝 + 1 次目标画布（只在首次创建）
    expect(doc.createElement).toHaveBeenCalledTimes(3)
  })
})
