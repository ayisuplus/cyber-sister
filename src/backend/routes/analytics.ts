// 分析事件路由 — 文件存储版.
// - POST /api/analytics    写入 data/analytics.jsonl (每行一个 JSON)
// - GET  /api/analytics/stats  返回事件总数 + 按 event 分组计数
// 数据落盘后,后续接 Postgres / ClickHouse 时只换 storage 适配器即可.

import { Router } from 'express';
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// ---------- 路径解析 ----------
// 路径优先级: ANALYTICS_DATA_DIR env > <project_root>/data
// 方便测试注入临时目录,也方便生产环境切到外挂盘.

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/backend/routes/analytics.ts → project root = ../../../../
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const DEFAULT_DATA_DIR = join(PROJECT_ROOT, 'data');

const DATA_DIR = process.env.ANALYTICS_DATA_DIR
  ? resolve(process.env.ANALYTICS_DATA_DIR)
  : DEFAULT_DATA_DIR;
const JSONL_PATH = join(DATA_DIR, 'analytics.jsonl');

// ---------- 类型 ----------

interface AnalyticsEvent {
  event: string;
  props?: Record<string, unknown>;
  timestamp?: number;
  sessionId?: string | null;
}

// 落盘行结构 (强制 timestamp,允许 sessionId 为 null)
interface AnalyticsRow {
  event: string;
  props: Record<string, unknown>;
  timestamp: number;
  sessionId: string | null;
}

interface StatsResponse {
  total: number;
  byEvent: Record<string, number>;
}

// ---------- 工具 ----------

/**
 * 确保数据目录与 jsonl 文件存在.
 * 性能上不优化 (启动不调),只在第一次写入前调用一次.
 */
function ensureFile(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  // 文件不需要预创建,appendFileSync 第一次写入时会自动创建.
  // 但有些文件系统对 "open O_APPEND" 要求文件存在,这里 touch 一下更安全.
  if (!existsSync(JSONL_PATH)) {
    appendFileSync(JSONL_PATH, '');
  }
}

/**
 * 从 header (x-session-id) 或 body (sessionId) 提取会话 id.
 * 优先级: body.sessionId > header.x-session-id > null
 */
function extractSessionId(
  headerVal: string | string[] | undefined,
  bodyVal: unknown,
): string | null {
  if (typeof bodyVal === 'string' && bodyVal.length > 0) return bodyVal;
  if (typeof headerVal === 'string' && headerVal.length > 0) return headerVal;
  // Express 5 headers 可能为 string[] (罕见,多值 header)
  if (Array.isArray(headerVal) && typeof headerVal[0] === 'string') {
    return headerVal[0];
  }
  return null;
}

/**
 * 读 jsonl,跳过空行和无法解析的行 (不抛错,坏数据兜底).
 */
function readRows(): AnalyticsRow[] {
  if (!existsSync(JSONL_PATH)) return [];
  const content = readFileSync(JSONL_PATH, 'utf-8');
  const lines = content.split('\n');
  const rows: AnalyticsRow[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Partial<AnalyticsRow>;
      if (typeof obj.event === 'string') {
        rows.push({
          event: obj.event,
          props: obj.props ?? {},
          timestamp: typeof obj.timestamp === 'number' ? obj.timestamp : 0,
          sessionId: obj.sessionId ?? null,
        });
      }
    } catch {
      // 坏行跳过,继续读下一行
      continue;
    }
  }
  return rows;
}

// ---------- 路由 ----------

export const analyticsRouter = Router();

// POST /api/analytics — 写入 jsonl
analyticsRouter.post('/analytics', (req, res) => {
  const body = (req.body ?? {}) as AnalyticsEvent;

  // event 必填
  if (typeof body.event !== 'string' || body.event.length === 0) {
    res.status(400).json({ error: 'missing event' });
    return;
  }

  const row: AnalyticsRow = {
    event: body.event,
    props: body.props ?? {},
    timestamp: typeof body.timestamp === 'number' ? body.timestamp : Date.now(),
    sessionId: extractSessionId(req.headers['x-session-id'], body.sessionId),
  };

  try {
    ensureFile();
    // 每行一个 JSON,以 \n 结尾
    appendFileSync(JSONL_PATH, JSON.stringify(row) + '\n', 'utf-8');
  } catch (err) {
    console.error('[analytics] write failed:', err);
    res.status(500).json({ error: 'write failed' });
    return;
  }

  console.info('[analytics]', row.event, row.props);
  res.json({ ok: true });
});

// GET /api/analytics/stats — 返回统计
analyticsRouter.get('/analytics/stats', (_req, res) => {
  const rows = readRows();
  const byEvent: Record<string, number> = {};
  for (const r of rows) {
    byEvent[r.event] = (byEvent[r.event] ?? 0) + 1;
  }
  const payload: StatsResponse = {
    total: rows.length,
    byEvent,
  };
  res.json(payload);
});
