// analytics 路由测试 — 文件存储 + /stats 端点.
// 用临时目录隔离,避免污染真实 data/analytics.jsonl.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Response 形状 (匹配 analytics.ts 的实际返回).测试用,放本地.
interface StatsBody {
  total: number;
  byEvent: Record<string, number>;
}
interface AckBody {
  ok: true;
}

// 测试注入 DATA_DIR via process.env,这样不需要改 analytics.ts 的硬编码路径.

const TMP = join(tmpdir(), `analytics-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const TEST_DATA_DIR = join(TMP, 'data');

// 必须在 import analytics 之前设置 env,让模块读取 TEST_DATA_DIR.
// 动态 import 是测试场景下唯一可靠的方式 (env 必须先就位)
process.env.ANALYTICS_DATA_DIR = TEST_DATA_DIR;

const { analyticsRouter, getStats, invalidateStatsCache } =
  await import('../src/backend/routes/analytics');

// ---------- 工具: 直接调用 router handler,绕开 express ----------

// Express Router 内部 stack 不在公开类型里.用窄接口局部接受 unknown.
interface InternalRouter {
  stack: Array<{
    route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> };
  }>;
}

interface CallResponse {
  status: number;
  json: unknown;
}

function getLayer(method: 'post' | 'get', path: string) {
  const internal = analyticsRouter as unknown as InternalRouter;
  const layer = internal.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer || !layer.route) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  return layer.route.stack;
}

function callHandler(
  method: 'post' | 'get',
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<CallResponse> {
  const { promise, resolve } = Promise.withResolvers<CallResponse>();
  const handlers = getLayer(method, path);
  // req 用宽 unknown 转,只暴露 handler 真正用到的字段. 必须给个 ip 让 rate-limit 不抛.
  // 还要给 req.app,因为 express-rate-limit 在 keyGenerator 里读 app.get('trust proxy').
  const req = {
    method: method.toUpperCase(),
    url: path,
    body: opts.body ?? {},
    headers: opts.headers ?? {},
    ip: '127.0.0.1',
    app: { get: (k: string) => (k === 'trust proxy' ? 1 : undefined) },
  };
  let ended = false;
  const res = {
    statusCode: 200,
    json(payload: unknown) {
      if (ended) return this;
      ended = true;
      resolve({ status: this.statusCode, json: payload });
      return this;
    },
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    setHeader(_name: string, _value: string | number | string[]): unknown {
      return this;
    },
    getHeader(_name: string): unknown {
      return undefined;
    },
  };
  // 串行调用整条中间件链 (限流 → 校验 → 业务 handler).res.json 一旦写过就停.
  let i = 0;
  const next = (err?: unknown) => {
    if (ended) return;
    if (err) {
      res.status(500).json(String(err));
      return;
    }
    if (i >= handlers.length) return;
    const handler = handlers[i]!.handle;
    i += 1;
    try {
      handler(req, res, next);
    } catch (e) {
      if (!ended) res.status(500).json(String(e));
    }
  };
  next();
  return promise;
}

// ---------- 准备/清理 ----------

beforeEach(() => {
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  // 清空旧 jsonl
  const jsonl = join(TEST_DATA_DIR, 'analytics.jsonl');
  if (existsSync(jsonl)) rmSync(jsonl);
});

afterEach(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

// ---------- POST /api/analytics ----------

describe('POST /api/analytics — 写入 jsonl', () => {
  it('合法事件 → 200 + 写入一行 jsonl，但不持久化客户端属性', async () => {
    const r = await callHandler('post', '/analytics', {
      body: {
        event: 'result_share',
        props: { authorization: 'Bearer secret', chat: '私密正文' },
      },
      headers: { 'x-session-id': 'sess-abc' },
    });
    expect(r.status).toBe(200);
    expect((r.json as AckBody).ok).toBe(true);

    const jsonl = join(TEST_DATA_DIR, 'analytics.jsonl');
    expect(existsSync(jsonl)).toBe(true);
    const content = readFileSync(jsonl, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(1);
    const row = JSON.parse(lines[0]!);
    expect(row.event).toBe('result_share');
    expect(row).not.toHaveProperty('props');
    expect(content).not.toContain('Bearer secret');
    expect(content).not.toContain('私密正文');
    expect(typeof row.timestamp).toBe('number');
    expect(row.sessionId).toBe('sess-abc');
  });

  it('body 里带 sessionId 时优先用 body 的', async () => {
    await callHandler('post', '/analytics', {
      body: { event: 'click', sessionId: 'sess-body' },
      headers: { 'x-session-id': 'sess-header' },
    });
    const jsonl = join(TEST_DATA_DIR, 'analytics.jsonl');
    const row = JSON.parse(readFileSync(jsonl, 'utf-8').trim());
    expect(row.sessionId).toBe('sess-body');
  });

  it('无 sessionId 时 sessionId 字段为 null (不抛错)', async () => {
    const r = await callHandler('post', '/analytics', {
      body: { event: 'click' },
    });
    expect(r.status).toBe(200);
    const jsonl = join(TEST_DATA_DIR, 'analytics.jsonl');
    const row = JSON.parse(readFileSync(jsonl, 'utf-8').trim());
    expect(row.sessionId).toBeNull();
  });

  it('多次调用 → 多行 jsonl (每行一个 JSON)', async () => {
    for (let i = 0; i < 3; i++) {
      await callHandler('post', '/analytics', {
        body: { event: 'click', props: { i } },
      });
    }
    const jsonl = join(TEST_DATA_DIR, 'analytics.jsonl');
    const lines = readFileSync(jsonl, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(3);
    for (const l of lines) {
      expect(() => JSON.parse(l)).not.toThrow();
    }
  });

  it('文件不存在时自动创建', async () => {
    const jsonl = join(TEST_DATA_DIR, 'analytics.jsonl');
    if (existsSync(jsonl)) rmSync(jsonl);
    expect(existsSync(jsonl)).toBe(false);
    await callHandler('post', '/analytics', { body: { event: 'first' } });
    expect(existsSync(jsonl)).toBe(true);
  });
});

// ---------- GET /api/analytics/stats ----------

describe('GET /api/analytics/stats — 统计', () => {
  it('无事件 → total=0, byEvent={}', async () => {
    const r = await callHandler('get', '/analytics/stats');
    expect(r.status).toBe(200);
    const s = r.json as StatsBody;
    expect(s.total).toBe(0);
    expect(s.byEvent).toEqual({});
  });

  it('多次写不同 event → 返回总数 + 按 event 分组计数', async () => {
    await callHandler('post', '/analytics', { body: { event: 'click' } });
    await callHandler('post', '/analytics', { body: { event: 'click' } });
    await callHandler('post', '/analytics', { body: { event: 'share' } });
    const r = await callHandler('get', '/analytics/stats');
    expect(r.status).toBe(200);
    const s = r.json as StatsBody;
    expect(s.total).toBe(3);
    expect(s.byEvent).toEqual({ click: 2, share: 1 });
  });

  it('坏行 (非 JSON) → 跳过不抛错', async () => {
    await callHandler('post', '/analytics', { body: { event: 'click' } });
    // 手动塞一行坏数据
    const { appendFileSync } = await import('node:fs');
    appendFileSync(join(TEST_DATA_DIR, 'analytics.jsonl'), 'this is not json\n');
    await callHandler('post', '/analytics', { body: { event: 'click' } });
    const r = await callHandler('get', '/analytics/stats');
    expect(r.status).toBe(200);
    const s = r.json as StatsBody;
    expect(s.total).toBe(2); // 坏行跳过
    expect(s.byEvent).toEqual({ click: 2 });
  });
});

describe('analytics: stats cache', () => {
  it('getStats returns the same shape as the route', () => {
    invalidateStatsCache();
    const s = getStats();
    expect(typeof s.total).toBe('number');
    expect(typeof s.byEvent).toBe('object');
  });

  it('getStats within TTL returns the cached object reference', () => {
    invalidateStatsCache();
    const a = getStats();
    const b = getStats();
    expect(b).toBe(a); // 同一个引用 → 命中缓存
  });

  it('invalidateStatsCache forces the next call to recompute', () => {
    invalidateStatsCache();
    const a = getStats();
    invalidateStatsCache();
    const b = getStats();
    expect(b).not.toBe(a);
    expect(b).toEqual(a); // 但内容应该相同
  });

  it('write 通过 invalidateStatsCache 失效缓存', async () => {
    invalidateStatsCache();
    const before = getStats();
    await callHandler('post', '/analytics', { body: { event: 'cache_test' } });
    // 写入后 cache 应被清,下一次 getStats 重新算
    const after = getStats();
    expect(after.total).toBe(before.total + 1);
    expect(after.byEvent.cache_test).toBe(1);
  });
});

// ---------- 内测 track() 保持本地，不发送事件内容 ----------

describe('track() 内测隐私门', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    const lsMock = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    };
    vi.stubGlobal('localStorage', lsMock);
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('track 不发送事件名或 props', async () => {
    const { track } = await import('../src/shared/analytics');
    track('test_event', { foo: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('多次 track 也不会创建网络请求', async () => {
    const { track, getSessionId } = await import('../src/shared/analytics');
    track('a');
    track('b');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getSessionId()).toBe(getSessionId());
  });

  it('sessionId 持久化到 localStorage 且不含 PII', async () => {
    const { getSessionId } = await import('../src/shared/analytics');
    const id = getSessionId();
    expect(store.get('makeupwhisper_session_id')).toBe(id);
    // id 形态: UUID 或 sess- 前缀,均为本地生成、无 PII
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(id.length).toBeLessThanOrEqual(128);
  });

  it('已持久化的 sessionId 在重新加载后被复用', async () => {
    store.set('makeupwhisper_session_id', 'pre-existing-id');
    const { getSessionId } = await import('../src/shared/analytics');
    expect(getSessionId()).toBe('pre-existing-id');
  });
});
