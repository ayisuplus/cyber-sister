import { Router } from 'express';
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { analyticsLimiter } from '../middleware/rateLimit.js';
import { validateBody } from '../middleware/validate.js';
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

// 事件名:限 ASCII 字母数字 + 下划线 + 短横线,避免写入奇怪字符
const analyticsSchema = {
  event: { type: 'string', required: true, min: 1, max: 64 },
} as const;

// POST /api/analytics — 写入 jsonl
analyticsRouter.post('/analytics', analyticsLimiter, validateBody(analyticsSchema), (req, res) => {
  const raw = req.body as { event: string; props?: unknown; sessionId?: unknown; timestamp?: unknown };
  // props 必须是普通对象;不是就当作空,保证落盘形状稳定.
  const props: Record<string, unknown> =
    raw.props && typeof raw.props === 'object' && !Array.isArray(raw.props)
      ? (raw.props as Record<string, unknown>)
      : {};
  const sessionId = extractSessionId(req.headers['x-session-id'], raw.sessionId);
  const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
  const row: AnalyticsRow = { event: raw.event, props, timestamp, sessionId };
  try {
    ensureFile();
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
