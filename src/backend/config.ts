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

  // ---------- Upload ----------
  uploadDir: readStr('UPLOAD_DIR', 'public/uploads'),
  maxUploadBytes: readInt('MAX_UPLOAD_BYTES', 8 * 1024 * 1024), // 8 MB

  // ---------- Generation ----------
  /**
   * Provider name. One of:
   *   - "noop"  (default) — explicit "not configured" failure, safe in prod
   *   - "mock"  — deterministic SVG placeholder, dev only
   *   - "replicate" — Replicate-hosted model (to be implemented by model provider)
   */
  imageGenProvider: readStr('IMAGE_GEN_PROVIDER', 'noop'),
  /** Hard timeout per provider call. Provider receives an AbortSignal. */
  imageGenTimeoutMs: readInt('IMAGE_GEN_TIMEOUT_MS', 180_000), // 3 min
  /** Suggested poll interval for clients. Server doesn't enforce. */
  imageGenPollIntervalMs: readInt('IMAGE_GEN_POLL_INTERVAL_MS', 2_500),
  /** TTL for completed/failed jobs in the in-memory store. */
  jobTtlMs: readInt('JOB_TTL_MS', 60 * 60 * 1000), // 1 hour
  /** How often the job store sweeps for expired jobs. */
  jobSweepIntervalMs: readInt('JOB_SWEEP_INTERVAL_MS', 5 * 60 * 1000), // 5 min
} as const;

export type AppConfig = typeof config;
