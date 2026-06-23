// Shared face-feature analysis.
// 输入 MediaPipe 478 关键点 (+ 可选像素),输出 FaceFeatures 摘要.
// 算法:三庭五眼 + 脸型/眼型/鼻型几何分类 + LAB 肤色 + 置信度合成.

import type { EyeType, FaceFeatures, FaceShape, NoseType, SkinTone } from './types';

/** 归一化坐标 (0..1) 的关键点. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** 像素缓冲,用于肤色采样. */
export interface PixelBuffer {
  data: Uint8ClampedArray; // RGBA
  width: number;
  height: number;
}

// ---------- 关键点索引 (MediaPipe Face Landmarker) ----------

const LM = {
  hairline: 10,
  forehead: 151,
  browCenter: 105,
  noseBase: 2,
  chin: 152,
  leftEyeInner: 33,
  leftEyeOuter: 133,
  rightEyeInner: 362,
  rightEyeOuter: 263,
  leftTemple: 234,
  rightTemple: 454,
  leftCheekTop: 117,
  leftCheekBot: 187,
  leftCheekSide: 207,
  // 鼻
  noseBridgeTop: 6,
  noseBridgeMid: 168,
  noseTip: 1,
  noseLeftAlar: 49,
  noseRightAlar: 279,
  noseBottom: 2,
  // 嘴
  upperLipTop: 0,
  upperLipRight: 61,
  lowerLipBottom: 17,
  lowerLipLeft: 291,
  // 眉
  leftBrowInner: 105,
  leftBrowPeak: 66,
  leftBrowTail: 46,
  // 下颌
  leftJaw: 172,
  rightJaw: 397,
  chinLeft: 172,
  chinRight: 397,
} as const;

// ---------- 工具函数 ----------

function dist(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function safeGet(landmarks: Landmark[], idx: number): Landmark {
  return landmarks[idx] ?? { x: 0, y: 0, z: 0 };
}

// 必需关键点是否都存在 (coords 都不为零)
function landmarkComplete(landmarks: Landmark[], indices: number[]): number {
  if (!landmarks || landmarks.length === 0) return 0;
  let hit = 0;
  for (const i of indices) {
    const lm = landmarks[i];
    if (lm && (lm.x !== 0 || lm.y !== 0)) hit++;
  }
  return hit / indices.length;
}

// ---------- 三庭五眼 ----------

function computeThirds(landmarks: Landmark[]) {
  const hairline = safeGet(landmarks, LM.hairline);
  const brow = safeGet(landmarks, LM.browCenter);
  const noseBase = safeGet(landmarks, LM.noseBase);
  const chin = safeGet(landmarks, LM.chin);

  const upper = dist(hairline, brow);
  const middle = dist(brow, noseBase);
  const lower = dist(noseBase, chin);
  const total = upper + middle + lower;
  if (total === 0) {
    return { upperThirdRatio: 0, middleThirdRatio: 0, lowerThirdRatio: 0 };
  }
  return {
    upperThirdRatio: upper / total,
    middleThirdRatio: middle / total,
    lowerThirdRatio: lower / total,
  };
}

function computeFiveEyeFit(landmarks: Landmark[]): number {
  const leftTemple = safeGet(landmarks, LM.leftTemple);
  const rightTemple = safeGet(landmarks, LM.rightTemple);
  const faceWidth = dist(leftTemple, rightTemple);
  if (faceWidth === 0) return 0;

  const leftInner = safeGet(landmarks, LM.leftEyeInner);
  const leftOuter = safeGet(landmarks, LM.leftEyeOuter);
  const rightInner = safeGet(landmarks, LM.rightEyeInner);
  const rightOuter = safeGet(landmarks, LM.rightEyeOuter);
  const leftEyeWidth = dist(leftInner, leftOuter);
  const rightEyeWidth = dist(rightInner, rightOuter);
  const eyeWidth = (leftEyeWidth + rightEyeWidth) / 2;
  if (eyeWidth === 0) return 0;
  return faceWidth / (5 * eyeWidth);
}

// ---------- 脸型分类 ----------

function classifyFaceShape(landmarks: Landmark[]): FaceShape {
  const faceWidth = dist(safeGet(landmarks, LM.leftTemple), safeGet(landmarks, LM.rightTemple));
  const totalHeight = dist(safeGet(landmarks, LM.hairline), safeGet(landmarks, LM.chin));
  if (faceWidth === 0 || totalHeight === 0) return 'unknown';

  const jawWidth = dist(safeGet(landmarks, LM.leftJaw), safeGet(landmarks, LM.rightJaw));
  const cheekWidth = dist(
    safeGet(landmarks, 132), // 左颧骨
    safeGet(landmarks, 361), // 右颧骨
  );

  const wh = faceWidth / totalHeight;
  const jawToFace = jawWidth / faceWidth;
  const cheekToFace = cheekWidth / faceWidth;

  // long: 脸明显长
  if (wh < 0.62) return 'long';
  // heart: 额头宽 + 下颌窄
  if (jawToFace < 0.72 && cheekToFace >= 0.85) return 'heart';
  // diamond: 额头窄 + 颧骨宽
  if (cheekToFace > 0.92 && jawToFace < 0.78) return 'diamond';
  // square: 宽高接近 + 下颌方
  if (wh >= 0.85 && jawToFace >= 0.82) return 'square';
  // round: 宽高比大 + 下颌圆 (不方)
  if (wh >= 0.9 && jawToFace < 0.85) return 'round';
  // oval: 默认均衡脸型
  if (wh >= 0.7 && wh <= 0.95) return 'oval';
  return 'unknown';
}

// ---------- 眼型 ----------

function classifyEyeType(landmarks: Landmark[]): EyeType {
  // 左眼纵横比: 上下眼睑距离 / 眼宽
  const upperLid = safeGet(landmarks, 159); // 左眼上眼睑中心
  const lowerLid = safeGet(landmarks, 145); // 左眼下眼睑中心
  const inner = safeGet(landmarks, LM.leftEyeInner);
  const outer = safeGet(landmarks, LM.leftEyeOuter);
  const eyeWidth = dist(inner, outer);
  if (eyeWidth === 0) return 'unknown';
  const eyeHeight = dist(upperLid, lowerLid);
  const ear = eyeHeight / eyeWidth;

  // 内眼角-外眼角 上下差异 → tilt
  const dy = outer.y - inner.y;
  const tilt = dy / eyeWidth; // 正=外眼角下垂

  // 眼距
  const rightInner = safeGet(landmarks, LM.rightEyeInner);
  const faceWidth = dist(safeGet(landmarks, LM.leftTemple), safeGet(landmarks, LM.rightTemple));
  const interPupil = dist(inner, rightInner);
  if (faceWidth === 0) return 'unknown';
  const interPupilRatio = interPupil / faceWidth;

  if (interPupilRatio < 0.32) return 'close_set';
  if (interPupilRatio > 0.5) return 'wide_set';
  if (ear > 0.42) return 'round';
  if (ear < 0.22) return 'monolid';
  if (ear < 0.3) return 'hooded';
  if (tilt > 0.08) return 'downturned';
  if (tilt < -0.05) return 'upturned';
  return 'almond';
}

// ---------- 鼻型 ----------

function classifyNoseType(landmarks: Landmark[]): NoseType {
  const bridgeMid = safeGet(landmarks, LM.noseBridgeMid);
  const tip = safeGet(landmarks, LM.noseTip);
  const leftAlar = safeGet(landmarks, LM.noseLeftAlar);
  const rightAlar = safeGet(landmarks, LM.noseRightAlar);

  const faceWidth = dist(safeGet(landmarks, LM.leftTemple), safeGet(landmarks, LM.rightTemple));
  if (faceWidth === 0) return 'unknown';

  // 鼻梁宽度(鼻翼间距)/ 脸宽
  const alarWidth = dist(leftAlar, rightAlar);
  const bridgeRatio = alarWidth / faceWidth;

  // bulbous: 鼻翼 / 鼻梁宽 比值高
  if (bridgeRatio > 0.32) return 'bulbus_tip';
  if (bridgeRatio > 0.25) return 'wide_bridge';
  if (bridgeRatio < 0.18) return 'narrow_bridge';
  // upturned: 鼻尖 y < 鼻底 y - 一点 (鼻尖翘)
  if (tip.y < safeGet(landmarks, LM.noseBottom).y - 0.01) return 'upturned';
  // hooked: 鼻梁中段 y 异常 (近似判断)
  if (bridgeMid.y > tip.y - 0.005) return 'hooked';
  return 'straight';
}

// ---------- 肤色: LAB 转换 + 中位数 + 分类 ----------

/** sRGB 0..255 → linear 0..1. */
function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** RGB → XYZ (D65). */
function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  // sRGB D65 matrix
  const x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175;
  const z = lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041;
  return [x, y, z];
}

/** XYZ → LAB (D65 reference white). */
function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  const xn = 0.95047,
    yn = 1.0,
    zn = 1.08883;
  const fx = labF(x / xn);
  const fy = labF(y / yn);
  const fz = labF(z / zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labF(t: number): number {
  const delta = 6 / 29;
  return t > delta * delta * delta ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const [x, y, z] = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

/** 取脸颊 30x30 ROI 的 LAB 像素中位数 + 有效像素占比. */
function sampleCheekLab(
  pixels: PixelBuffer,
  centerX: number,
  centerY: number,
): { medianL: number; medianA: number; medianB: number; validRatio: number } {
  const { data, width, height } = pixels;
  const roi = 15; // 30/2
  const x0 = Math.max(0, Math.floor(centerX - roi));
  const x1 = Math.min(width, Math.floor(centerX + roi));
  const y0 = Math.max(0, Math.floor(centerY - roi));
  const y1 = Math.min(height, Math.floor(centerY + roi));
  const total = Math.max(1, (x1 - x0) * (y1 - y0));

  const L: number[] = [];
  const A: number[] = [];
  const B: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const [L_, a, b2] = rgbToLab(r, g, b);
      // 过滤阴影/高光/异常红黄
      if (L_ < 30 || L_ > 95) continue;
      if (Math.abs(a) > 30) continue;
      if (Math.abs(b2) > 25) continue;
      L.push(L_);
      A.push(a);
      B.push(b2);
    }
  }
  const validRatio = L.length / total;
  if (L.length === 0) {
    return { medianL: 0, medianA: 0, medianB: 0, validRatio: 0 };
  }
  return {
    medianL: median(L),
    medianA: median(A),
    medianB: median(B),
    validRatio,
  };
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

/** 暖冷判断 + 深度 → 8 类 SkinTone. */
function classifySkinTone(lab: {
  medianL: number;
  medianA: number;
  medianB: number;
  validRatio: number;
}): SkinTone {
  const { medianL, medianA, medianB, validRatio } = lab;
  if (validRatio < 0.2 || medianL === 0) return 'unknown';

  // 暖: b > 0 且 |b| > |a|; 冷: a > 0 且 |a| > |b|; 中性: 都不显著
  let temp: 'warm' | 'cool' | 'neutral';
  if (medianB > 1 && Math.abs(medianB) > Math.abs(medianA)) temp = 'warm';
  else if (medianA > 1 && Math.abs(medianA) > Math.abs(medianB)) temp = 'cool';
  else temp = 'neutral';

  // 深度: L 越大越浅
  let depth: 'fair' | 'medium' | 'deep' | 'deep_dark';
  if (medianL > 75) depth = 'fair';
  else if (medianL > 55) depth = 'medium';
  else if (medianL > 30) depth = 'deep';
  else depth = 'deep_dark';

  const table: Record<typeof temp, Record<typeof depth, SkinTone>> = {
    warm: {
      fair: 'warm_fair',
      medium: 'warm_medium',
      deep: 'warm_deep',
      deep_dark: 'warm_deep_dark',
    },
    cool: {
      fair: 'cool_fair',
      medium: 'cool_medium',
      deep: 'warm_deep',
      deep_dark: 'warm_deep_dark',
    },
    neutral: {
      fair: 'neutral_fair',
      medium: 'neutral_medium',
      deep: 'warm_deep',
      deep_dark: 'warm_deep_dark',
    },
  };
  return table[temp][depth];
}

// ---------- 光照质量: ROI 内 L 通道直方图集中度 ----------

function estimateLightingQuality(pixels: PixelBuffer, centerX: number, centerY: number): number {
  const { data, width, height } = pixels;
  const roi = 20;
  const x0 = Math.max(0, Math.floor(centerX - roi));
  const x1 = Math.min(width, Math.floor(centerX + roi));
  const y0 = Math.max(0, Math.floor(centerY - roi));
  const y1 = Math.min(height, Math.floor(centerY + roi));
  const Ls: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const [L] = rgbToLab(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
      Ls.push(L);
    }
  }
  if (Ls.length === 0) return 0;
  // 标准差小 = 光照均匀 = 高分;过大过曝或过暗都差
  const mean = Ls.reduce((s, v) => s + v, 0) / Ls.length;
  const variance = Ls.reduce((s, v) => s + (v - mean) ** 2, 0) / Ls.length;
  const std = Math.sqrt(variance);
  // 理想 std 在 8~18 之间,过低(纯色)或过高(过曝/斑驳)扣分
  if (std < 5) return 0.3;
  if (std > 30) return 0.3;
  if (std >= 8 && std <= 18) return 1;
  return 1 - Math.min(1, Math.abs(std - 13) / 17);
}

// ---------- 整体置信度 ----------

function computeConfidence(args: {
  landmarks: Landmark[];
  pixels?: PixelBuffer;
  cheekX: number;
  cheekY: number;
  skinValidRatio: number;
}): number {
  const required = [
    LM.hairline,
    LM.browCenter,
    LM.chin,
    LM.noseBase,
    LM.leftEyeInner,
    LM.leftEyeOuter,
    LM.rightEyeInner,
    LM.rightEyeOuter,
    LM.leftTemple,
    LM.rightTemple,
    LM.upperLipTop,
    LM.upperLipRight,
    LM.lowerLipBottom,
    LM.lowerLipLeft,
  ];
  const completeness = landmarkComplete(args.landmarks, required);

  let lighting: number;
  if (args.pixels) {
    lighting = estimateLightingQuality(args.pixels, args.cheekX, args.cheekY);
  } else {
    // 没传像素时按 0.5 估计
    lighting = 0.5;
  }

  const skinValid = args.skinValidRatio;
  return completeness * 0.3 + lighting * 0.3 + skinValid * 0.4;
}

// ---------- 入口 ----------

const UNKNOWN_FEATURES: FaceFeatures = {
  upperThirdRatio: 0,
  middleThirdRatio: 0,
  lowerThirdRatio: 0,
  fiveEyeFit: 0,
  faceShape: 'unknown',
  skinTone: 'unknown',
  eyeType: 'unknown',
  noseType: 'unknown',
  eyeDistanceRatio: 0,
  faceWidthHeightRatio: 0,
  lipFullnessRatio: 0,
  browArchAngle: 0,
  noseBridgeWidth: 0,
  confidence: 0,
};

/**
 * 关键点 + 像素 → FaceFeatures 摘要.
 * 关键点坐标需在 [0..1] 归一化平面.
 */
export function analyzeFeatures(landmarks: Landmark[], pixels?: PixelBuffer): FaceFeatures {
  if (!landmarks || landmarks.length === 0) {
    return { ...UNKNOWN_FEATURES };
  }

  // 三庭五眼
  const thirds = computeThirds(landmarks);
  const fiveEyeFit = computeFiveEyeFit(landmarks);

  // 基础比值
  const faceWidth = dist(safeGet(landmarks, LM.leftTemple), safeGet(landmarks, LM.rightTemple));
  const faceHeight = dist(safeGet(landmarks, LM.hairline), safeGet(landmarks, LM.chin));
  const faceWidthHeightRatio = faceHeight > 0 ? faceWidth / faceHeight : 0;

  // 眼距比
  const leftInner = safeGet(landmarks, LM.leftEyeInner);
  const rightInner = safeGet(landmarks, LM.rightEyeInner);
  const interPupilDist = dist(leftInner, rightInner);
  const eyeDistanceRatio = faceWidth > 0 ? interPupilDist / faceWidth : 0;

  // 唇饱满度
  const lipHeight = dist(safeGet(landmarks, LM.upperLipTop), safeGet(landmarks, LM.lowerLipBottom));
  const lipWidth = dist(safeGet(landmarks, LM.upperLipRight), safeGet(landmarks, LM.lowerLipLeft));
  const lipFullnessRatio = lipWidth > 0 ? lipHeight / lipWidth : 0;

  // 眉峰角度
  const browInner = safeGet(landmarks, LM.leftBrowInner);
  const browPeak = safeGet(landmarks, LM.leftBrowPeak);
  const browTail = safeGet(landmarks, LM.leftBrowTail);
  const browArchAngle =
    browInner && browPeak && browTail
      ? Math.abs(
          Math.atan2(browPeak.y - browInner.y, browPeak.x - browInner.x) -
            Math.atan2(browTail.y - browInner.y, browTail.x - browInner.x),
        ) *
        (180 / Math.PI)
      : 0;

  // 鼻梁宽
  const alarWidth = dist(safeGet(landmarks, LM.noseLeftAlar), safeGet(landmarks, LM.noseRightAlar));
  const noseBridgeWidth = faceWidth > 0 ? alarWidth / faceWidth : 0;

  // 分类
  const faceShape = classifyFaceShape(landmarks);
  const eyeType = classifyEyeType(landmarks);
  const noseType = classifyNoseType(landmarks);

  // 肤色 (需要像素)
  let skinTone: SkinTone = 'unknown';
  let skinValidRatio = 0;
  let cheekX = 0;
  let cheekY = 0;
  if (pixels && pixels.width > 0) {
    // 脸颊中心: 用左侧 cheekTop (117) → 投影到像素坐标
    const cheekTop = safeGet(landmarks, LM.leftCheekTop);
    const cheekBot = safeGet(landmarks, LM.leftCheekBot);
    cheekX = ((cheekTop.x + cheekBot.x) / 2) * pixels.width;
    cheekY = ((cheekTop.y + cheekBot.y) / 2) * pixels.height;
    const lab = sampleCheekLab(pixels, cheekX, cheekY);
    skinValidRatio = lab.validRatio;
    skinTone = classifySkinTone(lab);
  }

  const confidence = computeConfidence({
    landmarks,
    pixels,
    cheekX,
    cheekY,
    skinValidRatio,
  });

  return {
    upperThirdRatio: thirds.upperThirdRatio,
    middleThirdRatio: thirds.middleThirdRatio,
    lowerThirdRatio: thirds.lowerThirdRatio,
    fiveEyeFit,
    faceShape,
    skinTone,
    eyeType,
    noseType,
    eyeDistanceRatio,
    faceWidthHeightRatio,
    lipFullnessRatio,
    browArchAngle,
    noseBridgeWidth,
    confidence,
  };
}
