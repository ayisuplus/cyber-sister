// frontend utils 行为测试 — runtime / csrf / fetch / cache / image.
// 无 jsdom: window/document/Image/FileReader 用最小 stub, 模块级缓存用
// vi.resetModules + 动态 import 隔离.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { API_BASE, APP_BASE, MODEL_BASE, toApiUrl, getMainAccessToken } from '../src/frontend/utils/runtime';

// ---------- runtime ----------

describe('runtime', () => {
  it('API_BASE/APP_BASE/MODEL_BASE 从 import.meta.env 派生且尾部斜杠规整', () => {
    expect(API_BASE.endsWith('/')).toBe(false);
    expect(APP_BASE.endsWith('/')).toBe(true);
    expect(MODEL_BASE).toBe(`${APP_BASE}mp-models`);
  });

  it('toApiUrl 重写 /api 前缀到 API_BASE', () => {
    expect(toApiUrl('/api/upload')).toBe(`${API_BASE}/upload`);
  });

  it('toApiUrl 非 /api 路径原样返回', () => {
    expect(toApiUrl('/tools')).toBe('/tools');
    expect(toApiUrl('https://x.com/api/y')).toBe('https://x.com/api/y');
  });
  it('toApiUrl 精确匹配: /apix 不被误重写, /api 本身重写为 API_BASE', () => {
    expect(toApiUrl('/apix')).toBe('/apix');
    expect(toApiUrl('/api')).toBe(API_BASE);
    expect(toApiUrl('/api/')).toBe(`${API_BASE}/`);
  });

  describe('getMainAccessToken', () => {
    afterEach(() => {
      delete (globalThis as Record<string, unknown>).window;
    });

    it('无 window 环境返回 null', () => {
      expect(getMainAccessToken()).toBeNull();
    });

    it('localStorage 有合法 token 时返回 token', () => {
      (globalThis as Record<string, unknown>).window = {
        localStorage: {
          getItem: () => JSON.stringify({ state: { token: 'tok-123' } }),
        },
      };
      expect(getMainAccessToken()).toBe('tok-123');
    });

    it('存储内容为空返回 null', () => {
      (globalThis as Record<string, unknown>).window = {
        localStorage: { getItem: () => null },
      };
      expect(getMainAccessToken()).toBeNull();
    });

    it('token 不是字符串时返回 null', () => {
      (globalThis as Record<string, unknown>).window = {
        localStorage: { getItem: () => JSON.stringify({ state: { token: 42 } }) },
      };
      expect(getMainAccessToken()).toBeNull();
    });

    it('localStorage 抛异常 (隐私模式) 返回 null', () => {
      (globalThis as Record<string, unknown>).window = {
        localStorage: {
          getItem: () => {
            throw new Error('denied');
          },
        },
      };
      expect(getMainAccessToken()).toBeNull();
    });

    it('JSON 损坏时返回 null', () => {
      (globalThis as Record<string, unknown>).window = {
        localStorage: { getItem: () => '{broken' },
      };
      expect(getMainAccessToken()).toBeNull();
    });
  });
});

// ---------- csrf (前端客户端) ----------

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

describe('frontend csrf', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function importCsrf() {
    return import('../src/frontend/utils/csrf');
  }

  it('ensureCsrfToken 拉取并缓存 token, 第二次不再发请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { csrfToken: 't1' }));
    vi.stubGlobal('fetch', fetchMock);
    const csrf = await importCsrf();

    expect(await csrf.ensureCsrfToken()).toBe('t1');
    expect(await csrf.ensureCsrfToken()).toBe('t1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(toApiUrl('/api/csrf-token'));
  });

  it('并发调用共享同一 inflight 请求', async () => {
    let release!: (r: Response) => void;
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );
    vi.stubGlobal('fetch', fetchMock);
    const csrf = await importCsrf();

    const p1 = csrf.ensureCsrfToken();
    const p2 = csrf.ensureCsrfToken();
    release(jsonResponse(200, { csrfToken: 't-shared' }));
    expect(await p1).toBe('t-shared');
    expect(await p2).toBe('t-shared');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('token 接口非 2xx 抛错, 且 inflight 清理后下次可重试', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(jsonResponse(200, { csrfToken: 't2' }));
    vi.stubGlobal('fetch', fetchMock);
    const csrf = await importCsrf();

    await expect(csrf.ensureCsrfToken()).rejects.toThrow('csrf token fetch failed: 500');
    expect(await csrf.ensureCsrfToken()).toBe('t2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resetCsrfToken 清空缓存, 下次重新拉取', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { csrfToken: 'a' }))
      .mockResolvedValueOnce(jsonResponse(200, { csrfToken: 'b' }));
    vi.stubGlobal('fetch', fetchMock);
    const csrf = await importCsrf();

    expect(await csrf.ensureCsrfToken()).toBe('a');
    csrf.resetCsrfToken();
    expect(await csrf.ensureCsrfToken()).toBe('b');
  });

  it('withCsrfHeader 对 safe method 原样返回 init', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const csrf = await importCsrf();

    const init = { headers: { 'X-A': '1' } };
    expect(await csrf.withCsrfHeader('GET', init)).toBe(init);
    expect(await csrf.withCsrfHeader('head', init)).toBe(init);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('withCsrfHeader 对 credentials:omit 不加 header', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const csrf = await importCsrf();

    const init: RequestInit = { credentials: 'omit' };
    expect(await csrf.withCsrfHeader('POST', init)).toBe(init);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('withCsrfHeader 对 unsafe method 注入 token 且保留原 headers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { csrfToken: 'tok' })));
    const csrf = await importCsrf();

    const out = await csrf.withCsrfHeader('post', { headers: { 'Content-Type': 'application/json' } });
    expect(out.headers).toEqual({
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'tok',
    });
  });

  it('withCsrfHeader 无 init 时给默认空对象', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { csrfToken: 'tok' })));
    const csrf = await importCsrf();

    const out = await csrf.withCsrfHeader('DELETE');
    expect(out.headers).toEqual({ 'X-CSRF-Token': 'tok' });
  });
});

// ---------- fetchJson ----------

describe('fetchJson', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function importFetch() {
    return import('../src/frontend/utils/fetch');
  }

  it('GET 成功返回解析后的 JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { ok: 1 })));
    const { fetchJson } = await importFetch();

    await expect(fetchJson<{ ok: number }>('/api/x')).resolves.toEqual({ ok: 1 });
  });

  it('URL 经 toApiUrl 重写', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchJson } = await importFetch();

    await fetchJson('/api/y');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(toApiUrl('/api/y'));
  });

  it('4xx (非 429) 立即抛错不重试, 消息带响应正文截断', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { msg: 'bad' }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchJson } = await importFetch();

    await expect(fetchJson('/api/x', { retries: 3, baseDelayMs: 1 })).rejects.toThrow(
      /^HTTP 400: /,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('5xx 中不可重试状态码 (500) 也立即抛错', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchJson } = await importFetch();

    await expect(fetchJson('/api/x', { retries: 2, baseDelayMs: 1 })).rejects.toThrow('HTTP 500');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('响应正文读取失败时错误消息为空文本', async () => {
    const badRes = {
      ok: false,
      status: 400,
      text: () => Promise.reject(new Error('stream boom')),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(badRes));
    const { fetchJson } = await importFetch();

    await expect(fetchJson('/api/x')).rejects.toThrow('HTTP 400: ');
  });

  it('503 退避重试后成功', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, { done: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchJson } = await importFetch();

    await expect(
      fetchJson('/api/x', { retries: 2, baseDelayMs: 1 }),
    ).resolves.toEqual({ done: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('429 属于可重试状态码', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchJson } = await importFetch();

    await expect(fetchJson('/api/x', { retries: 1, baseDelayMs: 1 })).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('重试耗尽后抛最后一次错误', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503, {}));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchJson } = await importFetch();

    await expect(fetchJson('/api/x', { retries: 1, baseDelayMs: 1 })).rejects.toThrow('HTTP 503');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('网络错误 (fetch reject) 会被重试', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(200, { ok: 2 }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchJson } = await importFetch();

    await expect(fetchJson('/api/x', { retries: 1, baseDelayMs: 1 })).resolves.toEqual({
      ok: 2,
    });
  });

  it('非法 JSON 响应抛错且可被重试', async () => {
    const notJson = {
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('nope')),
      text: () => Promise.resolve('nope'),
    } as unknown as Response;
    const fetchMock = vi.fn().mockResolvedValue(notJson);
    vi.stubGlobal('fetch', fetchMock);
    const { fetchJson } = await importFetch();

    await expect(fetchJson('/api/x', { retries: 0 })).rejects.toThrow('响应不是合法 JSON');
    // retries=0 时只请求一次
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('超时触发 AbortError 且不进入重试', async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { fetchJson } = await importFetch();

    await expect(fetchJson('/api/slow', { timeoutMs: 20, retries: 3 })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('父级 signal 已 abort 时立即失败', async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          if (init.signal?.aborted) reject(new DOMException('Aborted', 'AbortError'));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { fetchJson } = await importFetch();

    const parent = new AbortController();
    parent.abort();
    await expect(fetchJson('/api/x', { signal: parent.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('父级 signal 在退避等待期间 abort → delay 拒绝', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503, {}));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchJson } = await importFetch();

    const parent = new AbortController();
    const p = fetchJson('/api/x', { retries: 5, baseDelayMs: 10_000, signal: parent.signal });
    // 第一次 503 后进入长退避, 此时 abort
    setTimeout(() => parent.abort(), 30);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('unsafe method 自动注入 CSRF header', async () => {
    vi.doMock('../src/frontend/utils/csrf', () => ({
      withCsrfHeader: vi.fn((_method: string, init: RequestInit) =>
        Promise.resolve({ ...init, headers: { ...(init.headers ?? {}), 'X-CSRF-Token': 'mocked' } }),
      ),
    }));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchJson } = await importFetch();

    await fetchJson('/api/x', { method: 'POST' });
    const sentInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((sentInit.headers as Record<string, string>)['X-CSRF-Token']).toBe('mocked');
    vi.doUnmock('../src/frontend/utils/csrf');
  });

  it('CSRF token 拉取失败时仍发出请求 (由后端拒绝)', async () => {
    vi.doMock('../src/frontend/utils/csrf', () => ({
      withCsrfHeader: () => Promise.reject(new Error('csrf down')),
    }));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchJson } = await importFetch();

    await expect(fetchJson('/api/x', { method: 'DELETE' })).resolves.toEqual({ ok: true });
    const sentInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(sentInit.headers).toBeUndefined();
    vi.doUnmock('../src/frontend/utils/csrf');
  });

  it('GET 请求不调用 withCsrfHeader', async () => {
    const withCsrfHeader = vi.fn();
    vi.doMock('../src/frontend/utils/csrf', () => ({ withCsrfHeader }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {})));
    const { fetchJson } = await importFetch();

    await fetchJson('/api/x');
    expect(withCsrfHeader).not.toHaveBeenCalled();
    vi.doUnmock('../src/frontend/utils/csrf');
  });
  it('unsafe 请求 403 → 重置 token 重取并自愈重试一次', async () => {
    let token = 'stale';
    const resetCsrfToken = vi.fn(() => {
      token = 'fresh';
    });
    vi.doMock('../src/frontend/utils/csrf', () => ({
      resetCsrfToken,
      withCsrfHeader: vi.fn((_m: string, init: RequestInit) =>
        Promise.resolve({
          ...init,
          headers: { ...(init.headers ?? {}), 'X-CSRF-Token': token },
        }),
      ),
    }));
    // 服务端只接受 fresh token
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const sent = (init.headers as Record<string, string>)['X-CSRF-Token'];
      return Promise.resolve(
        sent === 'fresh' ? jsonResponse(200, { ok: true }) : jsonResponse(403, {}),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchJson } = await importFetch();

    await expect(fetchJson('/api/x', { method: 'POST' })).resolves.toEqual({ ok: true });
    expect(resetCsrfToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 第二次请求带的是新 token
    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect((secondInit.headers as Record<string, string>)['X-CSRF-Token']).toBe('fresh');
    vi.doUnmock('../src/frontend/utils/csrf');
  });

  it('自愈后再次 403 → 抛错, 不再二次重试', async () => {
    const resetCsrfToken = vi.fn();
    vi.doMock('../src/frontend/utils/csrf', () => ({
      resetCsrfToken,
      withCsrfHeader: vi.fn((_m: string, init: RequestInit) => Promise.resolve(init)),
    }));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { msg: 'forbidden' }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchJson } = await importFetch();

    await expect(fetchJson('/api/x', { method: 'DELETE', retries: 3, baseDelayMs: 1 }))
      .rejects.toThrow('HTTP 403');
    // 首次 + 自愈重试一次, 总共 2 次 (不退避重试 403)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resetCsrfToken).toHaveBeenCalledTimes(1);
    vi.doUnmock('../src/frontend/utils/csrf');
  });

  it('GET 请求 403 不触发自愈 (仅 unsafe 方法)', async () => {
    const resetCsrfToken = vi.fn();
    const withCsrfHeader = vi.fn();
    vi.doMock('../src/frontend/utils/csrf', () => ({ resetCsrfToken, withCsrfHeader }));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, {}));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchJson } = await importFetch();

    await expect(fetchJson('/api/x', { retries: 1, baseDelayMs: 1 })).rejects.toThrow(
      'HTTP 403',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resetCsrfToken).not.toHaveBeenCalled();
    vi.doUnmock('../src/frontend/utils/csrf');
  });
});

// ---------- cache ----------

interface FakeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(i: number): string | null;
  readonly length: number;
  __map: Map<string, string>;
}

function makeFakeStorage(opts: { throwOnSet?: boolean } = {}): FakeStorage {
  const map = new Map<string, string>();
  return {
    __map: map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      if (opts.throwOnSet && k !== '__cache_probe__') throw new Error('quota');
      map.set(k, v);
    },
    removeItem: (k) => void map.delete(k),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
}

describe('cache', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  async function importCacheWithStorage(store: FakeStorage | null) {
    if (store) {
      (globalThis as Record<string, unknown>).window = { sessionStorage: store };
    }
    return import('../src/frontend/utils/cache');
  }

  it('无 window 时退化为纯计算 (不缓存)', async () => {
    const cache = await importCacheWithStorage(null);
    const compute = vi.fn().mockResolvedValue('v');
    expect(await cache.cached('k', 1000, compute)).toBe('v');
    expect(await cache.cached('k', 1000, compute)).toBe('v');
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('命中未过期缓存时不调 compute', async () => {
    const store = makeFakeStorage();
    const cache = await importCacheWithStorage(store);
    store.__map.set('zw:a', JSON.stringify({ value: 'cached', expireAt: Date.now() + 60_000 }));

    const compute = vi.fn().mockResolvedValue('fresh');
    expect(await cache.cached('zw:a', 1000, compute)).toBe('cached');
    expect(compute).not.toHaveBeenCalled();
  });

  it('缓存过期后重算并覆盖存储', async () => {
    const store = makeFakeStorage();
    const cache = await importCacheWithStorage(store);
    store.__map.set('zw:a', JSON.stringify({ value: 'stale', expireAt: Date.now() - 1 }));

    const compute = vi.fn().mockResolvedValue('fresh');
    expect(await cache.cached('zw:a', 1000, compute)).toBe('fresh');
    expect(JSON.parse(store.__map.get('zw:a')!).value).toBe('fresh');
  });

  it('缓存 JSON 损坏时删除坏条目并重算', async () => {
    const store = makeFakeStorage();
    const cache = await importCacheWithStorage(store);
    store.__map.set('zw:a', '{oops');

    const compute = vi.fn().mockResolvedValue('fresh');
    expect(await cache.cached('zw:a', 1000, compute)).toBe('fresh');
  });

  it('并发调用去重: compute 只跑一次', async () => {
    const store = makeFakeStorage();
    const cache = await importCacheWithStorage(store);
    let release!: (v: string) => void;
    const compute = vi.fn().mockImplementation(() => new Promise<string>((r) => (release = r)));

    const p1 = cache.cached('zw:c', 1000, compute);
    const p2 = cache.cached('zw:c', 1000, compute);
    release('shared');
    expect(await p1).toBe('shared');
    expect(await p2).toBe('shared');
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('compute 抛错后 inflight 清理, 下次可重试', async () => {
    const store = makeFakeStorage();
    const cache = await importCacheWithStorage(store);
    const compute = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('recovered');

    await expect(cache.cached('zw:e', 1000, compute)).rejects.toThrow('boom');
    expect(await cache.cached('zw:e', 1000, compute)).toBe('recovered');
  });

  it('写入 storage 抛 quota 错时静默降级, 值仍返回', async () => {
    const store = makeFakeStorage({ throwOnSet: true });
    const cache = await importCacheWithStorage(store);
    expect(await cache.cached('zw:q', 1000, () => Promise.resolve('v'))).toBe('v');
    expect(store.__map.has('zw:q')).toBe(false);
  });

  it('invalidate 删除指定 key 与 inflight', async () => {
    const store = makeFakeStorage();
    const cache = await importCacheWithStorage(store);
    store.__map.set('zw:a', JSON.stringify({ value: 'v', expireAt: Date.now() + 60_000 }));

    cache.invalidate('zw:a');
    expect(store.__map.has('zw:a')).toBe(false);

    const compute = vi.fn().mockResolvedValue('new');
    expect(await cache.cached('zw:a', 1000, compute)).toBe('new');
  });

  it('invalidateAll 只清 zw: 前缀', async () => {
    const store = makeFakeStorage();
    const cache = await importCacheWithStorage(store);
    store.__map.set('zw:a', '1');
    store.__map.set('zw:b', '2');
    store.__map.set('other', '3');

    cache.invalidateAll();
    expect(store.__map.has('zw:a')).toBe(false);
    expect(store.__map.has('zw:b')).toBe(false);
    expect(store.__map.get('other')).toBe('3');
  });

  it('无 storage 时 invalidateAll 直接返回不报错', async () => {
    const cache = await importCacheWithStorage(null);
    expect(() => cache.invalidateAll()).not.toThrow();
    expect(() => cache.invalidate('k')).not.toThrow();
  });
});

// ---------- image ----------

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  static nextSize = { w: 100, h: 100 };
  static failNext = false;
  set src(_v: string) {
    const { w, h } = FakeImage.nextSize;
    const fail = FakeImage.failNext;
    setTimeout(() => {
      this.naturalWidth = w;
      this.naturalHeight = h;
      if (fail) this.onerror?.();
      else this.onload?.();
    }, 0);
  }
}

interface FakeCanvas {
  width: number;
  height: number;
  getContext(kind: string): unknown;
  toBlob(cb: (b: Blob | null) => void, type?: string, quality?: number): void;
}

function makeCanvas(behavior: {
  noCtx?: boolean;
  /** 按 quality 返回 blob 大小; null 表示 toBlob 回调 null */
  sizeFor?: (quality: number) => number | null;
}): FakeCanvas {
  const drawn: unknown[] = [];
  const ctx = { drawImage: (...args: unknown[]) => drawn.push(args) };
  return {
    width: 0,
    height: 0,
    getContext: () => (behavior.noCtx ? null : ctx),
    toBlob: (cb, _type, quality = 0.86) => {
      const size = behavior.sizeFor ? behavior.sizeFor(quality) : 100;
      cb(size === null ? null : new Blob([new Uint8Array(size)]));
    },
  };
}

describe('image', () => {
  let createdCanvas: FakeCanvas;
  let canvasBehavior: { noCtx?: boolean; sizeFor?: (q: number) => number | null };

  beforeEach(() => {
    vi.resetModules();
    FakeImage.failNext = false;
    canvasBehavior = {};
    (globalThis as Record<string, unknown>).Image = FakeImage;
    const URLGlobal = (globalThis as Record<string, unknown>).URL as typeof URL;
    URLGlobal.createObjectURL = vi.fn(() => 'blob:fake');
    URLGlobal.revokeObjectURL = vi.fn();
    (globalThis as Record<string, unknown>).document = {
      createElement: () => {
        createdCanvas = makeCanvas(canvasBehavior);
        return createdCanvas;
      },
    };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).Image;
    delete (globalThis as Record<string, unknown>).document;
  });

  async function importImage() {
    return import('../src/frontend/utils/image');
  }

  const src = new Blob(['x'], { type: 'image/png' });

  it('小图不缩放, 直接按原尺寸绘制', async () => {
    FakeImage.nextSize = { w: 800, h: 600 };
    const { compressImage } = await importImage();
    const out = await compressImage(src);
    expect(createdCanvas.width).toBe(800);
    expect(createdCanvas.height).toBe(600);
    expect(out).toBeInstanceOf(Blob);
  });

  it('横图按宽缩放到 maxDimension', async () => {
    FakeImage.nextSize = { w: 2560, h: 1280 };
    const { compressImage } = await importImage();
    await compressImage(src, { maxDimension: 1280 });
    expect(createdCanvas.width).toBe(1280);
    expect(createdCanvas.height).toBe(640);
  });

  it('竖图按高缩放到 maxDimension', async () => {
    FakeImage.nextSize = { w: 1000, h: 2000 };
    const { compressImage } = await importImage();
    await compressImage(src, { maxDimension: 500 });
    expect(createdCanvas.width).toBe(250);
    expect(createdCanvas.height).toBe(500);
  });

  it('图片解码失败抛 图片加载失败', async () => {
    FakeImage.failNext = true;
    const { compressImage } = await importImage();
    await expect(compressImage(src)).rejects.toThrow('图片加载失败');
  });

  it('canvas 2d context 不可用抛错', async () => {
    canvasBehavior.noCtx = true;
    const { compressImage } = await importImage();
    await expect(compressImage(src)).rejects.toThrow('Canvas 2D context unavailable');
  });

  it('超出 maxBytes 时降质量重试, 达标即返回', async () => {
    canvasBehavior.sizeFor = (q) => (q > 0.8 ? 2000 : 800);
    const { compressImage } = await importImage();
    const out = await compressImage(src, { maxBytes: 1000 });
    expect(out.size).toBe(800);
  });

  it('三档质量都超限时返回最后一档结果', async () => {
    canvasBehavior.sizeFor = () => 5000;
    const { compressImage } = await importImage();
    const out = await compressImage(src, { maxBytes: 100 });
    expect(out.size).toBe(5000);
  });

  it('首档 toBlob 失败, 次档成功时返回次档', async () => {
    canvasBehavior.sizeFor = (q) => (q > 0.8 ? null : 300);
    const { compressImage } = await importImage();
    const out = await compressImage(src, { maxBytes: 1000 });
    expect(out.size).toBe(300);
  });

  it('所有档位 toBlob 失败时抛首个错误', async () => {
    canvasBehavior.sizeFor = () => null;
    const { compressImage } = await importImage();
    await expect(compressImage(src)).rejects.toThrow('canvas.toBlob(image/jpeg) 返回 null');
  });

  it('blobToDataUrl 成功读出 data URL', async () => {
    class FR {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result = 'data:image/png;base64,AAA';
      readAsDataURL() {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    (globalThis as Record<string, unknown>).FileReader = FR;
    const { blobToDataUrl } = await importImage();
    await expect(blobToDataUrl(src)).resolves.toBe('data:image/png;base64,AAA');
    delete (globalThis as Record<string, unknown>).FileReader;
  });

  it('blobToDataUrl FileReader 出错时 reject', async () => {
    class FR {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      error = new Error('read boom');
      readAsDataURL() {
        setTimeout(() => this.onerror?.(), 0);
      }
    }
    (globalThis as Record<string, unknown>).FileReader = FR;
    const { blobToDataUrl } = await importImage();
    await expect(blobToDataUrl(src)).rejects.toThrow('read boom');
    delete (globalThis as Record<string, unknown>).FileReader;
  });
});
