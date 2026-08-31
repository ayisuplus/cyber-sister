// 妆容推荐引擎 — 确定性评分.
// 输入: FaceFeatures → 输出: 排序后的 top 3 MakeupLook + 评分理由.
// 规则: suitableFor 匹配 +分,avoidFor 匹配 -分,unknown 视为中性不加分.
// 排序: 总分降序,平局时按 look.id 字典序 (保证确定性).

import { Router } from 'express';
import type { FaceFeatures, MakeupLook } from '../../shared/types';
import { validateBody, type Schema } from '../middleware/validate.js';
import { loadLooks } from './_looks.js';

// ---------- FaceFeatures schema (所有字段都 optional,缺省回 unknown) ----------
const FACE_SHAPES = ['oval', 'round', 'square', 'heart', 'long', 'diamond', 'unknown'] as const;
const SKIN_TONES = [
  'cool_fair',
  'cool_medium',
  'neutral_fair',
  'neutral_medium',
  'warm_fair',
  'warm_medium',
  'warm_deep',
  'warm_deep_dark',
  'unknown',
] as const;
const EYE_TYPES = [
  'almond',
  'round',
  'hooded',
  'monolid',
  'downturned',
  'upturned',
  'close_set',
  'wide_set',
  'unknown',
] as const;
const NOSE_TYPES = [
  'straight',
  'wide_bridge',
  'narrow_bridge',
  'bulbus_tip',
  'upturned',
  'hooked',
  'unknown',
] as const;

const featureSchema: Schema = {
  faceShape: { type: 'enum', values: FACE_SHAPES },
  skinTone: { type: 'enum', values: SKIN_TONES },
  eyeType: { type: 'enum', values: EYE_TYPES },
  noseType: { type: 'enum', values: NOSE_TYPES },
  upperThirdRatio: { type: 'number', ge: 0, le: 1 },
  middleThirdRatio: { type: 'number', ge: 0, le: 1 },
  lowerThirdRatio: { type: 'number', ge: 0, le: 1 },
  fiveEyeFit: { type: 'number', ge: 0, le: 3 },
  eyeDistanceRatio: { type: 'number', ge: 0, le: 1 },
  faceWidthHeightRatio: { type: 'number', ge: 0, le: 3 },
  lipFullnessRatio: { type: 'number', ge: 0, le: 1 },
  browArchAngle: { type: 'number', ge: 0, le: 180 },
  noseBridgeWidth: { type: 'number', ge: 0, le: 1 },
  confidence: { type: 'number', ge: 0, le: 1 },
};

// ---------- 数据加载 ----------
// 统一走 _looks.ts 的 loadLooks() (带缓存 + resetLooksCache 测试钩子),
// 不再各自为政地模块级自读 looks.json.

// ---------- 评分 ----------
interface ScoredLook {
  look: MakeupLook;
  score: number;
  matchedTags: string[];
  avoidHits: string[];
  reason: string;
}

const WEIGHT_MATCH = 3;
const WEIGHT_AVOID = -4;

/**
 * 单个 tag 是否匹配 (支持前缀: "cool" 匹配 "cool_fair" / "cool_medium").
 * 已知特征必须严格匹配;unknown 视为中性,不进 matchedTags.
 */
function tagMatches(feature: string, tag: string): boolean {
  if (feature === 'unknown' || feature === '') return false;
  return feature === tag || feature.startsWith(tag + '_') || tag.startsWith(feature + '_');
}

function scoreLook(look: MakeupLook, features: FaceFeatures): ScoredLook {
  const matched: string[] = [];
  const avoidHits: string[] = [];
  let score = 0;

  const userTags: Array<[string, string]> = [
    ['faceShape', features.faceShape],
    ['eyeType', features.eyeType],
    ['skinTone', features.skinTone],
  ];

  for (const [label, value] of userTags) {
    for (const tag of look.suitableFor) {
      if (tagMatches(value, tag)) {
        score += WEIGHT_MATCH;
        matched.push(`${label}=${value}`);
      }
    }
    for (const tag of look.avoidFor ?? []) {
      if (tagMatches(value, tag)) {
        score += WEIGHT_AVOID;
        avoidHits.push(`${label}=${value}`);
      }
    }
  }

  return {
    look,
    score,
    matchedTags: matched,
    avoidHits,
    reason: buildReason(look, features, matched, avoidHits),
  };
}

/**
 * 用确定性规则生成中文推荐理由.
 * 优先:命中标签数 > 避免命中数 → "适合";完全没匹配 → "初学者友好".
 */
function buildReason(
  look: MakeupLook,
  features: FaceFeatures,
  matched: string[],
  avoid: string[],
): string {
  const allUnknown =
    features.faceShape === 'unknown' &&
    features.eyeType === 'unknown' &&
    features.skinTone === 'unknown';

  if (allUnknown) {
    return `${look.scenario}通用款,新手友好,先从 ${look.name} 开始。`;
  }
  if (avoid.length > matched.length) {
    return `你的特征跟 ${look.name} 的常见冲突较多 (${avoid.join('、')}),可以先看其他推荐。`;
  }
  if (matched.length === 0) {
    return `${look.scenario}通用款,与你的五官没有明显冲突,适合入门练习。`;
  }
  return `匹配你的 ${matched.join('、')},适合 ${look.scenario} 场景。`;
}

/**
 * 公开 API: 评分 + 排序 + 取 top N.
 * 排序键: score desc, look.id asc (确定性).
 */
export function recommendLooks(features: FaceFeatures, topN = 3): ScoredLook[] {
  const scored = loadLooks().map((l) => scoreLook(l, features));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.look.id.localeCompare(b.look.id);
  });
  return scored.slice(0, topN);
}

// 把"外部输入 + 缺省"合成 FaceFeatures.中间件已通过 schema 校验字段类型.
function toFaceFeatures(input: Record<string, unknown>): FaceFeatures {
  const num = (k: keyof FaceFeatures): number => {
    const v = input[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };
  const en = <T extends string>(k: keyof FaceFeatures, allowed: readonly T[], fb: T): T => {
    const v = input[k];
    return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fb;
  };
  return {
    upperThirdRatio: num('upperThirdRatio'),
    middleThirdRatio: num('middleThirdRatio'),
    lowerThirdRatio: num('lowerThirdRatio'),
    fiveEyeFit: num('fiveEyeFit'),
    faceShape: en('faceShape', FACE_SHAPES, 'unknown'),
    skinTone: en('skinTone', SKIN_TONES, 'unknown'),
    eyeType: en('eyeType', EYE_TYPES, 'unknown'),
    noseType: en('noseType', NOSE_TYPES, 'unknown'),
    eyeDistanceRatio: num('eyeDistanceRatio'),
    faceWidthHeightRatio: num('faceWidthHeightRatio'),
    lipFullnessRatio: num('lipFullnessRatio'),
    browArchAngle: num('browArchAngle'),
    noseBridgeWidth: num('noseBridgeWidth'),
    confidence: num('confidence'),
  };
}
// ---------- HTTP 路由 ----------
export const recommendRouter = Router();
recommendRouter.post('/recommend', validateBody(featureSchema), (req, res) => {
  // 显式 null body → 400 (validateBody 视 null 为 {} 通过)
  if (req.body === null || req.body === undefined) {
    res.status(400).json({ error: 'missing body' });
    return;
  }
  const input = req.body as Record<string, unknown>;
  const features = toFaceFeatures(input);
  const results = recommendLooks(features, 3);
  res.json({
    looks: results.map((r) => r.look),
    scores: results.map((r) => ({
      lookId: r.look.id,
      score: r.score,
      matched: r.matchedTags,
      avoid: r.avoidHits,
      reason: r.reason,
    })),
  });
});
