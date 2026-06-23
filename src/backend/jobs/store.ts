// In-memory job store. Single-process MVP.
//
// For production multi-instance, swap the Map with Redis / Postgres.
// The interface here is what would change.

import { randomUUID } from 'node:crypto';
import type { GenerationJob, JobStatus } from '../../shared/types.js';

interface CreateInput {
  imageId: string;
  style: string;
  sessionId: string | null;
  provider: string;
  prompt: string;
}

export class JobStore {
  private readonly jobs = new Map<string, GenerationJob>();
  private readonly sweepTimer: ReturnType<typeof setInterval> | null;

  constructor(
    private readonly ttlMs: number,
    sweepIntervalMs: number,
    onError: (err: unknown) => void = () => {},
  ) {
    if (sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => {
        try {
          this.cleanup();
        } catch (err) {
          onError(err);
        }
      }, sweepIntervalMs);
      // Don't keep the event loop alive just for sweeping.
      this.sweepTimer.unref();
    } else {
      this.sweepTimer = null;
    }
  }

  create(input: CreateInput): GenerationJob {
    const now = Date.now();
    const job: GenerationJob = {
      id: randomUUID(),
      status: 'queued',
      imageId: input.imageId,
      style: input.style,
      sessionId: input.sessionId,
      provider: input.provider,
      prompt: input.prompt,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): GenerationJob | undefined {
    return this.jobs.get(id);
  }

  update(
    id: string,
    patch: Partial<Omit<GenerationJob, 'id' | 'createdAt'>>,
  ): GenerationJob | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const next: GenerationJob = { ...job, ...patch, id: job.id, updatedAt: Date.now() };
    this.jobs.set(id, next);
    return next;
  }

  setStatus(
    id: string,
    status: JobStatus,
    extra: Partial<GenerationJob> = {},
  ): GenerationJob | undefined {
    return this.update(id, { status, ...extra });
  }

  cancel(id: string): GenerationJob | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      return job;
    }
    return this.setStatus(id, 'cancelled');
  }

  list(opts: { sessionId?: string; limit?: number } = {}): GenerationJob[] {
    const { sessionId, limit = 50 } = opts;
    const all = [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
    const filtered = sessionId ? all.filter((j) => j.sessionId === sessionId) : all;
    return filtered.slice(0, limit);
  }

  /** Remove finished jobs older than ttlMs. Returns the number deleted. */
  cleanup(now: number = Date.now()): number {
    let n = 0;
    for (const [id, job] of this.jobs) {
      const isTerminal =
        job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled';
      if (isTerminal && now - job.updatedAt > this.ttlMs) {
        this.jobs.delete(id);
        n++;
      }
    }
    return n;
  }

  /** For tests: hard reset + stop the sweeper. */
  destroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.jobs.clear();
  }

  /** For tests: how many jobs are currently tracked. */
  size(): number {
    return this.jobs.size;
  }
}
