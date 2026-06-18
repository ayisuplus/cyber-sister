// AI妆教 backend — Express 5
// 路由:
//   POST /api/upload        — 接收 base64 图片 → 保存到 public/uploads/
//   POST /api/generate      — 调 LoRA 生成(目前返回 SVG 占位)
//   GET  /api/tutorial/:id  — 返回教学数据
//   GET  /api/styles        — 列出所有风格元数据
//   GET  /api/health        — 健康检查
// 同时托管 public/ + dist/ 静态资源

import express, { type Request, type Response, type NextFunction } from 'express';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TUTORIALS, getTutorial, STYLE_META } from './data.js';
import type { GenerateRequest, GenerateResponse, UploadResponse } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PUBLIC_DIR = join(ROOT, 'public');
const UPLOAD_DIR = join(PUBLIC_DIR, 'uploads');
const RESULT_DIR = join(PUBLIC_DIR, 'results');
const DIST_DIR = join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 3001);

for (const d of [UPLOAD_DIR, RESULT_DIR]) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// ---------- 日志 ----------

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ---------- 健康检查 ----------

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', name: 'AI妆教', uptime: process.uptime() });
});

// ---------- 风格列表 ----------

app.get('/api/styles', (_req, res) => {
  res.json({ styles: STYLE_META, count: STYLE_META.length });
});

// ---------- 上传 ----------

app.post('/api/upload', (req, res) => {
  const { image } = req.body as { image?: string };
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: '缺少图片数据(image base64)' });
  }
  const m = image.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
  if (!m) return res.status(400).json({ error: '图片格式仅支持 jpeg/png/webp' });
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length === 0) return res.status(400).json({ error: '图片数据为空' });
  if (buf.length > 8 * 1024 * 1024) return res.status(413).json({ error: '图片超过 8MB' });

  const id = randomUUID();
  const filename = `${id}.${ext}`;
  writeFileSync(join(UPLOAD_DIR, filename), buf);

  const resp: UploadResponse = {
    imageId: id,
    url: `/uploads/${filename}`,
    size: buf.length,
  };
  res.json(resp);
});

// ---------- 生成(占位) ----------

app.post('/api/generate', async (req, res) => {
  const { imageId, style } = req.body as Partial<GenerateRequest>;
  if (!imageId || !style) return res.status(400).json({ error: '缺少 imageId 或 style' });
  const t = getTutorial(style);
  if (!t) return res.status(404).json({ error: `未知风格: ${style}` });

  const t0 = Date.now();
  // 占位生成:写一个 SVG,内容为风格名 + 主色 + 触发词
  const colors = t.colors.slice(0, 4);
  const id = randomUUID();
  const svg = renderPlaceholderSVG(t.name, t.trigger, colors, t.sampleCount);
  const filename = `${id}.svg`;
  writeFileSync(join(RESULT_DIR, filename), svg, 'utf8');

  const resp: GenerateResponse = {
    imageId,
    style,
    resultUrl: `/results/${filename}`,
    prompt: `${t.trigger}, high quality portrait, soft lighting`,
    tookMs: Date.now() - t0,
  };
  res.json(resp);
});

// ---------- 教学数据 ----------

app.get('/api/tutorial/:style', (req: Request<{ style: string }>, res) => {
  const t = getTutorial(decodeURIComponent(req.params.style));
  if (!t) return res.status(404).json({ error: '未找到该风格' });
  res.json(t);
});

app.get('/api/tutorials', (_req, res) => {
  res.json({ tutorials: TUTORIALS, count: TUTORIALS.length });
});

// ---------- 静态资源 ----------

if (existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR, { maxAge: '1h' }));
}
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    const idx = join(DIST_DIR, 'index.html');
    if (existsSync(idx)) return res.sendFile(idx);
    res.status(404).end();
  });
}

// ---------- 错误处理 ----------

app.use((req, res) => res.status(404).json({ error: 'Not Found', path: req.url }));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[err]', err);
  const msg = err instanceof Error ? err.message : 'Internal Server Error';
  res.status(500).json({ error: msg });
});

// ---------- 工具:占位 SVG ----------

function renderPlaceholderSVG(name: string, trigger: string, colors: string[], samples: number): string {
  const stops = colors.length
    ? colors.map((c, i) => `<stop offset="${(i / Math.max(1, colors.length - 1)) * 100}%" stop-color="${c}"/>`).join('')
    : '<stop offset="0%" stop-color="#ff9a9e"/><stop offset="100%" stop-color="#fad0c4"/>';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient>
    <filter id="b"><feGaussianBlur stdDeviation="40"/></filter>
  </defs>
  <rect width="800" height="600" fill="url(#g)"/>
  <circle cx="200" cy="300" r="180" fill="white" opacity="0.15" filter="url(#b)"/>
  <circle cx="600" cy="200" r="220" fill="white" opacity="0.12" filter="url(#b)"/>
  <text x="400" y="280" text-anchor="middle" font-family="'PingFang SC','Microsoft YaHei',sans-serif"
        font-size="72" font-weight="700" fill="white" style="text-shadow:0 4px 20px rgba(0,0,0,0.2)">${name}</text>
  <text x="400" y="340" text-anchor="middle" font-family="'PingFang SC',sans-serif"
        font-size="22" fill="white" opacity="0.9">LoRA 预览占位 · ${samples} 样本训练</text>
  <text x="400" y="500" text-anchor="middle" font-family="monospace"
        font-size="16" fill="white" opacity="0.7">${trigger}</text>
  <text x="400" y="560" text-anchor="middle" font-family="'PingFang SC',sans-serif"
        font-size="14" fill="white" opacity="0.5">AI妆教 · Flux2 + LoRA</text>
</svg>`;
}

// ---------- CORS(精简) ----------

function cors() {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  };
}

// ---------- 启动 ----------

app.listen(PORT, () => {
  console.log(`[AI妆教] http://localhost:${PORT}`);
  console.log(`[AI妆教] uploads: ${UPLOAD_DIR}`);
  console.log(`[AI妆教] results: ${RESULT_DIR}`);
});
