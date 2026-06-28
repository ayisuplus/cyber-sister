// 简单的 sessionStorage 缓存 — key/value + TTL.
// 适合少量大对象 (LLM explain text, recommend 列表).
// 不适合高频读 (那样用 Map).

interface Entry<T> {
  value: T;
  expireAt: number;
}

const STORE = (() => {
  if (typeof window === 'undefined') return null;
  try {
    window.sessionStorage.setItem('__cache_probe__', '1');
    window.sessionStorage.removeItem('__cache_probe__');
    return window.sessionStorage;
  } catch {
    // Safari 隐私模式或 quota 满,降级为 noop
    return null;
  }
})();

const inFlight = new Map<string, Promise<unknown>>();

/**
 * 带 TTL 的 get-or-compute 缓存.
 * - 命中:直接返回缓存值 (不调 compute).
 * - 失效 / 缺失: 调 compute(), 把结果存进缓存, 返回.
 * - 并发去重: 同时多个调用只跑一次 compute.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
): Promise<T> {
  const now = Date.now();

  // 1) 命中缓存
  if (STORE) {
    const raw = STORE.getItem(key);
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw) as Entry<T>;
        if (parsed.expireAt > now) {
          return parsed.value;
        }
        STORE.removeItem(key);
      } catch {
        STORE.removeItem(key);
      }
    }
  }

  // 2) 并发去重
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  // 3) 计算
  const p = (async () => {
    try {
      const value = await compute();
      if (STORE) {
        try {
          STORE.setItem(key, JSON.stringify({ value, expireAt: Date.now() + ttlMs } satisfies Entry<T>));
        } catch {
          // quota 超限 — 静默忽略
        }
      }
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p);
  return p;
}

/** 显式失效某个 key (如: 用户换了照片,清空 recommend 缓存). */
export function invalidate(key: string): void {
  if (STORE) STORE.removeItem(key);
  inFlight.delete(key);
}

/** 清空所有 zw:* 前缀的缓存. */
export function invalidateAll(): void {
  if (!STORE) return;
  const toRemove: string[] = [];
  for (let i = 0; i < STORE.length; i++) {
    const k = STORE.key(i);
    if (k && k.startsWith('zw:')) toRemove.push(k);
  }
  for (const k of toRemove) STORE.removeItem(k);
}
