// 形变渲染器：把 computeWarpTriangles 的输出逐三角形仿射绘制到目标 canvas。
// 路径：先整图铺底 → 每个三角形 clip(目标三角形) + setTransform(src→dst 仿射) + drawImage。

/**
 * @typedef {import('./beautyFilters').WarpTriangle} WarpTriangle
 * @typedef {import('./faceGeometry').Point} Point
 * @typedef {CanvasRenderingContext2D} Ctx
 * @typedef {HTMLCanvasElement} Canvas
 */

// clip 多边形向外扩的像素量：掩盖相邻三角形接缝
const CLIP_EXPANSION_PX = 0.75

/**
 * @param {Canvas} sourceCanvas 已完成皮肤滤镜的源画布
 * @param {WarpTriangle[]} triangles 像素坐标三角形列表
 * @param {Canvas} [targetCanvas] 不传则按 sourceCanvas 同源创建
 * @returns {Canvas}
 */
export function drawWarpedTriangles(sourceCanvas, triangles, targetCanvas) {
  const target = targetCanvas || createSiblingCanvas(sourceCanvas)
  // 写 width/height 即使值不变也会触发 backing store 重分配并清空画布：仅尺寸变化时写
  if (target.width !== sourceCanvas.width) target.width = sourceCanvas.width
  if (target.height !== sourceCanvas.height) target.height = sourceCanvas.height
  const ctx = target.getContext('2d')
  if (!ctx) return target

  ctx.drawImage(sourceCanvas, 0, 0)
  for (const { srcTri, dstTri } of triangles) {
    const srcArea = signedArea(srcTri)
    const dstArea = signedArea(dstTri)
    // 退化三角形跳过；dst 相对 src 翻转（形变折叠）也跳过——画出来是镜像内容，
    // 跳过则保留铺底原图，视觉上远比折叠伪影干净
    if (Math.abs(srcArea) < 0.25 || Math.abs(dstArea) < 0.25) continue
    if (Math.sign(srcArea) !== Math.sign(dstArea)) continue
    const t = affineFromTriangles(srcTri, dstTri)
    const clip = expandTriangle(dstTri, CLIP_EXPANSION_PX)
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(clip[0].x, clip[0].y)
    ctx.lineTo(clip[1].x, clip[1].y)
    ctx.lineTo(clip[2].x, clip[2].y)
    ctx.closePath()
    ctx.clip()
    ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f)
    ctx.drawImage(sourceCanvas, 0, 0)
    ctx.restore()
  }
  return target
}

/**
 * @param {Canvas} sourceCanvas
 * @returns {Canvas}
 */
const createSiblingCanvas = (sourceCanvas) => {
  const doc = sourceCanvas.ownerDocument || document
  return /** @type {Canvas} */ (doc.createElement('canvas'))
}

/**
 * 三点对应求仿射矩阵：x' = a·x + c·y + e，y' = b·x + d·y + f。
 * @param {Point[]} src
 * @param {Point[]} dst
 */
const affineFromTriangles = (src, dst) => {
  const [p0, p1, p2] = src
  const [q0, q1, q2] = dst
  const denom = p0.x * (p1.y - p2.y) + p1.x * (p2.y - p0.y) + p2.x * (p0.y - p1.y)
  const solve = (u0, u1, u2) => ({
    m1: (u0 * (p1.y - p2.y) + u1 * (p2.y - p0.y) + u2 * (p0.y - p1.y)) / denom,
    m2: (u0 * (p2.x - p1.x) + u1 * (p0.x - p2.x) + u2 * (p1.x - p0.x)) / denom,
    m3:
      (u0 * (p1.x * p2.y - p2.x * p1.y)
        + u1 * (p2.x * p0.y - p0.x * p2.y)
        + u2 * (p0.x * p1.y - p1.x * p0.y))
      / denom,
  })
  const row1 = solve(q0.x, q1.x, q2.x)
  const row2 = solve(q0.y, q1.y, q2.y)
  return { a: row1.m1, b: row2.m1, c: row1.m2, d: row2.m2, e: row1.m3, f: row2.m3 }
}

/**
 * 有符号面积：符号即环绕方向，用于检测形变导致的三角形翻转
 * @param {Point[]} tri
 */
const signedArea = (tri) =>
  ((tri[1].x - tri[0].x) * (tri[2].y - tri[0].y)
    - (tri[2].x - tri[0].x) * (tri[1].y - tri[0].y)) / 2

/**
 * 以质心为轴把三角形每个顶点外扩 amount 像素。
 * @param {Point[]} tri
 * @param {number} amount
 * @returns {Point[]}
 */
const expandTriangle = (tri, amount) => {
  const cx = (tri[0].x + tri[1].x + tri[2].x) / 3
  const cy = (tri[0].y + tri[1].y + tri[2].y) / 3
  return tri.map((p) => {
    const dx = p.x - cx
    const dy = p.y - cy
    const len = Math.hypot(dx, dy) || 1
    return { x: p.x + (dx / len) * amount, y: p.y + (dy / len) * amount }
  })
}
