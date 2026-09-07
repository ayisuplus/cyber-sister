// 美颜流水线：检测关键点 → 皮肤滤镜 → 逐三角形形变，全部在本机完成。
// engine 可注入（测试用假引擎），浏览器侧由 beautyEngine.createBeautyEngine() 提供。
import { buildSkinRegion, buildWarpMap } from './faceGeometry'
import { applySkinFilters, computeWarpTriangles } from './beautyFilters'
import { drawWarpedTriangles } from './warpRenderer'

/**
 * @typedef {import('./beautyEngine').BeautyEngine} BeautyEngine
 * @typedef {import('./presets').BeautySettings} BeautySettings
 * @typedef {HTMLCanvasElement} Canvas
 * @typedef {CanvasRenderingContext2D} Ctx
 */

/**
 * @param {{ engine: BeautyEngine }} deps
 * @returns {{ processImage: (sourceCanvas: Canvas, settings?: Partial<BeautySettings>, options?: { landmarkKey?: unknown }) => Promise<Canvas> }}
 */
export function createBeautyPipeline({ engine }) {
  if (!engine || typeof engine.detectImage !== 'function') {
    throw new TypeError('createBeautyPipeline 需要 { engine }，且 engine 必须暴露 detectImage()')
  }

  // 形变目标画布跨帧复用：避免每帧新建 canvas（backing store 分配 + GC 压力）。
  // 调用方拿到返回值应立即消费（绘制/导出），下一次同尺寸调用会覆写。
  /** @type {Canvas | null} */
  let warpTarget = null

  // 静态照片模式的 landmarks 缓存：同一源图（landmarkKey 相同）只检测一次，
  // 滑杆调整只重跑滤镜/形变；换图（key 变化）即失效重检。
  /** @type {{ key: unknown, landmarks: import('./faceGeometry').Landmark[] | null }} */
  let landmarkCache = { key: null, landmarks: null }

  /**
   * @param {Canvas} source
   * @returns {Canvas}
   */
  const copyCanvas = (source) => {
    const doc = source.ownerDocument || document
    const copy = /** @type {Canvas} */ (doc.createElement('canvas'))
    copy.width = source.width
    copy.height = source.height
    copy.getContext('2d')?.drawImage(source, 0, 0)
    return copy
  }

  /**
   * @param {Canvas} source
   * @returns {Canvas}
   */
  const getWarpTarget = (source) => {
    if (!warpTarget) {
      const doc = source.ownerDocument || document
      warpTarget = /** @type {Canvas} */ (doc.createElement('canvas'))
    }
    return warpTarget
  }

  return {
    /**
     * 处理一帧/一张图：返回新的 canvas；检测不到人脸时返回原图拷贝（不做任何修饰）。
     * @param {Canvas} sourceCanvas
     * @param {Partial<BeautySettings>} settings 缺省项按 0（不处理）
     * @param {{ landmarkKey?: unknown }} [options] 传 landmarkKey 时按 key 缓存检测结果
     * @returns {Promise<Canvas>}
     */
    async processImage(sourceCanvas, settings = {}, options = {}) {
      const { landmarkKey } = options
      let landmarks
      if (landmarkKey != null && landmarkCache.key === landmarkKey) {
        landmarks = landmarkCache.landmarks
      } else {
        landmarks = await engine.detectImage(sourceCanvas)
        if (landmarkKey != null) landmarkCache = { key: landmarkKey, landmarks }
      }
      const working = copyCanvas(sourceCanvas)
      if (!landmarks) return working

      const { smooth = 0, whiten = 0, slim = 0, eye = 0 } = settings
      const { width, height } = working

      if (smooth > 0 || whiten > 0) {
        const ctx = working.getContext('2d')
        const region = buildSkinRegion(landmarks, width, height)
        if (ctx && region) {
          const imageData = ctx.getImageData(0, 0, width, height)
          ctx.putImageData(applySkinFilters(imageData, region, { smooth, whiten }), 0, 0)
        }
      }

      if (slim > 0 || eye > 0) {
        const warpMap = buildWarpMap(landmarks, { slim, eye })
        const triangles = computeWarpTriangles(width, height, warpMap, engine.tessellation ?? [])
        return drawWarpedTriangles(working, triangles, getWarpTarget(sourceCanvas))
      }

      return working
    },
  }
}
