// 前端 CSRF 客户端 — 维护 token 缓存, 给 fetchJson 自动加 header.
//
// 工作流:
// 1. 首次调用需要 CSRF 的接口时, GET /api/csrf-token 拿到 token + cookie
// 2. 后续 POST/DELETE/PATCH 请求自动加 X-CSRF-Token header
// 3. 失败时 (403) 自动重新签发 token 并重试一次
//
// 注意: cookie 由浏览器自动管理 (HttpOnly=false + SameSite=Lax),
// 我们只负责把 token 放到 header. 这样 SameSite 仍然保护 cookie,
// 而 header 需要 JS 主动设置, 跨站脚本拿不到 (除非他们先破解了 cookie).

import { toApiUrl } from './runtime';

let cachedToken: string | null = null;
let inflight: Promise<string> | null = null;

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** 同步取 token, 没有就 fetch 一次. */
export async function ensureCsrfToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch(toApiUrl('/api/csrf-token'), {
        method: 'GET',
        credentials: 'same-origin',
      });
      if (!r.ok) {
        throw new Error(`csrf token fetch failed: ${r.status}`);
      }
      const body = (await r.json()) as { csrfToken: string };
      cachedToken = body.csrfToken;
      return cachedToken;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** 强制重置缓存 (例如收到 403 时). */
export function resetCsrfToken(): void {
  cachedToken = null;
}

/** 给 RequestInit 自动补 X-CSRF-Token (仅 unsafe methods + same-origin). */
export async function withCsrfHeader(method: string, init: RequestInit = {}): Promise<RequestInit> {
  const upper = method.toUpperCase();
  if (!UNSAFE_METHODS.has(upper)) return init;
  // 只对 same-origin 请求加 CSRF (跨域本来就被 CORS 拦截)
  const target = init.credentials ?? 'same-origin';
  if (target === 'omit') return init;
  const token = await ensureCsrfToken();
  return {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      'X-CSRF-Token': token,
    },
  };
}
