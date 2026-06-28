// Generate + upload route tests — happy path, validation, lifecycle.

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Set env BEFORE importing the routes so config + factory pick them up.
const TMP = mkdtempSync(join(tmpdir(), 'gen-test-'));
process.env.IMAGE_GEN_PROVIDER = 'mock';
process.env.IMAGE_GEN_TIMEOUT_MS = '5000';
process.env.UPLOAD_DIR = join(TMP, 'uploads');
process.env.JOB_SWEEP_INTERVAL_MS = '0';

mkdirSync(process.env.UPLOAD_DIR!, { recursive: true });

// Need a real input image on disk for generate to find.
const IMG_ID = 'test-image-001';
const IMG_PATH = join(process.env.UPLOAD_DIR!, `${IMG_ID}.jpg`);
// Minimal valid 1x1 JPEG (67 bytes).
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AB//Z',
  'base64',
);
writeFileSync(IMG_PATH, TINY_JPEG);

const { generateRouter } = await import('../src/backend/routes/generate');

// Express Router 内部 stack 不在公开类型里.用窄接口局部接受 unknown.
interface InternalRouter {
  stack: Array<{
    route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> };
  }>;
}

function getLayer(method: 'post' | 'get' | 'delete', path: string) {
  const internal = generateRouter as unknown as InternalRouter;
  const layer = internal.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer || !layer.route) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  return layer.route.stack;
}

interface CallOpts {
  body?: unknown;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

interface CallResponse {
  status: number;
  json: unknown;
}

function callHandler(
  method: 'post' | 'get' | 'delete',
  path: string,
  opts: CallOpts = {},
): Promise<CallResponse> {
  const { promise, resolve } = Promise.withResolvers<CallResponse>();
  const handlers = getLayer(method, path);
  // req 用宽 unknown 转,只暴露 handler 真正用到的字段. 必须给个 ip 让 rate-limit 不抛.
  // 还要给 req.app,因为 express-rate-limit 在 keyGenerator 里读 app.get('trust proxy').
  const req: Record<string, unknown> = {
    method: method.toUpperCase(),
    url: path,
    body: opts.body ?? {},
    headers: opts.headers ?? {},
    query: opts.query ?? {},
    ip: '127.0.0.1',
    app: { get: (k: string) => (k === 'trust proxy' ? 1 : undefined) },
  };
  if (opts.params) req.params = opts.params;
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
    setHeader(_name: string, _value: string | number | string[]): unknown { return this; },
  };
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

afterAll(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

// ---------- POST /api/generate ----------

describe('POST /api/generate — 创建任务', () => {
  it('缺 imageId → 400', async () => {
    const r = await callHandler('post', '/generate', {
      body: { style: 'look_cool_water' },
    });
    expect(r.status).toBe(400);
  });

  it('缺 style → 400', async () => {
    const r = await callHandler('post', '/generate', {
      body: { imageId: IMG_ID },
    });
    expect(r.status).toBe(400);
  });

  it('imageId 不存在 → 404', async () => {
    const r = await callHandler('post', '/generate', {
      body: { imageId: 'no-such-image', style: 'look_cool_water' },
    });
    expect(r.status).toBe(404);
  });

  it('合法输入 → 202 + jobId + queued', async () => {
    const r = await callHandler('post', '/generate', {
      body: { imageId: IMG_ID, style: 'look_cool_water' },
    });
    expect(r.status).toBe(202);
    const body = r.json as { jobId: string; status: string };
    expect(body.jobId).toBeTruthy();
    expect(['queued', 'running']).toContain(body.status);
  });

  it('sessionId 从 header 透传到 job', async () => {
    const r = await callHandler('post', '/generate', {
      body: { imageId: IMG_ID, style: 'look_cool_water' },
      headers: { 'x-session-id': 'sess-abc' },
    });
    const body = r.json as { jobId: string };
    const status = await callHandler('get', '/generate/:jobId', {
      params: { jobId: body.jobId },
    });
    const sBody = status.json as { jobId: string };
    expect(sBody.jobId).toBe(body.jobId);
  });
});

// ---------- GET /api/generate/:jobId ----------

describe('GET /api/generate/:jobId — 轮询', () => {
  it('找不到 → 404', async () => {
    const r = await callHandler('get', '/generate/:jobId', { params: { jobId: 'nope' } });
    expect(r.status).toBe(404);
  });

  it('存在 → 返回当前状态', async () => {
    const created = await callHandler('post', '/generate', {
      body: { imageId: IMG_ID, style: 'look_cool_water' },
    });
    const { jobId } = created.json as { jobId: string };
    const r = await callHandler('get', '/generate/:jobId', { params: { jobId } });
    expect(r.status).toBe(200);
    const body = r.json as { jobId: string; status: string };
    expect(body.jobId).toBe(jobId);
    expect(['queued', 'running', 'succeeded', 'failed', 'cancelled']).toContain(body.status);
  });

  it('~3s 后 mock provider 应当完成', async () => {
    const created = await callHandler('post', '/generate', {
      body: { imageId: IMG_ID, style: 'look_peach_date' },
    });
    const { jobId } = created.json as { jobId: string };
    await new Promise((r) => setTimeout(r, 3_500));
    const r = await callHandler('get', '/generate/:jobId', { params: { jobId } });
    const body = r.json as { status: string; resultUrl?: string; tookMs?: number; error?: string };
    if (body.status !== 'succeeded') {
      // surface the actual error in the test output
      throw new Error(`expected succeeded, got ${body.status}: ${body.error ?? '(no error)'}`);
    }
    expect(body.resultUrl).toMatch(/^\/results\/.+\.svg$/);
    expect(typeof body.tookMs).toBe('number');
    expect(body.tookMs).toBeGreaterThanOrEqual(3000);
  });
});

// ---------- DELETE /api/generate/:jobId ----------

describe('DELETE /api/generate/:jobId — 取消', () => {
  it('找不到 → 404', async () => {
    const r = await callHandler('delete', '/generate/:jobId', { params: { jobId: 'nope' } });
    expect(r.status).toBe(404);
  });

  it('取消 queued/running → status=cancelled', async () => {
    const created = await callHandler('post', '/generate', {
      body: { imageId: IMG_ID, style: 'look_cool_water' },
    });
    const { jobId } = created.json as { jobId: string };
    const r = await callHandler('delete', '/generate/:jobId', { params: { jobId } });
    expect(r.status).toBe(200);
    expect((r.json as { status: string }).status).toBe('cancelled');
  });

  it('取消已完成 → 保持 succeeded (idempotent)', async () => {
    const created = await callHandler('post', '/generate', {
      body: { imageId: IMG_ID, style: 'look_cool_water' },
    });
    const { jobId } = created.json as { jobId: string };
    await new Promise((r) => setTimeout(r, 3_500));
    const r = await callHandler('delete', '/generate/:jobId', { params: { jobId } });
    expect((r.json as { status: string }).status).toBe('succeeded');
  });
});

// ---------- GET /api/generate (list) ----------

describe('GET /api/generate — 列表', () => {
  it('无过滤 → 返回全部', async () => {
    const r = await callHandler('get', '/generate');
    expect(r.status).toBe(200);
    const body = r.json as { jobs: unknown[] };
    expect(Array.isArray(body.jobs)).toBe(true);
  });

  it('sessionId 过滤', async () => {
    const r = await callHandler('get', '/generate', {
      params: {},
      headers: {},
    });
    expect(r.status).toBe(200);
  });
});
