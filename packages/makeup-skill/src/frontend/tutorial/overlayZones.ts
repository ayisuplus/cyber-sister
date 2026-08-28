// 妆教覆盖区域定义 — 每个 OverlayZone 映射到 MediaPipe 关键点索引.
// polygon 用顶点绘制贝塞尔闭合;ellipse 用中心 + 半径绘制椭圆.
// MediaPipe Face Landmarker 共 478 点,关键点索引见:
//   https://github.com/google/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png

import type { OverlayZone } from '../../shared/types';

export type ZoneShape = 'polygon' | 'ellipse';

export interface ZoneDefinition {
  /** MediaPipe 关键点索引集合 (多边形顶点 / 椭圆采样点). */
  landmarks: number[];
  shape: ZoneShape;
  /**
   * 对该区域的几何中心 (归一化关键点索引).ellipse 必须,polygon 可选
   * (不指定时取 landmarks 包围盒中心).
   */
  center?: number;
  /**
   * 椭圆半径归一化系数 — 以"landmark 索引集合到中心的平均距离"为基线 × 该系数.
   * 默认 0.7,需要更大的圈就调大.
   */
  radiusFactor?: number;
  /** UI 显示色 (RGBA,绘制时直接用). */
  color: string;
}

export const ZONE_DEFINITIONS: Record<OverlayZone, ZoneDefinition> = {
  // ----- 额头 + T/U 区 -----
  forehead: {
    landmarks: [10, 151, 9, 8, 168, 6],
    shape: 'polygon',
    color: 'rgba(255, 200, 220, 0.6)',
  },
  t_zone: {
    landmarks: [10, 151, 6, 2, 168],
    shape: 'polygon',
    color: 'rgba(255, 220, 200, 0.6)',
  },
  u_zone: {
    landmarks: [127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152],
    shape: 'polygon',
    color: 'rgba(255, 220, 200, 0.6)',
  },

  // ----- 脸颊 (左 / 右) -----
  left_cheek: {
    landmarks: [117, 123, 187, 207, 216, 192],
    shape: 'polygon',
    color: 'rgba(255, 180, 200, 0.6)',
  },
  right_cheek: {
    landmarks: [346, 352, 411, 427, 436, 416],
    shape: 'polygon',
    color: 'rgba(255, 180, 200, 0.6)',
  },
  chin: {
    landmarks: [172, 136, 150, 149, 176, 148, 152],
    shape: 'polygon',
    color: 'rgba(255, 200, 220, 0.6)',
  },

  // ----- 眼部 -----
  left_eye: {
    landmarks: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157],
    shape: 'polygon',
    color: 'rgba(200, 220, 255, 0.6)',
  },
  right_eye: {
    landmarks: [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388],
    shape: 'polygon',
    color: 'rgba(200, 220, 255, 0.6)',
  },
  left_eyelid: {
    landmarks: [33, 159, 158, 133, 243, 249],
    shape: 'polygon',
    color: 'rgba(180, 200, 255, 0.6)',
  },
  right_eyelid: {
    landmarks: [362, 386, 385, 263, 359, 467],
    shape: 'polygon',
    color: 'rgba(180, 200, 255, 0.6)',
  },
  inner_corner_l: {
    landmarks: [33, 133, 243],
    shape: 'ellipse',
    center: 133,
    color: 'rgba(200, 200, 255, 0.6)',
  },
  inner_corner_r: {
    landmarks: [362, 263, 359],
    shape: 'ellipse',
    center: 263,
    color: 'rgba(200, 200, 255, 0.6)',
  },
  outer_corner_l: {
    landmarks: [33, 130, 243],
    shape: 'ellipse',
    center: 130,
    color: 'rgba(200, 200, 255, 0.6)',
  },
  outer_corner_r: {
    landmarks: [362, 359, 263],
    shape: 'ellipse',
    center: 359,
    color: 'rgba(200, 200, 255, 0.6)',
  },
  crease_l: {
    landmarks: [33, 130, 160, 158, 133],
    shape: 'polygon',
    color: 'rgba(220, 200, 255, 0.6)',
  },
  crease_r: {
    landmarks: [362, 359, 384, 385, 263],
    shape: 'polygon',
    color: 'rgba(220, 200, 255, 0.6)',
  },

  // ----- 眉 -----
  left_brow: {
    landmarks: [55, 107, 66, 105, 63, 70],
    shape: 'polygon',
    color: 'rgba(200, 180, 150, 0.6)',
  },
  right_brow: {
    landmarks: [285, 336, 296, 334, 293, 300],
    shape: 'polygon',
    color: 'rgba(200, 180, 150, 0.6)',
  },
  brow_tail_l: {
    landmarks: [66, 70, 105, 107],
    shape: 'ellipse',
    center: 70,
    color: 'rgba(200, 180, 150, 0.6)',
  },
  brow_tail_r: {
    landmarks: [296, 300, 334, 336],
    shape: 'ellipse',
    center: 300,
    color: 'rgba(200, 180, 150, 0.6)',
  },

  // ----- 鼻 -----
  nose_bridge: {
    landmarks: [6, 168, 197, 195, 2],
    shape: 'polygon',
    color: 'rgba(255, 220, 200, 0.6)',
  },
  nose_tip: {
    landmarks: [1, 2, 4, 5, 6],
    shape: 'ellipse',
    center: 1,
    color: 'rgba(255, 220, 200, 0.6)',
  },
  nose_sides: {
    landmarks: [98, 97, 2, 326, 327, 4],
    shape: 'polygon',
    color: 'rgba(255, 220, 200, 0.6)',
  },

  // ----- 唇 -----
  upper_lip: {
    landmarks: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291],
    shape: 'polygon',
    color: 'rgba(255, 150, 170, 0.6)',
  },
  lower_lip: {
    landmarks: [146, 91, 181, 84, 17, 314, 405, 321, 375, 291],
    shape: 'polygon',
    color: 'rgba(255, 150, 170, 0.6)',
  },
  lip_line: {
    landmarks: [61, 0, 291, 17],
    shape: 'polygon',
    color: 'rgba(255, 130, 150, 0.6)',
  },

  // ----- 高光 + 唇峰 -----
  left_highlight: {
    landmarks: [117, 123, 205, 187],
    shape: 'ellipse',
    center: 117,
    color: 'rgba(255, 250, 200, 0.6)',
  },
  right_highlight: {
    landmarks: [346, 352, 425, 411],
    shape: 'ellipse',
    center: 346,
    color: 'rgba(255, 250, 200, 0.6)',
  },
  cupid_bow: {
    landmarks: [0, 37, 39, 40, 185, 61, 0],
    shape: 'polygon',
    color: 'rgba(255, 200, 200, 0.6)',
  },
};

/**
 * 取某个区域的描述.未注册时返回 null.
 */
export function getZoneDef(zone: OverlayZone): ZoneDefinition | null {
  return ZONE_DEFINITIONS[zone] ?? null;
}
