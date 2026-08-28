// 教学资源路由测试 — 教学资源的 GET / POST / DELETE.

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TeachingResource } from '../src/shared/types';

interface ListBody {
  resources: TeachingResource[];
}

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
let storagePath: string | null = null;
const STORAGE_BACKUP: { value: string | null } = { value: null };

beforeAll(async () => {
  const mod = await import('../src/backend/routes/resources');
  router = mod.resourcesRouter;

  // 备份原始的 teaching-resources.json (持久化测试期间避免污染).
  const fs = await import('node:fs');
  const path = await import('node:path');
  storagePath = path.join(process.cwd(), 'src', 'shared', 'data', 'teaching-resources.json');
  if (fs.existsSync(storagePath)) {
    STORAGE_BACKUP.value = fs.readFileSync(storagePath, 'utf-8');
  }
});

afterAll(async () => {
  // 恢复原文件
  if (STORAGE_BACKUP.value !== null && storagePath) {
    writeFileSync(storagePath, STORAGE_BACKUP.value, 'utf-8');
  } else if (storagePath && existsSync(storagePath)) {
    unlinkSync(storagePath);
  }
});

/**
 * 直接调用 Express 路由 handler, 不经过完整 middleware 链.
 * 模拟 Express 的 req / res 对象, 带上 query, params 等字段.
 * 处理同步和异步 handler.
 */
async function callHandler(
  method: 'get' | 'post' | 'delete',
  path: string,
  opts: { body?: unknown; query?: Record<string, string>; params?: Record<string, string> } = {},
): Promise<{ status: number; body: unknown }> {
  const internal = router as unknown as InternalRouter;
  const layer = internal.stack.find((l) => {
    if (!l.route) return false;
    if (!l.route.methods[method]) return false;
    const rp = l.route.path;
    if (path === rp) return true;
    if (rp.endsWith('/:id') && path.startsWith(rp.slice(0, -3))) return true;
    return false;
  });
  if (!layer?.route || layer.route.stack.length === 0)
    throw new Error('No route found: ' + method + ' ' + path);

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

  const { promise, resolve } = Promise.withResolvers<{ status: number; body: unknown }>();
  let done = false;
  let idx = 0;

  const next = (err?: unknown) => {
    if (done) return;
    if (err) {
      done = true;
      resolve({ status: 500, body: { error: err instanceof Error ? err.message : String(err) } });
      return;
    }
    if (idx >= handlers.length) return;
    const handler = handlers[idx]!.handle;
    idx += 1;
    try {
      const r = handler(req, res, next);
      // 支持 async handler
      if (r && typeof (r as { then?: unknown }).then === 'function') {
        (r as Promise<void>).catch((e: unknown) => {
          if (!done) {
            done = true;
            resolve({ status: 500, body: { error: e instanceof Error ? e.message : String(e) } });
          }
        });
      }
    } catch (e) {
      done = true;
      resolve({ status: 500, body: { error: e instanceof Error ? e.message : String(e) } });
    }
  };

  const res = {
    statusCode: 200,
    json(payload: unknown) {
      if (!done) {
        done = true;
        resolve({ status: this.statusCode, body: payload });
      }
    },
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    setHeader(_name: string, _value: string | number | string[]) {
      return this;
    },
    getHeader(_name: string): string | undefined {
      return undefined;
    },
  };

  next();
  return promise;
}

// ---------- 持久化测试隔离 ----------

// 测试时把持久化文件指向临时目录,避免污染真实数据.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
const tmpDir = mkdtempSync(join(tmpdir(), 'resources-test-'));

let seedId: string;

beforeEach(async () => {
  // 重置 cache + 把持久化文件重置为 seed 内容
  const mod = await import('../src/backend/routes/_resources');
  mod.resetResourcesCache();
  // 把持久化文件重定向到 tmpDir,避免污染
  process.env.TEACHING_RESOURCES_FILE = join(tmpDir, 'teaching-resources.json');
  // 写一个初始 seed 到 tmpDir
  const initialSeed = {
    version: 1,
    description: 'test seed',
    resources: [
      {
        id: 'tr-seed-1',
        lookId: 'look_cool_water',
        kind: 'article',
        title: '底妆指南',
        summary: '基础',
        tags: ['基础'],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'tr-seed-2',
        lookId: 'look_cool_water',
        kind: 'video',
        title: '视频教程',
        summary: '快速',
        tags: ['视频'],
        videoUrl: 'https://e.com/v',
        durationSec: 60,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  };
  writeFileSync(join(tmpDir, 'teaching-resources.json'), JSON.stringify(initialSeed, null, 2));
  const list = mod.listResources();
  if (list.length === 0) throw new Error('seed data empty');
  seedId = list[0]!.id;
});

afterEach(async () => {
  const mod = await import('../src/backend/routes/_resources');
  mod.resetResourcesCache();
  delete process.env.TEACHING_RESOURCES_FILE;
});

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

// ---------- GET ----------

describe('GET /teaching-resources', () => {
  it('返回 seed 资源列表', async () => {
    const r = await callHandler('get', '/teaching-resources');
    expect(r.status).toBe(200);
    const body = r.body as ListBody;
    expect(body.resources.length).toBeGreaterThan(0);
  });

  it('按 lookId 过滤', async () => {
    const r = await callHandler('get', '/teaching-resources', {
      query: { lookId: 'look_cool_water' },
    });
    expect(r.status).toBe(200);
    const body = r.body as ListBody;
    expect(body.resources.every((x) => x.lookId === 'look_cool_water')).toBe(true);
  });

  it('unknown lookId → 空数组', async () => {
    const r = await callHandler('get', '/teaching-resources', { query: { lookId: 'none' } });
    expect(r.status).toBe(200);
    expect((r.body as ListBody).resources).toEqual([]);
  });
});

describe('GET /teaching-resources/:id', () => {
  it('存在 → 200 + 完整对象', async () => {
    const r = await callHandler('get', `/teaching-resources/${seedId}`);
    expect(r.status).toBe(200);
    const body = r.body as TeachingResource;
    expect(body.id).toBe(seedId);
    expect(typeof body.title).toBe('string');
  });

  it('不存在 → 404', async () => {
    const r = await callHandler('get', '/teaching-resources/no-such-id');
    expect(r.status).toBe(404);
  });
});

// ---------- POST ----------

describe('POST /teaching-resources', () => {
  it('合法 body → 201 + 新资源', async () => {
    const r = await callHandler('post', '/teaching-resources', {
      body: { kind: 'article', title: 'test', summary: 'x', tags: '' },
    });
    expect(r.status).toBe(201);
    const body = r.body as TeachingResource;
    expect(body.kind).toBe('article');
    expect(body.title).toBe('test');
    expect(typeof body.id).toBe('string');
  });

  it('视频资源带 videoUrl', async () => {
    const r = await callHandler('post', '/teaching-resources', {
      body: { kind: 'video', title: 'vid', summary: 's', videoUrl: 'https://a.com/v', tags: '' },
    });
    expect(r.status).toBe(201);
    expect((r.body as TeachingResource).videoUrl).toBe('https://a.com/v');
  });

  it('缺 title → 400', async () => {
    const r = await callHandler('post', '/teaching-resources', {
      body: { kind: 'article', summary: 'x' },
    });
    expect(r.status).toBe(400);
  });

  it('非法 kind → 400', async () => {
    const r = await callHandler('post', '/teaching-resources', {
      body: { kind: 'bad', title: 'x', summary: 'y' },
    });
    expect(r.status).toBe(400);
  });
});

// ---------- DELETE ----------

describe('DELETE /teaching-resources/:id', () => {
  it('删除新建资源 → 200', async () => {
    const before = await callHandler('get', '/teaching-resources');
    const beforeCount = (before.body as ListBody).resources.length;

    const c = await callHandler('post', '/teaching-resources', {
      body: { kind: 'article', title: 'to-delete', summary: 'x', tags: '' },
    });
    expect(c.status).toBe(201);
    const id = (c.body as { id: string }).id;

    const r = await callHandler('delete', `/teaching-resources/${id}`);
    expect(r.status).toBe(200);

    const after = await callHandler('get', '/teaching-resources');
    expect((after.body as ListBody).resources.length).toBe(beforeCount);
  });

  it('不存在 → 404', async () => {
    const r = await callHandler('delete', '/teaching-resources/no-such-id');
    expect(r.status).toBe(404);
  });
});

// ---------- 持久化行为 ----------

describe('持久化', () => {
  it('POST 后内容写回文件', async () => {
    const c = await callHandler('post', '/teaching-resources', {
      body: { kind: 'article', title: 'persist-test', summary: 'p', tags: '' },
    });
    expect(c.status).toBe(201);

    // 验证文件内容
    const filePath = join(tmpDir, 'teaching-resources.json');
    const fileContent = readFileSync(filePath, 'utf-8');
    expect(fileContent).toContain('persist-test');
  });

  it('DELETE 后内容写回文件', async () => {
    const c = await callHandler('post', '/teaching-resources', {
      body: { kind: 'article', title: 'to-be-deleted', summary: 'd', tags: '' },
    });
    const id = (c.body as { id: string }).id;

    const r = await callHandler('delete', `/teaching-resources/${id}`);
    expect(r.status).toBe(200);

    const fileContent = readFileSync(join(tmpDir, 'teaching-resources.json'), 'utf-8');
    expect(fileContent).not.toContain('to-be-deleted');
  });
});
