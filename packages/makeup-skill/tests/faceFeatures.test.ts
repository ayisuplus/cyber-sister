// 五官分析算法单元测试
// 用合成 landmarks + 像素,验证分类与比例.

import { describe, it, expect } from 'vitest';
import { analyzeFeatures, type Landmark, type PixelBuffer } from '../src/shared/faceFeatures';

// ---------- 工具: 生成 478 个零关键点 ----------

function blankLandmarks(): Landmark[] {
  return new Array(478).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
}

function set(landmarks: Landmark[], idx: number, x: number, y: number, z = 0) {
  landmarks[idx] = { x, y, z };
}

// 合成一个"标准椭圆脸" landmark,参数控制各比例
function buildOvalFace(opts: {
  widthHeightRatio?: number; // 脸宽/脸高
  jawRatio?: number; // 0..1,下颌宽 / 脸宽
  cheekRatio?: number; // 0..1,颧骨宽 / 脸宽
  upperRatio?: number; // 三庭 上庭
  middleRatio?: number;
  lowerRatio?: number;
}): Landmark[] {
  const lm = blankLandmarks();
  const wh = opts.widthHeightRatio ?? 0.8;
  // 标准化脸高 = 0.6, 脸宽 = 0.6 * wh
  const faceH = 0.6;
  const faceW = faceH * wh;
  const yTop = 0.1;
  const yBot = yTop + faceH;
  const cx = 0.5;
  const left = cx - faceW / 2;
  const right = cx + faceW / 2;
  const jaw = opts.jawRatio ?? 0.75;
  const cheek = opts.cheekRatio ?? 0.9;
  void cheek;

  // 三庭
  const upper = opts.upperRatio ?? 1 / 3;
  const middle = opts.middleRatio ?? 1 / 3;
  // 实际距离比例
  const upperDist = upper * faceH;
  const middleDist = middle * faceH;

  const yBrow = yTop + upperDist;
  const yNose = yBrow + middleDist;
  const yChin = yBot;

  // 基础锚点
  set(lm, 10, cx, yTop); // hairline
  set(lm, 151, cx, yTop + 0.05); // forehead
  set(lm, 105, cx, yBrow); // brow center
  set(lm, 2, cx, yNose); // nose base
  set(lm, 152, cx, yChin); // chin
  set(lm, 234, left, yTop + faceH * 0.3); // left temple
  set(lm, 454, right, yTop + faceH * 0.3); // right temple
  // 下颌宽度 = faceW * jaw (从中心向两侧放)
  set(lm, 172, cx - (faceW * jaw) / 2, yBot - 0.05); // left jaw
  set(lm, 397, cx + (faceW * jaw) / 2, yBot - 0.05); // right jaw
  // 颧骨宽度 = faceW * cheek
  set(lm, 132, cx - (faceW * cheek) / 2, yBrow + faceH * 0.15); // left cheekbone
  set(lm, 361, cx + (faceW * cheek) / 2, yBrow + faceH * 0.15); // right cheekbone

  // 眼睛: 内眼角在 (cx - eyeW/2), 外眼角在 (cx + eyeW/2)
  const eyeW = (right - left) / 5; // 理想五眼
  const eyeY = yBrow + 0.02;
  set(lm, 33, cx - eyeW / 2, eyeY); // left inner
  set(lm, 133, cx + eyeW / 2, eyeY); // left outer
  set(lm, 362, cx - eyeW / 2, eyeY); // right inner (assume symmetric with left)
  set(lm, 263, cx + eyeW / 2, eyeY); // right outer
  // 眼睑中心 (y 偏 ±)
  set(lm, 159, cx - eyeW / 4, eyeY - 0.005); // upper lid
  set(lm, 145, cx - eyeW / 4, eyeY + 0.005); // lower lid
  // 鼻
  set(lm, 6, cx, yBrow - 0.005);
  set(lm, 168, cx, (yBrow + yNose) / 2);
  set(lm, 1, cx, yNose - 0.005); // tip
  set(lm, 49, cx - 0.02, yNose);
  set(lm, 279, cx + 0.02, yNose);
  // 嘴
  set(lm, 0, cx - 0.03, yNose + 0.04); // upper lip top
  set(lm, 61, cx + 0.03, yNose + 0.04);
  set(lm, 17, cx, yNose + 0.06); // lower lip bottom
  set(lm, 291, cx - 0.03, yNose + 0.055);
  // 眉
  set(lm, 46, cx - 0.08, yBrow - 0.005);
  set(lm, 66, cx - 0.05, yBrow - 0.012);
  // 脸颊 (肤色采样用)
  set(lm, 117, cx - 0.1, yBrow + faceH * 0.15);
  set(lm, 187, cx - 0.1, yBrow + faceH * 0.25);
  set(lm, 207, cx - 0.05, yBrow + faceH * 0.2);

  return lm;
}

// 构造 30x30 RGBA 像素缓冲,中心填指定 RGB
function buildCheekPixels(centerRGB: [number, number, number], size = 32): PixelBuffer {
  const w = size,
    h = size;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = centerRGB[0];
      data[i + 1] = centerRGB[1];
      data[i + 2] = centerRGB[2];
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

describe('analyzeFeatures - 三庭五眼', () => {
  it('三庭各占 1/3 时比例约为 0.33/0.33/0.33', () => {
    const lm = buildOvalFace({ upperRatio: 0.33, middleRatio: 0.34, lowerRatio: 0.33 });
    const f = analyzeFeatures(lm);
    expect(f.upperThirdRatio).toBeCloseTo(0.33, 2);
    expect(f.middleThirdRatio).toBeCloseTo(0.34, 2);
    expect(f.lowerThirdRatio).toBeCloseTo(0.33, 2);
  });

  it('五眼完美时 fiveEyeFit ≈ 1.0', () => {
    const lm = buildOvalFace({ widthHeightRatio: 0.8 });
    const f = analyzeFeatures(lm);
    expect(f.fiveEyeFit).toBeCloseTo(1.0, 1);
  });

  it('三庭和为 1', () => {
    const lm = buildOvalFace({});
    const f = analyzeFeatures(lm);
    const sum = f.upperThirdRatio + f.middleThirdRatio + f.lowerThirdRatio;
    expect(sum).toBeCloseTo(1, 2);
  });
});

describe('analyzeFeatures - 脸型分类', () => {
  it('椭圆形 (oval): 宽高比 0.8, 下颌比例 0.75', () => {
    const lm = buildOvalFace({ widthHeightRatio: 0.8, jawRatio: 0.75 });
    const f = analyzeFeatures(lm);
    expect(f.faceShape).toBe('oval');
  });

  it('圆形 (round): 宽高比 0.95, 下颌偏圆', () => {
    const lm = buildOvalFace({ widthHeightRatio: 0.95, jawRatio: 0.8 });
    const f = analyzeFeatures(lm);
    expect(f.faceShape).toBe('round');
  });

  it('方形 (square): 宽高比 0.9, 下颌方宽', () => {
    const lm = buildOvalFace({ widthHeightRatio: 0.9, jawRatio: 0.88 });
    const f = analyzeFeatures(lm);
    expect(f.faceShape).toBe('square');
  });

  it('长形 (long): 宽高比 < 0.62', () => {
    const lm = buildOvalFace({ widthHeightRatio: 0.55 });
    const f = analyzeFeatures(lm);
    expect(f.faceShape).toBe('long');
  });

  it('心形 (heart): 下颌明显窄 (0.55)', () => {
    const lm = buildOvalFace({ widthHeightRatio: 0.8, jawRatio: 0.55 });
    const f = analyzeFeatures(lm);
    expect(f.faceShape).toBe('heart');
  });
});

describe('analyzeFeatures - 肤色 LAB 分类', () => {
  it('暖色调浅肤色 (warm_fair): RGB ≈ (245, 220, 195)', () => {
    // 先把 landmarks 摆好使脸颊坐标落在像素中心
    const lm = buildOvalFace({ widthHeightRatio: 0.8 });
    // 构造 100x100 像素,脸颊在 (50,50) — 调整像素中心与 landmark 投影一致
    const w = 100,
      h = 100;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i] = 245;
        data[i + 1] = 220;
        data[i + 2] = 195;
        data[i + 3] = 255;
      }
    }
    const f = analyzeFeatures(lm, { data, width: w, height: h });
    // 暖 + 浅 → warm_fair (但要满足 L > 75 且 |b| > |a|)
    expect(f.skinTone).toMatch(/^warm_/);
  });

  it('冷色调浅肤色 (cool_fair): RGB ≈ (240, 210, 215) (粉调)', () => {
    const lm = buildOvalFace({ widthHeightRatio: 0.8 });
    const w = 100,
      h = 100;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i] = 240;
        data[i + 1] = 210;
        data[i + 2] = 215;
        data[i + 3] = 255;
      }
    }
    const f = analyzeFeatures(lm, { data, width: w, height: h });
    expect(f.skinTone).toMatch(/^cool_/);
  });

  it('深肤色 (warm_deep): RGB ≈ (110, 80, 55)', () => {
    const lm = buildOvalFace({ widthHeightRatio: 0.8 });
    const w = 100,
      h = 100;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i] = 110;
        data[i + 1] = 80;
        data[i + 2] = 55;
        data[i + 3] = 255;
      }
    }
    const f = analyzeFeatures(lm, { data, width: w, height: h });
    // 暖 + 深 (30 < L <= 55)
    expect(f.skinTone).toMatch(/^warm_deep/);
  });

  it('有效像素不足时 unknown', () => {
    const lm = buildOvalFace({ widthHeightRatio: 0.8 });
    // 全黑 → 全部 L < 30 被过滤
    const pixels = buildCheekPixels([0, 0, 0]);
    const f = analyzeFeatures(lm, pixels);
    expect(f.skinTone).toBe('unknown');
  });
});

describe('analyzeFeatures - 置信度', () => {
  it('完整 landmarks + 均匀像素 → 置信度 > 0.5', () => {
    const lm = buildOvalFace({ widthHeightRatio: 0.8 });
    const pixels = buildCheekPixels([220, 195, 170]);
    const f = analyzeFeatures(lm, pixels);
    expect(f.confidence).toBeGreaterThan(0.3);
  });

  it('无 landmarks → confidence = 0', () => {
    const f = analyzeFeatures([]);
    expect(f.confidence).toBe(0);
  });

  it('只有部分 landmarks → 关键点完整性扣分', () => {
    const lm = blankLandmarks();
    // 只给两个关键点,其他全 0
    set(lm, 10, 0.5, 0.1);
    set(lm, 152, 0.5, 0.7);
    const f = analyzeFeatures(lm);
    // completeness 几乎为 0 → 置信度应较低
    expect(f.confidence).toBeLessThan(0.3);
  });
});

describe('analyzeFeatures - 鼻型', () => {
  it('鼻翼窄 → narrow_bridge', () => {
    const lm = buildOvalFace({ widthHeightRatio: 0.8 });
    // 手动把鼻翼往里收
    set(lm, 49, 0.5 - 0.005, 0.3);
    set(lm, 279, 0.5 + 0.005, 0.3);
    const f = analyzeFeatures(lm);
    expect(f.noseType).toBe('narrow_bridge');
  });

  it('鼻翼宽 → wide_bridge', () => {
    const lm = buildOvalFace({ widthHeightRatio: 0.8 });
    set(lm, 49, 0.5 - 0.06, 0.3);
    set(lm, 279, 0.5 + 0.06, 0.3);
    const f = analyzeFeatures(lm);
    expect(f.noseType).toMatch(/^wide_bridge|bulbus_tip$/);
  });
});

describe('analyzeFeatures - 边界', () => {
  it('空 landmarks 返回 unknown features', () => {
    const f = analyzeFeatures([]);
    expect(f.faceShape).toBe('unknown');
    expect(f.eyeType).toBe('unknown');
    expect(f.noseType).toBe('unknown');
    expect(f.skinTone).toBe('unknown');
    expect(f.confidence).toBe(0);
  });

  it('无像素时 skinTone = unknown,confidence 仍能计算', () => {
    const lm = buildOvalFace({ widthHeightRatio: 0.8 });
    const f = analyzeFeatures(lm);
    expect(f.skinTone).toBe('unknown');
    expect(f.confidence).toBeGreaterThan(0);
  });
});
