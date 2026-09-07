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


describe('applySkinFilters 像素级回归（缓冲复用/包围盒/可分离模糊的等价性快照）', () => {
  // 期望值由重构前实现生成：固定小合成图 + 固定皮肤区域，允许 ±1 舍入容差。
  const makePatternImage = (w, h) => {
    const image = new ImageData(w, h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4
        image.data[p] = (x * 13 + y * 7) % 256
        image.data[p + 1] = (x * 5 + y * 11 + 40) % 256
        image.data[p + 2] = (x * 3 + y * 17 + 80) % 256
        image.data[p + 3] = 255
      }
    }
    return image
  }

  const REGION_16 = {
    outer: [{ x: 2, y: 2 }, { x: 13, y: 2 }, { x: 13, y: 13 }, { x: 2, y: 13 }],
    holes: [[{ x: 6, y: 6 }, { x: 9, y: 6 }, { x: 9, y: 9 }, { x: 6, y: 9 }]],
  }
  const REGION_400 = {
    outer: [{ x: 80, y: 60 }, { x: 320, y: 60 }, { x: 320, y: 340 }, { x: 80, y: 340 }],
    holes: [[{ x: 150, y: 150 }, { x: 200, y: 150 }, { x: 200, y: 200 }, { x: 150, y: 200 }]],
  }

  const expectNear = (actual, expected, label) => {
    expect(actual.length, label).toBe(expected.length)
    for (let i = 0; i < expected.length; i += 1) {
      expect(Math.abs(actual[i] - expected[i]), `${label} 第 ${i} 字节`).toBeLessThanOrEqual(1)
    }
  }

  it('16x16 盒式模糊路径（可分离 3x3）：全图像素与重构前一致', () => {
    const out = applySkinFilters(makePatternImage(16, 16), REGION_16, { smooth: 70, whiten: 30 })
    expectNear([...out.data], CASE_A_PIXELS, '16x16')
  })

  it.each([
    ['纯磨皮', { smooth: 80, whiten: 0 }, CASE_B_SAMPLES],
    ['磨皮+美白', { smooth: 60, whiten: 40 }, CASE_C_SAMPLES],
  ])('400x400 降采样-升采样路径（%s）：采样像素与重构前一致', (label, settings, samples) => {
    const out = applySkinFilters(makePatternImage(400, 400), REGION_400, settings)
    for (const [x, y, r, g, b] of samples) {
      const p = (y * out.width + x) * 4
      expect(Math.abs(out.data[p] - r), `${label} (${x},${y}) R`).toBeLessThanOrEqual(1)
      expect(Math.abs(out.data[p + 1] - g), `${label} (${x},${y}) G`).toBeLessThanOrEqual(1)
      expect(Math.abs(out.data[p + 2] - b), `${label} (${x},${y}) B`).toBeLessThanOrEqual(1)
    }
  })

  it('同尺寸重复调用复用 scratch 缓冲；尺寸变化才重分配', () => {
    const names = ['Float32Array', 'Uint8Array', 'Uint8ClampedArray']
    const originals = new Map(names.map(n => [n, globalThis[n]]))
    const counts = Object.fromEntries(names.map(n => [n, 0]))
    for (const n of names) {
      globalThis[n] = new Proxy(originals.get(n), {
        construct(target, args) {
          counts[n] += 1
          return new target(...args)
        },
      })
    }
    const reset = () => { for (const n of names) counts[n] = 0 }
    try {
      applySkinFilters(makePatternImage(16, 16), REGION_16, { smooth: 50, whiten: 20 }) // 首次：建立缓冲
      reset()
      // 同尺寸第二次调用：工作缓冲全部复用，零分配。
      // 允许 1 个 Uint8ClampedArray：jsdom 的 ImageData(data,…) 构造内部会复制一份
      // （浏览器按规范共享传入缓冲、不复制），属测试环境伪影。
      applySkinFilters(makePatternImage(16, 16), REGION_16, { smooth: 80, whiten: 30 })
      expect(counts.Float32Array).toBe(0)
      expect(counts.Uint8Array).toBe(0)
      expect(counts.Uint8ClampedArray).toBeLessThanOrEqual(1)
      reset()
      // 尺寸变化：工作缓冲按需重建（对照组，证明上面的零分配是复用而非没干活）
      applySkinFilters(makePatternImage(20, 20), REGION_16, { smooth: 80, whiten: 30 })
      expect(counts.Float32Array).toBeGreaterThanOrEqual(1)
      expect(counts.Uint8Array).toBeGreaterThanOrEqual(1)
    } finally {
      for (const n of names) globalThis[n] = originals.get(n)
    }
  })
})

const CASE_A_PIXELS = [0,40,80,255,13,45,83,255,26,50,86,255,39,55,89,255,52,60,92,255,65,65,95,255,78,70,98,255,91,75,101,255,104,80,104,255,117,85,107,255,130,90,110,255,143,95,113,255,156,100,116,255,169,105,119,255,182,110,122,255,195,115,125,255,7,51,97,255,20,56,100,255,33,61,103,255,46,66,106,255,59,71,109,255,72,76,112,255,85,81,115,255,98,86,118,255,111,91,121,255,124,96,124,255,137,101,127,255,150,106,130,255,163,111,133,255,176,116,136,255,189,121,139,255,202,126,142,255,14,62,114,255,27,67,117,255,63,91,134,255,74,96,137,255,86,100,140,255,97,105,142,255,109,109,145,255,121,114,148,255,132,118,150,255,144,123,153,255,156,127,156,255,167,131,158,255,179,136,161,255,183,127,153,255,196,132,156,255,209,137,159,255,21,73,131,255,34,78,134,255,69,101,149,255,80,106,152,255,92,110,155,255,104,114,157,255,115,119,160,255,127,123,163,255,139,128,166,255,150,132,168,255,162,137,171,255,174,141,174,255,185,146,176,255,190,138,170,255,203,143,173,255,216,148,176,255,28,84,148,255,41,89,151,255,75,111,165,255,87,115,167,255,98,120,170,255,110,124,173,255,122,129,175,255,133,133,178,255,145,138,181,255,157,142,183,255,168,147,186,255,180,151,189,255,191,156,191,255,197,149,187,255,210,154,190,255,223,159,193,255,35,95,165,255,48,100,168,255,81,121,180,255,93,125,183,255,105,130,185,255,116,134,188,255,128,139,191,255,140,143,193,255,151,148,196,255,163,152,199,255,174,157,201,255,186,161,204,255,198,166,207,255,204,160,204,255,217,165,207,255,230,170,210,255,42,106,182,255,55,111,185,255,88,131,195,255,99,135,198,255,111,140,200,255,123,144,203,255,120,136,200,255,133,141,203,255,146,146,206,255,169,162,214,255,181,166,217,255,192,171,219,255,204,175,222,255,211,171,221,255,224,176,224,255,237,181,227,255,49,117,199,255,62,122,202,255,94,140,210,255,106,145,213,255,117,149,216,255,129,154,218,255,127,147,217,255,140,152,220,255,153,157,223,255,175,172,229,255,187,176,232,255,199,181,234,255,210,185,237,255,218,182,238,255,231,187,241,255,244,192,244,255,56,128,216,255,69,133,219,255,100,150,225,255,112,155,228,255,123,159,231,255,135,164,234,255,134,158,234,255,147,163,237,255,160,168,240,255,182,182,191,255,193,186,193,255,205,191,196,255,217,195,199,255,225,193,255,255,238,198,2,255,251,203,5,255,63,139,233,255,76,144,236,255,106,160,205,255,118,165,190,255,130,169,193,255,141,174,195,255,153,178,198,255,165,183,183,255,176,187,99,255,188,191,84,255,200,196,87,255,211,200,89,255,223,205,92,255,232,204,16,255,245,209,19,255,2,214,22,255,70,150,250,255,83,155,253,255,113,170,98,255,124,174,83,255,136,179,86,255,148,183,88,255,159,188,91,255,171,192,76,255,183,197,61,255,194,201,46,255,206,206,48,255,217,210,51,255,229,215,54,255,239,215,33,255,252,220,36,255,9,225,39,255,77,161,11,255,90,166,14,255,119,180,60,255,131,184,45,255,142,189,47,255,154,193,50,255,166,198,53,255,177,202,55,255,189,207,58,255,200,211,61,255,212,216,63,255,224,220,66,255,235,225,69,255,246,226,50,255,3,231,53,255,16,236,56,255,84,172,28,255,97,177,31,255,125,190,57,255,137,194,60,255,148,199,63,255,160,203,65,255,172,208,68,255,183,212,71,255,195,217,73,255,207,221,76,255,218,225,79,255,230,230,81,255,224,234,84,255,253,237,67,255,10,242,70,255,23,247,73,255,91,183,45,255,104,188,48,255,117,193,51,255,130,198,54,255,143,203,57,255,156,208,60,255,169,213,63,255,182,218,66,255,195,223,69,255,208,228,72,255,221,233,75,255,234,238,78,255,247,243,81,255,4,248,84,255,17,253,87,255,30,2,90,255,98,194,62,255,111,199,65,255,124,204,68,255,137,209,71,255,150,214,74,255,163,219,77,255,176,224,80,255,189,229,83,255,202,234,86,255,215,239,89,255,228,244,92,255,241,249,95,255,254,254,98,255,11,3,101,255,24,8,104,255,37,13,107,255,105,205,79,255,118,210,82,255,131,215,85,255,144,220,88,255,157,225,91,255,170,230,94,255,183,235,97,255,196,240,100,255,209,245,103,255,222,250,106,255,235,255,109,255,248,4,112,255,5,9,115,255,18,14,118,255,31,19,121,255,44,24,124,255]

const CASE_B_SAMPLES = [
    [0, 0, 0, 40, 80],
    [40, 0, 8, 240, 200],
    [80, 0, 16, 184, 64],
    [120, 0, 24, 128, 184],
    [160, 0, 32, 72, 48],
    [200, 0, 40, 16, 168],
    [240, 0, 48, 216, 32],
    [280, 0, 56, 160, 152],
    [320, 0, 64, 104, 16],
    [360, 0, 72, 48, 136],
    [0, 40, 24, 224, 248],
    [40, 40, 32, 168, 112],
    [80, 40, 40, 112, 232],
    [120, 40, 48, 56, 96],
    [160, 40, 56, 0, 216],
    [200, 40, 64, 200, 80],
    [240, 40, 72, 144, 200],
    [280, 40, 80, 88, 64],
    [320, 40, 88, 32, 184],
    [360, 40, 96, 232, 48],
    [0, 80, 48, 152, 160],
    [40, 80, 56, 96, 24],
    [80, 80, 64, 40, 144],
    [120, 80, 72, 211, 59],
    [160, 80, 80, 184, 128],
    [200, 80, 88, 128, 171],
    [240, 80, 96, 72, 112],
    [280, 80, 104, 45, 232],
    [320, 80, 112, 216, 96],
    [360, 80, 120, 160, 216],
    [0, 120, 72, 80, 72],
    [40, 120, 80, 24, 192],
    [80, 120, 88, 224, 56],
    [120, 120, 96, 168, 176],
    [160, 120, 104, 112, 40],
    [200, 120, 112, 56, 160],
    [240, 120, 120, 70, 50],
    [280, 120, 128, 200, 144],
    [320, 120, 136, 144, 8],
    [360, 120, 144, 88, 128],
    [0, 160, 96, 8, 240],
    [40, 160, 104, 208, 104],
    [80, 160, 112, 152, 224],
    [120, 160, 120, 96, 88],
    [160, 160, 128, 40, 208],
    [200, 160, 136, 211, 72],
    [240, 160, 144, 184, 192],
    [280, 160, 152, 128, 56],
    [320, 160, 160, 72, 176],
    [360, 160, 168, 16, 40],
    [0, 200, 120, 192, 152],
    [40, 200, 128, 136, 16],
    [80, 200, 136, 80, 136],
    [120, 200, 144, 30, 70],
    [160, 200, 152, 224, 120],
    [200, 200, 160, 168, 182],
    [240, 200, 168, 112, 104],
    [280, 200, 176, 56, 224],
    [320, 200, 184, 0, 88],
    [360, 200, 192, 200, 208],
    [0, 240, 144, 120, 64],
    [40, 240, 152, 64, 184],
    [80, 240, 160, 59, 48],
    [120, 240, 168, 208, 168],
    [160, 240, 176, 152, 48],
    [200, 240, 184, 96, 152],
    [240, 240, 192, 40, 58],
    [280, 240, 200, 211, 136],
    [320, 240, 208, 184, 0],
    [360, 240, 216, 128, 120],
    [0, 280, 168, 48, 232],
    [40, 280, 176, 248, 96],
    [80, 280, 184, 192, 216],
    [120, 280, 192, 136, 80],
    [160, 280, 200, 80, 200],
    [200, 280, 208, 30, 64],
    [240, 280, 216, 224, 184],
    [280, 280, 224, 168, 48],
    [320, 280, 232, 112, 168],
    [360, 280, 240, 56, 32],
    [0, 320, 192, 232, 144],
    [40, 320, 200, 176, 8],
    [80, 320, 208, 120, 128],
    [120, 320, 216, 64, 171],
    [160, 320, 224, 59, 112],
    [200, 320, 232, 208, 232],
    [240, 320, 211, 152, 96],
    [280, 320, 190, 96, 216],
    [320, 320, 0, 40, 80],
    [360, 320, 8, 240, 200],
    [0, 360, 216, 160, 56],
    [40, 360, 224, 104, 176],
    [80, 360, 232, 48, 40],
    [120, 360, 240, 248, 160],
    [160, 360, 248, 192, 24],
    [200, 360, 0, 136, 144],
    [240, 360, 8, 80, 8],
    [280, 360, 16, 24, 128],
    [320, 360, 24, 224, 248],
    [360, 360, 32, 168, 112],
]

const CASE_C_SAMPLES = [
    [0, 0, 0, 40, 80],
    [40, 0, 8, 240, 200],
    [80, 0, 16, 184, 64],
    [120, 0, 24, 128, 184],
    [160, 0, 32, 72, 48],
    [200, 0, 40, 16, 168],
    [240, 0, 48, 216, 32],
    [280, 0, 56, 160, 152],
    [320, 0, 64, 104, 16],
    [360, 0, 72, 48, 136],
    [0, 40, 24, 224, 248],
    [40, 40, 32, 168, 112],
    [80, 40, 40, 112, 232],
    [120, 40, 48, 56, 96],
    [160, 40, 56, 0, 216],
    [200, 40, 64, 200, 80],
    [240, 40, 72, 144, 200],
    [280, 40, 80, 88, 64],
    [320, 40, 88, 32, 184],
    [360, 40, 96, 232, 48],
    [0, 80, 48, 152, 160],
    [40, 80, 56, 96, 24],
    [80, 80, 91, 70, 160],
    [120, 80, 98, 224, 76],
    [160, 80, 104, 194, 146],
    [200, 80, 111, 146, 199],
    [240, 80, 118, 98, 132],
    [280, 80, 125, 68, 235],
    [320, 80, 112, 216, 96],
    [360, 80, 120, 160, 216],
    [0, 120, 72, 80, 72],
    [40, 120, 80, 24, 192],
    [80, 120, 111, 228, 84],
    [120, 120, 118, 180, 187],
    [160, 120, 125, 132, 70],
    [200, 120, 132, 84, 173],
    [240, 120, 139, 81, 73],
    [280, 120, 146, 208, 160],
    [320, 120, 136, 144, 8],
    [360, 120, 144, 88, 128],
    [0, 160, 96, 8, 240],
    [40, 160, 104, 208, 104],
    [80, 160, 132, 166, 228],
    [120, 160, 139, 118, 111],
    [160, 160, 128, 40, 208],
    [200, 160, 153, 224, 98],
    [240, 160, 160, 194, 201],
    [280, 160, 166, 146, 84],
    [320, 160, 160, 72, 176],
    [360, 160, 168, 16, 40],
    [0, 200, 120, 192, 152],
    [40, 200, 128, 136, 16],
    [80, 200, 153, 104, 153],
    [120, 200, 160, 60, 81],
    [160, 200, 166, 228, 139],
    [200, 200, 173, 180, 205],
    [240, 200, 180, 132, 125],
    [280, 200, 187, 84, 228],
    [320, 200, 184, 0, 88],
    [360, 200, 192, 200, 208],
    [0, 240, 144, 120, 64],
    [40, 240, 152, 64, 184],
    [80, 240, 173, 76, 77],
    [120, 240, 180, 215, 180],
    [160, 240, 187, 166, 74],
    [200, 240, 194, 118, 166],
    [240, 240, 201, 70, 76],
    [280, 240, 208, 224, 153],
    [320, 240, 208, 184, 0],
    [360, 240, 216, 128, 120],
    [0, 280, 168, 48, 232],
    [40, 280, 176, 248, 96],
    [80, 280, 194, 201, 221],
    [120, 280, 201, 153, 104],
    [160, 280, 208, 104, 208],
    [200, 280, 215, 60, 91],
    [240, 280, 221, 228, 194],
    [280, 280, 228, 180, 77],
    [320, 280, 232, 112, 168],
    [360, 280, 240, 56, 32],
    [0, 320, 192, 232, 144],
    [40, 320, 200, 176, 8],
    [80, 320, 215, 139, 146],
    [120, 320, 221, 91, 199],
    [160, 320, 228, 76, 132],
    [200, 320, 235, 215, 235],
    [240, 320, 224, 166, 118],
    [280, 320, 212, 118, 221],
    [320, 320, 0, 40, 80],
    [360, 320, 8, 240, 200],
    [0, 360, 216, 160, 56],
    [40, 360, 224, 104, 176],
    [80, 360, 232, 48, 40],
    [120, 360, 240, 248, 160],
    [160, 360, 248, 192, 24],
    [200, 360, 0, 136, 144],
    [240, 360, 8, 80, 8],
    [280, 360, 16, 24, 128],
    [320, 360, 24, 224, 248],
    [360, 360, 32, 168, 112],
]
