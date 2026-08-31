// MediaPipe 归一化坐标 (0..1) ↔ Canvas 像素坐标映射.
// Canvas 通常与图片宽高比不一致,需要等比缩放居中.
// 同时提供 OverlayZone → 关键点索引 → Canvas 坐标的端到端映射,
// 让上层 (MakeupCanvas) 只需要关心"画哪个区域",不用关心关键点索引细节.

import type { OverlayZone } from '../../shared/types';
import { ZONE_DEFINITIONS, getZoneDef, type ZoneDefinition } from './overlayZones';

/**
 * 描述图片在 Canvas 上的显示布局.
 * imageX/Y 是图片左上角在 Canvas 里的像素偏移 (用于居中显示).
 * imageWidth/Height 是缩放后图片在 Canvas 上的实际像素尺寸.
 */
export interface CanvasLayout {
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}

// ---------- 基础布局计算 ----------

/**
 * 等比缩放图片到 Canvas 中并居中.返回布局,后续用 layout 转换坐标.
 * 任一维度为 0 或负时返回零尺寸布局,避免除零.
 */
export function computeCanvasLayout(
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): CanvasLayout {
  if (imageWidth <= 0 || imageHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) {
    return {
      imageX: 0,
      imageY: 0,
      imageWidth: 0,
      imageHeight: 0,
      canvasWidth,
      canvasHeight,
    };
  }
  // 等比缩放:取较小的比例,确保图片完整显示
  const scale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const displayW = imageWidth * scale;
  const displayH = imageHeight * scale;
  return {
    imageX: (canvasWidth - displayW) / 2,
    imageY: (canvasHeight - displayH) / 2,
    imageWidth: displayW,
    imageHeight: displayH,
    canvasWidth,
    canvasHeight,
  };
}

/**
 * 缩放 + 居中(自定义对齐):用于非"contain"场景,例如"cover"或固定偏移.
 * 不做旋转,只做仿射变换.
 */
export function mapLandmarkToCanvas(
  landmark: { x: number; y: number },
  layout: CanvasLayout,
): { x: number; y: number } {
  return {
    x: layout.imageX + landmark.x * layout.imageWidth,
    y: layout.imageY + landmark.y * layout.imageHeight,
  };
}

/**
 * 批量映射.输入归一化坐标数组,返回 Canvas 像素坐标数组.
 */
export function mapLandmarksToCanvas(
  landmarks: ReadonlyArray<{ x: number; y: number }>,
  layout: CanvasLayout,
): Array<{ x: number; y: number }> {
  return landmarks.map((lm) => mapLandmarkToCanvas(lm, layout));
}

// ---------- OverlayZone 映射 ----------

/**
 * MediaPipe 478 个归一化关键点的简化形态.
 * 关键点数组必须按 MediaPipe Face Landmarker 的顺序排列(下标 0..477).
 */
export type NormalizedLandmarks = ReadonlyArray<{ x: number; y: number; z?: number }>;

/**
 * 取某个 OverlayZone 在 MediaPipe 中的关键点索引列表.
 * 未注册区域返回 null.供上层做 fallback 处理.
 */
export function getZoneLandmarkIndices(zone: OverlayZone): number[] | null {
  return getZoneDef(zone)?.landmarks ?? null;
}

/**
 * 把一个 OverlayZone 内的所有关键点批量映射到 Canvas 坐标.
 * 关键点缺失(越界)会被跳过,不抛错.
 *
 * @param zone 妆教覆盖区域
 * @param landmarks MediaPipe 478 个归一化关键点
 * @param layout Canvas 布局
 * @returns Canvas 像素坐标数组 (已映射);失败返回 null
 */
export function mapZoneToCanvas(
  zone: OverlayZone,
  landmarks: NormalizedLandmarks,
  layout: CanvasLayout,
): Array<{ x: number; y: number }> | null {
  const indices = getZoneLandmarkIndices(zone);
  if (!indices) return null;
  const points: Array<{ x: number; y: number }> = [];
  for (const idx of indices) {
    const lm = landmarks[idx];
    if (!lm) continue;
    points.push(mapLandmarkToCanvas(lm, layout));
  }
  return points;
}

/**
 * 计算区域在 Canvas 上的几何中心.
 * - polygon:取所有顶点映射后坐标的均值中心
 * - ellipse:用 ZoneDefinition.center 指定的归一化关键点
 */
export function getZoneCenterOnCanvas(
  zone: OverlayZone,
  landmarks: NormalizedLandmarks,
  layout: CanvasLayout,
): { x: number; y: number } | null {
  const def = getZoneDef(zone);
  if (!def) return null;
  if (def.shape === 'ellipse') {
    if (def.center === undefined) return null;
    const lm = landmarks[def.center];
    if (!lm) return null;
    return mapLandmarkToCanvas(lm, layout);
  }
  // polygon:取映射顶点的均值中心
  const points: Array<{ x: number; y: number }> = [];
  for (const idx of def.landmarks) {
    const lm = landmarks[idx];
    if (lm) points.push(mapLandmarkToCanvas(lm, layout));
  }
  if (points.length === 0) return null;
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  return { x: sumX / points.length, y: sumY / points.length };
}

/**
 * 计算区域在 Canvas 上的半径(像素,椭圆用).
 * 基础半径 = 该区域关键点归一化坐标到中心的平均距离 × imageWidth × radiusFactor.
 * - polygon:返回 null(用其他方式绘制)
 * - ellipse:返回 { rx, ry } 默认用同一半径;若需要按人脸长宽比可扩展.
 */
export function getZoneRadiusOnCanvas(
  zone: OverlayZone,
  landmarks: NormalizedLandmarks,
  layout: CanvasLayout,
  radiusFactorOverride?: number,
): { rx: number; ry: number } | null {
  const def = getZoneDef(zone);
  if (!def || def.shape !== 'ellipse') return null;
  if (def.center === undefined) return null;
  const center = landmarks[def.center];
  if (!center) return null;
  // 平均归一化距离
  let sumDist = 0;
  let count = 0;
  for (const idx of def.landmarks) {
    const lm = landmarks[idx];
    if (!lm) continue;
    const dx = lm.x - center.x;
    const dy = lm.y - center.y;
    sumDist += Math.hypot(dx, dy);
    count++;
  }
  if (count === 0) return null;
  const avgNorm = sumDist / count;
  const factor = radiusFactorOverride ?? def.radiusFactor ?? 0.7;
  const rNorm = avgNorm * factor;
  // 把归一化半径转 Canvas 像素:等比缩放时用 imageWidth/Height
  const rx = rNorm * layout.imageWidth;
  const ry = rNorm * layout.imageHeight;
  return { rx, ry };
}

/**
 * 一站式:取一个 OverlayZone 在 Canvas 上的完整绘制信息.
 * 包含:形状、Canvas 像素顶点/中心、半径、原始定义、颜色.
 * 上层拿到这个就能直接画 polygon/ellipse.
 */
export interface ZoneDrawInfo {
  zone: OverlayZone;
  definition: ZoneDefinition;
  shape: 'polygon' | 'ellipse';
  /** polygon 顶点 / ellipse 中心 (Canvas 像素). */
  points: Array<{ x: number; y: number }>;
  /** ellipse 半径 (Canvas 像素);polygon 为 null. */
  radius: { rx: number; ry: number } | null;
  color: string;
}

export function getZoneDrawInfo(
  zone: OverlayZone,
  landmarks: NormalizedLandmarks,
  layout: CanvasLayout,
): ZoneDrawInfo | null {
  const def = getZoneDef(zone);
  if (!def) return null;
  const points = mapZoneToCanvas(zone, landmarks, layout);
  if (!points || points.length === 0) return null;
  return {
    zone,
    definition: def,
    shape: def.shape,
    points,
    radius: def.shape === 'ellipse' ? getZoneRadiusOnCanvas(zone, landmarks, layout) : null,
    color: def.color,
  };
}

/**
 * 批量:把多个 OverlayZone 一次转成绘制信息.失败/缺失的 zone 被跳过.
 * MakeupCanvas 在每一步拿到 currentZones 后,调这个一次拿全部绘制数据.
 */
export function mapZonesToDrawInfo(
  zones: ReadonlyArray<OverlayZone>,
  landmarks: NormalizedLandmarks,
  layout: CanvasLayout,
): ZoneDrawInfo[] {
  const result: ZoneDrawInfo[] = [];
  for (const z of zones) {
    const info = getZoneDrawInfo(z, landmarks, layout);
    if (info) result.push(info);
  }
  return result;
}

// 暴露给外部按需引用 ZONE_DEFINITIONS,避免上层再 import 一次
export { ZONE_DEFINITIONS, getZoneDef };
export type { ZoneDefinition };
