// 校验 data/makeup-rules/*.json 的合法性:
// 1) JSON 全部可解析
// 2) overlayZones 值都在 types.ts 的 OverlayZone 联合类型中
// 3) looks 包含 3 套,每套 >= 7 步
// 4) skin-tone-guide 覆盖所有 SkinTone 枚举值

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data', 'makeup-rules');

// 引入类型只用于 type-check,不参与运行
type OverlayZone =
  | 'forehead'  | 't_zone'     | 'u_zone'
  | 'left_cheek'| 'right_cheek'| 'chin'
  | 'left_eye'  | 'right_eye'  | 'left_eyelid' | 'right_eyelid'
  | 'inner_corner_l' | 'inner_corner_r' | 'outer_corner_l' | 'outer_corner_r'
  | 'crease_l'  | 'crease_r'
  | 'left_brow' | 'right_brow' | 'brow_tail_l' | 'brow_tail_r'
  | 'nose_bridge' | 'nose_tip' | 'nose_sides'
  | 'upper_lip' | 'lower_lip' | 'lip_line'
  | 'left_highlight' | 'right_highlight' | 'cupid_bow';

const VALID_ZONES = new Set<OverlayZone>([
  'forehead', 't_zone', 'u_zone',
  'left_cheek', 'right_cheek', 'chin',
  'left_eye', 'right_eye', 'left_eyelid', 'right_eyelid',
  'inner_corner_l', 'inner_corner_r', 'outer_corner_l', 'outer_corner_r',
  'crease_l', 'crease_r',
  'left_brow', 'right_brow', 'brow_tail_l', 'brow_tail_r',
  'nose_bridge', 'nose_tip', 'nose_sides',
  'upper_lip', 'lower_lip', 'lip_line',
  'left_highlight', 'right_highlight', 'cupid_bow',
]);

const ALL_SKIN_TONES = [
  'cool_fair', 'cool_medium',
  'neutral_fair', 'neutral_medium',
  'warm_fair', 'warm_medium', 'warm_deep', 'warm_deep_dark',
];

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(dataDir, name), 'utf-8'));
}

describe('data/makeup-rules — JSON 解析 + 字段合法性', () => {
  it('所有 6 个 JSON 文件都能解析', () => {
    for (const f of [
      'face-shapes.json', 'eye-types.json', 'skin-tone-guide.json',
      'looks.json', 'tutorial-steps.json', 'product-families.json',
    ]) {
      expect(() => readJson(f)).not.toThrow();
    }
  });

  it('looks.json: 3 套妆容,每套 >= 7 步', () => {
    const data = readJson('looks.json') as { looks: Array<{ id: string; steps: unknown[] }> };
    expect(data.looks.length).toBeGreaterThanOrEqual(3);
    for (const look of data.looks) {
      expect(look.steps.length).toBeGreaterThanOrEqual(7);
    }
  });

  it('skin-tone-guide.json: 覆盖所有 8 种肤色', () => {
    const data = readJson('skin-tone-guide.json') as { tones: Array<{ id: string }> };
    const ids = new Set(data.tones.map((t) => t.id));
    for (const tone of ALL_SKIN_TONES) {
      expect(ids.has(tone)).toBe(true);
    }
  });

  it('looks.json: 所有 overlayZones 都是合法值', () => {
    const data = readJson('looks.json') as {
      looks: Array<{ id: string; steps: Array<{ overlayZones?: string[] }> }>;
    };
    for (const look of data.looks) {
      for (const step of look.steps) {
        for (const z of step.overlayZones ?? []) {
          expect(VALID_ZONES.has(z as OverlayZone)).toBe(true);
        }
      }
    }
  });

  it('tutorial-steps.json: 所有 overlayZones 都是合法值', () => {
    const data = readJson('tutorial-steps.json') as {
      tutorialSteps: Array<{ overlayZones?: string[] }>;
    };
    for (const ts of data.tutorialSteps) {
      for (const z of ts.overlayZones ?? []) {
        expect(VALID_ZONES.has(z as OverlayZone)).toBe(true);
      }
    }
  });

  it('product-families.json: 覆盖所有 8 种肤色', () => {
    const data = readJson('product-families.json') as {
      families: { foundation: Record<string, unknown> };
    };
    for (const tone of ALL_SKIN_TONES) {
      expect(data.families.foundation[tone]).toBeDefined();
    }
  });
});
