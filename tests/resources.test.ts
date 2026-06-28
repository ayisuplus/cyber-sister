// 教学资源路由测试 — 教学资源的 GET / POST / DELETE.

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import type { TeachingResource } from '../src/shared/types';

interface ListBody { resources: TeachingResource[] }

// ---------- Express Router stack 模拟器 ----------

interface InternalRouter {
  stack: Array<{
    route?: {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{ handle: Function }>;
    };
  }>;
}

let router: unknown;
beforeAll(async () => {
  // 动态 import 是测试场景唯一可靠的方式: 模块必须在 vitest 环境就绪后加载.
  const mod = await import('../src/backend/routes/resources');
  router = mod.resourcesRouter;
});



/**
 * 直接调用 Express 路由 handler, 不经过完整 middleware 链.
 * 模拟 Express 的 req / res 对象, 带上 query, params 等字段.
 */
function callHandler(
  method: 'get' | 'post' | 'delete',
  path: string,
  opts: { body?: unknown; query?: Record<string, string>; params?: Record<string, string> } = {},
): { status: number; body: unknown } {
  const internal = router as unknown as InternalRouter;
  const layer = internal.stack.find((l) => {
    if (!l.route) return false;
    if (!l.route.methods[method]) return false;
    const rp = l.route.path;
    if (path === rp) return true;
    if (rp.endsWith('/:id') && path.startsWith(rp.slice(0, -3))) return true;
    return false;
  });
  if (!layer?.route || layer.route.stack.length === 0) throw new Error('No route found: ' + method + ' ' + path);

  const handlers = layer.route.stack;

  // 从 '/teaching-resources/{id}' 抽 params.id
  const idMatch = /^\/[^/]+\/([^/]+)$/.exec(path);
  const params = idMatch ? { id: idMatch[1]! } : (opts.params ?? {});

  const req = {
    method: method.toUpperCase(),
    url: path,
    body: opts.body ?? {},
    headers: {},
    params,
    query: opts.query ?? {},
    ip: '127.0.0.1',
    app: { get: (k: string) => (k === 'trust proxy' ? 1 : undefined) },
  };

  let response: { status: number; body: unknown } = { status: 500, body: null };
  let idx = 0;
  let done = false;

  const next = () => {
    if (done || idx >= handlers.length) return;
    const handler = handlers[idx]!.handle;
    idx += 1;
    try {
      handler(req, res, next);
    } catch (e) {
      done = true;
      response = { status: 500, body: { error: e instanceof Error ? e.message : String(e) } };
    }
  };

  const res = {
    statusCode: 200,
    json(payload: unknown) {
      if (!done) {
        done = true;
        response = { status: this.statusCode, body: payload };
      }
    },
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    setHeader(_name: string, _value: string | number | string[]) { return this; },
    getHeader(_name: string): string | undefined { return undefined; },
  };

  next();
  return response;
}

// ---------- Seed reset ----------

let seedId: string;

beforeEach(async () => {
  const mod = await import('../src/backend/routes/_resources');
  mod.resetResourcesCache();
  const list = mod.listResources();
  if (list.length === 0) throw new Error('seed data empty');
  seedId = list[0]!.id;
});

afterEach(async () => {
  const mod = await import('../src/backend/routes/_resources');
  mod.resetResourcesCache();
});

// ---------- GET ----------

describe('GET /teaching-resources', () => {
  it('返回 seed 资源列表', () => {
    const r = callHandler('get', '/teaching-resources');
    expect(r.status).toBe(200);
    const body = r.body as ListBody;
    expect(body.resources.length).toBeGreaterThan(0);
  });

  it('按 lookId 过滤', () => {
    const r = callHandler('get', '/teaching-resources', { query: { lookId: 'look_cool_water' } });
    expect(r.status).toBe(200);
    const body = r.body as ListBody;
    expect(body.resources.every((x) => x.lookId === 'look_cool_water')).toBe(true);
  });

  it('unknown lookId → 空数组', () => {
    const r = callHandler('get', '/teaching-resources', { query: { lookId: 'none' } });
    expect(r.status).toBe(200);
    expect((r.body as ListBody).resources).toEqual([]);
  });
});

describe('GET /teaching-resources/:id', () => {
  it('存在 → 200 + 完整对象', () => {
    const r = callHandler('get', `/teaching-resources/${seedId}`);
    expect(r.status).toBe(200);
    const body = r.body as TeachingResource;
    expect(body.id).toBe(seedId);
    expect(typeof body.title).toBe('string');
  });

  it('不存在 → 404', () => {
    const r = callHandler('get', '/teaching-resources/no-such-id');
    expect(r.status).toBe(404);
  });
});

// ---------- POST ----------

describe('POST /teaching-resources', () => {
  it('合法 body → 201 + 新资源', () => {
    const r = callHandler('post', '/teaching-resources', {
      body: { kind: 'article', title: 'test', summary: 'x', tags: '' },
    });
    expect(r.status).toBe(201);
    const body = r.body as TeachingResource;
    expect(body.kind).toBe('article');
    expect(body.title).toBe('test');
    expect(typeof body.id).toBe('string');
  });

  it('视频资源带 videoUrl', () => {
    const r = callHandler('post', '/teaching-resources', {
      body: { kind: 'video', title: 'vid', summary: 's', videoUrl: 'https://a.com/v', tags: '' },
    });
    expect(r.status).toBe(201);
    expect((r.body as TeachingResource).videoUrl).toBe('https://a.com/v');
  });

  it('缺 title → 400', () => {
    const r = callHandler('post', '/teaching-resources', { body: { kind: 'article', summary: 'x' } });
    expect(r.status).toBe(400);
  });

  it('非法 kind → 400', () => {
    const r = callHandler('post', '/teaching-resources', { body: { kind: 'bad', title: 'x', summary: 'y' } });
    expect(r.status).toBe(400);
  });
});

// ---------- DELETE ----------

describe('DELETE /teaching-resources/:id', () => {
  it('删除新建资源 → 200', () => {
    // 先获取当前资源列表
    const before = callHandler('get', '/teaching-resources') as { body: ListBody };
    const beforeCount = before.body.resources.length;
    
    // 创建一个新资源
    const c = callHandler('post', '/teaching-resources', { body: { kind: 'article', title: 'to-delete', summary: 'x', tags: '' } });
    expect(c.status).toBe(201);
    const id = (c.body as { id: string }).id;
    
    // 删除该资源
    const r = callHandler('delete', `/teaching-resources/${id}`);
    expect(r.status).toBe(200);
    
    // 验证数量恢复
    const after = callHandler('get', '/teaching-resources') as { body: ListBody };
    expect(after.body.resources.length).toBe(beforeCount);
  });

  it('不存在 → 404', () => {
    const r = callHandler('delete', '/teaching-resources/no-such-id');
    expect(r.status).toBe(404);
  });
});
