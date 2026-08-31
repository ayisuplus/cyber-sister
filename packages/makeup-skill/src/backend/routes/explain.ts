// 妆教解释只接收规范化特征标签和 lookId。原始图片永不离开浏览器。
// Makeup 不持有模型配置：登录用户的规范化请求交给主 API 统一执行本地优先路由；
// 未登录、主 API 不可用或响应不合法时返回透明标识的确定性本地模板。

import { Router } from 'express';
import type { EyeType, FaceFeatures, FaceShape, MakeupLook, SkinTone } from '../../shared/types';
import { config } from '../config.js';
import { loadLooks } from './_looks.js';
import { recommendLooks } from './recommend.js';

export const explainRouter = Router();

export const MAIN_API_TIMEOUT_MS = 65_000;
const EXPLAIN_SOURCES = new Set(['local_model', 'qwen', 'local_template']);
type ExplainSource = 'local_model' | 'qwen' | 'local_template';

const FACE_SHAPES = new Set<FaceShape>([
  'oval',
  'round',
  'square',
  'heart',
  'long',
  'diamond',
  'unknown',
]);
const SKIN_TONES = new Set<SkinTone>([
  'cool_fair',
  'cool_medium',
  'neutral_fair',
  'neutral_medium',
  'warm_fair',
  'warm_medium',
  'warm_deep',
  'warm_deep_dark',
  'unknown',
]);
const EYE_TYPES = new Set<EyeType>([
  'almond',
  'round',
  'hooded',
  'monolid',
  'downturned',
  'upturned',
  'close_set',
  'wide_set',
  'unknown',
]);

function trimToCodePoints(value: string, max: number): string {
  return Array.from(value.trim().replace(/\s+/g, ' ')).slice(0, max).join('');
}

function toFeatures(input: unknown): FaceFeatures | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = input as Record<string, unknown>;
  if (
    Object.keys(candidate).length !== 3 ||
    !Object.hasOwn(candidate, 'faceShape') ||
    !Object.hasOwn(candidate, 'skinTone') ||
    !Object.hasOwn(candidate, 'eyeType')
  )
    return null;
  const faceShape = candidate.faceShape;
  const skinTone = candidate.skinTone;
  const eyeType = candidate.eyeType;
  if (
    typeof faceShape !== 'string' ||
    !FACE_SHAPES.has(faceShape as FaceShape) ||
    typeof skinTone !== 'string' ||
    !SKIN_TONES.has(skinTone as SkinTone) ||
    typeof eyeType !== 'string' ||
    !EYE_TYPES.has(eyeType as EyeType)
  )
    return null;

  return {
    upperThirdRatio: 0,
    middleThirdRatio: 0,
    lowerThirdRatio: 0,
    fiveEyeFit: 0,
    faceShape: faceShape as FaceShape,
    skinTone: skinTone as SkinTone,
    eyeType: eyeType as EyeType,
    noseType: 'unknown',
    eyeDistanceRatio: 0,
    faceWidthHeightRatio: 0,
    lipFullnessRatio: 0,
    browArchAngle: 0,
    noseBridgeWidth: 0,
    confidence: 0,
  };
}

function deterministicReason(features: FaceFeatures, look: MakeupLook): string {
  const hit = recommendLooks(features, 10).find((item) => item.look.id === look.id);
  return trimToCodePoints(hit?.reason ?? look.reason, 50);
}

function normalizedFeatures(features: FaceFeatures) {
  return {
    faceShape: features.faceShape,
    skinTone: features.skinTone,
    eyeType: features.eyeType,
  };
}

async function requestMainApiExplanation(
  features: FaceFeatures,
  lookId: string,
  authorization: string | undefined,
  requestId: string,
): Promise<{ explanation: string; source: ExplainSource } | null> {
  if (!authorization?.startsWith('Bearer ')) return null;

  try {
    const baseUrl = config.mainApiInternalUrl.replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}/api/llm/explain`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
      body: JSON.stringify({ features: normalizedFeatures(features), lookId }),
      signal: AbortSignal.timeout(MAIN_API_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const raw = (await response.json()) as Record<string, unknown>;
    if (typeof raw.explanation !== 'string' || typeof raw.source !== 'string') return null;
    if (!EXPLAIN_SOURCES.has(raw.source)) return null;

    const explanation = trimToCodePoints(raw.explanation, 50);
    if (!explanation) return null;
    return { explanation, source: raw.source as ExplainSource };
  } catch {
    return null;
  }
}

explainRouter.post('/explain', async (req, res) => {
  if (
    !req.body ||
    typeof req.body !== 'object' ||
    Array.isArray(req.body) ||
    Object.keys(req.body as Record<string, unknown>).length !== 2 ||
    !Object.hasOwn(req.body as object, 'features') ||
    !Object.hasOwn(req.body as object, 'lookId')
  ) {
    res.status(400).json({ error: 'INVALID_EXPLAIN_REQUEST' });
    return;
  }

  const body = req.body as { features?: unknown; lookId?: unknown };
  const features = toFeatures(body.features);
  const look =
    typeof body.lookId === 'string' ? loadLooks().find((item) => item.id === body.lookId) : null;
  if (!features || !look) {
    res.status(400).json({ error: 'INVALID_EXPLAIN_REQUEST' });
    return;
  }

  const fallback = deterministicReason(features, look);
  const result = await requestMainApiExplanation(
    features,
    look.id,
    req.get('authorization'),
    req.id,
  );
  res.json(result ?? { explanation: fallback, source: 'local_template' });
});
