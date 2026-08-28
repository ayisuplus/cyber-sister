// 结构化请求日志 — 替换原来裸的 console.info.
// 每条请求一条 JSON,带 method/path/status/duration/requestId.
// 失败的请求再单独 console.error 一遍,方便聚合.

import type { NextFunction, Request, Response } from 'express';

export function requestLogger() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      const durMs = Number(process.hrtime.bigint() - t0) / 1e6;
      const status = res.statusCode;
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
      const line = JSON.stringify({
        t: new Date().toISOString(),
        level,
        reqId: req.id,
        method: req.method,
        path: req.originalUrl,
        status,
        durMs: Math.round(durMs * 10) / 10,
        ip: req.ip,
        ua: req.headers['user-agent']?.slice(0, 80),
      });
      if (level === 'error') {
        console.error(line);
      } else if (level === 'warn') {
        console.warn(line);
      } else {
        console.info(line);
      }
    });
    next();
  };
}
