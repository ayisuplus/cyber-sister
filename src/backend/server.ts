// 妆语 backend — Express 5 + CORS + recommend / explain / analytics 三个核心路由.

import express from 'express';
import cors from 'cors';
import { recommendRouter } from './routes/recommend';
import { explainRouter } from './routes/explain';
import { analyticsRouter } from './routes/analytics';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

// CORS: 允许前端 dev server (Vite 默认 5173)
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', name: '妆语 MakeupWhisper' });
});

// 业务路由
app.use('/api', recommendRouter);
app.use('/api', explainRouter);
app.use('/api', analyticsRouter);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[妆语] backend listening on http://localhost:${PORT}`);
});
