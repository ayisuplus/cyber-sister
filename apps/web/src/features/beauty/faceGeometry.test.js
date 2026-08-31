import { describe, expect, it } from 'vitest'
import { makeSyntheticLandmarks } from '../../test/syntheticFace'
import {
  FACE_OVAL_INDICES,
  JAW_INDICES,
  LEFT_EYE_INDICES,
  LIPS_OUTER_INDICES,
  buildSkinRegion,
  buildWarpMap,
} from './faceGeometry'

const WIDTH = 200
const HEIGHT = 200

describe('buildSkinRegion', () => {
  it.each([undefined, null, [], Array.from({ length: 100 }, () => ({ x: 0.5, y: 0.5 }))])(
    '关键点缺失或不足时返回 null',
    (landmarks) => {
      expect(buildSkinRegion(landmarks, WIDTH, HEIGHT)).toBeNull()
    },
  )

  it('正常人脸返回外环多边形（像素坐标）与 5 个孔洞', () => {
    const landmarks = makeSyntheticLandmarks()
    const region = buildSkinRegion(landmarks, WIDTH, HEIGHT)

    expect(region.outer).toHaveLength(FACE_OVAL_INDICES.length)
    // 外环首点 = 10 号关键点（额头）映射到像素
    expect(region.outer[0]).toEqual({ x: landmarks[10].x * WIDTH, y: landmarks[10].y * HEIGHT })

    // 孔洞：左眼、右眼、嘴唇、左眉、右眉
    expect(region.holes).toHaveLength(5)
    const [leftEye, rightEye, lips] = region.holes
    expect(leftEye).toHaveLength(LEFT_EYE_INDICES.length)
    expect(lips).toHaveLength(LIPS_OUTER_INDICES.length)
    expect(leftEye[0]).toEqual({ x: landmarks[263].x * WIDTH, y: landmarks[263].y * HEIGHT })
    expect(rightEye[0]).toEqual({ x: landmarks[33].x * WIDTH, y: landmarks[33].y * HEIGHT })
    expect(lips[0]).toEqual({ x: landmarks[61].x * WIDTH, y: landmarks[61].y * HEIGHT })
  })

  it('眼/唇/眉区域以孔洞形式从皮肤区排除', () => {
    const landmarks = makeSyntheticLandmarks()
    const region = buildSkinRegion(landmarks, WIDTH, HEIGHT)
    // 孔洞多边形确实圈住了对应器官中心：唇心 (0.5, 0.68) 应落在 lips 孔洞包围盒内
    const lips = region.holes[2]
    const xs = lips.map(p => p.x)
    const ys = lips.map(p => p.y)
    expect(0.5 * WIDTH).toBeGreaterThan(Math.min(...xs))
    expect(0.5 * WIDTH).toBeLessThan(Math.max(...xs))
    expect(0.68 * HEIGHT).toBeGreaterThan(Math.min(...ys))
    expect(0.68 * HEIGHT).toBeLessThan(Math.max(...ys))
  })
})

describe('buildWarpMap', () => {
  it('关键点不足时返回 null', () => {
    expect(buildWarpMap([], { slim: 50, eye: 50 })).toBeNull()
  })

  it('强度全 0 时所有点位移为零', () => {
    const landmarks = makeSyntheticLandmarks()
    const warpMap = buildWarpMap(landmarks, { slim: 0, eye: 0 })

    expect(warpMap.indices).toHaveLength(landmarks.length)
    for (let i = 0; i < landmarks.length; i++) {
      expect(warpMap.displaced[i]).toEqual(warpMap.source[i])
    }
  })

  it('slim 使下颌点向脸部中轴线内收，非下颌点不动', () => {
    const landmarks = makeSyntheticLandmarks()
    const warpMap = buildWarpMap(landmarks, { slim: 100, eye: 0 })

    // 左下颌（x < 0.5）向右收，右下颌（x > 0.5）向左收
    const leftJaw = 148
    const rightJaw = 377
    expect(JAW_INDICES).toContain(leftJaw)
    expect(JAW_INDICES).toContain(rightJaw)
    expect(landmarks[leftJaw].x).toBeLessThan(0.5)
    expect(landmarks[rightJaw].x).toBeGreaterThan(0.5)
    expect(warpMap.displaced[leftJaw].x).toBeGreaterThan(landmarks[leftJaw].x)
    expect(warpMap.displaced[rightJaw].x).toBeLessThan(landmarks[rightJaw].x)
    // 下巴尖在中轴线上，不动
    expect(warpMap.displaced[152].x).toBeCloseTo(landmarks[152].x, 6)
    // 非下颌点（如鼻尖 1 号）不动
    expect(warpMap.displaced[1]).toEqual(warpMap.source[1])
  })

  it('slim 内收量不超过脸宽的 15%', () => {
    const landmarks = makeSyntheticLandmarks()
    const warpMap = buildWarpMap(landmarks, { slim: 100, eye: 0 })
    const faceWidth = 0.6 // 合成脸轮廓 x ∈ [0.2, 0.8]
    for (const i of JAW_INDICES) {
      expect(Math.abs(warpMap.displaced[i].x - landmarks[i].x)).toBeLessThanOrEqual(faceWidth * 0.15 + 1e-9)
    }
  })

  it('slim 位移场垂直连续渐变：眼线以下权重单调增至下巴（无跳变）', () => {
    const landmarks = makeSyntheticLandmarks()
    const warpMap = buildWarpMap(landmarks, { slim: 100, eye: 0 })

    // 同一列（x=0.392，中轴左侧）四个递增 y 的网格点，穿过面颊带；
    // 索引 140/186/278/370 均不在任何器官环上（未被合成脸覆盖写）
    const rows = [6, 8, 12, 16]
    const shifts = rows.map((r) => {
      const i = r * 23 + 2
      return warpMap.displaced[i].x - landmarks[i].x
    })
    // 左侧点向右收（正位移），且随 y 增大严格递增 → 相邻三角形拉伸率平滑过渡
    for (const shift of shifts) expect(shift).toBeGreaterThan(0)
    for (let k = 1; k < shifts.length; k++) expect(shifts[k]).toBeGreaterThan(shifts[k - 1])
  })

  it('slim 不影响眼线以上的点（额头、眉不动）', () => {
    const warpMap = buildWarpMap(makeSyntheticLandmarks(), { slim: 100, eye: 0 })
    expect(warpMap.displaced[10]).toEqual(warpMap.source[10]) // 额头
    expect(warpMap.displaced[46]).toEqual(warpMap.source[46]) // 眉
  })

  it('eye 位移场径向衰减：眼环外附近点部分外扩，远处点不动', () => {
    const landmarks = makeSyntheticLandmarks()
    landmarks[2] = { x: 0.6, y: 0.46 } // 左眼环外侧、影响半径内
    landmarks[3] = { x: 0.9, y: 0.9 } // 远离双眼
    const warpMap = buildWarpMap(landmarks, { slim: 0, eye: 100 })

    const moved = warpMap.displaced[2]
    const d = Math.hypot(0.6 - 0.65, 0.46 - 0.42)
    const dist = Math.hypot(moved.x - 0.6, moved.y - 0.46)
    expect(dist).toBeGreaterThan(0)
    // 衰减权重：位移小于环上全量（35% 半径）
    expect(dist).toBeLessThan(d * 0.35)
    // 影响半径（2 倍眼半径）以外不动
    expect(warpMap.displaced[3]).toEqual(warpMap.source[3])
  })

  it('eye 使眼轮廓点沿离眼心方向外扩', () => {
    const landmarks = makeSyntheticLandmarks()
    const warpMap = buildWarpMap(landmarks, { slim: 0, eye: 100 })

    const ring = LEFT_EYE_INDICES
    const center = {
      x: ring.reduce((s, i) => s + landmarks[i].x, 0) / ring.length,
      y: ring.reduce((s, i) => s + landmarks[i].y, 0) / ring.length,
    }
    const i = ring[0]
    const before = Math.hypot(landmarks[i].x - center.x, landmarks[i].y - center.y)
    const after = Math.hypot(warpMap.displaced[i].x - center.x, warpMap.displaced[i].y - center.y)
    expect(after).toBeGreaterThan(before)
    // 外扩比例有上限（35%）
    expect(after / before).toBeLessThanOrEqual(1.35 + 1e-9)
  })
})
