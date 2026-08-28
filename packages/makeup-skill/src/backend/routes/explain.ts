// LLM 解释层 — 调用 OpenAI 兼容 API 生成温暖的中文推荐理由.
// 失败 / 超时 (3s) 时 fallback 到 look.reason 或 recommend 的确定性 reason.
// 环境变量: LLM_API_URL (默认 OpenAI), LLM_API_KEY, LLM_MODEL (默认 gpt-4o-mini).

import { Router } from 'express';
import type { FaceFeatures, MakeupLook } from '../../shared/types';
import { recommendLooks } from './recommend';

export const explainRouter = Router();

const LLM_TIMEOUT_MS = 3000;
const LLM_API_URL = process.env.LLM_API_URL ?? 'https://api.openai.com/v1/chat/completions';
const LLM_API_KEY = process.env.LLM_API_KEY ?? '';
const LLM_MODEL = process.env.LLM_MODEL ?? 'gpt-4o-mini';

const PROMPT = `你是一位温柔的美妆老师。根据用户的脸型和肤质，用一句话解释为什么这款妆容适合她。
不要提及医疗诊断，不要保证变美，要具体说化妆技巧。不超过50个字。
脸型：{faceShape}，肤色：{skinTone}，妆容：{lookName}`;

const FACE_CN: Record<string, string> = {
  oval: '椭圆脸',
  round: '圆脸',
  square: '方脸',
  heart: '心形脸',
  long: '长脸',
  diamond: '菱形脸',
  unknown: '未知',
};
const TONE_CN: Record<string, string> = {
  cool_fair: '冷白皮',
  cool_medium: '冷调肤色',
  neutral_fair: '中性一白',
  neutral_medium: '中性肤色',
  warm_fair: '暖白皮',
  warm_medium: '暖黄皮',
  warm_deep: '暖深色',
  warm_deep_dark: '暖深色',
  unknown: '未知',
};

function buildPrompt(features: FaceFeatures, look: MakeupLook): string {
  return PROMPT.replace('{faceShape}', FACE_CN[features.faceShape] ?? '未知')
    .replace('{skinTone}', TONE_CN[features.skinTone] ?? '未知')
    .replace('{lookName}', look.name);
}

function deterministicReason(features: FaceFeatures, look: MakeupLook): string {
  // 复用 recommend 的 reason;找不到就回 look.reason
  const all = recommendLooks(features, 10);
  const hit = all.find((r) => r.look.id === look.id);
  return hit?.reason ?? look.reason;
}

async function callLlm(prompt: string): Promise<string | null> {
  if (!LLM_API_KEY) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 120,
        temperature: 0.7,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    // 截断到 60 个汉字 (留余量,UI 层会再处理)
    return text.length > 120 ? text.slice(0, 120) : text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

explainRouter.post('/explain', async (req, res) => {
  const { features, look } = req.body as {
    features?: FaceFeatures;
    look?: MakeupLook;
  };
  if (!features || !look) {
    res.status(400).json({ error: 'missing features or look' });
    return;
  }
  // 兜底:与 recommend.ts 同款,改用 Object.assign 规避 TS 6.0 重复键检查
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
    features,
  );
  const prompt = buildPrompt(safe, look);
  const llmText = await callLlm(prompt);
  const explanation = llmText ?? deterministicReason(safe, look);
  res.json({
    explanation,
    source: llmText ? 'llm' : 'fallback',
  });
});
