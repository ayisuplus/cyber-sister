// 妆语 backend — Express 5 + CORS + upload / recommend / explain /
// generate / analytics 五个核心路由.
// 同时托管 Vite 构建产物 (dist/) 作为前端静态站点,支持 SPA fallback.

import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { recommendRouter } from './routes/recommend';
import { explainRouter } from './routes/explain';
import { analyticsRouter } from './routes/analytics';
import { uploadRouter } from './routes/upload';
import { generateRouter } from './routes/generate';
import { config } from './config.js';

// ---------- 路径与配置 ----------

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist 在 backend 同级的 ../../dist;tsx 启动时 __dirname = src/backend,目标 = <root>/dist
const DIST_DIR = resolve(__dirname, '..', '..', 'dist');
const PUBLIC_DIR = resolve(__dirname, '..', '..', 'public');
const UPLOAD_DIR = resolve(PUBLIC_DIR, 'uploads');
const RESULTS_DIR = resolve(PUBLIC_DIR, 'results');
const PORT = config.port;

for (const d of [UPLOAD_DIR, RESULTS_DIR]) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

// ---------- 应用 ----------

const app = express();

// 代理信任(便于部署在 nginx/cloudflare 后面时获取真实 client IP)
app.set('trust proxy', 1);

// CORS: 允许前端 dev server (Vite 默认 5173) + 任何 localhost 变体
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', /^https?:\/\/localhost(:\d+)?$/],
    credentials: true,
  }),
);
app.use(express.json({ limit: '2mb' }));

// 简易请求日志(开发期有用,生产可换 morgan/pino)
app.use((req, _res, next) => {
  console.info(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ---------- 健康检查 ----------

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    name: '妆语 MakeupWhisper',
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

// ---------- 业务路由 ----------

app.use('/api', uploadRouter);
app.use('/api', recommendRouter);
app.use('/api', explainRouter);
app.use('/api', generateRouter);
app.use('/api', analyticsRouter);

// ---------- 静态文件服务 (上传的图 / 生成的结果 / Vite build 产物) ----------

if (existsSync(PUBLIC_DIR)) {
  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      maxAge: '1h',
    }),
  );
}

if (existsSync(DIST_DIR)) {
  // express.static 把 dist 里的文件直接挂到 /
  app.use(
    express.static(DIST_DIR, {
      index: false, // SPA fallback 自己处理 index.html
      maxAge: '1h',
      extensions: ['html'],
    }),
  );

  // SPA fallback:任何非 /api 的 GET 都返回 index.html,前端 router 接管路由
  app.get(/^\/(?!api\/).*/, (_req, res, next) => {
    const indexHtml = join(DIST_DIR, 'index.html');
    if (!existsSync(indexHtml)) return next();
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
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[妆语] unhandled error:', err);
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  res.status(500).json({ error: message });
});

// ---------- 启动 ----------

app.listen(PORT, () => {
  console.info(`[妆语] backend listening on http://localhost:${PORT}`);
  console.info(`[妆语] image gen provider: ${config.imageGenProvider}`);
  console.info(`[妆语] uploads: ${UPLOAD_DIR}`);
  console.info(`[妆语] results: ${RESULTS_DIR}`);
  if (existsSync(DIST_DIR)) {
    console.info(`[妆语] static site: ${DIST_DIR}`);
  }
});
