// ResultCard 单元测试 — 覆盖闺蜜种草文案与复制反馈.
// 文案函数是纯函数,可以直接 import 测试;组件部分测试关键渲染分支.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ResultCard, { buildXiaohongshuText } from '../src/frontend/result/ResultCard';
import type { FaceFeatures, MakeupLook, MakeupStep } from '../src/shared/types';

// ---------- 测试夹具 ----------

function baseFeatures(over: Partial<FaceFeatures> = {}): FaceFeatures {
  return {
    upperThirdRatio: 0.33,
    middleThirdRatio: 0.34,
    lowerThirdRatio: 0.33,
    fiveEyeFit: 1.0,
    faceShape: 'oval',
    skinTone: 'cool_fair',
    eyeType: 'almond',
    noseType: 'straight',
    eyeDistanceRatio: 0.4,
    faceWidthHeightRatio: 0.8,
    lipFullnessRatio: 0.3,
    browArchAngle: 15,
    noseBridgeWidth: 0.2,
    confidence: 0.85,
    ...over,
  };
}

function baseLook(over: Partial<MakeupLook> = {}): MakeupLook {
  const step: MakeupStep = {
    id: 's1',
    title: '底妆',
    area: 'base',
    instruction: '用气垫粉底轻拍全脸,打造清透奶油肌',
    overlayZones: ['left_cheek', 'right_cheek', 'forehead'],
    brushDirection: '由内向外',
    toolHint: '美妆蛋',
    order: 1,
  };
  return {
    id: 'look_cool_water',
    name: '清冷白开水妆',
    scenario: '日常通勤',
    suitableFor: ['cool_fair', 'oval'],
    reason: '匹配冷白皮,适合日常通勤',
    steps: [step],
    productHints: [],
    ...over,
  };
}

// ---------- 闺蜜种草文案 ----------

describe('buildXiaohongshuText — 闺蜜种草文案', () => {
  it('包含标题行 (emoji + 妆容名 + 适合脸型)', () => {
    const text = buildXiaohongshuText(baseFeatures(), baseLook());
    const firstLine = text.split('\n')[0] ?? '';
    expect(firstLine).toContain('清冷白开水妆');
    expect(firstLine).toContain('椭圆脸');
    // 标题里应有 emoji
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(firstLine)).toBe(true);
  });

  it('正文 3-5 行,闺蜜口吻 (用 "姐妹/宝宝/家人们" 等口语词)', () => {
    const text = buildXiaohongshuText(baseFeatures(), baseLook());
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    // 标题 + 标签 之间属于正文,至少 3 行
    expect(lines.length).toBeGreaterThanOrEqual(5); // 标题 + 3 行正文 + 标签
    // 必须有口语词
    const body = text;
    expect(/姐妹|宝宝|家人们|集美|宝子/.test(body)).toBe(true);
  });

  it('正文包含关键特征 (五官/肤色调性)', () => {
    const text = buildXiaohongshuText(baseFeatures(), baseLook());
    expect(text).toContain('冷白皮');
    expect(text).toContain('椭圆脸');
  });

  it('正文包含化妆技巧 (从 step 抽取 toolHint/brushDirection)', () => {
    const text = buildXiaohongshuText(baseFeatures(), baseLook());
    expect(text).toContain('美妆蛋');
    expect(text).toContain('由内向外');
  });

  it('末尾包含 # 标签 (#赛博姐妹 + #妆容推荐)', () => {
    const text = buildXiaohongshuText(baseFeatures(), baseLook());
    expect(text).toContain('#赛博姐妹');
    expect(text).toContain('#妆容推荐');
  });

  it('不宣称存在二维码回看能力', () => {
    const text = buildXiaohongshuText(baseFeatures(), baseLook());
    expect(text).not.toContain('二维码');
    expect(text).not.toContain('扫码');
  });

  it('结果卡界面不渲染伪二维码或扫码入口', () => {
    const html = renderToStaticMarkup(
      createElement(ResultCard, { features: baseFeatures(), look: baseLook() }),
    );
    expect(html).not.toMatch(/二维码|扫码|qr[-_ ]?code/iu);
  });

  it('unknown 特征时不抛错,仍输出可分享文案', () => {
    const text = buildXiaohongshuText(
      baseFeatures({ faceShape: 'unknown', skinTone: 'unknown', eyeType: 'unknown' }),
      baseLook(),
    );
    expect(text.length).toBeGreaterThan(20);
    expect(text).toContain('#赛博姐妹');
  });
});
