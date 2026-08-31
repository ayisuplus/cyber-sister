import { describe, expect, it } from 'vitest'
import { makeSyntheticLandmarks } from '../../test/syntheticFace'
import { buildSkinRegion, buildWarpMap } from './faceGeometry'
import { WHITEN_HEADROOM, applySkinFilters, computeWarpTriangles } from './beautyFilters'

const SIZE = 20

/** 20x20 棋盘格图（皮肤区有强边缘，磨皮后可观测变化） */
const makeCheckerImage = () => {
  const image = new ImageData(SIZE, SIZE)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const p = (y * SIZE + x) * 4
      const v = (x + y) % 2 === 0 ? 0 : 255
      image.data[p] = v
      image.data[p + 1] = v
      image.data[p + 2] = v
      image.data[p + 3] = 255
    }
  }
  return image
}

const pixelAt = (image, x, y) => {
  const p = (y * image.width + x) * 4
  return [image.data[p], image.data[p + 1], image.data[p + 2]]
}

describe('applySkinFilters', () => {
  const landmarks = makeSyntheticLandmarks()
  const region = buildSkinRegion(landmarks, SIZE, SIZE)

  it('强度全 0 时原样返回（引用相等）', () => {
    const image = makeCheckerImage()
    expect(applySkinFilters(image, region, { smooth: 0, whiten: 0 })).toBe(image)
  })

  it('无皮肤区域时原样返回', () => {
    const image = makeCheckerImage()
    expect(applySkinFilters(image, null, { smooth: 50, whiten: 50 })).toBe(image)
  })

  it('磨皮修改皮肤区像素，但不碰眼/唇像素', () => {
    const image = makeCheckerImage()
    const out = applySkinFilters(image, region, { smooth: 100, whiten: 0 })

    expect(out).not.toBe(image)
    // 皮肤区像素（额头 0.5,0.2 → 10,4）：棋盘格被柔化，黑白被拉向中间值
    const [r, g, b] = pixelAt(out, 10, 4)
    expect(r).toBeGreaterThan(0)
    expect(r).toBeLessThan(255)
    expect(g).toBe(r)
    expect(b).toBe(r)
    // 眼心像素 (0.65,0.42 → 13,8) 与唇心像素 (0.5,0.68 → 10,13) 保持原值
    expect(pixelAt(out, 13, 8)).toEqual(pixelAt(image, 13, 8))
    expect(pixelAt(out, 10, 13)).toEqual(pixelAt(image, 10, 13))
    // 输入图未被原地修改
    expect(pixelAt(image, 10, 4)).toEqual([0, 0, 0])
  })

  it('大图走降采样-升采样柔化路径，皮肤区边缘被软化', () => {
    // 600x400：min/256 ≥ 2，触发 soften 的降采样分支
    const w = 600
    const h = 400
    const image = new ImageData(w, h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4
        const v = x < w / 2 ? 0 : 255
        image.data[p] = v
        image.data[p + 1] = v
        image.data[p + 2] = v
        image.data[p + 3] = 255
      }
    }
    const bigRegion = buildSkinRegion(makeSyntheticLandmarks(), w, h)
    const out = applySkinFilters(image, bigRegion, { smooth: 100, whiten: 0 })
    // 明暗交界处的皮肤像素（额头中央 0.5,0.2 → x=300）被柔化成中间值
    const [r] = pixelAt(out, 300, 80)
    expect(r).toBeGreaterThan(0)
    expect(r).toBeLessThan(255)
  })

  it('美白提升皮肤区亮度，且提升量有上限', () => {
    const image = new ImageData(SIZE, SIZE)
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = 100
      image.data[i + 1] = 100
      image.data[i + 2] = 100
      image.data[i + 3] = 255
    }
    const out = applySkinFilters(image, region, { smooth: 0, whiten: 100 })

    const [r] = pixelAt(out, 10, 4)
    expect(r).toBeGreaterThan(100)
    // 上限：提升不超过 (255 - v) * WHITEN_HEADROOM
    expect(r).toBeLessThanOrEqual(Math.ceil(100 + (255 - 100) * WHITEN_HEADROOM))
    // 纯白皮肤不会被推过 255
    const white = new ImageData(SIZE, SIZE)
    white.data.fill(255)
    const outWhite = applySkinFilters(white, region, { smooth: 0, whiten: 100 })
    expect(pixelAt(outWhite, 10, 4)).toEqual([255, 255, 255])
  })
})

describe('computeWarpTriangles', () => {
  // 合成 tessellation：每连续 3 条边 = 一个闭合三角形（与 FaceLandmarker 静态表排布一致）
  const tessellation = [
    { start: 10, end: 152 }, { start: 152, end: 33 }, { start: 33, end: 10 },
    { start: 10, end: 263 }, { start: 263, end: 152 }, { start: 152, end: 10 },
    { start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 0 },
  ]

  it('输出三角形数量与 tessellation 一致（每 3 条边一个）', () => {
    const landmarks = makeSyntheticLandmarks()
    const warpMap = buildWarpMap(landmarks, { slim: 0, eye: 0 })
    const triangles = computeWarpTriangles(SIZE, SIZE, warpMap, tessellation)
    expect(triangles).toHaveLength(tessellation.length / 3)
  })

  it('dst 位移反映 warpMap，未形变点 src 与 dst 相同', () => {
    const landmarks = makeSyntheticLandmarks()
    const warpMap = buildWarpMap(landmarks, { slim: 100, eye: 0 })
    const triangles = computeWarpTriangles(SIZE, SIZE, warpMap, tessellation)

    // 第三个三角形全是网格点（0,1,2 不参与形变）：src === dst
    const grid = triangles[2]
    for (let k = 0; k < 3; k++) {
      expect(grid.dstTri[k]).toEqual(grid.srcTri[k])
    }
    // 第一、二个三角形含下颌点 152/148 一带：slim 下 src 与 dst 不同
    // 152 在中轴线上不动，但 33/263 不动、152 不动 → 用含 148 的三角形验证更直接
    const withJaw = computeWarpTriangles(SIZE, SIZE, warpMap, [
      { start: 10, end: 152 }, { start: 152, end: 148 }, { start: 148, end: 10 },
    ])
    const jawVertex = withJaw[0].srcTri.findIndex(
      (p, k) => p.x === landmarks[148].x * SIZE && withJaw[0].dstTri[k].x !== p.x,
    )
    expect(jawVertex).toBeGreaterThanOrEqual(0)
  })

  it('像素坐标按宽高缩放', () => {
    const landmarks = makeSyntheticLandmarks()
    const warpMap = buildWarpMap(landmarks, { slim: 0, eye: 0 })
    const [tri] = computeWarpTriangles(200, 100, warpMap, tessellation)
    // 10 号额头点 (0.5, 0.1) → (100, 10)
    expect(tri.srcTri[0].x).toBeCloseTo(100, 6)
    expect(tri.srcTri[0].y).toBeCloseTo(10, 6)
  })

  it.each([
    [null, tessellation],
    [buildWarpMap(makeSyntheticLandmarks(), {}), null],
    [buildWarpMap(makeSyntheticLandmarks(), {}), undefined],
  ])('入参缺失时返回空数组', (warpMap, tess) => {
    expect(computeWarpTriangles(SIZE, SIZE, warpMap, tess)).toEqual([])
  })

  it('共享边的两个三角形在公共顶点上 dst 完全一致（位移差为 0，无几何缝）', () => {
    const landmarks = makeSyntheticLandmarks()
    const warpMap = buildWarpMap(landmarks, { slim: 100, eye: 100 })
    // 两个三角形共享边 152-148（slim 高位移区）
    const tess = [
      { start: 10, end: 152 }, { start: 152, end: 148 }, { start: 148, end: 10 },
      { start: 152, end: 377 }, { start: 377, end: 148 }, { start: 148, end: 152 },
    ]
    const tris = computeWarpTriangles(SIZE, SIZE, warpMap, tess)
    expect(tris).toHaveLength(2)
    expect(tris[0].dstTri[1]).toEqual(tris[1].dstTri[0]) // 公共顶点 152
    expect(tris[0].dstTri[2]).toEqual(tris[1].dstTri[2]) // 公共顶点 148
    // 满强度下该边确实发生了位移（不变量是在"有形变"前提下验证的）
    expect(tris[0].dstTri[2]).not.toEqual(tris[0].srcTri[2])
  })

  it('tessellation 引用了 warpMap 之外的关键点时跳过该三角形', () => {
    const warpMap = {
      indices: [0, 1],
      source: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }],
      displaced: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }],
    }
    const tess = [{ start: 0, end: 1 }, { start: 1, end: 99 }, { start: 99, end: 0 }]
    expect(computeWarpTriangles(SIZE, SIZE, warpMap, tess)).toEqual([])
  })
})
