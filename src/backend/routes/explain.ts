// 解释路由 — T12 LLM 增强的占位实现.
// 当前直接复用 recommender 的确定性 reason,后续接 LLM 时只改这一个文件.

import { Router } from 'express';
import type { FaceFeatures, MakeupLook } from '../../shared/types';
import { recommendLooks } from './recommend';

export const explainRouter = Router();

explainRouter.post('/explain', (req, res) => {
  const { features, look } = req.body as {
    features?: FaceFeatures;
    look?: MakeupLook;
  };
  if (!features || !look) {
    res.status(400).json({ error: 'missing features or look' });
    return;
  }
  // 占位: 直接给一个温暖的中文短句,固定不变 (确定性)
  const safe: FaceFeatures = {
    upperThirdRatio: 0,
    middleThirdRatio: 0,
    lowerThirdRatio: 0,
    fiveEyeFit: 0,
    faceShape: 'unknown',
    skinTone: 'unknown',
    eyeType: 'unknown',
    noseType: 'unknown',
    eyeDistanceRatio: 0,
    faceWidthHeightRatio: 0,
    lipFullnessRatio: 0,
    browArchAngle: 0,
    noseBridgeWidth: 0,
    confidence: 0,
    ...features,
  };
  // 复用 recommendLooks 拿 reason
  const all = recommendLooks(safe, 10);
  const hit = all.find((r) => r.look.id === look.id);
  res.json({
    explanation: hit?.reason ?? `${look.name} 适合 ${look.scenario},新手友好。`,
  });
});
