// 妆语 backend — Express 5 + 安全中间件 + 业务路由.
// 中间件顺序: requestId → logger → security (helmet) → CORS → rateLimit → 路由.
// 同时托管 Vite 构建产物 (dist/) 作为前端静态站点,支持 SPA fallback.

import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { recommendRouter } from './routes/recommend';
import { explainRouter } from './routes/explain';
import { analyticsRouter } from './routes/analytics';
import { uploadRouter } from './routes/upload';
import { generateRouter } from './routes/generate';
import { resourcesRouter } from './routes/resources';
import { config } from './config.js';
import { requestId } from './middleware/requestId.js';
import { requestLogger } from './middleware/logger.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { cookieParser, issueCsrfToken, requireCsrfToken } from './middleware/csrf.js';

// ---------- 路径与配置 ----------

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist 在 backend 同级的 ../../dist;tsx 启动时 __dirname = src/backend,目标 = <root>/dist
const DIST_DIR = resolve(__dirname, '..', '..', 'dist');
const PUBLIC_DIR = resolve(__dirname, '..', '..', 'public');
const UPLOAD_DIR = resolve(PUBLIC_DIR, 'uploads');
const RESULTS_DIR = resolve(PUBLIC_DIR, 'results');
const PORT = config.port;
const isProd = config.nodeEnv === 'production';

for (const d of [UPLOAD_DIR, RESULTS_DIR]) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

// ---------- 应用 ----------

const app = express();

// 代理信任(便于部署在 nginx/cloudflare 后面时获取真实 client IP)
app.set('trust proxy', 1);

// 1) 请求 ID + 关联到响应头 (X-Request-Id)
app.use(requestId());
// 2) 结构化访问日志 (放在 requestId 之后,日志带上 reqId)
app.use(requestLogger());
// 3) 安全头: helmet 默认 + 自定义 CSP / Permissions-Policy / Referrer-Policy
app.use(
  helmet({
    // 自定义 securityHeaders() 提供更严格的 CSP, 关闭 helmet 默认避免冲突
    contentSecurityPolicy: false,
    // 跨域读 /results/* 的图片需要 cors,helmet 默认会带 CORP 头
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // HSTS: 一年 + includeSubDomains + preload (仅在 HTTPS 时由 securityHeaders 注入, 这里给 fallback)
    strictTransportSecurity: {
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: true,
    },
  }),
);
// 3b) 补齐 CSP / Permissions-Policy / Referrer-Policy / COOP 等头
app.use(securityHeaders());
// 4) CORS — 开发时允许 localhost,生产走白名单 (CORS_ORIGINS 逗号分隔)
const corsOrigins = config.corsOrigins
  ? config.corsOrigins.split(',').map((s) => s.trim()).filter(Boolean)
  : null;
app.use(
  cors({
    origin: corsOrigins ?? [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      /^https?:\/\/localhost(:\d+)?$/,
    ],
    credentials: true,
    maxAge: 600,
  }),
);
// 5) Body parsing — 全局限制小,大文件走 /api/upload 单独处理
app.use(express.json({ limit: '256kb' }));
// 5b) 解析 Cookie header (供 CSRF 中间件用)
app.use(cookieParser());
// 6) 全局限流 — 健康检查已 skip
app.use('/api', globalLimiter);
// 6b) CSRF 防护 — 跳过 analytics / csrf-token / health, 其他 unsafe method 必须带 token
app.use('/api', requireCsrfToken());

// ---------- 健康检查 (在限流器前,但已在限流器后;这里保持原位) ----------

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    name: '妆语 MakeupWhisper',
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

// ---------- CSRF token 端点 (用于客户端初始化) ----------
app.get('/api/csrf-token', issueCsrfToken);

// ---------- 业务路由 ----------

app.use('/api', uploadRouter);
app.use('/api', recommendRouter);
app.use('/api', explainRouter);
app.use('/api', generateRouter);
app.use('/api', analyticsRouter);
app.use('/api', resourcesRouter);

const staticMaxAge = isProd ? `${config.staticMaxAgeSec}s` : '0';
if (existsSync(PUBLIC_DIR)) {
  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      maxAge: staticMaxAge,
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
      },
    }),
  );
}

if (existsSync(DIST_DIR)) {
  // express.static 把 dist 里的文件直接挂到 /
  app.use(
    express.static(DIST_DIR, {
      index: false, // SPA fallback 自己处理 index.html
      maxAge: staticMaxAge,
      extensions: ['html'],
    }),
  );

  // SPA fallback:任何非 /api 的 GET 都返回 index.html,前端 router 接管路由
  app.get(/^\/(?!api\/).*/, (_req, res, next) => {
    const indexHtml = join(DIST_DIR, 'index.html');
    if (!existsSync(indexHtml)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
} else {
  // dev 模式:dist 还没构建,只跑后端
  console.warn(`[妆语] dist/ 不存在 (${DIST_DIR}),跳过静态文件服务`);
}

// ---------- 错误处理 ----------

// 404:所有未匹配的请求
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.url,
    method: req.method,
  });
});

// 通用错误中间件(4 参数签名才会被 Express 识别为 error handler)
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  // 生产:不暴露内部错误细节
  const safe = isProd ? 'Internal Server Error' : message;
  console.error(
    JSON.stringify({
      t: new Date().toISOString(),
      level: 'error',
      reqId: req.id,
      err: message,
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );
  res.status(500).json({ error: safe, reqId: req.id });
});

// ---------- 启动 ----------

const server = app.listen(PORT, () => {
  console.info(`[妆语] backend listening on http://localhost:${PORT}`);
  console.info(`[妆语] env=${config.nodeEnv} image gen provider: ${config.imageGenProvider}`);
  console.info(`[妆语] uploads: ${UPLOAD_DIR}`);
  console.info(`[妆语] results: ${RESULTS_DIR}`);
  console.info(
    `[妆语] rate limits: global=${config.rateLimitGlobal}/min upload=${config.rateLimitUpload}/min generate=${config.rateLimitGenerate}/min analytics=${config.rateLimitAnalytics}/min`,
  );
  if (existsSync(DIST_DIR)) {
    console.info(`[妆语] static site: ${DIST_DIR}`);
  }
});

// 优雅关停:收到 SIGTERM/SIGINT 时关闭 server,清理连接
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[妆语] received ${signal}, closing server…`);
  server.close((err) => {
    if (err) {
      console.error('[妆语] error closing server:', err);
      process.exit(1);
    }
    process.exit(0);
  });
  // 5s 强制退出
  setTimeout(() => {
    console.warn('[妆语] forced exit after timeout');
    process.exit(1);
  }, 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
