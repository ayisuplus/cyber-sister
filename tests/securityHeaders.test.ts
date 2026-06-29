// Tests for security headers middleware — 验证响应头按 OWASP 建议配置.
// 不依赖 supertest, 直接用 http 模块打测试 server (和 resources.test 同款).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { securityHeaders } from '../src/backend/middleware/securityHeaders';

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(() => {
  app = express();
  app.use(securityHeaders());
  app.get('/test', (_req, res) => res.json({ ok: true }));
  server = createServer(app);
  server.listen(0);
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

async function get(path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  // Convert Headers to a plain object for easy assertion
  const obj: Record<string, string | string[] | undefined> = {};
  res.headers.forEach((v, k) => {
    obj[k.toLowerCase()] = v;
  });
  return { status: res.status, headers: obj };
}

describe('securityHeaders: CSP', () => {
  it('sets a strict Content-Security-Policy', async () => {
    const r = await get('/test');
    const csp = r.headers['content-security-policy'];
    expect(typeof csp).toBe('string');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it('CSP does NOT allow unsafe-eval in script-src', async () => {
    const r = await get('/test');
    const csp = r.headers['content-security-policy'] as string;
    expect(csp).not.toMatch(/script-src[^;]*unsafe-eval/);
  });

  it('CSP does NOT allow unsafe-inline in script-src (only style)', async () => {
    const r = await get('/test');
    const csp = r.headers['content-security-policy'] as string;
    const scriptDir = csp.split(';').find((d) => d.trim().startsWith('script-src'));
    expect(scriptDir).toBeDefined();
    expect(scriptDir).not.toContain('unsafe-inline');
  });

  it('CSP includes upgrade-insecure-requests', async () => {
    const r = await get('/test');
    const csp = r.headers['content-security-policy'] as string;
    expect(csp).toContain('upgrade-insecure-requests');
  });
});

describe('securityHeaders: Permissions-Policy', () => {
  it('disables most features by default', async () => {
    const r = await get('/test');
    const pp = r.headers['permissions-policy'];
    expect(pp).toBeDefined();
    expect(pp).toContain('camera=(self)');
    expect(pp).toContain('geolocation=()');
    expect(pp).toContain('microphone=()');
    expect(pp).toContain('payment=()');
    expect(pp).toContain('usb=()');
  });
});

describe('securityHeaders: Other headers', () => {
  it('sets Referrer-Policy to strict-origin-when-cross-origin', async () => {
    const r = await get('/test');
    expect(r.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('sets Cross-Origin-Opener-Policy to same-origin', async () => {
    const r = await get('/test');
    expect(r.headers['cross-origin-opener-policy']).toBe('same-origin');
  });

  it('sets X-Content-Type-Options to nosniff', async () => {
    const r = await get('/test');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-XSS-Protection to 0 (modern recommendation)', async () => {
    const r = await get('/test');
    expect(r.headers['x-xss-protection']).toBe('0');
  });

  it('disables DNS prefetch', async () => {
    const r = await get('/test');
    expect(r.headers['x-dns-prefetch-control']).toBe('off');
  });
});

describe('securityHeaders: HSTS conditional on HTTPS', () => {
  it('does NOT set HSTS for plain HTTP requests', async () => {
    const r = await get('/test');
    expect(r.headers['strict-transport-security']).toBeUndefined();
  });

  it('sets HSTS for X-Forwarded-Proto: https', async () => {
    const r = await get('/test', { 'X-Forwarded-Proto': 'https' });
    const hsts = r.headers['strict-transport-security'];
    expect(hsts).toBeDefined();
    expect(hsts).toContain('max-age=31536000');
    expect(hsts).toContain('includeSubDomains');
    expect(hsts).toContain('preload');
  });
});
