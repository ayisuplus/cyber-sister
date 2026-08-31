// 边界场景诊断 — 没人脸、多人脸、侧脸、暗光、眼镜、刘海、浓妆、模糊、EXIF.
// 原则:温暖文案 + 尽量降级分析,不要轻易阻止;用户能"继续分析"就放行.

import type { Landmark } from '../../shared/faceFeatures';
import type { PixelBuffer } from '../../shared/faceFeatures';

// ---------- 公开类型 ----------

export interface SelfieDiagnosis {
  canProceed: boolean;
  warnings: string[]; // 非阻塞提示
  blocked: boolean; // true = 完全不能分析
  blockedReason?: string; // 仅 blocked=true 时有值
  adjustedConfidence: number; // 0..1,基于质量的置信度调整
  skippedFeatures: string[]; // 需要跳过的特征
}

// 诊断所需的全部输入打包,避免长参数列表.
export interface DiagnosisInput {
  faces: Landmark[][]; // landmarker 返回的多个脸;空数组=无人脸
  pixels?: PixelBuffer; // 图像 RGBA + 宽高;可选但越多检查越准
  exifOrientation?: number; // 1-8;默认 1 (无旋转)
  baseConfidence: number; // 来自 faceFeatures 的整体置信度
}

// 阈值常量集中放置,便于测试与调整.
export const THRESHOLDS = {
  yawPitchDeg: 30, // >30° 算偏转过大
  darkLightL: 40, // 脸颊中位 L < 40 算暗光
  glassNonSkinRatio: 0.25, // 鼻梁区非肤色像素占比 > 25% 视为戴眼镜
  bangsSkinRatio: 0.3, // 前额 ROI 有效肤色像素 < 30% 视为刘海遮额
  heavyMakeupSat: 60, // 脸颊饱和度阈值 (HSV S × 100)
  blurLaplacian: 80, // Laplacian 方差下限,低于即视为模糊
  roiSize: 20, // 通用 ROI 半边长
  minFaceArea: 0.005, // 关键点 bbox 占图比 < 0.5% 视为过小
} as const;

// ---------- 主入口 ----------

export function diagnoseSelfie(input: DiagnosisInput): SelfieDiagnosis {
  const warnings: string[] = [];
  const skipped: string[] = [];
  let confidence = clamp01(input.baseConfidence);
  let blocked = false;
  let blockedReason: string | undefined;

  // 1) 没人脸
  if (input.faces.length === 0) {
    return {
      canProceed: false,
      warnings: [],
      blocked: true,
      blockedReason: '请上传清晰的正面照 📷',
      adjustedConfidence: 0,
      skippedFeatures: ['all'],
    };
  }

  // 2) 多人脸 — 选最大(由调用方负责),给 toast
  if (input.faces.length > 1) {
    warnings.push('已自动选择画面中最大的人脸');
  }

  const face = pickLargestFace(input.faces);
  if (face.length === 0) {
    return {
      canProceed: false,
      warnings,
      blocked: true,
      blockedReason: '请上传清晰的正面照 📷',
      adjustedConfidence: 0,
      skippedFeatures: ['all'],
    };
  }

  // 3) 侧脸 / 偏转
  const yawPitch = estimateYawPitch(face);
  if (yawPitch > THRESHOLDS.yawPitchDeg) {
    blocked = true;
    blockedReason = '请正视镜头,拍一张正面照哦～';
  } else if (yawPitch > THRESHOLDS.yawPitchDeg * 0.7) {
    warnings.push('头稍微有点偏,正面照效果会更好');
    confidence *= 0.7;
  }

  // 4) 暗光 + 模糊 + 浓妆 + 眼镜 + 刘海 — 需要像素
  if (input.pixels) {
    const px = input.pixels;

    // 4a) 暗光
    const cheekL = medianCheekLightness(px, face);
    if (cheekL > 0 && cheekL < THRESHOLDS.darkLightL) {
      warnings.push('光线有点暗,建议在自然光下拍摄');
      confidence *= 0.6;
    }

    // 4b) 模糊 (Laplacian 方差) — 0 = 纯色 = 严重模糊
    const blur = estimateBlur(px);
    if (blur < THRESHOLDS.blurLaplacian) {
      if (blur < THRESHOLDS.blurLaplacian * 0.5) {
        // 严重模糊 (包含纯色 = 0)
        blocked = true;
        blockedReason = '照片有点模糊,重新拍一张清晰的吧';
      } else {
        warnings.push('照片有点糊,清晰一点分析会更准');
        confidence *= 0.7;
      }
    }

    // 4c) 戴眼镜 — 鼻梁区非肤色像素占比
    if (hasGlasses(px, face)) {
      warnings.push('眼镜可能影响眼妆分析');
      confidence = Math.min(confidence, 0.7);
    }

    // 4d) 刘海遮额 — 前额 ROI 有效像素
    if (foreheadCovered(px, face)) {
      warnings.push('刘海很好看,但分析前额需要更清楚哦～');
      skipped.push('forehead');
      confidence *= 0.85;
    }

    // 4e) 浓妆 — 脸颊饱和度过高
    if (isHeavyMakeup(px, face)) {
      warnings.push('检测到你已有妆容,分析结果可能受当前妆容影响');
      confidence = Math.min(confidence, 0.7);
    }
  }

  // 5) 脸过小 (拍得太远) — bbox 占图比
  if (faceAreaRatio(face) < THRESHOLDS.minFaceArea) {
    warnings.push('脸在画面里有点小,凑近一点拍效果更好');
    confidence *= 0.8;
  }

  return {
    canProceed: !blocked,
    warnings,
    blocked,
    blockedReason,
    adjustedConfidence: clamp01(confidence),
    skippedFeatures: skipped,
  };
}

// ---------- 工具函数 ----------

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function pickLargestFace(faces: Landmark[][]): Landmark[] {
  const first = faces[0];
  if (!first) return [];
  if (faces.length === 1) return first;
  let best: Landmark[] = first;
  let bestArea = 0;
  for (const face of faces) {
    const area = faceAreaRatio(face);
    if (area > bestArea) {
      bestArea = area;
      best = face;
    }
  }
  return best;
}

function faceAreaRatio(face: Landmark[]): number {
  if (!face || face.length === 0) return 0;
  let minX = 1,
    minY = 1,
    maxX = 0,
    maxY = 0;
  let seen = false;
  for (const lm of face) {
    // 稀疏数组的空洞 (关键点缺失) 与 (0,0) 哨兵一样视作无效点, 跳过
    if (!lm || (lm.x === 0 && lm.y === 0)) continue;
    if (lm.x < minX) minX = lm.x;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.y > maxY) maxY = lm.y;
    seen = true;
  }
  if (!seen) return 0;
  return Math.max(0, (maxX - minX) * (maxY - minY));
}

/**
 * 用关键点对称性粗估偏转角度.
 * 没有直接的 yaw/pitch,这里用左右眼角 + 左右脸颊的水平差估算.
 * 简化: |左脸颊.x - 右脸颊.x| / 脸宽 偏离 0.5 越多 = 越偏.
 */
function estimateYawPitch(face: Landmark[]): number {
  const safe = (i: number): Landmark => face[i] ?? { x: 0, y: 0, z: 0 };

  // 关键点: 左脸颊 117, 右脸颊 346, 鼻尖 1, 下巴 152, 眉心 168
  const leftCheek = safe(117);
  const rightCheek = safe(346);
  const noseTip = safe(1);
  const chin = safe(152);

  // 脸宽 (左右脸颊水平距离)
  const faceW = Math.abs(rightCheek.x - leftCheek.x);
  if (faceW < 1e-6) return 0;

  // 鼻尖到脸颊中线的水平偏移比例
  const midX = (leftCheek.x + rightCheek.x) / 2;
  const noseOffset = Math.abs(noseTip.x - midX) / faceW;

  // 鼻尖到下巴中线偏移 (pitch 估算)
  const chinMidX = chin.x; // 近似中线
  const pitchOffset = Math.abs(noseTip.x - chinMidX) / faceW;

  // 综合偏移 → 角度估算 (粗略线性:偏移 0.3 ≈ 30°)
  const combined = Math.max(noseOffset, pitchOffset);
  return Math.min(90, combined * 100);
}

/**
 * 脸颊 ROI 中位亮度 (RGB → 简化 L).
 * 返回 -1 表示没有有效像素.
 */
function medianCheekLightness(pixels: PixelBuffer, face: Landmark[]): number {
  const { data, width, height } = pixels;
  const cheek = face[117] ?? face[187] ?? face[1] ?? { x: 0.5, y: 0.5, z: 0 };
  const cx = Math.floor(cheek.x * width);
  const cy = Math.floor(cheek.y * height);
  const r = THRESHOLDS.roiSize;
  const x0 = Math.max(0, cx - r);
  const x1 = Math.min(width, cx + r);
  const y0 = Math.max(0, cy - r);
  const y1 = Math.min(height, cy + r);
  if (x1 <= x0 || y1 <= y0) return -1;

  const L: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const R = data[i] ?? 0;
      const G = data[i + 1] ?? 0;
      const B = data[i + 2] ?? 0;
      // 简化亮度 (sRGB 0..255)
      L.push(0.299 * R + 0.587 * G + 0.114 * B);
    }
  }
  if (L.length === 0) return -1;
  return median(L);
}

/**
 * 全图 Laplacian 方差 (粗略) — 用于模糊检测.
 * 在缩小后的网格上计算以提速,精度对自拍足够.
 */
function estimateBlur(pixels: PixelBuffer): number {
  const { data, width, height } = pixels;
  if (width < 4 || height < 4) return 0;

  // 步长:大图采样以加速
  const step = Math.max(1, Math.floor(Math.min(width, height) / 200));
  const gray: number[] = [];
  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      gray.push(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }
  if (gray.length < 9) return 0;

  // 计算 3x3 Laplacian 响应
  const lap: number[] = [];
  const w = Math.floor((width - 2) / step);
  for (let y = 1; y < gray.length / w - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = gray[y * w + x] ?? 0;
      const sum =
        (gray[(y - 1) * w + x] ?? 0) +
        (gray[(y + 1) * w + x] ?? 0) +
        (gray[y * w + (x - 1)] ?? 0) +
        (gray[y * w + (x + 1)] ?? 0) -
        4 * c;
      lap.push(sum);
    }
  }
  if (lap.length === 0) return 0;
  const mean = lap.reduce((s, v) => s + v, 0) / lap.length;
  const variance = lap.reduce((s, v) => s + (v - mean) ** 2, 0) / lap.length;
  return variance;
}

/**
 * 鼻梁区检测眼镜:高对比 + 大量非肤色像素.
 * 鼻梁关键点: 6 (top), 168 (mid), 2 (bottom).
 */
function hasGlasses(pixels: PixelBuffer, face: Landmark[]): boolean {
  const bridge = face[6] ?? face[168];
  if (!bridge) return false;
  const { data, width, height } = pixels;
  const cx = Math.floor(bridge.x * width);
  const cy = Math.floor(bridge.y * height);
  const r = 15;
  const x0 = Math.max(0, cx - r);
  const x1 = Math.min(width, cx + r);
  const y0 = Math.max(0, cy - r);
  const y1 = Math.min(height, cy + r);
  if (x1 <= x0 || y1 <= y0) return false;

  let total = 0,
    nonSkin = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const R = data[i] ?? 0;
      const G = data[i + 1] ?? 0;
      const B = data[i + 2] ?? 0;
      total++;
      // 简单肤色判别:R > G > B 且 R > 95 — 否则视为非肤色(深色镜框/镜面高光)
      if (!(R > G && G > B && R > 95)) nonSkin++;
    }
  }
  if (total === 0) return false;
  return nonSkin / total > THRESHOLDS.glassNonSkinRatio;
}

/**
 * 前额 ROI 有效肤色像素占比 < 阈值 → 刘海遮额.
 */
function foreheadCovered(pixels: PixelBuffer, face: Landmark[]): boolean {
  const forehead = face[10] ?? face[151];
  if (!forehead) return false;
  const { data, width, height } = pixels;
  const cx = Math.floor(forehead.x * width);
  const cy = Math.floor(forehead.y * height);
  const r = THRESHOLDS.roiSize;
  const x0 = Math.max(0, cx - r);
  const x1 = Math.min(width, cx + r);
  const y0 = Math.max(0, cy - r);
  const y1 = Math.min(height, cy + r);
  if (x1 <= x0 || y1 <= y0) return false;

  let total = 0,
    skin = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const R = data[i] ?? 0;
      const G = data[i + 1] ?? 0;
      const B = data[i + 2] ?? 0;
      total++;
      // 头发通常是深色:亮度低 + R/G/B 接近
      const lum = 0.299 * R + 0.587 * G + 0.114 * B;
      if (lum > 60 && lum < 230) skin++; // 排除阴影/过曝
    }
  }
  if (total === 0) return false;
  return skin / total < THRESHOLDS.bangsSkinRatio;
}

/**
 * 脸颊区域 HSV 饱和度均值 — 浓妆 (腮红/粉底色差大) 提示.
 */
function isHeavyMakeup(pixels: PixelBuffer, face: Landmark[]): boolean {
  const cheek = face[117] ?? face[205] ?? { x: 0.5, y: 0.5, z: 0 };
  const { data, width, height } = pixels;
  const cx = Math.floor(cheek.x * width);
  const cy = Math.floor(cheek.y * height);
  const r = THRESHOLDS.roiSize;
  const x0 = Math.max(0, cx - r);
  const x1 = Math.min(width, cx + r);
  const y0 = Math.max(0, cy - r);
  const y1 = Math.min(height, cy + r);
  if (x1 <= x0 || y1 <= y0) return false;

  const sats: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const R = (data[i] ?? 0) / 255;
      const G = (data[i + 1] ?? 0) / 255;
      const B = (data[i + 2] ?? 0) / 255;
      const max = Math.max(R, G, B);
      const min = Math.min(R, G, B);
      const s = max === 0 ? 0 : (max - min) / max; // 0..1
      sats.push(s);
    }
  }
  if (sats.length === 0) return false;
  const meanSat = sats.reduce((s, v) => s + v, 0) / sats.length;
  return meanSat * 100 > THRESHOLDS.heavyMakeupSat;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 0) {
    const a = sorted[mid - 1] ?? 0;
    const b = sorted[mid] ?? 0;
    return (a + b) / 2;
  }
  return sorted[mid] ?? 0;
}

// ---------- EXIF 旋转校正工具 ----------

/**
 * 把 EXIF Orientation (1-8) 转换为画布上的旋转/翻转组合.
 * 返回 {rotation: 0|90|180|270, flipX: boolean}.
 * 调用方应在传入 MediaPipe 之前用 OffscreenCanvas 应用此变换.
 */
export function exifToTransform(orientation: number): { rotation: number; flipX: boolean } {
  switch (orientation) {
    case 1:
      return { rotation: 0, flipX: false };
    case 2:
      return { rotation: 0, flipX: true };
    case 3:
      return { rotation: 180, flipX: false };
    case 4:
      return { rotation: 180, flipX: true };
    case 5:
      return { rotation: 90, flipX: true };
    case 6:
      return { rotation: 90, flipX: false };
    case 7:
      return { rotation: 270, flipX: true };
    case 8:
      return { rotation: 270, flipX: false };
    default:
      return { rotation: 0, flipX: false };
  }
}

/**
 * 浏览器侧读取 EXIF Orientation (从 JPEG File).
 * PNG/WebP 不支持 EXIF,返回 1.
 */
export async function readExifOrientation(file: File): Promise<number> {
  // 仅 JPEG 头部含 EXIF
  if (!/jpe?g/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return 1;
  try {
    const slice = file.slice(0, 64 * 1024);
    const buf = await slice.arrayBuffer();
    const view = new DataView(buf);
    // JPEG SOI
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;
    let offset = 2;
    while (offset < view.byteLength) {
      if (view.getUint8(offset) !== 0xff) break;
      const marker = view.getUint8(offset + 1);
      const size = view.getUint16(offset + 2);
      // APP1 (EXIF)
      if (marker === 0xe1) {
        // "Exif\0\0"
        if (view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0) {
          const tiff = offset + 10;
          // TIFF header: 字节序标记 'II' (0x4949, little-endian) 或 'MM' (0x4D4D, big-endian)
          const bom = view.getUint16(tiff);
          if (bom !== 0x4949 && bom !== 0x4d4d) break;
          const little = bom === 0x4949;
          // 魔数 42 按声明的字节序读取
          if (view.getUint16(tiff + 2, little) !== 0x002a) break;
          const ifd0 = tiff + 8;
          const numEntries = view.getUint16(ifd0, little);
          for (let i = 0; i < numEntries; i++) {
            const entry = ifd0 + 2 + i * 12;
            const tag = view.getUint16(entry, little);
            if (tag === 0x0112) {
              // Orientation
              const value = view.getUint16(entry + 8, little);
              return value >= 1 && value <= 8 ? value : 1;
            }
          }
        }
        break;
      }
      offset += 2 + size;
    }
  } catch {
    // 解析失败静默,默认 1
  }
  return 1;
}

/**
 * 在 OffscreenCanvas 上应用 EXIF 校正,返回新的 ImageData.
 * MediaPipe 看到的是已校正方向的图像.
 */
export async function applyExifToImageData(
  imageData: ImageData,
  orientation: number,
): Promise<ImageData> {
  if (!orientation || orientation === 1) return imageData;
  const { rotation, flipX } = exifToTransform(orientation);

  // 旋转 90/270 交换宽高
  const swap = rotation === 90 || rotation === 270;
  const w = swap ? imageData.height : imageData.width;
  const h = swap ? imageData.width : imageData.height;

  if (typeof OffscreenCanvas === 'undefined') {
    // SSR / Node 环境下不旋转,直接返回原图
    return imageData;
  }
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return imageData;

  // 源图先翻转到临时画布
  const src = new OffscreenCanvas(imageData.width, imageData.height);
  const srcCtx = src.getContext('2d');
  if (!srcCtx) return imageData;
  srcCtx.putImageData(imageData, 0, 0);

  ctx.save();
  if (flipX) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(src, -imageData.width / 2, -imageData.height / 2);
  ctx.restore();

  return ctx.getImageData(0, 0, w, h);
}
