// 边界场景诊断测试 — 覆盖主要场景 + 确定性

import { describe, it, expect } from 'vitest';
import {
  diagnoseSelfie,
  exifToTransform,
  readExifOrientation,
  applyExifToImageData,
  type DiagnosisInput,
} from '../src/frontend/face/edgeCases';
import type { Landmark, PixelBuffer } from '../src/shared/faceFeatures';

// ---------- 工具: 合成关键点 + 像素 ----------

function blankLandmarks(): Landmark[] {
  return new Array(478).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
}

function set(landmarks: Landmark[], idx: number, x: number, y: number, z = 0) {
  landmarks[idx] = { x, y, z };
}

// 合成一张"标准正面脸" 478 关键点
function buildFrontalFace(): Landmark[] {
  const lm = blankLandmarks();
  // 脸轮廓
  set(lm, 10, 0.5, 0.1);  // hairline
  set(lm, 151, 0.5, 0.13); // forehead
  set(lm, 105, 0.5, 0.28); // brow center
  set(lm, 2, 0.5, 0.5);   // nose base
  set(lm, 152, 0.5, 0.85); // chin
  set(lm, 234, 0.15, 0.3); // left temple
  set(lm, 454, 0.85, 0.3); // right temple
  set(lm, 172, 0.3, 0.78); // left jaw
  set(lm, 397, 0.7, 0.78); // right jaw
  set(lm, 132, 0.2, 0.4);  // left cheekbone
  set(lm, 361, 0.8, 0.4);  // right cheekbone
  // 眼睛
  set(lm, 33, 0.35, 0.32);
  set(lm, 133, 0.45, 0.32);
  set(lm, 362, 0.55, 0.32);
  set(lm, 263, 0.65, 0.32);
  // 脸颊 (关键点索引 117, 187, 207, 346)
  set(lm, 117, 0.3, 0.45);
  set(lm, 187, 0.32, 0.55);
  set(lm, 207, 0.25, 0.5);
  set(lm, 346, 0.7, 0.45);
  // 鼻梁
  set(lm, 6, 0.5, 0.32);
  set(lm, 168, 0.5, 0.42);
  set(lm, 1, 0.5, 0.48);
  set(lm, 49, 0.47, 0.5);
  set(lm, 279, 0.53, 0.5);
  return lm;
}

// 合成"侧脸" — 鼻尖大幅偏移到一边
function buildSideFace(): Landmark[] {
  const lm = buildFrontalFace();
  set(lm, 1, 0.7, 0.48);   // 鼻尖偏到右边
  set(lm, 2, 0.7, 0.5);    // 鼻底也偏
  set(lm, 152, 0.65, 0.85); // 下巴偏
  return lm;
}

// 像素:全填一个 RGB
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

// 在指定圆心画深色 (刘海) 区域
function addDarkSpot(pixels: PixelBuffer, cx: number, cy: number, r: number) {
  for (let y = Math.max(0, cy - r); y < Math.min(pixels.height, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x < Math.min(pixels.width, cx + r); x++) {
      if (Math.hypot(x - cx, y - cy) > r) continue;
      const i = (y * pixels.width + x) * 4;
      pixels.data[i] = 30;
      pixels.data[i + 1] = 25;
      pixels.data[i + 2] = 20;
    }
  }
}

// 在指定圆心画深色镜框 (眼镜) — 厚镜框,占据鼻梁 ROI 较大比例
function addGlassesFrame(pixels: PixelBuffer, cx: number, cy: number) {
  // 画两条粗横向镜框 + 鼻梁竖桥
  for (let y = cy - 3; y <= cy + 3; y++) {
    for (let x = cx - 25; x <= cx + 25; x++) {
      if (x < 0 || x >= pixels.width || y < 0 || y >= pixels.height) continue;
      const i = (y * pixels.width + x) * 4;
      pixels.data[i] = 20;
      pixels.data[i + 1] = 20;
      pixels.data[i + 2] = 20;
    }
  }
  // 中间鼻梁桥
  for (let y = cy - 3; y <= cy + 12; y++) {
    for (let x = cx - 2; x <= cx + 2; x++) {
      if (x < 0 || x >= pixels.width || y < 0 || y >= pixels.height) continue;
      const i = (y * pixels.width + x) * 4;
      pixels.data[i] = 20;
      pixels.data[i + 1] = 20;
      pixels.data[i + 2] = 20;
    }
  }
}

// ---------- 测试 ----------

describe('diagnoseSelfie — 没人脸', () => {
  it('0 张脸 → blocked,blockedReason 含提示', () => {
    const r = diagnoseSelfie({ faces: [], baseConfidence: 0.8 });
    expect(r.blocked).toBe(true);
    expect(r.canProceed).toBe(false);
    expect(r.blockedReason).toContain('正面照');
    expect(r.adjustedConfidence).toBe(0);
    expect(r.skippedFeatures).toContain('all');
  });
});

describe('diagnoseSelfie — 多人脸', () => {
  it('>1 张脸 → 不 block,但有 warning', () => {
    const a = buildFrontalFace();
    const b = buildFrontalFace();
    const r = diagnoseSelfie({ faces: [a, b], baseConfidence: 0.8 });
    expect(r.blocked).toBe(false);
    expect(r.canProceed).toBe(true);
    expect(r.warnings.some((w) => w.includes('最大的人脸'))).toBe(true);
  });

  it('恰好 1 张脸 → 不应出现"最大"提示', () => {
    const r = diagnoseSelfie({ faces: [buildFrontalFace()], baseConfidence: 0.8 });
    expect(r.warnings.some((w) => w.includes('最大的人脸'))).toBe(false);
  });
});

describe('diagnoseSelfie — 侧脸', () => {
  it('严重侧脸 → blocked', () => {
    const r = diagnoseSelfie({
      faces: [buildSideFace()],
      baseConfidence: 0.8,
    });
    expect(r.blocked).toBe(true);
    expect(r.blockedReason).toContain('正面照');
  });

  it('正面脸 → 不 block', () => {
    const r = diagnoseSelfie({
      faces: [buildFrontalFace()],
      baseConfidence: 0.8,
    });
    expect(r.blocked).toBe(false);
  });
});

describe('diagnoseSelfie — 暗光 + 模糊', () => {
  it('极暗像素 → warning + 置信度降低', () => {
    const pixels = fillPixels(100, 100, [15, 10, 8]);
    const r = diagnoseSelfie({
      faces: [buildFrontalFace()],
      pixels,
      baseConfidence: 0.8,
    });
    expect(r.warnings.some((w) => w.includes('光线'))).toBe(true);
    expect(r.adjustedConfidence).toBeLessThan(0.8);
  });

  it('极模糊 (纯色) → blocked', () => {
    const pixels = fillPixels(200, 200, [180, 160, 140]);
    const r = diagnoseSelfie({
      faces: [buildFrontalFace()],
      pixels,
      baseConfidence: 0.8,
    });
    // 纯色 Laplacian 方差为 0,严重模糊 → blocked
    expect(r.blocked).toBe(true);
    expect(r.blockedReason).toContain('模糊');
  });
});

describe('diagnoseSelfie — 戴眼镜 / 刘海 / 浓妆', () => {
  it('鼻梁区画深色镜框 → 眼镜 warning + 置信度封顶 0.7', () => {
    const pixels = fillPixels(200, 200, [220, 195, 170]);
    // 鼻梁关键点 6 在归一化 (0.5, 0.32) → 像素 (100, 64)
    addGlassesFrame(pixels, 100, 64);
    const r = diagnoseSelfie({
      faces: [buildFrontalFace()],
      pixels,
      baseConfidence: 0.9,
    });
    expect(r.warnings.some((w) => w.includes('眼镜'))).toBe(true);
    expect(r.adjustedConfidence).toBeLessThanOrEqual(0.7);
  });

  it('前额画深色块 → 刘海 warning + skippedFeatures 含 forehead', () => {
    const pixels = fillPixels(200, 200, [220, 195, 170]);
    // hairline (0.5, 0.1) → 像素 (100, 20);用大半径深色块覆盖前额
    addDarkSpot(pixels, 100, 22, 22);
    const r = diagnoseSelfie({
      faces: [buildFrontalFace()],
      pixels,
      baseConfidence: 0.9,
    });
    expect(r.warnings.some((w) => w.includes('刘海'))).toBe(true);
    expect(r.skippedFeatures).toContain('forehead');
  });

  it('高饱和度脸颊 (粉底+腮红) → 浓妆 warning', () => {
    // 鲜艳玫红
    const pixels = fillPixels(200, 200, [200, 80, 100]);
    const r = diagnoseSelfie({
      faces: [buildFrontalFace()],
      pixels,
      baseConfidence: 0.9,
    });
    expect(r.warnings.some((w) => w.includes('妆容'))).toBe(true);
  });
});

describe('diagnoseSelfie — 文案温度 + 可降级', () => {
  it('所有 warning 都有中文,绝不出现嘲讽词', () => {
    const pixels = fillPixels(200, 200, [220, 195, 170]);
    addDarkSpot(pixels, 100, 20, 18);
    addGlassesFrame(pixels, 100, 64);
    const r = diagnoseSelfie({
      faces: [buildFrontalFace(), buildFrontalFace()],
      pixels,
      baseConfidence: 0.9,
    });
    // 不应包含敏感/嘲讽词
    const banned = ['丑', '糟糕', '失败', '重拍', '难看'];
    for (const w of r.warnings) {
      for (const b of banned) {
        expect(w).not.toContain(b);
      }
    }
  });

  it('降级分析:多种 warning 出现时 canProceed 仍为 true', () => {
    const pixels = fillPixels(200, 200, [220, 195, 170]);
    addDarkSpot(pixels, 100, 20, 18);
    addGlassesFrame(pixels, 100, 64);
    const r = diagnoseSelfie({
      faces: [buildFrontalFace()],
      pixels,
      baseConfidence: 0.9,
    });
    expect(r.blocked).toBe(false);
    expect(r.canProceed).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('没人脸 / 严重侧脸时确实阻止', () => {
    expect(
      diagnoseSelfie({ faces: [], baseConfidence: 0.9 }).blocked
    ).toBe(true);
    expect(
      diagnoseSelfie({ faces: [buildSideFace()], baseConfidence: 0.9 }).blocked
    ).toBe(true);
  });
});

describe('diagnoseSelfie — 确定性', () => {
  it('相同输入 → 相同输出 (多次运行)', () => {
    const input: DiagnosisInput = {
      faces: [buildFrontalFace()],
      pixels: fillPixels(200, 200, [220, 195, 170]),
      baseConfidence: 0.85,
    };
    const a = diagnoseSelfie(input);
    const b = diagnoseSelfie(input);
    expect(a).toEqual(b);
  });
});

describe('exifToTransform', () => {
  it('orientation 1-8 映射正确', () => {
    expect(exifToTransform(1)).toEqual({ rotation: 0, flipX: false });
    expect(exifToTransform(3)).toEqual({ rotation: 180, flipX: false });
    expect(exifToTransform(6)).toEqual({ rotation: 90, flipX: false });
    expect(exifToTransform(8)).toEqual({ rotation: 270, flipX: false });
    expect(exifToTransform(2)).toEqual({ rotation: 0, flipX: true });
  });

  it('未知 orientation 默认不旋转', () => {
    expect(exifToTransform(99)).toEqual({ rotation: 0, flipX: false });
    expect(exifToTransform(0)).toEqual({ rotation: 0, flipX: false });
  });
});

describe('readExifOrientation', () => {
  it('非 JPEG 文件 → 1', async () => {
    const pngFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', {
      type: 'image/png',
    });
    expect(await readExifOrientation(pngFile)).toBe(1);
  });

  it('不带 EXIF 的 JPEG → 1', async () => {
    // 最小 JPEG: FFD8 + FFD9
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const f = new File([bytes], 'a.jpg', { type: 'image/jpeg' });
    expect(await readExifOrientation(f)).toBe(1);
  });
});

describe('applyExifToImageData', () => {
  it('orientation=1 → 返回原图 (canvas 不可用时也是同样行为)', async () => {
    // 不依赖 DOM:用对象 stub 模拟 ImageData,Node 环境 OffscreenCanvas 不存在,函数会 early return
    const stub = { width: 10, height: 10, data: new Uint8ClampedArray(10 * 10 * 4) } as unknown as ImageData;
    const r = await applyExifToImageData(stub, 1);
    expect(r).toBe(stub);
  });

  it('orientation=6 在无 OffscreenCanvas 环境 → 原样返回 (实际旋转需浏览器)', async () => {
    const stub = { width: 20, height: 10, data: new Uint8ClampedArray(200 * 4) } as unknown as ImageData;
    const r = await applyExifToImageData(stub, 6);
    // Node 环境没有 OffscreenCanvas,函数直接返回原图(浏览器中会旋转)
    expect(r.width).toBe(20);
  });
});
