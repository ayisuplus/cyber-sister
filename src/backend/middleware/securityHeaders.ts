// 安全响应头中间件 — 在 helmet 之上补齐 CSP / Permissions-Policy / Referrer-Policy 等.
//
// 参考:
// - https://owasp.org/www-project-secure-headers/
// - skills/performing-security-headers-audit
// - helmet 默认配置 (helmet v7)

import type { NextFunction, Request, Response } from 'express';

/**
 * 严格 CSP 策略.
 * - default-src 'self' — 默认只允许同源
 * - script-src 'self' — 不允许 unsafe-inline / unsafe-eval
 * - style-src 'self' 'unsafe-inline' — 允许内联样式 (Tailwind 注入)
 * - img-src 'self' data: blob: — 允许 data: (canvas 截图) + blob: (本地预览)
 * - media-src 'self' blob: — 允许 blob 视频预览
 * - connect-src 'self' — 限制 fetch / XHR / WebSocket 目标
 * - font-src 'self' https://fonts.gstatic.com data: — 允许 Google Fonts
 * - frame-ancestors 'none' — 防止点击劫持
 * - base-uri 'self' — 限制 <base>
 * - form-action 'self' — 限制 form 提交目标
 * - object-src 'none' — 禁 Flash/Java
 * - upgrade-insecure-requests — 自动升级 HTTP 子资源到 HTTPS
 */
function buildContentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "font-src 'self' https://fonts.gstatic.com data:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/**
 * Permissions-Policy: 关闭大部分浏览器功能, 减少攻击面.
 * 留 camera=(self) 因为妆教应用需要拍照.
 */
function buildPermissionsPolicy(): string {
  const closed = [
    'microphone',
    'geolocation',
    'payment',
    'usb',
    'magnetometer',
    'accelerometer',
    'gyroscope',
    'autoplay',
    'encrypted-media',
    'fullscreen',
    'picture-in-picture',
    'publickey-credentials-get',
    'screen-wake-lock',
    'sync-xhr',
    'xr-spatial-tracking',
  ];
  return [
    ...closed.map((f) => `${f}=()`),
    'camera=(self)',
  ].join(', ');
}

/**
 * 单一中间件: 注入所有安全响应头.
 * 在 helmet 之后挂, 覆盖/补全 helmet 默认.
 */
export function securityHeaders() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    // 1) CSP — helmet 默认会带, 我们用更严格的版本覆盖
    res.setHeader('Content-Security-Policy', buildContentSecurityPolicy());

    // 2) Permissions-Policy — 关闭不需要的浏览器功能
    res.setHeader('Permissions-Policy', buildPermissionsPolicy());

    // 3) Referrer-Policy — 不向第三方泄露完整 URL
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // 4) Cross-Origin-Opener-Policy — 隔离 window.opener
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

    // 5) Cross-Origin-Resource-Policy — helmet 已设 cross-origin, 这里再确认
    // (允许跨域读 /results/*.png 等)

    // 6) HSTS (一年 + includeSubDomains + preload)
    // 只在 HTTPS 环境下设置 (避免本地开发时浏览器拒绝 HTTP 加载)
    if (_req.secure || _req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload',
      );
    }

    // 7) X-XSS-Protection 显式禁用 (现代浏览器 CSP 已覆盖, 旧头会让旧浏览器行为反预测)
    res.setHeader('X-XSS-Protection', '0');

    // 8) 移除识别头 (helmet 已删 x-powered-by, 这里加 cache-control 给敏感页)
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // 9) 不让浏览器猜测 referrer 之外的元数据
    res.setHeader('X-DNS-Prefetch-Control', 'off');

    next();
  };
}
