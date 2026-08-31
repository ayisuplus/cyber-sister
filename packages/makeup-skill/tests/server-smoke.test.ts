// server.ts 集成冒烟 — 真实 import 整个 Express 装配 (中间件链 + 路由 + 静态托管 +
// 404/500 兜底), 用临时端口 + tmp 目录隔离持久化副作用.
// 不触发 SIGTERM/SIGINT (shutdown 会 process.exit).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { once } from 'node:events';
import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let baseUrl: string;
const tmpDir = mkdtempSync(join(tmpdir(), 'server-smoke-'));

async function freePort(): Promise<number> {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const port = (srv.address() as net.AddressInfo).port;
  srv.close();
  await once(srv, 'close');
  return port;
}

async function waitReady(): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      const r = await fetch(`${baseUrl}/api/health`);
      if (r.ok) return;
    } catch {
      // 还没起来,继续等
    }
    if (Date.now() > deadline) throw new Error('server 未在 10s 内就绪');
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  const port = await freePort();
  process.env.PORT = String(port);
  process.env.ANALYTICS_DATA_DIR = join(tmpDir, 'analytics');
  process.env.TEACHING_RESOURCES_FILE = join(tmpDir, 'resources.json');
  // 必须动态 import: config 在模块加载时读 env, 静态 import 会先于此处的 env 设置执行
  await import('../src/backend/server');
  baseUrl = `http://127.0.0.1:${port}`;
  await waitReady();
}, 30_000);

afterAll(() => {
  delete process.env.PORT;
  delete process.env.ANALYTICS_DATA_DIR;
  delete process.env.TEACHING_RESOURCES_FILE;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('server 装配冒烟', () => {
  it('GET /api/health → 200 + X-Request-Id 头 (requestId 中间件接线)', async () => {
    const r = await fetch(`${baseUrl}/api/health`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { status: string; name: string };
    expect(body.status).toBe('ok');
    expect(body.name).toContain('赛博姐妹');
    expect(r.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('GET /api/csrf-token → 200 签发 token + cookie (限流器之前)', async () => {
    const r = await fetch(`${baseUrl}/api/csrf-token`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { csrfToken: string };
    expect(typeof body.csrfToken).toBe('string');
    expect(r.headers.get('set-cookie')).toContain('csrf_token');
  });

  it('POST /api/recommend 不带 CSRF token → 403 (CSRF 中间件接线)', async () => {
    const r = await fetch(`${baseUrl}/api/recommend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(r.status).toBe(403);
  });

  it('未知 /api 路径 → 404 JSON + reqId (非 /api 的 GET 由 SPA fallback 接管)', async () => {
    const r = await fetch(`${baseUrl}/api/definitely-not-here`);
    expect(r.status).toBe(404);
    const body = (await r.json()) as { error: string; reqId: string };
    expect(body.error).toBe('Not Found');
    expect(typeof body.reqId).toBe('string');
  });

  it('畸形 JSON body → 400 (body-parser SyntaxError 的 status 透传, 不压成 500)', async () => {
    const r = await fetch(`${baseUrl}/api/recommend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{broken json',
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: string; reqId: string };
    expect(typeof body.error).toBe('string');
    expect(typeof body.reqId).toBe('string');
  });
  it('超大 JSON body → 413 (entity.too.large 的 status 透传)', async () => {
    const r = await fetch(`${baseUrl}/api/recommend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // express.json limit 是 256kb
      body: `{"pad":"${'x'.repeat(300 * 1024)}"}`,
    });
    expect(r.status).toBe(413);
  });

  it('POST /api/analytics 无 CSRF token 不被 403 (SKIP_PATHS 剥前缀回归)', async () => {
    const r = await fetch(`${baseUrl}/api/analytics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'smoke_test' }),
    });
    expect(r.status).not.toBe(403);
    expect(r.status).toBe(200);
  });

  it('public/ 静态文件带 nosniff 头 (静态托管接线)', async () => {
    const r = await fetch(`${baseUrl}/index.html`);
    expect(r.status).toBe(200);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
