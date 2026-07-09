// 请求 ID + 结构化日志中间件.
//
// 每个请求分配一个短 ID (8 hex 字符),挂到 req.id,
// 在响应头 X-Request-Id 暴露给客户端,日志/错误里都带上.

import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** 16-hex 请求 id,本次请求全局唯一. */
      id: string;
    }
  }
}

export function requestId() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // 优先使用上游传入的 X-Request-Id (分布式追踪用)
    const incoming = req.headers['x-request-id'];
    const id =
      (typeof incoming === 'string' && /^[a-zA-Z0-9-]{6,64}$/.test(incoming) ? incoming : null) ??
      randomBytes(4).toString('hex');
    req.id = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
}
