// 关键点提取的纯逻辑测试 — 不依赖 MediaPipe 真实模型.
// 覆盖新加的 toSharedLandmarks + FACE_LANDMARK_COUNT 等小工具.

import { describe, it, expect } from 'vitest';
import { toSharedLandmarks, FACE_LANDMARK_COUNT } from '../src/frontend/face/landmarks';
import type { Landmark } from '../src/shared/faceFeatures';

describe('landmarks — 适配器', () => {
  it('toSharedLandmarks 保持 xyz 顺序', () => {
    const input = [
      { x: 0.1, y: 0.2, z: 0.3 },
      { x: 0.4, y: 0.5, z: 0.6 },
    ];
    const out: Landmark[] = toSharedLandmarks(input);
    expect(out).toEqual([
      { x: 0.1, y: 0.2, z: 0.3 },
      { x: 0.4, y: 0.5, z: 0.6 },
    ]);
  });

  it('空输入 → 空数组', () => {
    expect(toSharedLandmarks([])).toEqual([]);
  });

  it('FACE_LANDMARK_COUNT === 478 (MediaPipe FaceLandmarker 标准)', () => {
    expect(FACE_LANDMARK_COUNT).toBe(478);
  });
});
