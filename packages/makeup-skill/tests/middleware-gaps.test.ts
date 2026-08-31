// 中间件覆盖补全 — logger / requestId / rateLimit / validate / csrf 的缺口分支.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { requestLogger } from '../src/backend/middleware/logger';
import { requestId } from '../src/backend/middleware/requestId';
import { validateBody, type Schema } from '../src/backend/middleware/validate';
import { cookieParser, issueCsrfToken, requireCsrfToken } from '../src/backend/middleware/csrf';

// rateLimit 在模块加载时读 RATE_LIMIT_* env — 必须先设 env 再动态 import
// (测试有意覆盖 readLimit 的 env 解析分支, 静态 import 无法保证顺序).
process.env.RATE_LIMIT_ANALYTICS = '2'; // 小限额, 便于触发 429 handler
process.env.RATE_LIMIT_GLOBAL = 'not-a-number'; // NaN → fallback 分支
const { globalLimiter, analyticsLimiter } =
  await import('../src/backend/middleware/rateLimit');

// ---------- 通用假 req/res ----------

interface FakeRes {
  statusCode: number;
  body: unknown;
  headers: Record<string, string | number | string[]>;
  status(c: number): FakeRes;
  json(p: unknown): FakeRes;
  setHeader(n: string, v: string | number | string[]): FakeRes;
  getHeader(n: string): string | number | string[] | undefined;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(c: number) {
      res.statusCode = c;
      return res;
    },
    json(p: unknown) {
      res.body = p;
      return res;
    },
    setHeader(n: string, v: string | number | string[]) {
      res.headers[n.toLowerCase()] = v;
      return res;
    },
    getHeader(n: string) {
      return res.headers[n.toLowerCase()];
    },
  };
  return res;
}

function makeReq(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    method: 'POST',
    path: '/api/x',
    url: '/api/x',
    body: {},
    headers: {},
    ip: '192.168.1.100',
    app: { get: (k: string) => (k === 'trust proxy' ? 1 : undefined) },
    ...overrides,
  };
}

// ---------- requestLogger ----------

describe('requestLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function runLogger(statusCode: number) {
    const middleware = requestLogger();
    const finishCbs: Array<() => void> = [];
    const req = { id: 'req-test-1' } as Request;
    const res = {
      statusCode,
      on(event: string, cb: () => void) {
        if (event === 'finish') finishCbs.push(cb);
        return this;
      },
    } as unknown as Response;
    const next = vi.fn();
    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    for (const cb of finishCbs) cb();
  }

  it('2xx → console.info + level info', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runLogger(200);
    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    const line = JSON.parse(info.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(line.level).toBe('info');
    expect(line.result).toBe('http_200');
    expect(line.requestId).toBe('req-test-1');
    expect(typeof line.latencyMs).toBe('number');
    expect(typeof line.t).toBe('string');
  });

  it('4xx → console.warn + level warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runLogger(404);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(warn.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(line.level).toBe('warn');
    expect(line.result).toBe('http_404');
  });

  it('5xx → console.error + level error', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    runLogger(503);
    expect(error).toHaveBeenCalledTimes(1);
    const line = JSON.parse(error.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(line.level).toBe('error');
    expect(line.result).toBe('http_503');
  });
});

// ---------- requestId ----------

describe('requestId', () => {
  it('生成 uuid 并写入 X-Request-Id 响应头', () => {
    const middleware = requestId();
    const req = {} as Request;
    const res = makeRes();
    const next = vi.fn();
    middleware(req, res as unknown as Response, next as NextFunction);
    expect(req.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(res.getHeader('x-request-id')).toBe(req.id);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('两次调用生成不同 id (不串请求)', () => {
    const middleware = requestId();
    const reqA = {} as Request;
    const reqB = {} as Request;
    const noop = () => undefined;
    middleware(reqA, makeRes() as unknown as Response, noop);
    middleware(reqB, makeRes() as unknown as Response, noop);
    expect(reqA.id).not.toBe(reqB.id);
  });
});

// ---------- rateLimit ----------

describe('rateLimit', () => {
  function makeLimiterReqRes(path: string) {
    const req = makeReq({ path }) as unknown as Request;
    const res = makeRes();
    return { req, res };
  }

  it('健康检查路径被 skip, 不计数', async () => {
    const { req, res } = makeLimiterReqRes('/health');
    const next = vi.fn();
    await analyticsLimiter(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    // skip 的请求不写 RateLimit 头
    expect(res.getHeader('ratelimit-policy')).toBeUndefined();
  });

  it('env 覆盖限额 (RATE_LIMIT_ANALYTICS=2), 超限 → 429 + retryAfter', async () => {
    // 前 2 次放行
    for (let i = 0; i < 2; i++) {
      const { req, res } = makeLimiterReqRes('/api/analytics');
      const next = vi.fn();
      await analyticsLimiter(req, res as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(1);
    }
    // 第 3 次触发自定义 handler (rateLimit.ts 第 18 行)
    const { req, res } = makeLimiterReqRes('/api/analytics');
    const next = vi.fn();
    await analyticsLimiter(req, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    const body = res.body as { error: string; retryAfter: unknown };
    expect(body.error).toContain('请求过于频繁');
    expect(body.retryAfter).toBeDefined();
  });

  it('readLimit 非法 env 回退默认值 (global/analytics limiter 正常工作)', async () => {
    // RATE_LIMIT_GLOBAL='not-a-number' 已回退为默认值, 限额远大于 1, 单次请求必然放行.
    for (const limiter of [globalLimiter, analyticsLimiter]) {
      // 新鲜 IP: 避免吃到上个用例消耗的 analytics 限额
      const req = makeReq({ path: '/api/x', ip: '10.9.9.9' }) as unknown as Request;
      const res = makeRes();
      const next = vi.fn();
      await limiter(req, res as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });
});

// ---------- validateBody ----------

describe('validateBody 缺口分支', () => {
  function run(schema: Schema, body: unknown, opts?: { strict?: boolean }) {
    const middleware = validateBody(schema, opts);
    const req = makeReq({ body }) as unknown as Request;
    const res = makeRes();
    const next = vi.fn();
    middleware(req, res as unknown as Response, next as NextFunction);
    return { res, next };
  }

  it('body 是数组 → 400 请求体必须是对象', () => {
    const { res, next } = run({}, [1, 2]);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toBe('请求体必须是对象');
  });

  it('strict 默认拒绝未知字段; strict:false 放行', () => {
    const schema: Schema = { a: { type: 'string' } };
    const strictRun = run(schema, { a: 'x', evil: 1 });
    expect(strictRun.res.statusCode).toBe(400);
    const details = (strictRun.res.body as { details: Array<{ field: string; message: string }> })
      .details;
    expect(details[0]).toEqual({ field: 'evil', message: '字段不在白名单中' });

    const looseRun = run(schema, { a: 'x', evil: 1 }, { strict: false });
    expect(looseRun.next).toHaveBeenCalledTimes(1);
  });

  it('boolean: 非布尔 → 400 (第 103-104 行)', () => {
    const { res } = run({ flag: { type: 'boolean' } }, { flag: 'true' });
    expect(res.statusCode).toBe(400);
    const details = (res.body as { details: Array<{ message: string }> }).details;
    expect(details[0]!.message).toBe('必须是布尔');
  });

  it('boolean: 合法布尔 → 放行', () => {
    const { next } = run({ flag: { type: 'boolean' } }, { flag: false });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('object: 数组/ null → 400 必须是对象 (第 108 行)', () => {
    // null 被视为 "字段缺失" (present=false), optional 时放行; 数组/标量才报 "必须是对象"
    for (const bad of [[1], 'str', 42]) {
      const { res } = run({ meta: { type: 'object' } }, { meta: bad });
      expect(res.statusCode).toBe(400);
      const details = (res.body as { details: Array<{ message: string }> }).details;
      expect(details[0]!.message).toBe('必须是对象');
    }
    const { next } = run({ meta: { type: 'object' } }, { meta: null });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('object: 序列化超 max 字节 → 400 (第 111 行)', () => {
    const { res, next } = run(
      { meta: { type: 'object', max: 8 } },
      { meta: { longKey: '超过八字节的内容' } },
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    const details = (res.body as { details: Array<{ message: string }> }).details;
    expect(details[0]!.message).toContain('序列化后需 <= 8 字节');
  });

  it('object: 合法对象在 max 内 → 放行', () => {
    const { next } = run({ meta: { type: 'object', max: 1024 } }, { meta: { a: 1 } });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('enum: 非字符串 → 必须是字符串', () => {
    const { res } = run({ k: { type: 'enum', values: ['a', 'b'] } }, { k: 1 });
    expect(res.statusCode).toBe(400);
    const details = (res.body as { details: Array<{ message: string }> }).details;
    expect(details[0]!.message).toBe('必须是字符串');
  });

  it('enum: 不在取值列表 → 取值应为 a/b', () => {
    const { res } = run({ k: { type: 'enum', values: ['a', 'b'] } }, { k: 'zzz' });
    expect(res.statusCode).toBe(400);
    const details = (res.body as { details: Array<{ message: string }> }).details;
    expect(details[0]!.message).toBe('取值应为 a/b');
  });

  it('enum: 合法值 → 放行', () => {
    const { next } = run({ k: { type: 'enum', values: ['a', 'b'] } }, { k: 'b' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('string: min/max/pattern 三类失败', () => {
    const schema: Schema = { s: { type: 'string', min: 2, max: 4, pattern: /^[a-z]+$/ } };
    expect(run(schema, { s: 'x' }).res.statusCode).toBe(400); // min
    expect(run(schema, { s: 'xxxxx' }).res.statusCode).toBe(400); // max
    expect(run(schema, { s: 'AB1' }).res.statusCode).toBe(400); // pattern
    expect(run(schema, { s: 'abc' }).next).toHaveBeenCalledTimes(1);
  });

  it('number: 非有限 / min / max / ge / le', () => {
    const schema: Schema = { n: { type: 'number', ge: 1, le: 10 } };
    expect(run(schema, { n: Number.NaN }).res.statusCode).toBe(400);
    expect(run(schema, { n: 0 }).res.statusCode).toBe(400);
    expect(run(schema, { n: 11 }).res.statusCode).toBe(400);
    expect(run(schema, { n: 5 }).next).toHaveBeenCalledTimes(1);

    const minMax: Schema = { n: { type: 'number', min: 1, max: 10 } };
    expect(run(minMax, { n: 0 }).res.statusCode).toBe(400);
    expect(run(minMax, { n: 11 }).res.statusCode).toBe(400);
  });

  it('integer: 小数 → 必须是整数; 边界 ge/le', () => {
    const schema: Schema = { n: { type: 'integer', ge: 0, le: 5 } };
    expect(run(schema, { n: 1.5 }).res.statusCode).toBe(400);
    expect(run(schema, { n: -1 }).res.statusCode).toBe(400);
    expect(run(schema, { n: 6 }).res.statusCode).toBe(400);
    expect(run(schema, { n: 3 }).next).toHaveBeenCalledTimes(1);

    const minMax: Schema = { n: { type: 'integer', min: 0, max: 5 } };
    expect(run(minMax, { n: -1 }).res.statusCode).toBe(400);
    expect(run(minMax, { n: 6 }).res.statusCode).toBe(400);
  });

  it('required 缺失 → 字段必填; optional 缺失 → 放行', () => {
    const schema: Schema = {
      req: { type: 'string', required: true },
      opt: { type: 'number' },
    };
    const missing = run(schema, {});
    expect(missing.res.statusCode).toBe(400);
    const details = (missing.res.body as { details: Array<{ field: string }> }).details;
    expect(details.some((d) => d.field === 'req')).toBe(true);

    expect(run(schema, { req: 'ok' }).next).toHaveBeenCalledTimes(1);
  });
});

// ---------- csrf ----------

describe('csrf 缺口分支', () => {
  function runCsrf(reqOverrides: Record<string, unknown>) {
    const middleware = requireCsrfToken();
    const req = makeReq(reqOverrides) as unknown as Request;
    const res = makeRes();
    const next = vi.fn();
    middleware(req, res as unknown as Response, next as NextFunction);
    return { res, next };
  }

  it('cookieParser: 解析正常 / 空 / 畸形 cookie', () => {
    const parser = cookieParser();
    const cases: Array<[string | undefined, Record<string, string>]> = [
      [undefined, {}],
      ['a=1; b=2', { a: '1', b: '2' }],
      ['no-eq-part; ; k=', { k: '' }],
      ['tok=a%20b', { tok: 'a b' }],
    ];
    for (const [header, expected] of cases) {
      const req = makeReq({ headers: header === undefined ? {} : { cookie: header } });
      parser(req as unknown as Request, makeRes() as unknown as Response, () => undefined);
      expect((req as { cookies: Record<string, string> }).cookies).toEqual(expected);
    }
  });

  it('issueCsrfToken: 写入 Set-Cookie 并返回 64-hex token', () => {
    const handler = issueCsrfToken();
    const res = makeRes();
    handler({} as Request, res as unknown as Response);
    const cookie = res.getHeader('set-cookie');
    expect(typeof cookie).toBe('string');
    expect(cookie as string).toContain('csrf_token=');
    expect(cookie as string).toContain('SameSite=Lax');
    const body = res.body as { csrfToken: string };
    expect(body.csrfToken).toMatch(/^[0-9a-f]{64}$/);
    expect(cookie as string).toContain(body.csrfToken);
  });

  it('安全方法 (GET) → 直接放行', () => {
    const { next } = runCsrf({ method: 'GET' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('跳过路径 (剥前缀后的相对路径) → 放行 (第 85-86 行)', () => {
    for (const path of ['/health', '/csrf-token', '/analytics']) {
      const { next } = runCsrf({ method: 'POST', path });
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it('缺 cookie 或 header → 403 缺少 CSRF token (第 89-90 行)', () => {
    // 两者都缺
    expect(runCsrf({ method: 'POST', cookies: {} }).res.statusCode).toBe(403);
    // 只有 header
    const onlyHeader = runCsrf({
      method: 'POST',
      cookies: {},
      headers: { 'x-csrf-token': 'abc' },
    });
    expect(onlyHeader.res.statusCode).toBe(403);
    expect((onlyHeader.res.body as { error: string }).error).toBe('缺少 CSRF token');
    // 只有 cookie
    const onlyCookie = runCsrf({ method: 'POST', cookies: { csrf_token: 'abc' } });
    expect(onlyCookie.res.statusCode).toBe(403);
  });

  it('token 不匹配 → 403 (含长度不等分支)', () => {
    const mismatch = runCsrf({
      method: 'POST',
      cookies: { csrf_token: 'aaa' },
      headers: { 'x-csrf-token': 'bbb' },
    });
    expect(mismatch.res.statusCode).toBe(403);
    expect((mismatch.res.body as { error: string }).error).toBe('CSRF token 不匹配');

    const diffLen = runCsrf({
      method: 'POST',
      cookies: { csrf_token: 'aaa' },
      headers: { 'x-csrf-token': 'aaaa' },
    });
    expect(diffLen.res.statusCode).toBe(403);
  });

  it('token 一致 → 放行', () => {
    const { next } = runCsrf({
      method: 'DELETE',
      cookies: { csrf_token: 'same-token' },
      headers: { 'x-csrf-token': 'same-token' },
    });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
