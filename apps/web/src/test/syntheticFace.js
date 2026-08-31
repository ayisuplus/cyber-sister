// 合成 478 点人脸关键点：椭圆脸轮廓 + 眼/唇/眉环 + 脸内小网格，供 beauty 模块测试驱动。
// 归一化坐标，与 MediaPipe NormalizedLandmark 形状一致（只用 x/y）。
import {
  FACE_OVAL_INDICES,
  LEFT_EYE_INDICES,
  LEFT_EYEBROW_INDICES,
  LIPS_OUTER_INDICES,
  RIGHT_EYE_INDICES,
  RIGHT_EYEBROW_INDICES,
} from '../features/beauty/faceGeometry'

const TOTAL_LANDMARKS = 478

const placeRing = (pts, indices, cx, cy, rx, ry) => {
  indices.forEach((idx, k) => {
    const t = (k / indices.length) * Math.PI * 2
    pts[idx] = { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) }
  })
}

export function makeSyntheticLandmarks() {
  // 默认：脸内部 23 列小网格，保证任意 tessellation 三角形可用且不退化
  const pts = Array.from({ length: TOTAL_LANDMARKS }, (_, i) => ({
    x: 0.5 + ((i % 23) - 11) * 0.012,
    y: 0.5 + (Math.floor(i / 23) - 10) * 0.016,
  }))

  // 脸轮廓椭圆：t=0 在额头正上方，顺时绕行，152 号落在下巴底
  FACE_OVAL_INDICES.forEach((idx, k) => {
    const t = (k / FACE_OVAL_INDICES.length) * Math.PI * 2
    pts[idx] = { x: 0.5 + 0.3 * Math.sin(t), y: 0.5 - 0.4 * Math.cos(t) }
  })

  placeRing(pts, LEFT_EYE_INDICES, 0.65, 0.42, 0.05, 0.03)
  placeRing(pts, RIGHT_EYE_INDICES, 0.35, 0.42, 0.05, 0.03)
  placeRing(pts, LIPS_OUTER_INDICES, 0.5, 0.68, 0.09, 0.035)
  placeRing(pts, LEFT_EYEBROW_INDICES, 0.65, 0.34, 0.06, 0.015)
  placeRing(pts, RIGHT_EYEBROW_INDICES, 0.35, 0.34, 0.06, 0.015)

  return pts
}
