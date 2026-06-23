// Generation endpoint — kicks off async image generation and exposes
// a polling-friendly status API.
//
// Routes:
//   POST   /api/generate          create job, returns { jobId, status }
//   GET    /api/generate/:jobId   poll status; returns full job state
//   DELETE /api/generate/:jobId   cancel a running/queued job
//   GET    /api/generate          list recent jobs (filter by sessionId)
//
// Why polling and not SSE/WebSocket: the only HTTP client we need to
// support is the browser fetch API. Long polling with a generous
// max-wait is simpler and just as good UX.

import { Router } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { track } from '../../shared/analytics.js';
import type {
  FaceFeatures,
  GenerationRequest,
  GenerationResponse,
  GenerationStatusResponse,
} from '../../shared/types.js';
import { config } from '../config.js';
import { JobStore } from '../jobs/store.js';
import { getImageGenerationProvider } from '../providers/factory.js';
import type { ProviderInput } from '../providers/types.js';
import { loadLooks } from './_looks.js';

// ---------- 单例 store + provider (per-process) ----------

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const UPLOAD_DIR = resolve(PROJECT_ROOT, config.uploadDir);

const jobStore = new JobStore(config.jobTtlMs, config.jobSweepIntervalMs, (err) => {
  console.warn('[generate] job sweep error:', err);
});

// ---------- Helpers ----------

function safeFeatures(input: unknown): FaceFeatures | undefined {
  if (!input || typeof input !== 'object') return undefined;
  return input as FaceFeatures;
}

function toStatusResponse(job: ReturnType<JobStore['get']>): GenerationStatusResponse | null {
  if (!job) return null;
  const r: GenerationStatusResponse = { jobId: job.id, status: job.status };
  if (job.status === 'succeeded' && job.resultUrl) r.resultUrl = job.resultUrl;
  if (job.status === 'failed' && job.error) r.error = job.error;
  if (job.status === 'succeeded') r.tookMs = job.updatedAt - job.createdAt;
  if (typeof job.progress === 'number') r.progress = job.progress;
  return r;
}

function composePrompt(
  look: { trigger?: string; name: string } | null,
  features?: FaceFeatures,
): string {
  const parts: string[] = [];
  if (look?.trigger) parts.push(look.trigger);
  parts.push('high quality portrait, soft studio lighting, sharp focus on face');
  if (features) {
    if (features.skinTone !== 'unknown') parts.push(`${features.skinTone} skin tone`);
    if (features.faceShape !== 'unknown') parts.push(`${features.faceShape} face shape`);
  }
  parts.push(look?.name ?? 'natural makeup look');
  return parts.join(', ');
}

// ---------- Router ----------

export const generateRouter = Router();

// POST /api/generate
generateRouter.post('/generate', async (req, res) => {
  const body = (req.body ?? {}) as Partial<GenerationRequest>;
  if (!body.imageId || !body.style) {
    res.status(400).json({ error: '缺少 imageId 或 style' });
    return;
  }

  const imagePath = join(UPLOAD_DIR, `${body.imageId}`);
  // Try the most common extensions. The upload route accepts jpg/png/webp.
  const candidates = [`${imagePath}.jpg`, `${imagePath}.png`, `${imagePath}.webp`, imagePath];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    res.status(404).json({ error: `imageId 不存在或已过期: ${body.imageId}` });
    return;
  }
  const imageMime = found.endsWith('.png')
    ? 'image/png'
    : found.endsWith('.webp')
      ? 'image/webp'
      : 'image/jpeg';

  const looks = loadLooks();
  const look = looks.find((l) => l.id === body.style) ?? null;
  const prompt = composePrompt(
    look ? { trigger: look.trigger, name: look.name } : null,
    safeFeatures(body.features),
  );

  const sessionId =
    (typeof req.headers['x-session-id'] === 'string'
      ? req.headers['x-session-id']
      : Array.isArray(req.headers['x-session-id'])
        ? req.headers['x-session-id'][0]
        : null) ?? null;

  const provider = getImageGenerationProvider();
  const job = jobStore.create({
    imageId: body.imageId,
    style: body.style,
    sessionId,
    provider: provider.name,
    prompt,
  });

  // Track + log
  track('generate_start', {
    jobId: job.id,
    style: job.style,
    provider: job.provider,
  });

  // Kick off async work. Do not await — return jobId immediately.
  void runJob(job.id, found, imageMime, body.style, prompt, safeFeatures(body.features)).catch(
    (err) => {
      console.error('[generate] unexpected runner error:', err);
    },
  );

  const resp: GenerationResponse = { jobId: job.id, status: job.status };
  res.status(202).json(resp);
});

// GET /api/generate/:jobId
generateRouter.get('/generate/:jobId', (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'job not found' });
    return;
  }
  const r = toStatusResponse(job);
  res.json(r);
});

// DELETE /api/generate/:jobId
generateRouter.delete('/generate/:jobId', (req, res) => {
  const job = jobStore.cancel(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'job not found' });
    return;
  }
  track('generate_cancel', { jobId: job.id });
  const r = toStatusResponse(job);
  res.json(r);
});

// GET /api/generate — list (optionally filtered by ?sessionId=)
generateRouter.get('/generate', (req, res) => {
  const sessionId =
    typeof req.query.sessionId === 'string' && req.query.sessionId.length > 0
      ? req.query.sessionId
      : undefined;
  const list = jobStore.list({ sessionId, limit: 50 });
  res.json({ jobs: list.map((j) => toStatusResponse(j)) });
});

// ---------- Job runner ----------

async function runJob(
  jobId: string,
  imagePath: string,
  imageMime: string,
  style: string,
  prompt: string,
  features: FaceFeatures | undefined,
): Promise<void> {
  jobStore.setStatus(jobId, 'running');
  const provider = getImageGenerationProvider();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.imageGenTimeoutMs);

  try {
    const input: ProviderInput = { imagePath, imageMime, style, prompt, features };
    const out = await provider.generate(input, ctrl.signal);
    jobStore.setStatus(jobId, 'succeeded', {
      resultUrl: out.resultUrl,
      progress: 1,
    });
    track('generate_complete', {
      jobId,
      style,
      provider: out.provider,
      tookMs: out.tookMs,
    });
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    const message =
      err instanceof Error
        ? err.message
        : aborted
          ? `timeout after ${config.imageGenTimeoutMs}ms`
          : 'generation failed';
    jobStore.setStatus(jobId, aborted ? 'cancelled' : 'failed', {
      error: message,
    });
    track(aborted ? 'generate_cancel' : 'generate_fail', {
      jobId,
      style,
      error: message,
    });
  } finally {
    clearTimeout(timer);
  }
}
