// face 模块测试 — landmarks.ts 关键点提取 / loader.ts 单例加载 / edgeCases.ts 剩余分支.
// landmarks + edgeCases 是纯逻辑, 用 mock 的 FaceLandmarker 驱动.
// loader 用 vi.mock 替换 @mediapipe/tasks-vision, 覆盖单例缓存 / 并发去重 /
// GPU→CPU 降级 / 错误复位 / dispose.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';

// ---------- loader 的 mediapipe mock (hoisted) ----------

const { createFromOptions, forVisionTasks } = vi.hoisted(() => ({
  createFromOptions: vi.fn(),
  forVisionTasks: vi.fn(),
}));

vi.mock('@mediapipe/tasks-vision', () => ({
  FaceLandmarker: { createFromOptions },
  FilesetResolver: { forVisionTasks },
}));

import {
  extractLandmarks,
  extractAllLandmarks,
  NoFaceError,
  FACE_LANDMARK_COUNT,
} from '../src/frontend/face/landmarks';
import { loadModel, disposeModel } from '../src/frontend/face/loader';
import {
  diagnoseSelfie,
  exifToTransform,
  readExifOrientation,
  applyExifToImageData,
} from '../src/frontend/face/edgeCases';
import type { DiagnosisInput, SelfieDiagnosis } from '../src/frontend/face/edgeCases';
import type { Landmark, PixelBuffer } from '../src/shared/faceFeatures';

// ======================================================================
// landmarks.ts — 关键点提取
// ======================================================================

const pt = (x: number, y: number, z = 0): NormalizedLandmark => ({ x, y, z, visibility: 1 });

function mockLandmarker(result: { faceLandmarks?: NormalizedLandmark[][] }): FaceLandmarker {
  return { detect: vi.fn().mockReturnValue(result) } as unknown as FaceLandmarker;
}

const IMG = {} as HTMLImageElement;

describe('landmarks — extractLandmarks', () => {
  it('未检测到人脸 (faceLandmarks 缺失) → 抛 NoFaceError', () => {
    const lm = mockLandmarker({});
    expect(() => extractLandmarks(lm, IMG)).toThrow(NoFaceError);
  });

  it('faceLandmarks 为空数组 → 抛 NoFaceError, name/message 正确', () => {
    const lm = mockLandmarker({ faceLandmarks: [] });
    try {
      extractLandmarks(lm, IMG);
      expect.unreachable('应当抛错');
    } catch (err) {
      expect(err).toBeInstanceOf(NoFaceError);
      expect((err as Error).name).toBe('NoFaceError');
      expect((err as Error).message).toBe('未检测到人脸');
    }
  });

  it('单张完整人脸 (478 点) → 按原样映射, xyz 保留', () => {
    const face = Array.from({ length: FACE_LANDMARK_COUNT }, (_, i) => pt(i / 1000, 0.5, 0.1));
    const lm = mockLandmarker({ faceLandmarks: [face] });
    const out = extractLandmarks(lm, IMG);
    expect(out).toHaveLength(478);
    expect(out[0]).toEqual({ x: 0, y: 0.5, z: 0.1 });
    expect(out[477]).toEqual({ x: 0.477, y: 0.5, z: 0.1 });
  });

  it('关键点不足 478 → 缺失位补 {0,0,0}', () => {
    const face = Array.from({ length: 100 }, (_, i) => pt(i / 100, 0.2));
    const lm = mockLandmarker({ faceLandmarks: [face] });
    const out = extractLandmarks(lm, IMG);
    expect(out).toHaveLength(478);
    expect(out[99]).toEqual({ x: 0.99, y: 0.2, z: 0 });
    expect(out[100]).toEqual({ x: 0, y: 0, z: 0 });
    expect(out[477]).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('多人脸 → 按归一化边界框面积取最大脸', () => {
    const big: NormalizedLandmark[] = Array.from({ length: 478 }, () => pt(0.2, 0.2));
    big[0] = pt(0.11, 0.12, 0.13); // 标记点
    big[1] = pt(0.8, 0.9); // bbox: 0.6 x 0.7
    const small: NormalizedLandmark[] = Array.from({ length: 478 }, () => pt(0.5, 0.5));
    small[0] = pt(0.91, 0.92, 0.93); // 标记点
    small[1] = pt(0.55, 0.6); // bbox: 0.05 x 0.1
    const lm = mockLandmarker({ faceLandmarks: [big, small] });
    const out = extractLandmarks(lm, IMG);
    expect(out[0]).toEqual({ x: 0.11, y: 0.12, z: 0.13 });
  });

  it('多人脸面积相同 → 保留第一张 (严格大于才替换)', () => {
    const mk = (offset: number, mark: NormalizedLandmark): NormalizedLandmark[] => {
      const f: NormalizedLandmark[] = Array.from({ length: 478 }, () => pt(offset, 0.1));
      f[0] = mark;
      f[1] = pt(offset + 0.2, 0.5); // 两张脸 bbox 面积都是 0.2 x 0.4
      return f;
    };
    const a = mk(0.1, pt(0.01, 0.02));
    const b = mk(0.6, pt(0.61, 0.62));
    const lm = mockLandmarker({ faceLandmarks: [a, b] });
    const out = extractLandmarks(lm, IMG);
    expect(out[0]).toEqual({ x: 0.01, y: 0.02, z: 0 });
  });

  it('faceLandmarks 含空/缺位条目 → 按 0 关键点处理并补齐 478', () => {
    const lm = mockLandmarker({ faceLandmarks: [undefined as unknown as NormalizedLandmark[]] });
    const out = extractLandmarks(lm, IMG);
    expect(out).toHaveLength(478);
    expect(out.every((p) => p.x === 0 && p.y === 0 && p.z === 0)).toBe(true);
  });
});

describe('landmarks — extractAllLandmarks', () => {
  it('无检测结果 → 空数组', () => {
    const lm = mockLandmarker({});
    expect(extractAllLandmarks(lm, IMG)).toEqual([]);
  });

  it('多张脸: 完整的原样返回, 不足的补齐 478', () => {
    const full = Array.from({ length: FACE_LANDMARK_COUNT }, () => pt(0.3, 0.3));
    const partial = Array.from({ length: 10 }, () => pt(0.7, 0.7));
    const lm = mockLandmarker({ faceLandmarks: [full, partial] });
    const out = extractAllLandmarks(lm, IMG);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(478);
    expect(out[0]![0]).toEqual({ x: 0.3, y: 0.3, z: 0 });
    expect(out[1]).toHaveLength(478);
    expect(out[1]![0]).toEqual({ x: 0.7, y: 0.7, z: 0 });
    expect(out[1]![10]).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('超过 478 点的脸不截断 (原样透传)', () => {
    const big = Array.from({ length: 480 }, (_, i) => pt(i / 1000, 0.1));
    const lm = mockLandmarker({ faceLandmarks: [big] });
    expect(extractAllLandmarks(lm, IMG)[0]).toHaveLength(480);
  });
});

// ======================================================================
// loader.ts — FaceLandmarker 单例加载
// ======================================================================

describe('loader — loadModel', () => {
  beforeEach(() => {
    disposeModel();
    createFromOptions.mockReset();
    forVisionTasks.mockReset();
    forVisionTasks.mockResolvedValue({ vision: true });
  });

  afterEach(() => {
    disposeModel();
  });

  it('成功加载: 进度 0.05 → 0.5 → 1, GPU delegate, 本地模型路径', async () => {
    const fake = { close: vi.fn() };
    createFromOptions.mockResolvedValue(fake);
    const progress: number[] = [];
    const result = await loadModel((p) => progress.push(p));

    expect(result).toBe(fake);
    expect(progress).toEqual([0.05, 0.5, 1]);
    expect(forVisionTasks).toHaveBeenCalledWith(expect.stringContaining('mp-models/wasm'));
    expect(createFromOptions).toHaveBeenCalledTimes(1);
    expect(createFromOptions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        baseOptions: expect.objectContaining({
          delegate: 'GPU',
          modelAssetPath: expect.stringContaining('mp-models/face_landmarker.task'),
        }),
        runningMode: 'IMAGE',
        numFaces: 3,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      }),
    );
  });

  it('已加载 → 直接复用单例, 只报进度 1, 不重复创建', async () => {
    const fake = { close: vi.fn() };
    createFromOptions.mockResolvedValue(fake);
    await loadModel(() => {});

    const progress: number[] = [];
    const again = await loadModel((p) => progress.push(p));
    expect(again).toBe(fake);
    expect(progress).toEqual([1]);
    expect(createFromOptions).toHaveBeenCalledTimes(1);
  });

  it('并发调用去重: 两个调用共享同一次加载', async () => {
    const fake = { close: vi.fn() };
    let resolveCreate: (v: unknown) => void = () => {};
    createFromOptions.mockImplementation(() => {
      const { promise, resolve } = Promise.withResolvers<unknown>();
      resolveCreate = resolve;
      return promise;
    });
    const p1 = loadModel(() => {});
    const p2 = loadModel(() => {});
    // 推进微任务, 让第一个调用进入 createFromOptions
    await Promise.resolve();
    await Promise.resolve();
    resolveCreate(fake);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(fake);
    expect(r2).toBe(fake);
    expect(createFromOptions).toHaveBeenCalledTimes(1);
  });

  it.each(['GPU backend init failed', 'WebGL context lost'])(
    'GPU/WebGL 错误 (%s) → 降级 CPU 重试一次',
    async (message) => {
      const fake = { close: vi.fn() };
      createFromOptions.mockRejectedValueOnce(new Error(message)).mockResolvedValueOnce(fake);
      const progress: number[] = [];
      const result = await loadModel((p) => progress.push(p));

      expect(result).toBe(fake);
      expect(progress).toEqual([0.05, 0.5, 0.05, 0.5, 1]);
      expect(createFromOptions).toHaveBeenCalledTimes(2);
      // 第二次用 CPU delegate
      expect(createFromOptions).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          baseOptions: expect.objectContaining({ delegate: 'CPU' }),
        }),
      );
      // 降级成功后单例缓存生效
      const again = await loadModel(() => {});
      expect(again).toBe(fake);
      expect(createFromOptions).toHaveBeenCalledTimes(2);
    },
  );

  it('非 GPU 错误 (如网络失败) → 直接抛出, 不降级, 且复位后可重试', async () => {
    const fake = { close: vi.fn() };
    createFromOptions.mockRejectedValueOnce(new Error('network boom')).mockResolvedValueOnce(fake);

    await expect(loadModel(() => {})).rejects.toThrow('network boom');
    expect(createFromOptions).toHaveBeenCalledTimes(1); // 没有 CPU 重试

    // loadPromise 已复位 → 再次调用从头加载
    const result = await loadModel(() => {});
    expect(result).toBe(fake);
    expect(createFromOptions).toHaveBeenCalledTimes(2);
  });

  it('抛出非 Error 对象 → 不识别为 GPU 错误, 原样抛出', async () => {
    createFromOptions.mockRejectedValueOnce('gpu-ish string');
    await expect(loadModel(() => {})).rejects.toBe('gpu-ish string');
    expect(createFromOptions).toHaveBeenCalledTimes(1);
  });

  it('GPU 失败后 CPU 也失败 → 抛出 CPU 错误, 且之后仍可重试 (loadPromise 在降级前已复位)', async () => {
    const fake = { close: vi.fn() };
    createFromOptions
      .mockRejectedValueOnce(new Error('GPU fail'))
      .mockRejectedValueOnce(new Error('cpu fail too'))
      .mockResolvedValueOnce(fake);

    await expect(loadModel(() => {})).rejects.toThrow('cpu fail too');
    expect(createFromOptions).toHaveBeenCalledTimes(2);

    const result = await loadModel(() => {});
    expect(result).toBe(fake);
    expect(createFromOptions).toHaveBeenCalledTimes(3);
  });

  it('disposeModel: 释放单例 (调 close), 之后重新加载', async () => {
    const fake = { close: vi.fn() };
    createFromOptions.mockResolvedValue(fake);
    await loadModel(() => {});

    disposeModel();
    expect(fake.close).toHaveBeenCalledTimes(1);

    await loadModel(() => {});
    expect(createFromOptions).toHaveBeenCalledTimes(2);
  });

  it('disposeModel: 未加载时不抛错', () => {
    expect(() => disposeModel()).not.toThrow();
  });
});

// ======================================================================
// edgeCases.ts — 现有测试未覆盖的分支
// ======================================================================

const lm2 = (x: number, y: number): Landmark => ({ x, y, z: 0 });

/** 标准正面脸: bbox 0.3..0.7 × 0.1..0.9, 无偏转. */
function frontalFace(): Landmark[] {
  const f: Landmark[] = Array.from({ length: 478 }, () => lm2(0, 0));
  f[10] = lm2(0.5, 0.1);
  f[151] = lm2(0.5, 0.18);
  f[168] = lm2(0.5, 0.25);
  f[6] = lm2(0.5, 0.32);
  f[1] = lm2(0.5, 0.55);
  f[152] = lm2(0.5, 0.9);
  f[117] = lm2(0.3, 0.5);
  f[187] = lm2(0.32, 0.55);
  f[205] = lm2(0.35, 0.52);
  f[346] = lm2(0.7, 0.5);
  return f;
}

function fillPixels(w: number, h: number, rgb: [number, number, number]): PixelBuffer {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

function fillRect(
  p: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
): void {
  for (let y = Math.max(0, y0); y < Math.min(p.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(p.width, x1); x++) {
      const i = (y * p.width + x) * 4;
      p.data[i] = rgb[0];
      p.data[i + 1] = rgb[1];
      p.data[i + 2] = rgb[2];
    }
  }
}

function diagnose(overrides: Partial<DiagnosisInput>): SelfieDiagnosis {
  return diagnoseSelfie({ faces: [frontalFace()], baseConfidence: 1, ...overrides });
}

describe('diagnoseSelfie — 人脸列表退化分支', () => {
  it('faces=[[]] → 选不出有效脸, blocked', () => {
    const r = diagnose({ faces: [[]] });
    expect(r.blocked).toBe(true);
    expect(r.blockedReason).toContain('正面照');
    expect(r.skippedFeatures).toContain('all');
  });

  it('faces=[undefined] → pickLargestFace 空表兜底, blocked', () => {
    const r = diagnose({ faces: [undefined as unknown as Landmark[]] });
    expect(r.blocked).toBe(true);
    expect(r.skippedFeatures).toContain('all');
  });

  it('多人脸中含空脸 → 空脸面积 0, 仍选出正常脸继续分析', () => {
    const r = diagnose({ faces: [[], frontalFace()] });
    expect(r.blocked).toBe(false);
    expect(r.warnings.some((w) => w.includes('最大的人脸'))).toBe(true);
  });

  it('多人脸中含 undefined 条目 → faceAreaRatio 的 !face 兜底, 不崩溃', () => {
    const r = diagnose({ faces: [frontalFace(), undefined as unknown as Landmark[]] });
    expect(r.blocked).toBe(false);
    expect(r.canProceed).toBe(true);
  });

  it('全零稀疏脸 (不足 478 点) → 无有效 bbox, 提示脸太小', () => {
    const sparseFace: Landmark[] = Array.from({ length: 10 }, () => lm2(0, 0));
    const r = diagnose({ faces: [sparseFace] });
    // estimateYawPitch 的 safe() 兜底 + faceW=0 → 不误判侧脸
    expect(r.blocked).toBe(false);
    expect(r.warnings.some((w) => w.includes('有点小'))).toBe(true);
  });
});

describe('diagnoseSelfie — 置信度 clamp 与侧脸中间档', () => {
  it('baseConfidence NaN → 按 0 处理', () => {
    expect(diagnose({ baseConfidence: NaN }).adjustedConfidence).toBe(0);
  });

  it('baseConfidence < 0 → 按 0 处理', () => {
    expect(diagnose({ baseConfidence: -0.5 }).adjustedConfidence).toBe(0);
  });

  it('baseConfidence > 1 → 截断到 1', () => {
    expect(diagnose({ baseConfidence: 1.5 }).adjustedConfidence).toBe(1);
  });

  it('轻微偏头 (21°~30°) → 不 block, 警告 + 置信度 ×0.7', () => {
    const f = frontalFace();
    f[1] = lm2(0.6, 0.55); // 偏移 0.1/0.4 = 0.25 → 25°
    const r = diagnose({ faces: [f] });
    expect(r.blocked).toBe(false);
    expect(r.warnings.some((w) => w.includes('稍微有点偏'))).toBe(true);
    expect(r.adjustedConfidence).toBeCloseTo(0.7, 6);
  });

  it('严重偏头 (>30°) → blocked (与中间档区分)', () => {
    const f = frontalFace();
    f[1] = lm2(0.65, 0.55); // 0.15/0.4 = 0.375 → 37.5°
    const r = diagnose({ faces: [f] });
    expect(r.blocked).toBe(true);
    expect(r.blockedReason).toContain('正视镜头');
  });

  it('脸 bbox 占比 < 0.5% → 警告 + 置信度 ×0.8', () => {
    const tiny: Landmark[] = Array.from({ length: 478 }, () => lm2(0, 0));
    tiny[117] = lm2(0.4, 0.4);
    tiny[346] = lm2(0.45, 0.4);
    tiny[1] = lm2(0.425, 0.42);
    tiny[152] = lm2(0.425, 0.44);
    const r = diagnose({ faces: [tiny] });
    expect(r.warnings.some((w) => w.includes('有点小'))).toBe(true);
    expect(r.adjustedConfidence).toBeCloseTo(0.8, 6);
  });
});

describe('diagnoseSelfie — 模糊中间档', () => {
  it('轻度模糊 (40 ≤ Laplacian 方差 < 80) → 警告但不 block', () => {
    // 50x50 灰底 + 一个亮点, 方差 ≈ 60.5
    const pixels = fillPixels(50, 50, [100, 100, 100]);
    const i = (25 * 50 + 25) * 4;
    pixels.data[i] = 180;
    pixels.data[i + 1] = 180;
    pixels.data[i + 2] = 180;
    const r = diagnose({ pixels });
    expect(r.warnings.some((w) => w.includes('有点糊'))).toBe(true);
    expect(r.blocked).toBe(false);
  });

  it('4x4 小图 → 灰度采样不足, 按模糊 0 处理 (blocked)', () => {
    const r = diagnose({ pixels: fillPixels(4, 4, [120, 110, 100]) });
    expect(r.blocked).toBe(true);
    expect(r.blockedReason).toContain('模糊');
  });

  it('7x4 扁图 → 采样行不足以算 Laplacian, 按模糊 0 处理', () => {
    const r = diagnose({ pixels: fillPixels(7, 4, [120, 110, 100]) });
    expect(r.blocked).toBe(true);
  });
});

describe('diagnoseSelfie — 像素缓冲退化分支', () => {
  it('0x0 像素 → 各 ROI 检查安全跳过, 最终按模糊 block', () => {
    const pixels: PixelBuffer = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
    const r = diagnose({ pixels });
    expect(r.blocked).toBe(true);
    expect(r.blockedReason).toContain('模糊');
  });

  it('data 长度不足宽高声明 → 越界采样按 0 处理 (黑图语义)', () => {
    const pixels: PixelBuffer = { data: new Uint8ClampedArray(16), width: 100, height: 100 };
    const r = diagnose({ pixels });
    // 全 0 像素: 亮度 0 → 非肤色 → 眼镜 + 刘海命中; 饱和度按 0 → 不报浓妆
    expect(r.warnings.some((w) => w.includes('眼镜'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('刘海'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('妆容'))).toBe(false);
    expect(r.blocked).toBe(true); // 模糊
  });

  it('奇数尺寸 ROI → median 走奇数路径', () => {
    // 19x19: 脸颊 ROI 19x19 = 361 个采样 (奇数)
    const r = diagnose({ pixels: fillPixels(19, 19, [220, 195, 170]) });
    // 不崩溃, 亮色 uniform → 模糊 block
    expect(r.blocked).toBe(true);
    expect(r.blockedReason).toContain('模糊');
  });
});

describe('diagnoseSelfie — 关键点回退链 (短数组: 高索引越界缺失)', () => {
  // 回退链 (face[117] ?? face[187] ?? ...) 的安全触发方式是"数组长度不足",
  // 此时高位索引自然越界为 undefined, 且不产生 for..of 会崩溃的空洞.
  const DARK: [number, number, number] = [15, 10, 8];
  const SKIN: [number, number, number] = [220, 195, 170];

  it('脸颊亮度: 缺 117/187 时回退到鼻尖 1', () => {
    const f: Landmark[] = Array.from({ length: 117 }, () => lm2(0, 0));
    f[1] = lm2(0.2, 0.2); // → 像素 (12, 12) @60x60
    f[6] = lm2(0.5, 0.32);
    f[10] = lm2(0.5, 0.1);
    const pixels = fillPixels(60, 60, SKIN);
    fillRect(pixels, 0, 0, 32, 32, DARK); // 覆盖鼻尖 ROI (0..32 × 0..32)
    const r = diagnose({ faces: [f], pixels });
    expect(r.warnings.some((w) => w.includes('光线'))).toBe(true);
  });

  it('脸颊亮度: 117/187/1 都缺 → 回退默认中心 (0.5,0.5)', () => {
    const f: Landmark[] = [lm2(0, 0)];
    const pixels = fillPixels(60, 60, SKIN);
    fillRect(pixels, 10, 10, 50, 50, DARK); // 覆盖默认中心 ROI
    const r = diagnose({ faces: [f], pixels });
    expect(r.warnings.some((w) => w.includes('光线'))).toBe(true);
  });

  it('眼镜检测: 6/168 都缺 → 跳过检查, 不误报', () => {
    const f: Landmark[] = Array.from({ length: 6 }, () => lm2(0, 0));
    const pixels = fillPixels(200, 200, SKIN);
    fillRect(pixels, 85, 49, 115, 79, [20, 20, 20]); // 深色镜框也没用
    const r = diagnose({ faces: [f], pixels });
    expect(r.warnings.some((w) => w.includes('眼镜'))).toBe(false);
  });

  it('刘海检测: 10/151 都缺 → 跳过检查, 不误报', () => {
    const f: Landmark[] = Array.from({ length: 10 }, () => lm2(0, 0));
    const pixels = fillPixels(200, 200, SKIN);
    fillRect(pixels, 80, 16, 120, 56, [20, 20, 20]); // 深色刘海也没用
    const r = diagnose({ faces: [f], pixels });
    expect(r.warnings.some((w) => w.includes('刘海'))).toBe(false);
  });

  it('浓妆检测: 缺 117/205 → 回退默认中心 (0.5,0.5)', () => {
    const f: Landmark[] = Array.from({ length: 117 }, () => lm2(0, 0));
    f[1] = lm2(0.5, 0.55);
    f[6] = lm2(0.5, 0.32);
    f[10] = lm2(0.5, 0.1);
    const pixels = fillPixels(60, 60, [120, 120, 120]); // 低饱和灰底
    fillRect(pixels, 10, 10, 50, 50, [220, 60, 90]); // 高饱和覆盖默认中心 ROI
    const r = diagnose({ faces: [f], pixels });
    expect(r.warnings.some((w) => w.includes('妆容'))).toBe(true);
  });
});

describe('diagnoseSelfie — 中间空洞数组 (回退链: 缺 117 用 187 等)', () => {
  // 回退链的另一半 (缺 117 用 187 / 缺 6 用 168 / 缺 10 用 151 / 缺 117 用 205)
  // 只能靠"数组中间有空洞"触发. faceAreaRatio 已修复为空洞视作无效点,
  // 这里断言回退后按回退点的 ROI 正常诊断 (不再崩溃).
  const SKIN: [number, number, number] = [220, 195, 170];
  const DARK: [number, number, number] = [15, 10, 8];

  it('脸颊亮度回退到 187 → 按 187 处 ROI 诊断出暗光', () => {
    const f = frontalFace();
    f[117] = undefined as unknown as Landmark;
    f[187] = lm2(0.7, 0.5); // → 像素 (42,30) @60x60, ROI 半边长 20
    const pixels = fillPixels(60, 60, SKIN);
    fillRect(pixels, 22, 10, 59, 50, DARK); // 覆盖 187 处脸颊 ROI
    const r = diagnose({ faces: [f], pixels });
    expect(r.warnings.some((w) => w.includes('光线'))).toBe(true);
  });

  it('眼镜检测回退到 168 → 按 168 处鼻梁 ROI 检出眼镜', () => {
    const f = frontalFace();
    f[6] = undefined as unknown as Landmark;
    f[168] = lm2(0.5, 0.32); // → 像素 (100,64) @200x200
    const pixels = fillPixels(200, 200, SKIN);
    fillRect(pixels, 80, 44, 120, 84, [20, 20, 20]); // 深色镜框覆盖 168 处 ROI
    const r = diagnose({ faces: [f], pixels });
    expect(r.warnings.some((w) => w.includes('眼镜'))).toBe(true);
  });

  it('刘海检测回退到 151 → 按 151 处前额 ROI 检出刘海', () => {
    const f = frontalFace();
    f[10] = undefined as unknown as Landmark;
    f[151] = lm2(0.5, 0.18); // → 像素 (100,36) @200x200
    const pixels = fillPixels(200, 200, SKIN);
    fillRect(pixels, 80, 16, 120, 56, [20, 20, 20]); // 深色刘海覆盖 151 处 ROI
    const r = diagnose({ faces: [f], pixels });
    expect(r.warnings.some((w) => w.includes('刘海'))).toBe(true);
  });

  it('浓妆检测回退到 205 → 按 205 处脸颊 ROI 检出浓妆', () => {
    const f = frontalFace();
    f[117] = undefined as unknown as Landmark;
    f[205] = lm2(0.35, 0.5); // → 像素 (21,30) @60x60
    const pixels = fillPixels(60, 60, [120, 120, 120]); // 低饱和灰底
    fillRect(pixels, 0, 8, 44, 52, [220, 60, 90]); // 高饱和覆盖 205 处 ROI
    const r = diagnose({ faces: [f], pixels });
    expect(r.warnings.some((w) => w.includes('妆容'))).toBe(true);
  });
});

describe('exifToTransform — 补齐 orientation 4/5/7', () => {
  it('4 → 180° + 水平翻转', () => {
    expect(exifToTransform(4)).toEqual({ rotation: 180, flipX: true });
  });

  it('5 → 90° + 水平翻转', () => {
    expect(exifToTransform(5)).toEqual({ rotation: 90, flipX: true });
  });

  it('7 → 270° + 水平翻转', () => {
    expect(exifToTransform(7)).toEqual({ rotation: 270, flipX: true });
  });
});

// ---------- readExifOrientation 的 JPEG 构造工具 ----------

/**
 * 构造带 EXIF APP1 段的 JPEG 字节 (真实 TIFF 布局:
 * BOM 'II'/'MM' + 按声明字节序的魔数 42 + 4 字节 IFD 偏移, IFD0 固定在 tiff+8).
 */
function jpegWithExif(opts: { orientation?: number; little?: boolean; tag?: number }): Uint8Array {
  const little = opts.little ?? true;
  const tag = opts.tag ?? 0x0112;
  const val = opts.orientation ?? 6;
  const tiff: number[] = [];
  // 字节序标记: little-endian 'II', big-endian 'MM'
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]));
  // 魔数 42, 按声明的字节序
  tiff.push(...(little ? [0x2a, 0x00] : [0x00, 0x2a]));
  tiff.push(0, 0, 0, 0); // IFD0 偏移字段 (解析端固定按 tiff+8 读)
  if (little) tiff.push(0x01, 0x00);
  else tiff.push(0x00, 0x01); // numEntries = 1
  if (little) tiff.push(tag & 0xff, tag >> 8);
  else tiff.push(tag >> 8, tag & 0xff);
  tiff.push(0, 0, 0, 0, 0, 0); // entry 中间 6 字节
  if (little) tiff.push(val & 0xff, val >> 8);
  else tiff.push(val >> 8, val & 0xff);
  tiff.push(0, 0); // entry 尾部
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0"
  const size = payload.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, size >> 8, size & 0xff, ...payload]);
}

function jpegFile(bytes: Uint8Array, name = 'photo.jpg'): File {
  return new File([bytes.buffer as ArrayBuffer], name, { type: 'image/jpeg' });
}

describe('readExifOrientation — EXIF 解析分支', () => {
  it('合法 EXIF (little-endian 「II」头) → 读出 orientation 6', async () => {
    expect(await readExifOrientation(jpegFile(jpegWithExif({ orientation: 6 })))).toBe(6);
  });

  it('合法 EXIF (big-endian 「MM」头) → 读出 orientation 3', async () => {
    expect(
      await readExifOrientation(jpegFile(jpegWithExif({ orientation: 3, little: false }))),
    ).toBe(3);
  });

  it('orientation 值越界 (9) → 兜底返回 1', async () => {
    expect(await readExifOrientation(jpegFile(jpegWithExif({ orientation: 9 })))).toBe(1);
  });

  it('IFD 里没有 Orientation tag → 返回 1', async () => {
    expect(await readExifOrientation(jpegFile(jpegWithExif({ tag: 0x010f })))).toBe(1);
  });

  it('APP1 段但不是 Exif 头 → 返回 1', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
    expect(await readExifOrientation(jpegFile(bytes))).toBe(1);
  });

  it('Exif 头但缺少 \\0\\0 后缀 → 返回 1', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x01]);
    expect(await readExifOrientation(jpegFile(bytes))).toBe(1);
  });

  it('非 APP1 段 (APP0) → 按 size 跳过继续扫描, 扫不到 EXIF 返回 1', async () => {
    const bytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x08, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x00, 0x00,
    ]);
    expect(await readExifOrientation(jpegFile(bytes))).toBe(1);
  });

  it('文件不足 4 字节 → 返回 1', async () => {
    expect(await readExifOrientation(jpegFile(new Uint8Array([0xff, 0xd8])))).toBe(1);
  });

  it('非 JPEG SOI 魔数 → 返回 1', async () => {
    expect(await readExifOrientation(jpegFile(new Uint8Array([0x00, 0x11, 0x22, 0x33])))).toBe(1);
  });

  it('MIME 是 jpeg 但扩展名不是 .jpg → 仍然尝试解析', async () => {
    const f = new File([new Uint8Array([0x00, 0x11, 0x22, 0x33])], 'noext', {
      type: 'image/jpeg',
    });
    expect(await readExifOrientation(f)).toBe(1);
  });

  it('扩展名是 .jpeg 但 MIME 空 → 也会解析', async () => {
    const f = new File([jpegWithExif({ orientation: 8 }).buffer as ArrayBuffer], 'photo.jpeg', { type: '' });
    expect(await readExifOrientation(f)).toBe(8);
  });

  it('slice 抛异常 → 静默兜底返回 1', async () => {
    const broken = {
      type: 'image/jpeg',
      name: 'x.jpg',
      slice: () => {
        throw new Error('boom');
      },
    } as unknown as File;
    expect(await readExifOrientation(broken)).toBe(1);
  });
});

// ---------- applyExifToImageData 的 OffscreenCanvas stub ----------

class Fake2dCtx {
  translateArgs: Array<[number, number]> = [];
  scaleArgs: Array<[number, number]> = [];
  rotateArgs: number[] = [];
  drawImageCount = 0;
  putImageDataCount = 0;
  save(): void {}
  restore(): void {}
  translate(x: number, y: number): void {
    this.translateArgs.push([x, y]);
  }
  scale(x: number, y: number): void {
    this.scaleArgs.push([x, y]);
  }
  rotate(a: number): void {
    this.rotateArgs.push(a);
  }
  drawImage(): void {
    this.drawImageCount++;
  }
  putImageData(): void {
    this.putImageDataCount++;
  }
  getImageData(_x: number, _y: number, w: number, h: number): ImageData {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) } as unknown as ImageData;
  }
}

let ctxMode: 'ok' | 'null-main' | 'null-src' = 'ok';
let getContextCalls = 0;
let createdCtxs: Fake2dCtx[] = [];

class FakeOffscreenCanvas {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext(_type: string): Fake2dCtx | null {
    const idx = getContextCalls++;
    if (ctxMode === 'null-main' && idx === 0) return null;
    if (ctxMode === 'null-src' && idx === 1) return null;
    const ctx = new Fake2dCtx();
    createdCtxs.push(ctx);
    return ctx;
  }
}

function stubImageData(w: number, h: number): ImageData {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) } as unknown as ImageData;
}

describe('applyExifToImageData — OffscreenCanvas 路径', () => {
  beforeEach(() => {
    ctxMode = 'ok';
    getContextCalls = 0;
    createdCtxs = [];
    (globalThis as Record<string, unknown>).OffscreenCanvas = FakeOffscreenCanvas;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).OffscreenCanvas;
  });

  it('orientation=0 (falsy) → 直接返回原图', async () => {
    const img = stubImageData(20, 10);
    expect(await applyExifToImageData(img, 0)).toBe(img);
  });

  it('orientation=6 (90°): 宽高交换, 旋转 π/2, 返回新 ImageData', async () => {
    const img = stubImageData(20, 10);
    const out = await applyExifToImageData(img, 6);
    expect(out).not.toBe(img);
    expect(out.width).toBe(10);
    expect(out.height).toBe(20);
    const mainCtx = createdCtxs[0]!;
    expect(mainCtx.rotateArgs).toEqual([Math.PI / 2]);
    expect(mainCtx.drawImageCount).toBe(1);
    expect(createdCtxs[1]!.putImageDataCount).toBe(1);
  });

  it('orientation=2 (flipX): 宽高不变, 应用水平翻转', async () => {
    const img = stubImageData(20, 10);
    const out = await applyExifToImageData(img, 2);
    expect(out.width).toBe(20);
    expect(out.height).toBe(10);
    const mainCtx = createdCtxs[0]!;
    expect(mainCtx.scaleArgs).toContainEqual([-1, 1]);
    expect(mainCtx.translateArgs[0]).toEqual([20, 0]);
  });

  it('orientation=7 (270° + flipX): 宽高交换', async () => {
    const img = stubImageData(20, 10);
    const out = await applyExifToImageData(img, 7);
    expect(out.width).toBe(10);
    expect(out.height).toBe(20);
    expect(createdCtxs[0]!.rotateArgs).toEqual([(270 * Math.PI) / 180]);
  });

  it('主画布拿不到 2d context → 返回原图', async () => {
    ctxMode = 'null-main';
    const img = stubImageData(20, 10);
    expect(await applyExifToImageData(img, 6)).toBe(img);
  });

  it('源画布拿不到 2d context → 返回原图', async () => {
    ctxMode = 'null-src';
    const img = stubImageData(20, 10);
    expect(await applyExifToImageData(img, 6)).toBe(img);
  });
});
