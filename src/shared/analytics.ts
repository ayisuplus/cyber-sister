// 轻量级事件埋点 — console.log + POST /api/analytics,fire-and-forget.
// 任何错误不抛,绝不影响 UI.

const ENDPOINT = '/api/analytics';
const SESSION_ID_KEY = 'makeupwhisper_session_id';
const SESSION_ID_MAX_LEN = 128;

export type AnalyticsProps = Record<string, unknown> | undefined;

/**
 * 生成一个新的 sessionId.优先 crypto.randomUUID(),不可用时回退到
 * 时间戳 + 随机串.本地生成,不含任何 PII.
 */
function generateSessionId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c && typeof c.randomUUID === 'function') {
      return c.randomUUID();
    }
  } catch {
    /* 静默 */
  }
  return (
    'sess-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
  );
}

/**
 * 读取或创建并持久化 sessionId.
 * localStorage 不可用 (SSR / 隐私模式) 时退化为内存态 id,仍保证非空.
 */
function loadOrCreateSessionId(): string {
  if (typeof localStorage === 'undefined') {
    return generateSessionId();
  }
  try {
    const existing = localStorage.getItem(SESSION_ID_KEY);
    if (existing && existing.length > 0 && existing.length <= SESSION_ID_MAX_LEN) {
      return existing;
    }
    const id = generateSessionId();
    localStorage.setItem(SESSION_ID_KEY, id);
    return id;
  } catch {
    // localStorage 被禁用 (隐私模式 / 配额满) → 内存态兜底
    return generateSessionId();
  }
}

// 模块加载时确定一次,同一会话内复用.
let sessionId = loadOrCreateSessionId();

/**
 * 返回当前会话的 sessionId (本地生成,不含 PII).
 */
export function getSessionId(): string {
  return sessionId;
}

export function track(event: string, props?: AnalyticsProps): void {
  const payload = {
    event,
    props: props ?? {},
    timestamp: Date.now(),
    sessionId: getSessionId(),
  };
  // 开发模式方便肉眼看到
  if (typeof console !== 'undefined') {
    console.debug('[analytics]', event, props ?? {});
  }
  if (typeof fetch === 'undefined') return;
  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      /* 静默 */
    });
  } catch {
    /* 静默 */
  }
}

/**
 * 计时器辅助:记录 fromNow() 到 now() 的毫秒数.
 */
export function startTimer(): () => number {
  const t0 = Date.now();
  return () => Date.now() - t0;
}
