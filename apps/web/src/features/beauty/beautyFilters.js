// 皮肤滤镜与形变三角形计算：纯函数，不碰 canvas / DOM，jsdom 可直接测。

/**
 * @typedef {import('./faceGeometry').SkinRegion} SkinRegion
 * @typedef {import('./faceGeometry').WarpMap} WarpMap
 * @typedef {import('./faceGeometry').Point} Point
 * @typedef {{ start: number, end: number }} Connection
 * @typedef {{ srcTri: Point[], dstTri: Point[] }} WarpTriangle
 */

// 美白最大提升幅度：占当前亮度到 255 空余量的比例，保证提升有上限且不过曝
export const WHITEN_HEADROOM = 0.35

// 模块级 scratch 缓冲：同尺寸调用复用，消除每帧约 16MB 的短生命周期分配
// （1280×720 时 mask 0.9MB + 输出像素 3.5MB + soften 输出 10.5MB + 降采样网格 ~1.2MB）。
// 注意：applySkinFilters 返回的 ImageData 由 scratch.rgba 背书，下一次同尺寸调用会覆写——
// 调用方（beautyPipeline）拿到结果立即 putImageData 消费，不得跨调用持有。
const scratch = {
  size: -1, // 当前缓冲对应的像素数（宽×高）
  smallSize: -1, // 降采样网格浮点长度
  /** @type {Uint8Array | null} */ mask: null,
  /** @type {Float32Array | null} */ soft: null, // 软化结果 RGB
  /** @type {Float32Array | null} */ row: null, // 可分离盒式模糊的行缓冲
  /** @type {Uint8ClampedArray<ArrayBuffer> | null} */ rgba: null, // 输出像素
  /** @type {Float32Array | null} */ small: null, // 降采样网格 RGB
}

/**
 * @param {number} pixelCount
 * @param {number} [smallLen] 降采样网格需要的浮点长度
 */
const ensureScratch = (pixelCount, smallLen = 0) => {
  if (scratch.size !== pixelCount) {
    scratch.mask = new Uint8Array(pixelCount)
    scratch.soft = new Float32Array(pixelCount * 3)
    scratch.row = new Float32Array(pixelCount * 3)
    scratch.rgba = new Uint8ClampedArray(pixelCount * 4)
    scratch.size = pixelCount
  }
  if (smallLen > scratch.smallSize) {
    scratch.small = new Float32Array(smallLen)
    scratch.smallSize = smallLen
  }
}

/**
 * 磨皮 + 美白。两者均为 0（或无皮肤区域）时原样返回传入的 imageData（引用相等）。
 * 磨皮：皮肤区内做降采样-升采样柔化，再按强度与原图混合；眼/唇/眉孔洞不动。
 * 美白：皮肤区亮度温和提升，提升量以 WHITEN_HEADROOM 为上界。
 * 返回的 ImageData 复用模块级像素缓冲（见 scratch 注释），仅限立即消费。
 * @param {ImageData} imageData
 * @param {SkinRegion | null} skinRegion 像素坐标皮肤区域
 * @param {{ smooth?: number, whiten?: number }} settings 0-100
 * @returns {ImageData}
 */
export function applySkinFilters(imageData, skinRegion, { smooth = 0, whiten = 0 } = {}) {
  const smoothA = clampPercent(smooth) / 100
  const whitenA = clampPercent(whiten) / 100
  if ((smoothA === 0 && whitenA === 0) || !skinRegion) return imageData

  const { width, height } = imageData
  const src = imageData.data
  const box = regionBounds(skinRegion.outer, width, height)
  ensureScratch(width * height)
  const mask = rasterizeRegion(skinRegion, width, height)
  const soft = smoothA > 0 ? soften(src, width, height, box) : null
  const dst = /** @type {Uint8ClampedArray<ArrayBuffer>} */ (scratch.rgba)
  dst.set(src)

  for (let y = box.top; y <= box.bottom; y++) {
    const row = y * width
    for (let x = box.left; x <= box.right; x++) {
      const i = row + x
      if (!mask[i]) continue
      const p = i * 4
      for (let c = 0; c < 3; c++) {
        let v = src[p + c]
        if (soft) v += (soft[i * 3 + c] - v) * smoothA
        if (whitenA > 0) v += (255 - v) * whitenA * WHITEN_HEADROOM
        dst[p + c] = v
      }
    }
  }
  return new ImageData(dst, width, height)
}

/**
 * 形变三角形列表：tessellation 每连续 3 条边构成一个闭合三角形
 * （与 FaceLandmarker.FACE_LANDMARKS_TESSELATION 的排布一致）。
 * srcTri 用形变前点位，dstTri 用形变后点位，均为像素坐标。
 * @param {number} width
 * @param {number} height
 * @param {WarpMap | null} warpMap
 * @param {Connection[] | null | undefined} tessellation
 * @returns {WarpTriangle[]}
 */
export function computeWarpTriangles(width, height, warpMap, tessellation) {
  if (!warpMap || !Array.isArray(tessellation)) return []
  /** @type {Map<number, Point>} */
  const srcPos = new Map()
  /** @type {Map<number, Point>} */
  const dstPos = new Map()
  warpMap.indices.forEach((idx, k) => {
    srcPos.set(idx, warpMap.source[k])
    dstPos.set(idx, warpMap.displaced[k])
  })

  /** @type {WarpTriangle[]} */
  const triangles = []
  for (let i = 0; i + 2 < tessellation.length; i += 3) {
    const ids = [tessellation[i].start, tessellation[i + 1].start, tessellation[i + 2].start]
    const srcTri = ids.map(idx => srcPos.get(idx))
    const dstTri = ids.map(idx => dstPos.get(idx))
    if (srcTri.some(p => !p) || dstTri.some(p => !p)) continue
    triangles.push({
      srcTri: srcTri.map(p => ({ x: p.x * width, y: p.y * height })),
      dstTri: dstTri.map(p => ({ x: p.x * width, y: p.y * height })),
    })
  }
  return triangles
}

/**
 * @param {number} value
 */
const clampPercent = (value) => Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))

/**
 * 皮肤区域光栅化：外环填 1，孔洞（眼/唇/眉）清 0，逐扫描线 even-odd。
 * 复用 scratch.mask（先清零再填）。
 * @param {SkinRegion} region
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array}
 */
const rasterizeRegion = (region, width, height) => {
  const mask = scratch.mask
  mask.fill(0)
  fillPolygon(mask, width, height, region.outer, 1)
  for (const hole of region.holes) fillPolygon(mask, width, height, hole, 0)
  return mask
}

/**
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} height
 * @param {Point[]} polygon
 * @param {0 | 1} value
 */
const fillPolygon = (mask, width, height, polygon, value) => {
  const ys = polygon.map(p => p.y)
  const top = Math.max(0, Math.ceil(Math.min(...ys) - 0.5))
  const bottom = Math.min(height - 1, Math.floor(Math.max(...ys) - 0.5))
  /** @type {number[]} */
  const xs = []
  for (let y = top; y <= bottom; y++) {
    const yc = y + 0.5
    xs.length = 0
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i]
      const q = polygon[(i + 1) % polygon.length]
      if ((p.y <= yc) === (q.y <= yc)) continue
      xs.push(p.x + ((yc - p.y) * (q.x - p.x)) / (q.y - p.y))
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5))
      const to = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5))
      const row = y * width
      for (let x = from; x <= to; x++) mask[row + x] = value
    }
  }
}

/**
 * 降采样（块均值）→ 双线性升采样：大图先缩到约 256px 量级柔化，性能可控；
 * 小图退化为 3x3 盒式模糊，保证磨皮在任何尺寸下都有可见效果。
 * 只计算皮肤包围盒内的输出像素：盒外像素只会被掩码循环跳过，算了也没人读。
 * @param {Uint8ClampedArray} data RGBA
 * @param {number} width
 * @param {number} height
 * @param {{ left: number, right: number, top: number, bottom: number }} box 皮肤包围盒
 * @returns {Float32Array} RGB 软化结果（仅 box 内像素有效）
 */
const soften = (data, width, height, box) => {
  const factor = Math.max(1, Math.round(Math.min(width, height) / 256))
  if (factor === 1) return boxBlur3x3(data, width, height, box)

  const sw = Math.max(1, Math.floor(width / factor))
  const sh = Math.max(1, Math.floor(height / factor))
  ensureScratch(width * height, sw * sh * 3)
  const small = scratch.small
  const scaleX = sw / width
  const scaleY = sh / height

  // 只降采样包围盒双线性采样会触达的网格点（含外侧一圈）
  const sx0 = Math.max(0, Math.floor(clamp((box.left + 0.5) * scaleX - 0.5, 0, sw - 1)))
  const sx1 = Math.min(sw - 1, Math.floor(clamp((box.right + 0.5) * scaleX - 0.5, 0, sw - 1)) + 1)
  const sy0 = Math.max(0, Math.floor(clamp((box.top + 0.5) * scaleY - 0.5, 0, sh - 1)))
  const sy1 = Math.min(sh - 1, Math.floor(clamp((box.bottom + 0.5) * scaleY - 0.5, 0, sh - 1)) + 1)
  for (let sy = sy0; sy <= sy1; sy++) {
    const y0 = sy * factor
    const y1 = Math.min(y0 + factor, height)
    for (let sx = sx0; sx <= sx1; sx++) {
      const x0 = sx * factor
      const x1 = Math.min(x0 + factor, width)
      let r = 0
      let g = 0
      let b = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = (y * width + x) * 4
          r += data[p]
          g += data[p + 1]
          b += data[p + 2]
        }
      }
      const n = (x1 - x0) * (y1 - y0)
      const t = (sy * sw + sx) * 3
      small[t] = r / n
      small[t + 1] = g / n
      small[t + 2] = b / n
    }
  }

  const out = scratch.soft
  for (let y = box.top; y <= box.bottom; y++) {
    const gy = clamp((y + 0.5) * scaleY - 0.5, 0, sh - 1)
    const yA = Math.floor(gy)
    const yB = Math.min(yA + 1, sh - 1)
    const wy = gy - yA
    for (let x = box.left; x <= box.right; x++) {
      const gx = clamp((x + 0.5) * scaleX - 0.5, 0, sw - 1)
      const xA = Math.floor(gx)
      const xB = Math.min(xA + 1, sw - 1)
      const wx = gx - xA
      const t = (y * width + x) * 3
      const i00 = (yA * sw + xA) * 3
      const i01 = (yA * sw + xB) * 3
      const i10 = (yB * sw + xA) * 3
      const i11 = (yB * sw + xB) * 3
      for (let c = 0; c < 3; c++) {
        const top = small[i00 + c] + (small[i01 + c] - small[i00 + c]) * wx
        const bottom = small[i10 + c] + (small[i11 + c] - small[i10 + c]) * wx
        out[t + c] = top + (bottom - top) * wy
      }
    }
  }
  return out
}

/**
 * 可分离 3x3 盒式模糊：行 1×3 + 列 3×1 两遍，每像素 6 次采样（原实现 9 次）。
 * 有效采样数 n = 行有效数 × 列有效数，与逐点 3x3 求和再除以有效数完全等价
 * （各中间和都是小整数，无浮点误差）。只写皮肤包围盒内的像素。
 * @param {Uint8ClampedArray} data RGBA
 * @param {number} width
 * @param {number} height
 * @param {{ left: number, right: number, top: number, bottom: number }} box 皮肤包围盒
 * @returns {Float32Array} RGB（仅 box 内像素有效）
 */
const boxBlur3x3 = (data, width, height, box) => {
  const rowBuf = scratch.row
  const out = scratch.soft

  // 行 pass：列 pass 只会读 [top-1, bottom+1] 的行
  const rowTop = Math.max(0, box.top - 1)
  const rowBottom = Math.min(height - 1, box.bottom + 1)
  for (let y = rowTop; y <= rowBottom; y++) {
    for (let x = box.left; x <= box.right; x++) {
      const x0 = Math.max(0, x - 1)
      const x1 = Math.min(width - 1, x + 1)
      let r = 0
      let g = 0
      let b = 0
      for (let xx = x0; xx <= x1; xx++) {
        const p = (y * width + xx) * 4
        r += data[p]
        g += data[p + 1]
        b += data[p + 2]
      }
      const t = (y * width + x) * 3
      rowBuf[t] = r
      rowBuf[t + 1] = g
      rowBuf[t + 2] = b
    }
  }

  // 列 pass：out = Σdy 行和 / (行有效数 × 列有效数)
  for (let y = box.top; y <= box.bottom; y++) {
    const y0 = Math.max(0, y - 1)
    const y1 = Math.min(height - 1, y + 1)
    const cy = y1 - y0 + 1
    for (let x = box.left; x <= box.right; x++) {
      const cx = Math.min(width - 1, x + 1) - Math.max(0, x - 1) + 1
      let r = 0
      let g = 0
      let b = 0
      for (let yy = y0; yy <= y1; yy++) {
        const t = (yy * width + x) * 3
        r += rowBuf[t]
        g += rowBuf[t + 1]
        b += rowBuf[t + 2]
      }
      const n = cx * cy
      const t = (y * width + x) * 3
      out[t] = r / n
      out[t + 1] = g / n
      out[t + 2] = b / n
    }
  }
  return out
}

/**
 * @param {Point[]} polygon
 * @param {number} width
 * @param {number} height
 */
const regionBounds = (polygon, width, height) => ({
  left: Math.max(0, Math.floor(Math.min(...polygon.map(p => p.x)))),
  right: Math.min(width - 1, Math.ceil(Math.max(...polygon.map(p => p.x)))),
  top: Math.max(0, Math.floor(Math.min(...polygon.map(p => p.y)))),
  bottom: Math.min(height - 1, Math.ceil(Math.max(...polygon.map(p => p.y)))),
})

/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
