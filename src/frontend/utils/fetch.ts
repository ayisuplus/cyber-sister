// fetch 包装 — 超时 + 退避重试 (5xx / 网络错误 / 429) + CSRF 自动注入.

import { withCsrfHeader } from './csrf';
//
// 行为:
// - 单次请求有 timeoutMs 超时 (默认 15s).
// - 遇到 5xx / 429 / 网络错误时, 指数退避重试最多 retries 次 (默认 2).
// - 4xx (除 429) 立即抛错, 客户端问题不需要重试.
// - 解析为 JSON 失败抛错 (而不是返回 undefined).

interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  /** 重试基础延迟 (ms). 实际延迟 = baseMs * 2^attempt + 抖动. */
  baseDelayMs?: number;
  /** 可选 abort signal (来自父级, 比如用户取消). */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BASE_DELAY = 400;



function isRetriableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * 增强版 fetch — JSON 响应 + 超时 + 退避重试.
 * 抛错: 网络错误 / 超时 / 4xx-非-429 / JSON 解析失败 / 上层 abort.
 */
export async function fetchJson<T = unknown>(
  requestUrl: string,
  init: RequestInit & FetchOptions = {},
): Promise<T> {
  let { timeoutMs = DEFAULT_TIMEOUT, retries = DEFAULT_RETRIES, baseDelayMs = DEFAULT_BASE_DELAY, signal, ...rest } = init;
  // CSRF 注入: 仅在 unsafe method + same-origin 时加 header
  const isUnsafe = ["POST", "PUT", "PATCH", "DELETE"].includes((rest.method ?? "").toUpperCase());
  if (isUnsafe) {
    try {
      rest = await withCsrfHeader(rest.method ?? "POST", rest);
    } catch {
      // 拉 token 失败, 仍然尝试发请求 (后端会拒绝)
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onParentAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    signal.addEventListener('abort', onParentAbort, { once: true });
  }
  const combinedSignal = ctrl.signal;

  let lastError: unknown = null;
  try {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(requestUrl, { ...rest, signal: combinedSignal });
        if (!res.ok) {
          if (isRetriableStatus(res.status) && attempt < retries) {
            lastError = new Error(`HTTP ${res.status}`);
            // fall through to backoff
          } else {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
          }
        } else {
          // 成功 — 解析 JSON
          try {
            return (await res.json()) as T;
          } catch {
            throw new Error('响应不是合法 JSON');
          }
        }
      } catch (err) {
        // abort 立刻抛 — 不重试
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        // 网络错误 / 上面手动 throw 的 5xx / JSON 错误 — 记录并重试
        lastError = err;
        if (attempt >= retries) break;
      }
      // 退避 (带 ±20% 抖动)
      const backoff = baseDelayMs * 2 ** attempt;
      const jitter = backoff * 0.2 * (Math.random() * 2 - 1);
      await delay(backoff + jitter, combinedSignal);
    }
    throw lastError ?? new Error('请求失败');
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onParentAbort);
  }
}
