import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn() },
  FaceLandmarker: {
    FACE_LANDMARKS_TESSELATION: [
      { start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 0 },
    ],
    createFromOptions: vi.fn(),
  },
}))

const FACE = [{ x: 0.5, y: 0.5 }]

const makeLandmarker = () => ({
  detect: vi.fn(() => ({ faceLandmarks: [FACE] })),
  detectForVideo: vi.fn(() => ({ faceLandmarks: [FACE] })),
  setOptions: vi.fn(async () => {}),
})

/** 每个用例重建模块（单例缓存复位）并返回引擎与 mock 句柄 */
const setup = async () => {
  vi.resetModules()
  const mp = await import('@mediapipe/tasks-vision')
  const { createBeautyEngine, MODEL_ASSET_PATH, WASM_BASE_PATH } = await import('./beautyEngine')
  return { mp, createBeautyEngine, MODEL_ASSET_PATH, WASM_BASE_PATH }
}

describe('createBeautyEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('返回单例：两次调用是同一对象', async () => {
    const { createBeautyEngine } = await setup()
    expect(createBeautyEngine()).toBe(createBeautyEngine())
  })

  it('懒加载：创建引擎不触发模型加载，首次 detect 才加载本地 wasm 与模型', async () => {
    const { mp, createBeautyEngine, MODEL_ASSET_PATH, WASM_BASE_PATH } = await setup()
    const landmarker = makeLandmarker()
    mp.FilesetResolver.forVisionTasks.mockResolvedValue('fileset')
    mp.FaceLandmarker.createFromOptions.mockResolvedValue(landmarker)

    const engine = createBeautyEngine()
    expect(mp.FilesetResolver.forVisionTasks).not.toHaveBeenCalled()

    const landmarks = await engine.detectImage({})
    expect(mp.FilesetResolver.forVisionTasks).toHaveBeenCalledTimes(1)
    expect(mp.FilesetResolver.forVisionTasks).toHaveBeenCalledWith(WASM_BASE_PATH)
    expect(WASM_BASE_PATH).toBe('/mp-models/wasm')
    expect(mp.FaceLandmarker.createFromOptions).toHaveBeenCalledWith(
      'fileset',
      expect.objectContaining({ baseOptions: { modelAssetPath: MODEL_ASSET_PATH }, numFaces: 1 }),
    )
    expect(MODEL_ASSET_PATH).toBe('/mp-models/face_landmarker.task')
    expect(landmarks).toBe(FACE)
  })

  it('加载成功后复用同一个 landmarker（不重复初始化）', async () => {
    const { mp, createBeautyEngine } = await setup()
    const landmarker = makeLandmarker()
    mp.FilesetResolver.forVisionTasks.mockResolvedValue('fileset')
    mp.FaceLandmarker.createFromOptions.mockResolvedValue(landmarker)

    const engine = createBeautyEngine()
    await engine.detectImage({})
    await engine.detectImage({})
    expect(mp.FilesetResolver.forVisionTasks).toHaveBeenCalledTimes(1)
    expect(mp.FaceLandmarker.createFromOptions).toHaveBeenCalledTimes(1)
  })

  it('detectImage 取第一张脸的 landmarks；无脸返回 null', async () => {
    const { mp, createBeautyEngine } = await setup()
    const landmarker = makeLandmarker()
    mp.FilesetResolver.forVisionTasks.mockResolvedValue('fileset')
    mp.FaceLandmarker.createFromOptions.mockResolvedValue(landmarker)
    const engine = createBeautyEngine()

    landmarker.detect.mockReturnValueOnce({ faceLandmarks: [] })
    expect(await engine.detectImage({})).toBeNull()
    landmarker.detect.mockReturnValueOnce({ faceLandmarks: [FACE] })
    expect(await engine.detectImage({})).toBe(FACE)
  })

  it('detectVideoFrame 传递时间戳并按需切换 VIDEO 模式', async () => {
    const { mp, createBeautyEngine } = await setup()
    const landmarker = makeLandmarker()
    mp.FilesetResolver.forVisionTasks.mockResolvedValue('fileset')
    mp.FaceLandmarker.createFromOptions.mockResolvedValue(landmarker)
    const engine = createBeautyEngine()
    const video = {}

    expect(await engine.detectVideoFrame(video, 1234)).toBe(FACE)
    expect(landmarker.setOptions).toHaveBeenCalledWith({ runningMode: 'VIDEO' })
    expect(landmarker.detectForVideo).toHaveBeenCalledWith(video, 1234)

    // 已是 VIDEO 模式：不再重复 setOptions；切回 IMAGE 会再次切换
    landmarker.setOptions.mockClear()
    await engine.detectVideoFrame(video, 1300)
    expect(landmarker.setOptions).not.toHaveBeenCalled()
    await engine.detectImage({})
    expect(landmarker.setOptions).toHaveBeenCalledWith({ runningMode: 'IMAGE' })
  })

  it('加载失败抛出诚实错误，且不留缓存可重试', async () => {
    const { mp, createBeautyEngine } = await setup()
    mp.FilesetResolver.forVisionTasks.mockResolvedValue('fileset')
    mp.FaceLandmarker.createFromOptions
      .mockRejectedValueOnce(new Error('wasm missing'))
      .mockResolvedValueOnce(makeLandmarker())
    const engine = createBeautyEngine()

    await expect(engine.detectImage({})).rejects.toThrow('美颜引擎加载失败')
    // 重试成功
    await expect(engine.detectImage({})).resolves.toBe(FACE)
    expect(mp.FaceLandmarker.createFromOptions).toHaveBeenCalledTimes(2)
  })

  it('暴露 tessellation（FaceLandmarker 静态连接表）', async () => {
    const { mp, createBeautyEngine } = await setup()
    expect(createBeautyEngine().tessellation).toBe(mp.FaceLandmarker.FACE_LANDMARKS_TESSELATION)
  })

  it('并发 detectImage/detectVideoFrame 串行化：无交错 setOptions，模式随调用顺序翻转', async () => {
    const { mp, createBeautyEngine } = await setup()
    /** @type {string[]} 临界区事件顺序：串行化正确时严格按提交顺序、setOptions 不成对交错 */
    const ops = []
    const landmarker = {
      detect: vi.fn(() => { ops.push('detect'); return { faceLandmarks: [FACE] } }),
      detectForVideo: vi.fn(() => { ops.push('detectForVideo'); return { faceLandmarks: [FACE] } }),
      setOptions: vi.fn(async ({ runningMode }) => { ops.push(`setOptions:${runningMode}`) }),
    }
    // 加载本身也异步（并发调用都会在 load 完成前进入队列）
    let resolveCreate
    mp.FilesetResolver.forVisionTasks.mockResolvedValue('fileset')
    mp.FaceLandmarker.createFromOptions.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve }))
    const engine = createBeautyEngine()

    const pending = [
      engine.detectImage({}),
      engine.detectVideoFrame({}, 1),
      engine.detectImage({}),
      engine.detectVideoFrame({}, 2),
    ]
    resolveCreate(landmarker)
    await Promise.all(pending)

    // 初始 IMAGE：detect 直接跑；之后严格按 VIDEO→IMAGE→VIDEO 各切一次，不交错
    expect(ops).toEqual([
      'detect',
      'setOptions:VIDEO', 'detectForVideo',
      'setOptions:IMAGE', 'detect',
      'setOptions:VIDEO', 'detectForVideo',
    ])
    expect(landmarker.setOptions).toHaveBeenCalledTimes(3)
  })

  it('一次调用失败不阻塞后续排队的调用', async () => {
    const { mp, createBeautyEngine } = await setup()
    const landmarker = makeLandmarker()
    landmarker.detect.mockImplementationOnce(() => { throw new Error('decode failed') })
    mp.FilesetResolver.forVisionTasks.mockResolvedValue('fileset')
    mp.FaceLandmarker.createFromOptions.mockResolvedValue(landmarker)
    const engine = createBeautyEngine()

    await expect(engine.detectImage({})).rejects.toThrow('decode failed')
    await expect(engine.detectVideoFrame({}, 1)).resolves.toBe(FACE)
    expect(landmarker.setOptions).toHaveBeenCalledWith({ runningMode: 'VIDEO' })
  })
})
