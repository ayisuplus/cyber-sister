// Tests for CSRF middleware — double-submit cookie pattern.
// 策略: 在 beforeAll 里直接调一次 issueCsrfToken() / requireCsrfToken()
// 拿到 handler, 避免 vitest transform 二次调用.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { cookieParser, issueCsrfToken, requireCsrfToken } from '../src/backend/middleware/csrf';

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.get('/api/csrf-token', issueCsrfToken());
  // requireCsrfToken() 返回中间件, 直接挂到 /api/safe-action
  const csrfGuard = requireCsrfToken();
  app.post('/api/safe-action', csrfGuard, (_req, res) => res.json({ ok: true }));
  app.delete('/api/safe-action/:id', csrfGuard, (_req, res) => res.json({ ok: true }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

interface CsrfBody {
  csrfToken: string;
}

async function getToken(): Promise<{ token: string; cookie: string }> {
  const r = await fetch(`${baseUrl}/api/csrf-token`);
  const body = (await r.json()) as CsrfBody;
  const setCookie = r.headers.get('set-cookie') ?? '';
  const m = /csrf_token=([^;]+)/.exec(setCookie);
  return { token: body.csrfToken, cookie: m?.[1] ?? '' };
}

async function call(
  method: string,
  path: string,
  opts: { cookie?: string; token?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.cookie) headers['Cookie'] = `csrf_token=${opts.cookie}`;
  if (opts.token) headers['X-CSRF-Token'] = opts.token;
  const r = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: method !== 'GET' ? '{}' : undefined,
  });
  return { status: r.status, body: await r.json() };
}

describe('CSRF: token issuance', () => {
  it('GET /api/csrf-token returns 200 with random hex token', async () => {
    const r = await fetch(`${baseUrl}/api/csrf-token`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as CsrfBody;
    expect(body.csrfToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it('sets csrf_token cookie with SameSite=Lax', async () => {
    const r = await fetch(`${baseUrl}/api/csrf-token`);
    const setCookie = r.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/csrf_token=[a-f0-9]{64}/);
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Max-Age=86400');
  });

  it('cookie value matches body token', async () => {
    const { token, cookie } = await getToken();
    expect(cookie).toBe(token);
  });

  it('each request gets a different token', async () => {
    const a = await getToken();
    const b = await getToken();
    expect(a.token).not.toBe(b.token);
  });
});

describe('CSRF: unsafe methods require token', () => {
  it('POST without token → 403', async () => {
    const r = await call('POST', '/api/safe-action');
    expect(r.status).toBe(403);
  });

  it('POST with cookie only (no header) → 403', async () => {
    const { cookie } = await getToken();
    const r = await call('POST', '/api/safe-action', { cookie });
    expect(r.status).toBe(403);
  });

  it('POST with header only (no cookie) → 403', async () => {
    const { token } = await getToken();
    const r = await call('POST', '/api/safe-action', { token });
    expect(r.status).toBe(403);
  });

  it('POST with mismatched cookie and header → 403', async () => {
    const { token } = await getToken();
    const r = await call('POST', '/api/safe-action', {
      cookie: 'a'.repeat(64),
      token,
    });
    expect(r.status).toBe(403);
  });

  it('POST with matching cookie + header → 200', async () => {
    const { token, cookie } = await getToken();
    const r = await call('POST', '/api/safe-action', { cookie, token });
    expect(r.status).toBe(200);
  });

  it('DELETE with matching cookie + header → 200', async () => {
    const { token, cookie } = await getToken();
    const r = await call('DELETE', '/api/safe-action/abc', { cookie, token });
    expect(r.status).toBe(200);
  });
});

describe('CSRF: timing-safe compare', () => {
  it('rejects near-miss tokens (length differs)', async () => {
    const { cookie } = await getToken();
    const r = await call('POST', '/api/safe-action', {
      cookie,
      token: 'short',
    });
    expect(r.status).toBe(403);
  });

  it('rejects tokens that differ in last char', async () => {
    const { token, cookie } = await getToken();
    const lastChar = token[token.length - 1];
    const flipped = lastChar === 'a' ? 'b' : 'a';
    const badToken = token.slice(0, -1) + flipped;
    const r = await call('POST', '/api/safe-action', {
      cookie,
      token: badToken,
    });
    expect(r.status).toBe(403);
  });
});

describe('CSRF: GET requests skip CSRF check', () => {
  it('GET /api/csrf-token does not require token', async () => {
    const r = await fetch(`${baseUrl}/api/csrf-token`);
    expect(r.status).toBe(200);
  });
});
