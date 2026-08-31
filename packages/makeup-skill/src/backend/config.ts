// Runtime config — all values read from env at module load.
// Single source of truth for tunables; routes import from here.

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  // 拒绝 0/负数: 这类值对限额/端口/尺寸没有合法语义,
  // 放行会毒化下游 (如 RATE_LIMIT_*=0 让 express-rate-limit 封死全部请求).
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readStr(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.length > 0 ? raw : fallback;
}

/** Prefer the plural allowlist, while accepting Compose's singular variable. */
export function resolveCorsOrigins(env: NodeJS.ProcessEnv): string {
  return env.CORS_ORIGINS?.trim() || env.CORS_ORIGIN?.trim() || '';
}

export const config = {
  // ---------- Server ----------
  port: readInt('PORT', 3001),
  /** Comma-separated allowlist. CORS_ORIGINS takes precedence over CORS_ORIGIN. */
  corsOrigins: resolveCorsOrigins(process.env),
  /** Production 模式 (会收紧 CORS / 错误信息 / 静态文件缓存). */
  nodeEnv: readStr('NODE_ENV', 'development'),
  /** Main API that owns normalized explanation, model routing, and consent. */
  mainApiInternalUrl: readStr('MAIN_API_INTERNAL_URL', 'http://localhost:3000'),

  // ---------- Generation (图像生成已剥离;IMAGE_GEN_* 配置已移除) ----------
  // job store 字段保留以兼容旧 .env,当前未被核心流程使用.
  jobTtlMs: readInt('JOB_TTL_MS', 60 * 60 * 1000),
  jobSweepIntervalMs: readInt('JOB_SWEEP_INTERVAL_MS', 5 * 60 * 1000),
  jobStoreMax: readInt('JOB_STORE_MAX', 5000),
  /** Static-asset cache max-age in seconds. */
  staticMaxAgeSec: readInt('STATIC_MAX_AGE_SEC', 3600),

  // ---------- Rate limits (per minute per IP) ----------
  // Overridden by RATE_LIMIT_GLOBAL / RATE_LIMIT_ANALYTICS / etc.
  rateLimitGlobal: readInt('RATE_LIMIT_GLOBAL', 120),
  rateLimitAnalytics: readInt('RATE_LIMIT_ANALYTICS', 60),
} as const;
