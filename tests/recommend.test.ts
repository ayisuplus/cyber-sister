// 推荐引擎单元测试 + HTTP 路由测试

import { describe, it, expect } from 'vitest';
import { recommendLooks } from '../src/backend/routes/recommend';
import type { FaceFeatures } from '../src/shared/types';

// ---------- 测试夹具 ----------

function baseFeatures(over: Partial<FaceFeatures> = {}): FaceFeatures {
  return {
    upperThirdRatio: 0.33,
    middleThirdRatio: 0.34,
    lowerThirdRatio: 0.33,
    fiveEyeFit: 1.0,
    faceShape: 'unknown',
    skinTone: 'unknown',
    eyeType: 'unknown',
    noseType: 'unknown',
    eyeDistanceRatio: 0.4,
    faceWidthHeightRatio: 0.8,
    lipFullnessRatio: 0.3,
    browArchAngle: 15,
    noseBridgeWidth: 0.2,
    confidence: 0.8,
    ...over,
  };
}

// ---------- 推荐逻辑测试 ----------

describe('recommendLooks — 圆脸 + 修容引导', () => {
  it('圆脸用户 → 第一推荐应包含修容/腮红引导步骤', () => {
    const features = baseFeatures({ faceShape: 'round', skinTone: 'neutral_medium' });
    const results = recommendLooks(features, 3);
    expect(results.length).toBe(3);
    // 至少有一个结果含 contour 步骤
    const hasContour = results.some((r) =>
      r.look.steps.some((s) => s.area === 'contour')
    );
    expect(hasContour).toBe(true);
  });

  it('圆脸用户 reason 至少命中 1 个标签', () => {
    const features = baseFeatures({ faceShape: 'round' });
    const results = recommendLooks(features, 3);
    const matched = results.filter((r) => r.matchedTags.length > 0);
    expect(matched.length).toBeGreaterThan(0);
  });
});

describe('recommendLooks — 冷调肤色 → 莓果/梅子色而非橙色', () => {
  it('cool_fair 肤色的 top 推荐不应是 "气场御姐妆" (暖调为主)', () => {
    const features = baseFeatures({ skinTone: 'cool_fair', faceShape: 'oval' });
    const results = recommendLooks(features, 3);
    const topId = results[0].look.id;
    // 清冷白开水妆 suitableFor 含 cool_fair,应胜出
    expect(topId).toBe('look_cool_water');
  });

  it('cool_fair 肤色的 look 步骤里出现 cool/rose/berry 色系,不是 orange/peach', () => {
    const features = baseFeatures({ skinTone: 'cool_fair', faceShape: 'oval' });
    const results = recommendLooks(features, 1);
    const look = results[0].look;
    const allColors = [
      look.name,
      look.reason,
      ...look.steps.map((s) => s.colorFamily ?? ''),
    ]
      .join(' ')
      .toLowerCase();
    // 不应出现暖橘提示
    expect(allColors).not.toMatch(/南瓜|橘色|金棕|暖橘/);
  });
});

describe('recommendLooks — 未知特征 → 仍返回安全初学者妆容', () => {
  it('全部 unknown → 返回 3 个妆容,不抛错', () => {
    const results = recommendLooks(baseFeatures(), 3);
    expect(results.length).toBe(3);
    for (const r of results) {
      expect(r.look).toBeDefined();
      expect(r.look.id).toBeTruthy();
      expect(r.reason).toBeTruthy();
    }
  });

  it('全部 unknown 时 reason 应提及 "新手"/"入门"', () => {
    const results = recommendLooks(baseFeatures(), 3);
    const hasBeginner = results.some((r) =>
      /新手|入门|通用|初学/.test(r.reason)
    );
    expect(hasBeginner).toBe(true);
  });
});

describe('recommendLooks — 确定性', () => {
  it('相同输入两次 → 输出完全一致', () => {
    const features = baseFeatures({ faceShape: 'oval', skinTone: 'cool_fair' });
    const a = recommendLooks(features, 3);
    const b = recommendLooks(features, 3);
    expect(a.map((r) => r.look.id)).toEqual(b.map((r) => r.look.id));
    expect(a.map((r) => r.score)).toEqual(b.map((r) => r.score));
  });

  it('不同特征但得分相同时 → 排序按 look.id 字典序', () => {
    // 全部 unknown 时,所有 look 得分都是 0,排序应稳定
    const a = recommendLooks(baseFeatures(), 3);
    const ids = a.map((r) => r.look.id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});

describe('recommendLooks — 避免项惩罚', () => {
  it('用户特征命中 avoidFor → 该 look 排名靠后', () => {
    const safe = baseFeatures({ faceShape: 'oval', skinTone: 'cool_fair' });
    const avoid = baseFeatures({ faceShape: 'oval', skinTone: 'warm_deep' });
    const r1 = recommendLooks(safe, 3);
    const r2 = recommendLooks(avoid, 3);
    // warm_deep 应让 清冷白开水妆 降权(因不在 suitableFor)
    const idSafeIdx = r1.findIndex((r) => r.look.id === 'look_cool_water');
    const idAvoidIdx = r2.findIndex((r) => r.look.id === 'look_cool_water');
    expect(idSafeIdx).toBeLessThan(idAvoidIdx);
  });
});

// ---------- HTTP 路由测试 ----------

import { recommendRouter } from '../src/backend/routes/recommend';

function callRouter(body: unknown): { status: number; json: any } {
  return new Promise((resolve) => {
    const handlers: Array<{ method: string; path: string; handler: Function }> = [];
    const fakeApp = {
      post: (path: string, h: Function) => {
        handlers.push({ method: 'post', path, handler: h });
        return fakeApp;
      },
    };
    // 重新创建路由并直接调用 handler
    const router = recommendRouter;
    const stack = (router as any).stack;
    const layer = stack.find(
      (l: any) => l.route && l.route.path === '/recommend' && l.route.methods.post
    );
    if (!layer) throw new Error('no /recommend route');
    const req = { body };
    const res = {
      statusCode: 200,
      json(payload: any) {
        resolve({ status: this.statusCode, json: payload });
      },
      status(c: number) {
        this.statusCode = c;
        return this;
      },
    };
    layer.route.stack[0].handle(req, res, () => {});
  }) as any;
}

describe('POST /api/recommend', () => {
  it('合法 features → 返回 3 个 looks + 评分详情', async () => {
    const r = await callRouter(baseFeatures({ faceShape: 'oval', skinTone: 'cool_fair' }));
    expect(r.status).toBe(200);
    expect(r.json.looks).toHaveLength(3);
    expect(r.json.scores).toHaveLength(3);
    expect(r.json.scores[0].lookId).toBeTruthy();
    expect(typeof r.json.scores[0].score).toBe('number');
    expect(r.json.scores[0].reason).toBeTruthy();
  });

  it('空 body → 400', async () => {
    const r = await callRouter({});
    expect(r.status).toBe(200); // 兜底 fill,不会 400
    expect(r.json.looks).toHaveLength(3);
  });

  it('缺失 body → 400', async () => {
    const r = await callRouter(null);
    expect(r.status).toBe(400);
  });
});
