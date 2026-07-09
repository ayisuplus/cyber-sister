// Runtime config — all values read from env at module load.
// Single source of truth for tunables; routes import from here.

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function readStr(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.length > 0 ? raw : fallback;
}

export const config = {
  // ---------- Server ----------
  port: readInt('PORT', 3001),
  /** Comma-separated allowlist of CORS origins. Empty = use dev default. */
  corsOrigins: readStr('CORS_ORIGINS', ''),
  /** Production 模式 (会收紧 CORS / 错误信息 / 静态文件缓存). */
  nodeEnv: readStr('NODE_ENV', 'development'),

  // ---------- Upload ----------
  uploadDir: readStr('UPLOAD_DIR', 'public/uploads'),
  maxUploadBytes: readInt('MAX_UPLOAD_BYTES', 8 * 1024 * 1024), // 8 MB
  /** 上传后保留时间 (ms);到期文件由后台清扫. */
  uploadTtlMs: readInt('UPLOAD_TTL_MS', 24 * 60 * 60 * 1000), // 24h

  // ---------- Generation (图像生成已剥离;IMAGE_GEN_* 配置已移除) ----------
  // job store 字段保留以兼容旧 .env,当前未被核心流程使用.
  jobTtlMs: readInt('JOB_TTL_MS', 60 * 60 * 1000),
  jobSweepIntervalMs: readInt('JOB_SWEEP_INTERVAL_MS', 5 * 60 * 1000),
  jobStoreMax: readInt('JOB_STORE_MAX', 5000),
  /** Static-asset cache max-age in seconds. */
  staticMaxAgeSec: readInt('STATIC_MAX_AGE_SEC', 3600),

  // ---------- Rate limits (per minute per IP) ----------
  // Overridden by RATE_LIMIT_GLOBAL / RATE_LIMIT_UPLOAD / etc.
  rateLimitGlobal: readInt('RATE_LIMIT_GLOBAL', 120),
  rateLimitUpload: readInt('RATE_LIMIT_UPLOAD', 10),
  rateLimitAnalytics: readInt('RATE_LIMIT_ANALYTICS', 60),
} as const;
