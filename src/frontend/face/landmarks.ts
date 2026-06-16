// 从 MediaPipe FaceLandmarker 提取 478 个归一化关键点.
// 多人脸时按边界框面积选最大;无脸抛错由上层捕获.

import type { FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';

export interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

export const FACE_LANDMARK_COUNT = 478;

export class NoFaceError extends Error {
  constructor() {
    super('未检测到人脸');
    this.name = 'NoFaceError';
  }
}

/**
 * 转换 MediaPipe 的 NormalizedLandmark 为简化 LandmarkPoint.
 */
function toLandmarkPoints(landmarks: NormalizedLandmark[]): LandmarkPoint[] {
  return landmarks.map((lm) => ({ x: lm.x, y: lm.y, z: lm.z }));
}

/**
 * 多人脸时按"归一化边界框面积"取最大脸.
 * MediaPipe 没有直接给 bbox,这里用所有点的 min/max 估算.
 */
function pickLargestFace(faces: NormalizedLandmark[][]): NormalizedLandmark[] {
  if (faces.length === 1) return faces[0];
  let best = faces[0];
  let bestArea = 0;
  for (const face of faces) {
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const lm of face) {
      if (lm.x < minX) minX = lm.x;
      if (lm.x > maxX) maxX = lm.x;
      if (lm.y < minY) minY = lm.y;
      if (lm.y > maxY) maxY = lm.y;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (area > bestArea) {
      bestArea = area;
      best = face;
    }
  }
  return best;
}

/**
 * 从图片元素提取 478 个归一化关键点.
 * @param landmarker 已加载的 FaceLandmarker
 * @param imageElement HTMLImageElement / HTMLVideoElement / ImageBitmap 等
 * @returns 归一化关键点 (x/y/z 都在 [0,1] / 中心化深度)
 * @throws NoFaceError 检测不到人脸时
 */
export function extractLandmarks(
  landmarker: FaceLandmarker,
  imageElement: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap
): LandmarkPoint[] {
  const result = landmarker.detect(imageElement);
  if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
    throw new NoFaceError();
  }
  const largest = pickLargestFace(result.faceLandmarks);
  if (largest.length < FACE_LANDMARK_COUNT) {
    // 模型不完整,补齐缺失点为 {0,0,0},上层置信度会扣分.
    const filled: LandmarkPoint[] = toLandmarkPoints(largest);
    while (filled.length < FACE_LANDMARK_COUNT) {
      filled.push({ x: 0, y: 0, z: 0 });
    }
    return filled;
  }
  return toLandmarkPoints(largest);
}
