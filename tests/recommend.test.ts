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
    const hasContour = results.some((r) => r.look.steps.some((s) => s.area === 'contour'));
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
    const topId = results[0]?.look.id;
    // 清冷白开水妆 suitableFor 含 cool_fair,应胜出
    expect(topId).toBe('look_cool_water');
  });

  it('cool_fair 肤色的 look 步骤里出现 cool/rose/berry 色系,不是 orange/peach', () => {
    const features = baseFeatures({ skinTone: 'cool_fair', faceShape: 'oval' });
    const results = recommendLooks(features, 1);
    const look = results[0]?.look;
    if (!look) throw new Error('expected at least one result');
    const allColors = [look.name, look.reason, ...look.steps.map((s) => s.colorFamily ?? '')]
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
    const hasBeginner = results.some((r) => /新手|入门|通用|初学/.test(r.reason));
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
  it('用户特征命中 avoidFor → 该 look 排名靠后 (或跌出 top 3)', () => {
    const safe = baseFeatures({ faceShape: 'oval', skinTone: 'cool_fair' });
    const avoid = baseFeatures({ faceShape: 'oval', skinTone: 'warm_deep' });
    const r1 = recommendLooks(safe, 3);
    const r2 = recommendLooks(avoid, 3);
    // warm_deep 应让 清冷白开水妆 降权。
    // 强降权: 跌出 top 3 (idx === -1) 视为 > 任意合法 idx。
    const idSafeIdx = r1.findIndex((r) => r.look.id === 'look_cool_water');
    const idAvoidIdx = r2.findIndex((r) => r.look.id === 'look_cool_water');
    const avoidRank = idAvoidIdx === -1 ? Infinity : idAvoidIdx;
    expect(idSafeIdx).toBeLessThan(avoidRank);
  });
});

// ---------- HTTP 路由测试 ----------

import type { Request, Response, NextFunction } from 'express';
import { recommendRouter } from '../src/backend/routes/recommend';

interface HttpResponse {
  statusCode: number;
  body: unknown;
  /** 在中间件链终止时,记录调用栈以定位未触发的 handler. */
  ended: boolean;
}

function callRouter(body: unknown): Promise<HttpResponse> {
  const { promise, resolve } = Promise.withResolvers<HttpResponse>();

  // 通过 express.Router.stack 拿到中间件链.
  // 这里 router 来自第三方库,内部结构不在公开类型里,用窄接口局部接受 unknown.
  interface InternalRouter {
    stack: Array<{
      route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> };
    }>;
  }
  const internal = recommendRouter as unknown as InternalRouter;
  const layer = internal.stack.find(
    (l) => l.route && l.route.path === '/recommend' && l.route.methods.post,
  );
  if (!layer || !layer.route) throw new Error('no /recommend route');
  const handlers = layer.route.stack;

  const req = { body } as unknown as Request;
  const res = makeRes(resolve);

  // 串行调用中间件链 (validator → handler).
  const i = { value: 0 };
  const next: NextFunction = (err) => {
    if (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'next(err)' });
      return;
    }
    i.value += 1;
    if (i.value >= handlers.length) return; // 链结束,等 res 触发
    void handlers[i.value]!.handle(req, res, next);
  };
  void handlers[0]!.handle(req, res, next);
  return promise;
}

function makeRes(resolve: (r: HttpResponse) => void) {
  const state: HttpResponse = { statusCode: 200, body: null, ended: false };
  const res = {
    get statusCode() {
      return state.statusCode;
    },
    status(c: number) {
      state.statusCode = c;
      return this;
    },
    json(payload: unknown) {
      state.body = payload;
      state.ended = true;
      resolve(state);
      return this;
    },
  };
  return res as unknown as Response;
}
describe('POST /api/recommend', () => {
  it('合法 features → 返回 3 个 looks + 评分详情', async () => {
    const r = await callRouter(baseFeatures({ faceShape: 'oval', skinTone: 'cool_fair' }));
    expect(r.statusCode).toBe(200);
    const body = r.body as { looks: unknown[]; scores: Array<{ lookId: string; score: number; reason: string }> };
    expect(body.looks).toHaveLength(3);
    expect(body.scores).toHaveLength(3);
    expect(body.scores[0]?.lookId).toBeTruthy();
    expect(typeof body.scores[0]?.score).toBe('number');
    expect(body.scores[0]?.reason).toBeTruthy();
  });

  it('空 body → 200 (兜底 fill)', async () => {
    const r = await callRouter({});
    expect(r.statusCode).toBe(200);
    const body = r.body as { looks: unknown[] };
    expect(body.looks).toHaveLength(3);
  });

  it('缺失 body (null) → 400', async () => {
    const r = await callRouter(null);
    expect(r.statusCode).toBe(400);
  });
});
