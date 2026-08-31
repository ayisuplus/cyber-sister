// 路由分支缺口补全 — _looks / _resources / analytics / explain / recommend / resources
// 的未覆盖分支: 错误 catch, 空结果, 坏参数, 持久化兜底.

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Router } from 'express';

import { loadLooks, resetLooksCache } from '../src/backend/routes/_looks';
import {
  listResources,
  getResource,
  createResource,
  deleteResource,
  resetResourcesCache,
  deleteStorage,
} from '../src/backend/routes/_resources';
import { resourcesRouter } from '../src/backend/routes/resources';
import { recommendRouter, recommendLooks } from '../src/backend/routes/recommend';
import { explainRouter } from '../src/backend/routes/explain';
import type { FaceFeatures, MakeupLook, TeachingResource } from '../src/shared/types';

const tmpRoot = mkdtempSync(join(tmpdir(), 'routes-gaps-test-'));

afterAll(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------- Express Router stack 模拟器 (同 tests/resources.test.ts 套路) ----------

interface InternalRouter {
  stack: Array<{
    route?: {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{ handle: Function }>;
    };
  }>;
}

interface CallOptions {
  body?: unknown;
  query?: Record<string, string>;
  params?: Record<string, string | undefined>;
  headers?: Record<string, string | string[]>;
  ip?: string;
}

interface CallResult {
  status: number;
  body: unknown;
  headers: Record<string, string | number | string[]>;
}

function getRouteStack(router: Router, method: string, path: string) {
  const internal = router as unknown as InternalRouter;
  const layer = internal.stack.find((l) => {
    if (!l.route || !l.route.methods[method]) return false;
    const rp = l.route.path;
    if (path === rp) return true;
    if (rp.endsWith('/:id') && path.startsWith(rp.slice(0, -3))) return true;
    return false;
  });
  if (!layer?.route || layer.route.stack.length === 0)
    throw new Error(`No route found: ${method} ${path}`);
  return layer.route.stack;
}

function callRoute(
  router: Router,
  method: 'get' | 'post' | 'delete',
  path: string,
  opts: CallOptions = {},
): Promise<CallResult> {
  const handlers = getRouteStack(router, method, path);
  const idMatch = /^\/[^/]+\/([^/]+)$/.exec(path);
  const params = opts.params ?? (idMatch ? { id: idMatch[1]! } : {});
  const headers = opts.headers ?? {};

  const req = {
    method: method.toUpperCase(),
    url: path,
    path,
    body: opts.body ?? {},
    headers,
    params,
    query: opts.query ?? {},
    ip: opts.ip ?? '127.0.0.1',
    id: 'req-test-1',
    app: { get: (k: string) => (k === 'trust proxy' ? 1 : undefined) },
    get: (name: string) => {
      const v = headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    },
  };

  const { promise, resolve } = Promise.withResolvers<CallResult>();
  const resHeaders: Record<string, string | number | string[]> = {};
  let done = false;
  let idx = 0;
  const res = {
    statusCode: 200,
    json(payload: unknown) {
      if (!done) {
        done = true;
        resolve({ status: this.statusCode, body: payload, headers: resHeaders });
      }
      return this;
    },
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    setHeader(name: string, value: string | number | string[]) {
      resHeaders[name.toLowerCase()] = value;
      return this;
    },
    getHeader(name: string) {
      return resHeaders[name.toLowerCase()];
    },
  };
  const next = (err?: unknown) => {
    if (done) return;
    if (err) {
      done = true;
      resolve({
        status: 500,
        body: { error: err instanceof Error ? err.message : String(err) },
        headers: resHeaders,
      });
      return;
    }
    if (idx >= handlers.length) return;
    const handler = handlers[idx]!.handle;
    idx += 1;
    try {
      const r = handler(req, res, next) as unknown;
      if (r && typeof (r as { then?: unknown }).then === 'function') {
        (r as Promise<void>).catch((e: unknown) => {
          if (!done) {
            done = true;
            resolve({
              status: 500,
              body: { error: e instanceof Error ? e.message : String(e) },
              headers: resHeaders,
            });
          }
        });
      }
    } catch (e) {
      done = true;
      resolve({
        status: 500,
        body: { error: e instanceof Error ? e.message : String(e) },
        headers: resHeaders,
      });
    }
  };
  next();
  return promise;
}

// ---------- _looks.ts ----------

describe('_looks 缓存加载', () => {
  it('resetLooksCache 后重新读盘; 二次调用走缓存 (同一引用)', () => {
    resetLooksCache();
    const a = loadLooks();
    expect(a.length).toBeGreaterThan(0);
    const b = loadLooks();
    expect(b).toBe(a); // cache 分支
    resetLooksCache();
    const c = loadLooks();
    expect(c).not.toBe(a); // 重新加载
    expect(c.length).toBe(a.length);
  });
});

// ---------- _resources.ts ----------

describe('_resources 持久化缺口', () => {
  const SEED = {
    version: 1,
    resources: [
      {
        id: 'tr-gap-1',
        lookId: 'look_cool_water',
        kind: 'article',
        title: 'gap seed',
        summary: 's',
        tags: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  };

  afterEach(() => {
    resetResourcesCache();
    delete process.env.TEACHING_RESOURCES_FILE;
  });

  it('override 文件不存在 → fallback 到仓库 seed (loadFromDisk 兜底分支)', () => {
    process.env.TEACHING_RESOURCES_FILE = join(tmpRoot, 'no-such-dir', 'resources.json');
    resetResourcesCache();
    const list = listResources();
    expect(list.length).toBeGreaterThan(0); // 读到 src/shared/data/teaching-resources.json
  });

  it('override 文件结构非法 → 抛错 (isSeedFile 拒绝分支)', () => {
    const bad = join(tmpRoot, 'bad-resources.json');
    writeFileSync(bad, JSON.stringify({ version: 1, nope: true }), 'utf-8');
    process.env.TEACHING_RESOURCES_FILE = bad;
    resetResourcesCache();
    expect(() => listResources()).toThrow('缺少 "resources" 数组');
  });

  it('create → persist → get/delete 全路径 (含 delete 不存在 → false)', async () => {
    const file = join(tmpRoot, 'crud-resources.json');
    writeFileSync(file, JSON.stringify(SEED), 'utf-8');
    process.env.TEACHING_RESOURCES_FILE = file;
    resetResourcesCache();

    const created = await createResource({
      lookId: 'look_cool_water',
      kind: 'video',
      title: '新视频',
      summary: 'sum',
      tags: ['a'],
      body: '正文',
      coverImage: 'https://e.com/c.png',
      videoUrl: 'https://e.com/v',
      durationSec: 42,
      author: 'tester',
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.videoUrl).toBe('https://e.com/v');
    expect(getResource(created.id)?.title).toBe('新视频');

    // 持久化到磁盘
    const onDisk = JSON.parse(readFileSync(file, 'utf-8')) as { resources: TeachingResource[] };
    expect(onDisk.resources.some((r) => r.id === created.id)).toBe(true);

    expect(await deleteResource(created.id)).toBe(true);
    expect(await deleteResource(created.id)).toBe(false); // idx < 0 分支
    expect(getResource(created.id)).toBeUndefined();
  });

  it('deleteStorage 清空缓存后可重新加载', () => {
    const file = join(tmpRoot, 'crud-resources.json');
    process.env.TEACHING_RESOURCES_FILE = file;
    resetResourcesCache();
    listResources();
    deleteStorage();
    const list = listResources(); // 重新从磁盘加载
    expect(Array.isArray(list)).toBe(true);
  });
});

// ---------- resources.ts 路由 catch 分支 ----------

describe('resources 路由缺口', () => {
  const SEED_FILE = join(tmpRoot, 'route-resources.json');
  const SEED = {
    version: 1,
    resources: [
      {
        id: 'tr-route-1',
        lookId: 'look_cool_water',
        kind: 'article',
        title: 'route seed',
        summary: 's',
        tags: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  };

  beforeEach(() => {
    writeFileSync(SEED_FILE, JSON.stringify(SEED), 'utf-8');
    process.env.TEACHING_RESOURCES_FILE = SEED_FILE;
    resetResourcesCache();
  });

  afterEach(() => {
    resetResourcesCache();
    delete process.env.TEACHING_RESOURCES_FILE;
  });

  it('GET 列表 / lookId 过滤 / 单个 404', async () => {
    const all = await callRoute(resourcesRouter, 'get', '/teaching-resources');
    expect(all.status).toBe(200);
    expect((all.body as { resources: TeachingResource[] }).resources).toHaveLength(1);

    const filtered = await callRoute(resourcesRouter, 'get', '/teaching-resources', {
      query: { lookId: 'look_cool_water' },
    });
    expect((filtered.body as { resources: TeachingResource[] }).resources).toHaveLength(1);

    const empty = await callRoute(resourcesRouter, 'get', '/teaching-resources', {
      query: { lookId: 'none' },
    });
    expect((empty.body as { resources: TeachingResource[] }).resources).toHaveLength(0);

    const missing = await callRoute(resourcesRouter, 'get', '/teaching-resources/no-such');
    expect(missing.status).toBe(404);
  });

  it('POST 全字段 → 201 (parseTags / parseStringField / parseNumberField)', async () => {
    const r = await callRoute(resourcesRouter, 'post', '/teaching-resources', {
      body: {
        lookId: 'look_cool_water',
        kind: 'video',
        title: '完整资源',
        summary: 'sum',
        body: '正文内容',
        coverImage: 'https://e.com/c.png',
        videoUrl: 'https://e.com/v',
        durationSec: 120,
        author: '作者',
        tags: '底妆, 教程 invalid$$$tag 进阶',
      },
    });
    expect(r.status).toBe(201);
    const created = r.body as TeachingResource;
    expect(created.tags).toEqual(['底妆', '教程', '进阶']); // 非法 tag 被丢弃
    expect(created.durationSec).toBe(120);
    expect(created.author).toBe('作者');
  });

  it('POST tags 非字符串 → 空数组', async () => {
    const r = await callRoute(resourcesRouter, 'post', '/teaching-resources', {
      body: { kind: 'article', title: 't', summary: 's', tags: 123 },
    });
    // tags 类型不符会被 validateBody 拦下 (schema 声明 string)
    expect(r.status).toBe(400);
  });

  it('POST 持久化失败 → 500 catch 分支 (第 136-137 行)', async () => {
    // 先预热缓存 (listResources 从合法 seed 加载)
    const warm = await callRoute(resourcesRouter, 'get', '/teaching-resources');
    expect(warm.status).toBe(200);
    // 再把存储路径重定向到 "父路径是文件" 的非法位置 → mkdirSync 抛 ENOTDIR
    const blockedBase = join(tmpRoot, 'blocked-file');
    writeFileSync(blockedBase, 'x', 'utf-8');
    process.env.TEACHING_RESOURCES_FILE = join(blockedBase, 'r.json');

    const r = await callRoute(resourcesRouter, 'post', '/teaching-resources', {
      body: { kind: 'article', title: 'will fail', summary: 's' },
    });
    expect(r.status).toBe(500);
    expect(typeof (r.body as { error: string }).error).toBe('string');
  });

  it('DELETE 不存在 → 404; 存在 → 200; params.id 缺失 → 404', async () => {
    const missing = await callRoute(resourcesRouter, 'delete', '/teaching-resources/nope');
    expect(missing.status).toBe(404);

    const ok = await callRoute(resourcesRouter, 'delete', '/teaching-resources/tr-route-1');
    expect(ok.status).toBe(200);
    expect((ok.body as { ok: boolean }).ok).toBe(true);

    // params.id 不是 string 的防御分支 (Express 正常不会到这, 直调 handler 覆盖)
    const handlers = getRouteStack(resourcesRouter, 'delete', '/teaching-resources/x');
    const final = handlers[handlers.length - 1]!.handle;
    const { promise, resolve } = Promise.withResolvers<CallResult>();
    const res = {
      statusCode: 200,
      json(p: unknown) {
        resolve({ status: this.statusCode, body: p, headers: {} });
        return this;
      },
      status(c: number) {
        this.statusCode = c;
        return this;
      },
    };
    const result = final(
      { params: {}, headers: {}, ip: '127.0.0.1' },
      res,
      () => undefined,
    ) as unknown;
    if (result && typeof (result as { then?: unknown }).then === 'function') {
      await (result as Promise<void>).catch(() => undefined);
    }
    const r = await promise;
    expect(r.status).toBe(404);
  });

  it('DELETE 持久化失败 → 500 catch 分支 (第 146-147 行)', async () => {
    // 预热缓存 (id 存在于 cache)
    const warm = await callRoute(resourcesRouter, 'get', '/teaching-resources/tr-route-1');
    expect(warm.status).toBe(200);
    const blockedBase = join(tmpRoot, 'blocked-file-2');
    writeFileSync(blockedBase, 'x', 'utf-8');
    process.env.TEACHING_RESOURCES_FILE = join(blockedBase, 'r.json');

    const r = await callRoute(resourcesRouter, 'delete', '/teaching-resources/tr-route-1');
    expect(r.status).toBe(500);
  });
});

// ---------- analytics.ts 路由缺口 ----------

describe('analytics 路由缺口', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('空文件 stats / 首次写入 mkdir / sessionId 提取 / 坏行兜底 / 缓存', async () => {
    const dirA = join(tmpRoot, 'analytics-a'); // 故意不预创建 → ensureFile 走 mkdirSync (第 47 行)
    process.env.ANALYTICS_DATA_DIR = dirA;
    vi.resetModules();
    // 动态 import: env 必须先就位, 模块在加载时固化 DATA_DIR
    const mod = await import('../src/backend/routes/analytics');

    // 文件尚不存在 → readRows 早退分支
    const empty = await callRoute(mod.analyticsRouter, 'get', '/analytics/stats');
    expect(empty.status).toBe(200);
    expect((empty.body as { total: number }).total).toBe(0);

    // 首次写入 → mkdirSync 分支
    const w1 = await callRoute(mod.analyticsRouter, 'post', '/analytics', {
      body: { event: 'page_view' },
    });
    expect(w1.status).toBe(200);
    expect((w1.body as { ok: boolean }).ok).toBe(true);
    expect(existsSync(join(dirA, 'analytics.jsonl'))).toBe(true);

    // body.sessionId 优先于 header
    const w2 = await callRoute(mod.analyticsRouter, 'post', '/analytics', {
      body: { event: 'click', sessionId: 'body-sess' },
      headers: { 'x-session-id': 'hdr-sess' },
    });
    expect(w2.status).toBe(200);

    // header 为 string[] 的罕见分支 (第 68 行)
    const w3 = await callRoute(mod.analyticsRouter, 'post', '/analytics', {
      body: { event: 'click' },
      headers: { 'x-session-id': ['arr-sess', 'second'] },
    });
    expect(w3.status).toBe(200);
    // 仅 header 字符串 (body 无 sessionId) + 显式 timestamp 分支
    const w4 = await callRoute(mod.analyticsRouter, 'post', '/analytics', {
      body: { event: 'click', timestamp: 1_700_000_000_000 },
      headers: { 'x-session-id': 'only-header' },
    });
    expect(w4.status).toBe(200);

    // timestamp 缺省 → Date.now() 分支
    const rows = readFileSync(join(dirA, 'analytics.jsonl'), 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { event: string; sessionId: string | null; timestamp: number });
    expect(rows[0]!.sessionId).toBeNull();
    expect(rows[0]!.timestamp).toBeGreaterThan(0);
    expect(rows[1]!.sessionId).toBe('body-sess');
    expect(rows[2]!.sessionId).toBe('arr-sess');
    expect(rows[3]!.sessionId).toBe('only-header');
    expect(rows[3]!.timestamp).toBe(1_700_000_000_000);

    // stats: 第一次 miss, 第二次命中缓存 (TTL 分支)
    const s1 = await callRoute(mod.analyticsRouter, 'get', '/analytics/stats');
    expect((s1.body as { total: number }).total).toBe(4);
    expect((s1.body as { byEvent: Record<string, number> }).byEvent['click']).toBe(3);
    const s2 = await callRoute(mod.analyticsRouter, 'get', '/analytics/stats');
    expect(s2.body).toEqual(s1.body);

    // 坏行 / 缺 event / 非数字 timestamp 兜底
    appendFileSync(
      join(dirA, 'analytics.jsonl'),
      'not-json-at-all\n{"timestamp":5}\n{"event":"e3","timestamp":"x"}\n\n',
      'utf-8',
    );
    mod.invalidateStatsCache();
    const s3 = await callRoute(mod.analyticsRouter, 'get', '/analytics/stats');
    const body3 = s3.body as { total: number; byEvent: Record<string, number> };
    expect(body3.total).toBe(5); // 4 正常 + e3; 坏行跳过
    expect(body3.byEvent['e3']).toBe(1);

    // 校验失败分支: 非法事件名 / 非字符串 event
    const bad1 = await callRoute(mod.analyticsRouter, 'post', '/analytics', {
      body: { event: 'bad name!' },
    });
    expect(bad1.status).toBe(400);
    const bad2 = await callRoute(mod.analyticsRouter, 'post', '/analytics', {
      body: { event: 5 },
    });
    expect(bad2.status).toBe(400);

    delete process.env.ANALYTICS_DATA_DIR;
  });

  it('写入失败 → 500 + console.error (第 132-134 行)', async () => {
    const dirB = join(tmpRoot, 'analytics-b');
    // analytics.jsonl 预先存在为目录 → appendFileSync 抛 EISDIR
    mkdirSync(join(dirB, 'analytics.jsonl'), { recursive: true });
    process.env.ANALYTICS_DATA_DIR = dirB;
    vi.resetModules();
    // 动态 import: 需要全新模块实例读取新 env
    const mod = await import('../src/backend/routes/analytics');

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await callRoute(mod.analyticsRouter, 'post', '/analytics', {
      body: { event: 'will_fail' },
    });
    expect(r.status).toBe(500);
    expect((r.body as { error: string }).error).toBe('write failed');
    expect(errSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errSpy.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(logged.result).toBe('analytics_write_failed');

    delete process.env.ANALYTICS_DATA_DIR;
  });
});

// ---------- recommend.ts 路由缺口 ----------

describe('recommend 路由缺口', () => {
  it('POST 合法特征 → 200 + top3 + 确定性', async () => {
    const body = { faceShape: 'oval', skinTone: 'cool_fair', eyeType: 'almond' };
    const r1 = await callRoute(recommendRouter, 'post', '/recommend', { body });
    expect(r1.status).toBe(200);
    const payload = r1.body as {
      looks: MakeupLook[];
      scores: Array<{ lookId: string; score: number; reason: string }>;
    };
    expect(payload.looks.length).toBeGreaterThan(0);
    expect(payload.looks.length).toBeLessThanOrEqual(3);
    expect(payload.scores).toHaveLength(payload.looks.length);
    // 第一名应是 cool_water (suitable 全中)
    expect(payload.looks[0]!.id).toBe('look_cool_water');
    expect(payload.scores[0]!.lookId).toBe('look_cool_water');
    expect(payload.scores[0]!.reason).toContain('匹配你的');

    const r2 = await callRoute(recommendRouter, 'post', '/recommend', { body });
    expect(r2.body).toEqual(r1.body); // 确定性排序
  });

  it('POST 空 body → 全 unknown → 新手友好理由', async () => {
    const r = await callRoute(recommendRouter, 'post', '/recommend', { body: {} });
    expect(r.status).toBe(200);
    const scores = (r.body as { scores: Array<{ reason: string }> }).scores;
    expect(scores.length).toBeGreaterThan(0);
    for (const s of scores) expect(s.reason).toContain('新手友好');
  });

  it('POST 非法枚举值 → 400; 未知字段 → 400', async () => {
    const badEnum = await callRoute(recommendRouter, 'post', '/recommend', {
      body: { faceShape: 'triangle' },
    });
    expect(badEnum.status).toBe(400);

    const extra = await callRoute(recommendRouter, 'post', '/recommend', {
      body: { isAdmin: true },
    });
    expect(extra.status).toBe(400);
  });

  it('POST 显式 null body → 400 missing body (第 209-210 行)', async () => {
    // callRoute 把 null 归一成 {}, 这里直调最终 handler (validateBody 视 null 为可放行, 由 handler 自己拦)
    const handlers = getRouteStack(recommendRouter, 'post', '/recommend');
    const final = handlers[handlers.length - 1]!.handle;
    const { promise, resolve } = Promise.withResolvers<CallResult>();
    const res = {
      statusCode: 200,
      json(p: unknown) {
        resolve({ status: this.statusCode, body: p, headers: {} });
        return this;
      },
      status(c: number) {
        this.statusCode = c;
        return this;
      },
    };
    final({ body: null, headers: {}, ip: '127.0.0.1' }, res, () => undefined);
    const r = await promise;
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe('missing body');
  });

  it('recommendLooks: avoid 命中最多的理由 + 前缀匹配 + 排序平局', () => {
    const base: FaceFeatures = {
      upperThirdRatio: 0,
      middleThirdRatio: 0,
      lowerThirdRatio: 0,
      fiveEyeFit: 0,
      faceShape: 'round',
      skinTone: 'cool_fair',
      eyeType: 'downturned',
      noseType: 'unknown',
      eyeDistanceRatio: 0,
      faceWidthHeightRatio: 0,
      lipFullnessRatio: 0,
      browArchAngle: 0,
      noseBridgeWidth: 0,
      confidence: 0,
    };
    const scored = recommendLooks(base, 6);
    expect(scored).toHaveLength(6);
    // look_power_queen: avoidFor 含 round, 且 round/cool_fair/downturned 都不命中 suitable
    const queen = scored.find((s) => s.look.id === 'look_power_queen');
    expect(queen).toBeDefined();
    expect(queen!.avoidHits.length).toBeGreaterThan(queen!.matchedTags.length);
    expect(queen!.reason).toContain('常见冲突');
    // long/warm_deep_dark/wide_set 对 look_korean 既不命中 suitable 也不命中 avoid → "入门练习" 分支
    const scored2 = recommendLooks({ ...base, faceShape: 'long', skinTone: 'warm_deep_dark', eyeType: 'wide_set' }, 6);
    const korean = scored2.find((s) => s.look.id === 'look_korean');
    expect(korean).toBeDefined();
    expect(korean!.matchedTags).toHaveLength(0);
    expect(korean!.avoidHits).toHaveLength(0);
    expect(korean!.reason).toContain('入门练习');
    // 排序: 分数降序
    for (let i = 1; i < scored.length; i++) {
      expect(scored[i - 1]!.score).toBeGreaterThanOrEqual(scored[i]!.score);
    }
  });

  it('looks.json 结构非法 → loadLooks 抛错 (校验已随数据加载迁入 _looks)', async () => {
    vi.resetModules();
    // doMock + 动态 import: 测试有意覆盖模块加载边界, 静态 import 无法注入坏数据
    vi.doMock('node:fs', async (importActual) => {
      const actual = await importActual<typeof import('node:fs')>();
      return {
        ...actual,
        readFileSync: (p: unknown, ...rest: unknown[]) => {
          if (typeof p === 'string' && p.endsWith('looks.json')) return '{"version":1}';
          return actual.readFileSync(p as never, ...(rest as never[]));
        },
      };
    });
    const mod = await import('../src/backend/routes/_looks');
    expect(() => mod.loadLooks()).toThrow('缺少 "looks" 数组');
    vi.doUnmock('node:fs');
    vi.resetModules();
  });
});

// ---------- explain.ts 路由缺口 ----------

describe('explain 路由缺口', () => {
  const VALID_FEATURES = { faceShape: 'oval', skinTone: 'cool_fair', eyeType: 'almond' };
  const VALID_BODY = { features: VALID_FEATURES, lookId: 'look_cool_water' };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function postExplain(body: unknown, authorization?: string) {
    return callRoute(explainRouter, 'post', '/explain', {
      body,
      headers: authorization ? { authorization } : {},
    });
  }

  it('body 结构不合法 → 400 INVALID_EXPLAIN_REQUEST', async () => {
    const cases: unknown[] = [
      {},
      { features: VALID_FEATURES },
      { lookId: 'look_cool_water' },
      { ...VALID_BODY, extra: 1 }, // 3 个 key
      { features: null, lookId: 'look_cool_water' },
      { features: 'str', lookId: 'look_cool_water' },
      { features: { ...VALID_FEATURES, extra: 1 }, lookId: 'look_cool_water' }, // features 4 个 key
      { features: { faceShape: 'triangle', skinTone: 'cool_fair', eyeType: 'almond' }, lookId: 'look_cool_water' },
      { features: { faceShape: 'oval', skinTone: 'cool_fair' }, lookId: 'look_cool_water' },
      { features: VALID_FEATURES, lookId: 123 }, // lookId 非字符串
      { features: VALID_FEATURES, lookId: 'no-such-look' }, // lookId 不存在
    ];
    for (const body of cases) {
      const r = await postExplain(body);
      expect(r.status).toBe(400);
      expect((r.body as { error: string }).error).toBe('INVALID_EXPLAIN_REQUEST');
    }
  });

  it('无 authorization → 本地模板兜底 (local_template)', async () => {
    const r = await postExplain(VALID_BODY);
    expect(r.status).toBe(200);
    const body = r.body as { explanation: string; source: string };
    expect(body.source).toBe('local_template');
    expect(body.explanation.length).toBeGreaterThan(0);
    expect(Array.from(body.explanation).length).toBeLessThanOrEqual(50);
  });

  it('authorization 非 Bearer → 本地兜底', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await postExplain(VALID_BODY, 'Basic abc');
    expect(r.status).toBe(200);
    expect((r.body as { source: string }).source).toBe('local_template');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Bearer + 主 API 正常 → 透传 explanation/source', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ explanation: '主 API 给出的解释', source: 'qwen' }),
      })),
    );
    const r = await postExplain(VALID_BODY, 'Bearer token-1');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ explanation: '主 API 给出的解释', source: 'qwen' });
  });

  it('Bearer + 主 API 超长解释 → 截断到 50 码点', async () => {
    const longText = '妆'.repeat(80);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ explanation: longText, source: 'local_model' }),
      })),
    );
    const r = await postExplain(VALID_BODY, 'Bearer token-1');
    expect(r.status).toBe(200);
    const body = r.body as { explanation: string; source: string };
    expect(body.source).toBe('local_model');
    expect(Array.from(body.explanation).length).toBe(50);
  });

  it('Bearer + 主 API 异常响应 → 全部回退本地兜底', async () => {
    const scenarios: Array<Record<string, unknown> | 'throw'> = [
      { ok: false, json: async () => ({}) }, // HTTP 错误
      { ok: true, json: async () => ({ explanation: 123, source: 'qwen' }) }, // explanation 非字符串
      { ok: true, json: async () => ({ explanation: 'x', source: 'evil_source' }) }, // source 不在白名单
      { ok: true, json: async () => ({ explanation: '   ', source: 'qwen' }) }, // trim 后为空
      'throw', // 网络异常
    ];
    for (const s of scenarios) {
      vi.unstubAllGlobals();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          if (s === 'throw') throw new Error('network down');
          return s;
        }),
      );
      const r = await postExplain(VALID_BODY, 'Bearer token-1');
      expect(r.status).toBe(200);
      expect((r.body as { source: string }).source).toBe('local_template');
    }
  });
});
