// 妆容推荐引擎 — 确定性评分.
// 输入: FaceFeatures → 输出: 排序后的 top 3 MakeupLook + 评分理由.
// 规则: suitableFor 匹配 +分,avoidFor 匹配 -分,unknown 视为中性不加分.
// 排序: 总分降序,平局时按 look.id 字典序 (保证确定性).

import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { FaceFeatures, MakeupLook } from '../../shared/types';

// ---------- 数据加载 (启动时读一次,缓存到内存) ----------

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', '..', 'data', 'makeup-rules');

function loadLooks(): MakeupLook[] {
  const raw = JSON.parse(
    readFileSync(join(DATA_DIR, 'looks.json'), 'utf-8')
  ) as { looks: MakeupLook[] };
  return raw.looks;
}

const LOOKS: MakeupLook[] = loadLooks();

// ---------- 评分 ----------

interface ScoredLook {
  look: MakeupLook;
  score: number;
  matchedTags: string[];
  avoidHits: string[];
  reason: string;
}

// 加分 / 减分权重
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
  avoid: string[]
): string {
  // 兜底:任何特征都是 unknown
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
  const scored = LOOKS.map((l) => scoreLook(l, features));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.look.id.localeCompare(b.look.id);
  });
  return scored.slice(0, topN);
}

// ---------- HTTP 路由 ----------

export const recommendRouter = Router();

recommendRouter.post('/recommend', (req, res) => {
  const features = req.body as FaceFeatures;
  if (!features || typeof features !== 'object') {
    res.status(400).json({ error: 'missing features' });
    return;
  }
  // 兜底:缺少字段时用 unknown,确保不会抛
  // 用 Object.assign 避免 TS 6.0 把 spread 与字面量键视为"显式重复"
  const safe: FaceFeatures = Object.assign(
    {
      upperThirdRatio: 0,
      middleThirdRatio: 0,
      lowerThirdRatio: 0,
      fiveEyeFit: 0,
      faceShape: 'unknown' as const,
      skinTone: 'unknown' as const,
      eyeType: 'unknown' as const,
      noseType: 'unknown' as const,
      eyeDistanceRatio: 0,
      faceWidthHeightRatio: 0,
      lipFullnessRatio: 0,
      browArchAngle: 0,
      noseBridgeWidth: 0,
      confidence: 0,
    },
    features
  );
  const results = recommendLooks(safe, 3);
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
