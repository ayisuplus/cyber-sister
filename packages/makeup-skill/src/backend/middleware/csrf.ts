// CSRF 防护 — 双重提交 Cookie 模式 (double-submit cookie).
// 参考: skills/securing-rest-apis-with-csrf-protection
//
// 工作流:
// 1. GET /api/csrf-token 签发一个随机 token, 同时写入 cookie 和 JSON body
// 2. 客户端后续写操作 (POST/DELETE/PATCH) 必须:
//    a) 带 cookie csrf-token
//    b) 在 header X-CSRF-Token 里带同样值
// 3. 中间件对比两者, 不一致则 403
//
// 这种模式不需要服务端 session 存储, 适合无状态 API.
// 仅检查 unsafe HTTP methods, GET / HEAD / OPTIONS 不受 CSRF 影响.
//
// 注意: 当 credentials: true 的 CORS 允许第三方域时, 这种模式不充分
// (cookie 不会被第三方域设置). 我们用 CORS 白名单 + SameSite=Lax 兜底.

import type { NextFunction, Request, Response } from 'express';
import { randomBytes } from 'node:crypto';

/**
 * 简易 cookie 解析: 把 'a=1; b=2' 解析为 { a: '1', b: '2' }.
 * 避免引 cookie-parser 依赖.
 */
function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function cookieParser() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.cookies = parseCookieHeader(req.headers.cookie);
    next();
  };
}

const COOKIE_NAME = 'csrf_token';
const HEADER_NAME = 'x-csrf-token';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 签发一个新 CSRF token 并写入 cookie + 返回 body.
 * 客户端拿到后必须在后续 unsafe 请求里回传 header.
 */
export function issueCsrfToken() {
  return (_req: Request, res: Response): void => {
    const token = randomBytes(32).toString('hex');
    // SameSite=Lax: 顶层导航会自动带, 但跨站 POST 不会带
    // Secure: 留给浏览器自己判断 (HTTPS 时才生效)
    // HttpOnly: 故意设 false — JS 需要读到 cookie 才能放到 header
    // 手工设置 Set-Cookie 头 (避免引 cookie-parser)
    // - HttpOnly=false: JS 需要读 cookie 放到 header
    // - SameSite=Lax: 顶层导航带, 跨站 POST 不带
    // - Max-Age=1 天
    const cookieStr = [`${COOKIE_NAME}=${token}`, 'Path=/', 'Max-Age=86400', 'SameSite=Lax'].join(
      '; ',
    );
    res.setHeader('Set-Cookie', cookieStr);
    res.json({ csrfToken: token });
  };
}

/**
 * 中间件: 校验 CSRF token. 仅对 UNSAFE_METHODS 生效.
 * 跳过 /api/health, /api/csrf-token, /api/analytics (后者使用 SameSite + 限流).
 */
const SKIP_PATHS = new Set([
  '/api/health',
  '/api/csrf-token',
  '/api/analytics', // 公开埋点端点, 无业务影响
]);

export function requireCsrfToken() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!UNSAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    if (SKIP_PATHS.has(req.path)) {
      next();
      return;
    }
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME];
    const headerToken = (req.headers[HEADER_NAME] as string | undefined) ?? '';
    if (!cookieToken || !headerToken) {
      res.status(403).json({ error: '缺少 CSRF token' });
      return;
    }
    // 时间恒定比较, 防止 timing attack
    if (!timingSafeEqual(cookieToken, headerToken)) {
      res.status(403).json({ error: 'CSRF token 不匹配' });
      return;
    }
    next();
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
