// 扩展 Express Request 类型, 添加 cookies 字段 (由 cookieParser 中间件填充).

import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    cookies?: Record<string, string>;
  }
}

export {};
