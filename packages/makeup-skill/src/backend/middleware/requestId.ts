// 请求 ID + 结构化日志中间件.
//
// 每个请求分配一个短 ID (8 hex 字符),挂到 req.id,
// 在响应头 X-Request-Id 暴露给客户端,日志/错误里都带上.

import { randomUUID } from 'node:crypto';
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
    const id = randomUUID();
    req.id = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
}
