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
   * @param {'IMAGE' | 'VIDEO'} mode
   */
  const ensureMode = async (mode) => {
    const landmarker = await load()
    if (runningMode !== mode) {
      await landmarker.setOptions({ runningMode: mode })
      runningMode = mode
    }
    return landmarker
  }

  /**
   * @param {FaceLandmarkerResult} result
   * @returns {Landmark[] | null}
   */
  const firstFace = (result) => result?.faceLandmarks?.[0] ?? null

  singleton = {
    tessellation: FaceLandmarker.FACE_LANDMARKS_TESSELATION,
    async detectImage(source) {
      const landmarker = await ensureMode('IMAGE')
      return firstFace(landmarker.detect(source))
    },
    async detectVideoFrame(video, timestampMs) {
      const landmarker = await ensureMode('VIDEO')
      return firstFace(landmarker.detectForVideo(video, timestampMs))
    },
  }
  return singleton
}
