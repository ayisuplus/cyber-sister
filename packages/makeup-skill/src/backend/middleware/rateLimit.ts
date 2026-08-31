// 限流中间件 — 基于 express-rate-limit,按 IP 限频.
//
// 设计原则:
// - 全局宽松限流 套在所有 /api 路由前面,兜底抗暴力.
// - 上传/出图这种昂贵路由叠加更严格的限流.
// - 阈值默认从 config 读,可通过环境变量 RATE_LIMIT_<NAME> 覆盖.
// - 健康检查永远不计数,方便 LB / 监控.

import rateLimit, { type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { config } from '../config.js';

const baseOptions: Partial<Options> = {
  windowMs: 60_000, // 1 分钟窗口
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      error: '请求过于频繁,请稍后再试',
      retryAfter: res.getHeader('Retry-After'),
    });
  },
  // 健康检查永不限流. 注意 limiter 挂在 app.use('/api', ...) 下,
  // Express 已剥掉 '/api' 前缀, req.path 是相对路径.
  skip: (req) => req.path === '/health',
};

function makeLimiter(name: string, defaultLimit: number) {
  return rateLimit({
    ...baseOptions,
    limit: readLimit(name, defaultLimit),
    identifier: name,
  });
}

function readLimit(name: string, fallback: number): number {
  const raw = process.env[`RATE_LIMIT_${name.toUpperCase()}`];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 全局宽松限流:所有 /api 路由. */
export const globalLimiter = makeLimiter('global', config.rateLimitGlobal);

/** analytics 写入:IO 密集. */
export const analyticsLimiter = makeLimiter('analytics', config.rateLimitAnalytics);
