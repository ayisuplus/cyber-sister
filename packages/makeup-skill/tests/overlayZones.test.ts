// overlayZones 测试 — 区域定义表的结构性契约:
//   - 键集合与 OverlayZone 联合类型一一对应 (少注册一个区域, 上层就会拿到 null)
//   - 每个定义的关键点索引合法 (0..477 整数), shape/color 合法
//   - ellipse 必须有 center 且 center 在自己的 landmarks 里
//   - getZoneDef 命中/未命中行为

import { describe, it, expect } from 'vitest';
import { ZONE_DEFINITIONS, getZoneDef } from '../src/frontend/tutorial/overlayZones';
import type { OverlayZone } from '../src/shared/types';

// 与 src/shared/types.ts 的 OverlayZone 联合类型保持同步.
const ALL_ZONES: OverlayZone[] = [
  'forehead',
  't_zone',
  'u_zone',
  'left_cheek',
  'right_cheek',
  'chin',
  'left_eye',
  'right_eye',
  'left_eyelid',
  'right_eyelid',
  'inner_corner_l',
  'inner_corner_r',
  'outer_corner_l',
  'outer_corner_r',
  'crease_l',
  'crease_r',
  'left_brow',
  'right_brow',
  'brow_tail_l',
  'brow_tail_r',
  'nose_bridge',
  'nose_tip',
  'nose_sides',
  'upper_lip',
  'lower_lip',
  'lip_line',
  'left_highlight',
  'right_highlight',
  'cupid_bow',
];

describe('ZONE_DEFINITIONS — 完整性', () => {
  it('注册的键集合与 OverlayZone 联合类型完全一致', () => {
    expect(Object.keys(ZONE_DEFINITIONS).sort()).toEqual([...ALL_ZONES].sort());
  });

  it('每个区域都有非空关键点 + 合法 shape + RGBA 颜色', () => {
    for (const zone of ALL_ZONES) {
      const def = ZONE_DEFINITIONS[zone];
      expect(def.landmarks.length, `${zone} landmarks 不能为空`).toBeGreaterThan(0);
      expect(['polygon', 'ellipse']).toContain(def.shape);
      expect(def.color, `${zone} color 必须是 rgba()`).toMatch(/^rgba\(/);
    }
  });

  it('所有关键点索引都是 0..477 的整数 (MediaPipe Face Landmarker 共 478 点)', () => {
    for (const zone of ALL_ZONES) {
      for (const idx of ZONE_DEFINITIONS[zone].landmarks) {
        expect(Number.isInteger(idx), `${zone} 含非整数索引 ${idx}`).toBe(true);
        expect(idx, `${zone} 索引 ${idx} 越界`).toBeGreaterThanOrEqual(0);
        expect(idx, `${zone} 索引 ${idx} 越界`).toBeLessThanOrEqual(477);
      }
    }
  });

  it('ellipse 区域必须定义 center, 且 center 是合法索引并出现在自己的 landmarks 里', () => {
    const ellipseZones = ALL_ZONES.filter((z) => ZONE_DEFINITIONS[z].shape === 'ellipse');
    // 确保测试本身不是空转
    expect(ellipseZones.length).toBeGreaterThan(0);
    for (const zone of ellipseZones) {
      const def = ZONE_DEFINITIONS[zone];
      expect(def.center, `${zone} (ellipse) 缺 center`).toBeDefined();
      expect(Number.isInteger(def.center)).toBe(true);
      expect(def.center!).toBeGreaterThanOrEqual(0);
      expect(def.center!).toBeLessThanOrEqual(477);
      expect(def.landmarks, `${zone} center 不在 landmarks 里`).toContain(def.center!);
    }
  });

  it('radiusFactor 如定义则必须为正数', () => {
    for (const zone of ALL_ZONES) {
      const def = ZONE_DEFINITIONS[zone];
      if (def.radiusFactor !== undefined) {
        expect(def.radiusFactor, `${zone} radiusFactor 必须 > 0`).toBeGreaterThan(0);
      }
    }
  });
});

describe('getZoneDef', () => {
  it('已注册区域返回定义本体 (引用相等, 不是副本)', () => {
    expect(getZoneDef('forehead')).toBe(ZONE_DEFINITIONS.forehead);
    expect(getZoneDef('nose_tip')).toBe(ZONE_DEFINITIONS.nose_tip);
  });

  it('未注册区域返回 null (上层据此做 fallback)', () => {
    expect(getZoneDef('not_a_zone' as OverlayZone)).toBeNull();
    expect(getZoneDef('' as OverlayZone)).toBeNull();
  });

  it('代表性定义内容: nose_tip 是 ellipse 且 center=1; cupid_bow 是 polygon', () => {
    expect(getZoneDef('nose_tip')).toMatchObject({ shape: 'ellipse', center: 1 });
    expect(getZoneDef('cupid_bow')?.shape).toBe('polygon');
  });
});
