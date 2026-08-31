// 脸部几何纯函数：皮肤区域多边形与形变目标点位。
// 索引常量与 @mediapipe/tasks-vision 内置 Connection 列表（FACE_LANDMARKS_*）同源，
// 这里展开为纯数组，保证本模块不 import tasks-vision，jsdom 测试无需加载 wasm/模型。

/**
 * @typedef {{ x: number, y: number }} Point
 * NormalizedLandmark 兼容结构：MediaPipe 返回 { x, y, z, visibility? }，这里只用 x/y。
 * @typedef {{ x: number, y: number }} Landmark
 * @typedef {{ outer: Point[], holes: Point[][] }} SkinRegion
 * @typedef {{ indices: number[], source: Point[], displaced: Point[] }} WarpMap
 */

// 脸轮廓闭环（与 FACE_LANDMARKS_FACE_OVAL 一致，36 点）
export const FACE_OVAL_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
]

// 嘴唇外圈闭环（FACE_LANDMARKS_LIPS 的外圈部分，20 点）
export const LIPS_OUTER_INDICES = [
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146,
]

// 左右眼轮廓闭环（FACE_LANDMARKS_LEFT_EYE / RIGHT_EYE，各 16 点）
export const LEFT_EYE_INDICES = [
  263, 249, 390, 373, 374, 380, 381, 382, 362, 466, 388, 387, 386, 385, 384, 398,
]
export const RIGHT_EYE_INDICES = [
  33, 7, 163, 144, 145, 153, 154, 155, 133, 246, 161, 160, 159, 158, 157, 173,
]

// 左右眉（FACE_LANDMARKS_LEFT_EYEBROW / RIGHT_EYEBROW，开放折线，闭合后形成细长区域）
export const LEFT_EYEBROW_INDICES = [276, 283, 282, 295, 285, 300, 293, 334, 296, 336]
export const RIGHT_EYEBROW_INDICES = [46, 53, 52, 65, 55, 70, 63, 105, 66, 107]

// 下颌/下半脸轮廓点（瘦脸作用区）：左下颌 152 起向右下颌
export const JAW_INDICES = [
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93,
  377, 400, 378, 379, 365, 397, 288, 361, 323, 454,
]

const MIN_LANDMARKS = 468

/**
 * @param {unknown} landmarks
 * @returns {landmarks is Landmark[]}
 */
const hasEnoughLandmarks = (landmarks) =>
  Array.isArray(landmarks) && landmarks.length >= MIN_LANDMARKS

/**
 * @param {Landmark[]} landmarks
 * @param {number[]} indices
 * @param {(p: Landmark) => Point} project
 * @returns {Point[]}
 */
const pickLoop = (landmarks, indices, project) => indices.map(i => project(landmarks[i]))

/**
 * 皮肤区域：脸轮廓外环减去眼/唇/眉孔洞，输出像素坐标多边形。
 * @param {Landmark[] | null | undefined} landmarks MediaPipe NormalizedLandmark[]
 * @param {number} width 图像像素宽
 * @param {number} height 图像像素高
 * @returns {SkinRegion | null} 关键点不足时返回 null
 */
export function buildSkinRegion(landmarks, width, height) {
  if (!hasEnoughLandmarks(landmarks)) return null
  /** @param {Landmark} p */
  const toPx = (p) => ({ x: p.x * width, y: p.y * height })
  return {
    outer: pickLoop(landmarks, FACE_OVAL_INDICES, toPx),
    holes: [
      pickLoop(landmarks, LEFT_EYE_INDICES, toPx),
      pickLoop(landmarks, RIGHT_EYE_INDICES, toPx),
      pickLoop(landmarks, LIPS_OUTER_INDICES, toPx),
      pickLoop(landmarks, LEFT_EYEBROW_INDICES, toPx),
      pickLoop(landmarks, RIGHT_EYEBROW_INDICES, toPx),
    ],
  }
}

// slim 有效上限：单点最多内收“其到中轴距离”的 30%（脸缘点约等于脸宽 15%），presets 的 100 档即对应此上限
const SLIM_MAX_FRACTION = 0.3
// slim 垂直衰减指数：眼线处权重 0 → 下巴处权重 1，平方渐变
const SLIM_FALLOFF_POWER = 2
// eye 有效上限：眼环点最多外扩眼半径的 35%，presets 的 100 档即对应此上限
const EYE_GROW_MAX = 0.35
// eye 影响半径倍数：眼环外位移线性衰减，到 眼半径×2 处为 0
const EYE_INFLUENCE_RADIUS = 2

/**
 * 形变目标点位：indices 覆盖全部输入关键点，displaced 与之一一对齐；
 * intensity 为 0 时所有点位移为零（归一化坐标）。
 *
 * 位移场是连续的，这是高强度（100 档）下不产生三角形拼缝的关键：
 * - slim：眼线以下所有点向脸部中轴内收，权重沿垂直方向平方渐变
 *   （眼线 0 → 下巴 1），下颌带全量、面颊递减、眼线以上不动；
 * - eye：以眼心为中心径向外扩，眼环内全量，环外随距离线性衰减至 2 倍眼半径处为 0。
 * 相邻关键点权重相近 ⇒ 相邻三角形拉伸率相近 ⇒ 共享边两侧采样率一致，无缝。
 *
 * @param {Landmark[] | null | undefined} landmarks
 * @param {{ slim?: number, eye?: number }} intensity 0-100
 * @returns {WarpMap | null}
 */
export function buildWarpMap(landmarks, { slim = 0, eye = 0 } = {}) {
  if (!hasEnoughLandmarks(landmarks)) return null
  const slimA = clampPercent(slim) / 100
  const eyeA = clampPercent(eye) / 100

  /** @type {Point[]} */
  const source = landmarks.map(p => ({ x: p.x, y: p.y }))
  /** @type {Point[]} */
  const displaced = landmarks.map(p => ({ x: p.x, y: p.y }))

  if (slimA > 0) {
    const xs = FACE_OVAL_INDICES.map(i => landmarks[i].x)
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2
    const yChin = landmarks[152].y
    const yEye = (
      centroid(LEFT_EYE_INDICES.map(i => landmarks[i])).y
      + centroid(RIGHT_EYE_INDICES.map(i => landmarks[i])).y
    ) / 2
    const band = Math.max(yChin - yEye, 1e-6)
    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i]
      const w = clamp01((p.y - yEye) / band) ** SLIM_FALLOFF_POWER
      if (w === 0) continue
      displaced[i] = { x: p.x + (centerX - p.x) * SLIM_MAX_FRACTION * slimA * w, y: p.y }
    }
  }

  if (eyeA > 0) {
    for (const ring of [LEFT_EYE_INDICES, RIGHT_EYE_INDICES]) {
      const center = centroid(ring.map(i => landmarks[i]))
      const radius = ring.reduce((s, i) => s + Math.hypot(
        landmarks[i].x - center.x, landmarks[i].y - center.y,
      ), 0) / ring.length
      const influence = radius * EYE_INFLUENCE_RADIUS
      for (let i = 0; i < landmarks.length; i++) {
        const base = displaced[i]
        const d = Math.hypot(base.x - center.x, base.y - center.y)
        if (d < 1e-9 || d >= influence) continue
        const w = d <= radius ? 1 : 1 - (d - radius) / (influence - radius)
        const k = EYE_GROW_MAX * eyeA * w
        displaced[i] = { x: base.x + (base.x - center.x) * k, y: base.y + (base.y - center.y) * k }
      }
    }
  }

  return { indices: landmarks.map((_, i) => i), source, displaced }
}

/**
 * @param {number} v
 */
const clamp01 = (v) => Math.min(1, Math.max(0, v))

/**
 * @param {number} value
 */
const clampPercent = (value) => Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))

/**
 * @param {Point[]} points
 * @returns {Point}
 */
const centroid = (points) => {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 })
  return { x: sum.x / points.length, y: sum.y / points.length }
}
