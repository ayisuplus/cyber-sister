// analytics 路由测试 — 文件存储 + /stats 端点.
// 用临时目录隔离,避免污染真实 data/analytics.jsonl.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 用 vi.mock 注入 DATA_DIR,这样不需要改 analytics.ts 的硬编码路径.
import { vi } from 'vitest';

const TMP = join(tmpdir(), `analytics-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const TEST_DATA_DIR = join(TMP, 'data');

// 必须在 import analytics 之前设置 env,让模块读取 TEST_DATA_DIR
process.env.ANALYTICS_DATA_DIR = TEST_DATA_DIR;

// 现在再 import (会读 env)
const { analyticsRouter } = await import('../src/backend/routes/analytics');

// ---------- 工具: 直接调用 router handler,绕开 express ----------

function getLayer(method: 'post' | 'get', path: string) {
  const stack = (analyticsRouter as any).stack as any[];
  const layer = stack.find(
    (l: any) =>
      l.route && l.route.path === path && l.route.methods[method]
  );
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  return layer.route.stack[0].handle;
}

function callHandler(
  method: 'post' | 'get',
  path: string,
  opts: { body?: any; headers?: Record<string, string> } = {}
): Promise<{ status: number; json: any }> {
  return new Promise((resolve) => {
    const handler = getLayer(method, path);
    const req = {
      method: method.toUpperCase(),
      url: path,
      body: opts.body ?? {},
      headers: opts.headers ?? {},
    };
    const res = {
      statusCode: 200,
      json(payload: any) {
        resolve({ status: this.statusCode, json: payload });
      },
      status(c: number) {
        this.statusCode = c;
        return this;
      },
    };
    handler(req, res, () => {});
  });
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
  it('合法事件 → 200 + 写入一行 jsonl (含 event/props/timestamp/sessionId)', async () => {
    const r = await callHandler('post', '/analytics', {
      body: { event: 'result_share', props: { method: 'image' } },
      headers: { 'x-session-id': 'sess-abc' },
    });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);

    const jsonl = join(TEST_DATA_DIR, 'analytics.jsonl');
    expect(existsSync(jsonl)).toBe(true);
    const content = readFileSync(jsonl, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(1);
    const row = JSON.parse(lines[0]!);
    expect(row.event).toBe('result_share');
    expect(row.props).toEqual({ method: 'image' });
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
    expect(r.json.total).toBe(0);
    expect(r.json.byEvent).toEqual({});
  });

  it('多次写不同 event → 返回总数 + 按 event 分组计数', async () => {
    await callHandler('post', '/analytics', { body: { event: 'click' } });
    await callHandler('post', '/analytics', { body: { event: 'click' } });
    await callHandler('post', '/analytics', { body: { event: 'share' } });
    const r = await callHandler('get', '/analytics/stats');
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(3);
    expect(r.json.byEvent).toEqual({ click: 2, share: 1 });
  });

  it('坏行 (非 JSON) → 跳过不抛错', async () => {
    await callHandler('post', '/analytics', { body: { event: 'click' } });
    // 手动塞一行坏数据
    const { appendFileSync } = await import('node:fs');
    appendFileSync(join(TEST_DATA_DIR, 'analytics.jsonl'), 'this is not json\n');
    await callHandler('post', '/analytics', { body: { event: 'click' } });
    const r = await callHandler('get', '/analytics/stats');
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(2); // 坏行跳过
    expect(r.json.byEvent).toEqual({ click: 2 });
  });
});
