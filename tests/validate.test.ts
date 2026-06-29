// Tests for the strict schema validation middleware.
// 覆盖: mass assignment 防护 / pattern 校验 / type 严格性.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { validateBody, type Schema } from '../src/backend/middleware/validate';

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(() => {
  app = express();
  app.use(express.json());

  app.post(
    '/strict',
    validateBody(
      {
        name: { type: 'string', required: true, min: 1, max: 50 },
      },
      { strict: true },
    ),
    (req, res) => res.json({ ok: true, body: req.body }),
  );
  app.post(
    '/permissive',
    validateBody(
      {
        name: { type: 'string', required: true, min: 1, max: 50 },
      },
      { strict: false },
    ),
    (req, res) => res.json({ ok: true, body: req.body }),
  );
  app.post(
    '/pattern',
    validateBody(
      {
        slug: {
          type: 'string',
          required: true,
          min: 1,
          max: 50,
          pattern: /^[a-z0-9-]+$/,
        },
      },
      { strict: true },
    ),
    (_req, res) => res.json({ ok: true }),
  );
  app.post(
    '/num',
    validateBody(
      {
        age: { type: 'integer', required: true, ge: 0, le: 150 },
      },
      { strict: true },
    ),
    (_req, res) => res.json({ ok: true }),
  );
  app.post(
    '/must-be-obj',
    validateBody(
      { name: { type: 'string', required: true, min: 1, max: 50 } },
      { strict: true },
    ),
    (_req, res) => res.json({ ok: true }),
  );

  server = createServer(app);
  server.listen(0);
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

async function post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const r = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

describe('validateBody: strict mode (default)', () => {
  it('accepts valid input', async () => {
    const r = await post('/strict', { name: 'hello' });
    expect(r.status).toBe(200);
  });

  it('rejects mass assignment (unknown fields)', async () => {
    // 攻击者尝试 POST { name: 'x', isAdmin: true } — mass assignment
    const r = await post('/strict', { name: 'hello', isAdmin: true });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('isAdmin');
  });

  it('rejects missing required field', async () => {
    const r = await post('/strict', {});
    expect(r.status).toBe(400);
  });

  it('rejects wrong type', async () => {
    const r = await post('/strict', { name: 123 });
    expect(r.status).toBe(400);
  });

  it('rejects too-long string', async () => {
    const r = await post('/strict', { name: 'x'.repeat(100) });
    expect(r.status).toBe(400);
  });
});

describe('validateBody: permissive mode', () => {
  it('accepts unknown fields', async () => {
    const r = await post('/permissive', { name: 'hello', isAdmin: true });
    expect(r.status).toBe(200);
  });
});

describe('validateBody: pattern validation', () => {
  it('accepts value matching pattern', async () => {
    const r = await post('/pattern', { slug: 'hello-world-123' });
    expect(r.status).toBe(200);
  });

  it('rejects value not matching pattern', async () => {
    const r = await post('/pattern', { slug: 'Hello World!' });
    expect(r.status).toBe(400);
  });

  it('rejects SQL injection pattern attempt', async () => {
    const r = await post('/pattern', { slug: "'; DROP TABLE--" });
    expect(r.status).toBe(400);
  });
});

describe('validateBody: integer / number ranges', () => {
  it('accepts integer in range', async () => {
    const r = await post('/num', { age: 25 });
    expect(r.status).toBe(200);
  });

  it('rejects integer out of range', async () => {
    const r = await post('/num', { age: 200 });
    expect(r.status).toBe(400);
  });

  it('rejects float when integer expected', async () => {
    const r = await post('/num', { age: 25.5 });
    expect(r.status).toBe(400);
  });
});

describe('validateBody: body must be an object', () => {
  it('rejects array body', async () => {
    const r = await fetch(`${baseUrl}/must-be-obj`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([1, 2, 3]),
    });
    expect(r.status).toBe(400);
  });
});

// 防止导出被未使用
void ((_s: Schema) => _s);
