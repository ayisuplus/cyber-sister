// 分析事件路由 — fire-and-forget 占位.
// 后续接 Postgres / ClickHouse 时只改这一处.

import { Router } from 'express';

export const analyticsRouter = Router();

interface AnalyticsEvent {
  event: string;
  props?: Record<string, unknown>;
  timestamp?: number;
}

analyticsRouter.post('/analytics', (req, res) => {
  const body = req.body as AnalyticsEvent;
  // eslint-disable-next-line no-console
  console.log('[analytics]', body?.event ?? 'unknown', body?.props ?? {});
  res.json({ ok: true });
});
