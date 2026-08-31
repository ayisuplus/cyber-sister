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

// 内存缓存:避免每次 GET /stats 都读盘.写入时失效.
// 5s TTL 是 trade-off: 实时性 vs 性能. 监控场景 5s 内一致已经足够.
let cachedStats: { stats: StatsResponse; loadedAt: number } | null = null;
const STATS_CACHE_TTL_MS = 5_000;

// ---------- 类型 ----------

// 落盘行结构 (强制 timestamp,允许 sessionId 为 null)
interface AnalyticsRow {
  event: string;
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
// 事件名限 ASCII 字母数字 + 下划线 + 短横线, 避免写入奇怪字符
// props 仅为兼容旧客户端做大小校验，服务端不会记录或持久化其内容。
// sessionId < 128, timestamp 是 unix ms
const EVENT_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const analyticsSchema = {
  event: { type: 'string', required: true, min: 1, max: 64, pattern: EVENT_NAME_PATTERN },
  sessionId: { type: 'string', min: 0, max: 128 },
  timestamp: { type: 'integer', ge: 0, le: 9_999_999_999_999 },
  props: { type: 'object', min: 0, max: 16_384 },
} as const;

// POST /api/analytics — 写入 jsonl
analyticsRouter.post('/analytics', analyticsLimiter, validateBody(analyticsSchema), (req, res) => {
  const raw = req.body as {
    event: string;
    props?: unknown;
    sessionId?: unknown;
    timestamp?: unknown;
  };
  const sessionId = extractSessionId(req.headers['x-session-id'], raw.sessionId);
  const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
  const row: AnalyticsRow = { event: raw.event, timestamp, sessionId };
  try {
    ensureFile();
    appendFileSync(JSONL_PATH, JSON.stringify(row) + '\n', 'utf-8');
  } catch {
    console.error(JSON.stringify({ requestId: req.id, result: 'analytics_write_failed' }));
    res.status(500).json({ error: 'write failed' });
    return;
  }

  invalidateStatsCache();
  res.json({ ok: true });
});

// GET /api/analytics/stats — 返回统计
analyticsRouter.get('/analytics/stats', (_req, res) => {
  res.json(getStats());
});

/**
 * 带缓存的统计读.5s TTL,写后立即失效.
 * 公开用于测试与未来其他端点.
 */
export function getStats(): StatsResponse {
  const now = Date.now();
  if (cachedStats && now - cachedStats.loadedAt < STATS_CACHE_TTL_MS) {
    return cachedStats.stats;
  }
  const rows = readRows();
  const byEvent: Record<string, number> = {};
  for (const r of rows) {
    byEvent[r.event] = (byEvent[r.event] ?? 0) + 1;
  }
  const stats: StatsResponse = { total: rows.length, byEvent };
  cachedStats = { stats, loadedAt: now };
  return stats;
}

/** 手动清缓存 (写完/管理后台刷新). */
export function invalidateStatsCache(): void {
  cachedStats = null;
}
