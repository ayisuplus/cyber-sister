// 美颜引擎：MediaPipe FaceLandmarker 的浏览器侧薄封装。
// 隐私合同：wasm 与模型全部从本地 /mp-models 加载，禁止 CDN；加载失败抛中文诚实错误供 UI 展示。
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

export const WASM_BASE_PATH = '/mp-models/wasm'
export const MODEL_ASSET_PATH = '/mp-models/face_landmarker.task'

const LOAD_ERROR_MESSAGE = '美颜引擎加载失败：本地模型文件不可用，请检查应用是否完整安装'

/**
 * @typedef {import('@mediapipe/tasks-vision').NormalizedLandmark} NormalizedLandmark
 * @typedef {import('./faceGeometry').Landmark} Landmark
 * @typedef {import('./beautyFilters').Connection} Connection
 * @typedef {import('@mediapipe/tasks-vision').FaceLandmarkerResult} FaceLandmarkerResult
 * @typedef {import('@mediapipe/tasks-vision').ImageSource} ImageSource
 */

/** @type {BeautyEngine | null} */
let singleton = null

/**
 * @typedef {object} BeautyEngine
 * @property {Connection[]} tessellation 脸部网格三角形连接（来自 FaceLandmarker 静态表）
 * @property {(source: ImageSource) => Promise<Landmark[] | null>} detectImage 静态图片检测
 * @property {(video: ImageSource, timestampMs: number) => Promise<Landmark[] | null>} detectVideoFrame 视频帧检测
 */

/**
 * 创建（或返回缓存的）美颜引擎单例。FaceLandmarker 懒加载：首次 detect 时才初始化。
 * @returns {BeautyEngine}
 */
export function createBeautyEngine() {
  if (singleton) return singleton

  /** @type {Promise<import('@mediapipe/tasks-vision').FaceLandmarker> | null} */
  let landmarkerPromise = null
  /** @type {'IMAGE' | 'VIDEO'} */
  let runningMode = 'IMAGE'
  // 模式切换串行化队列：并发 detectImage/detectVideoFrame 的 check-then-act
  // （判断 runningMode → await setOptions）跨 await 会交错翻转模式，
  // 用 promise 链把「按需切模式 + 本次 detect」整段串行，消除竞态。
  // 备选方案是按 mode 各持一个 landmarker 实例——双份 wasm/模型内存，
  // 而本应用相机循环自带处理中守卫、静态模式与相机模式互斥，串行链足够。
  /** @type {Promise<unknown>} */
  let modeQueue = Promise.resolve()

  const load = () => {
    if (!landmarkerPromise) {
      landmarkerPromise = (async () => {
        try {
          const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_PATH)
          return await FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_ASSET_PATH },
            runningMode,
            numFaces: 1,
          })
        } catch (cause) {
          // 失败不留缓存，允许 UI 重试
          landmarkerPromise = null
          throw new Error(LOAD_ERROR_MESSAGE, { cause })
        }
      })()
    }
    return landmarkerPromise
  }

  /**
   * 串行执行「确保 runningMode = mode，然后 run(landmarker)」整段临界区。
   * @param {'IMAGE' | 'VIDEO'} mode
   * @param {(landmarker: import('@mediapipe/tasks-vision').FaceLandmarker) => Landmark[] | null} run
   * @returns {Promise<Landmark[] | null>}
   */
  const withMode = (mode, run) => {
    const task = modeQueue.then(async () => {
      const landmarker = await load()
      if (runningMode !== mode) {
        await landmarker.setOptions({ runningMode: mode })
        runningMode = mode
      }
      return run(landmarker)
    })
    // 失败不阻塞后续调用（错误沿 task 抛给本次调用方）
    modeQueue = task.catch(() => {})
    return task
  }

  /**
   * @param {FaceLandmarkerResult} result
   * @returns {Landmark[] | null}
   */
  const firstFace = (result) => result?.faceLandmarks?.[0] ?? null

  singleton = {
    tessellation: FaceLandmarker.FACE_LANDMARKS_TESSELATION,
    async detectImage(source) {
      return withMode('IMAGE', landmarker => firstFace(landmarker.detect(source)))
    },
    async detectVideoFrame(video, timestampMs) {
      return withMode('VIDEO', landmarker => firstFace(landmarker.detectForVideo(video, timestampMs)))
    },
  }
  return singleton
}
