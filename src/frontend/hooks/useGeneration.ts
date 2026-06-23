// useGeneration — poll-based hook for the async image generation API.
//
// Contract:
//   const gen = useGeneration();
//   await gen.start({ imageDataUrl, style, features });  // uploads + generates, returns jobId
//   // OR:  gen.start({ imageId, style, features })        // if image already uploaded
//   // gen.status / gen.resultUrl / gen.error auto-update while polling
//   gen.cancel();                                          // best-effort cancel
//
// Implementation notes:
//   - One in-flight poll at a time (AbortController cancels previous fetch).
//   - Polling stops on any terminal state (succeeded | failed | cancelled).
//   - Hard ceiling: 240s of polling → gives up and surfaces a timeout error.

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FaceFeatures,
  GenerationResponse,
  GenerationStatusResponse,
  JobStatus,
  UploadResponse,
} from '@shared/types';

const POLL_INTERVAL_MS = 2_500;
const MAX_POLL_MS = 240_000;

export interface UseGenerationState {
  jobId: string | null;
  imageId: string | null;
  status: JobStatus | null;
  resultUrl: string | null;
  error: string | null;
  /** Wall-clock milliseconds since start. null when not running. */
  elapsedMs: number | null;
  isPolling: boolean;
  /** Set while the upload step is in flight (before generate POST). */
  isUploading: boolean;
}

export interface StartInputWithImage {
  imageDataUrl: string;
  style: string;
  features?: FaceFeatures;
}
export interface StartInputWithId {
  imageId: string;
  style: string;
  features?: FaceFeatures;
}
export type StartInput = StartInputWithImage | StartInputWithId;

export interface UseGenerationApi extends UseGenerationState {
  start: (req: StartInput) => Promise<string>;
  cancel: () => Promise<void>;
  reset: () => void;
}

const INITIAL: UseGenerationState = {
  jobId: null,
  imageId: null,
  status: null,
  resultUrl: null,
  error: null,
  elapsedMs: null,
  isPolling: false,
  isUploading: false,
};

export function useGeneration(): UseGenerationApi {
  const [state, setState] = useState<UseGenerationState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);
  const startTsRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const tickElapsed = useCallback(() => {
    if (startTsRef.current !== null) {
      const ms = Date.now() - startTsRef.current;
      setState((s) => (s.elapsedMs === ms ? s : { ...s, elapsedMs: ms }));
    }
  }, []);

  const uploadIfNeeded = useCallback(async (req: StartInput): Promise<string> => {
    if ('imageId' in req) return req.imageId;
    setState((s) => ({ ...s, isUploading: true }));
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: req.imageDataUrl }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `upload failed: HTTP ${res.status}`);
      }
      const data = (await res.json()) as UploadResponse;
      return data.imageId;
    } finally {
      setState((s) => ({ ...s, isUploading: false }));
    }
  }, []);

  const pollOnce = useCallback(async (jobId: string): Promise<GenerationStatusResponse> => {
    abortRef.current = new AbortController();
    const res = await fetch(`/api/generate/${jobId}`, {
      signal: abortRef.current.signal,
    });
    if (res.status === 404) {
      throw new Error('任务已过期或不存在');
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as GenerationStatusResponse;
    setState((s) => ({
      ...s,
      status: data.status,
      resultUrl: data.resultUrl ?? s.resultUrl,
      error: data.error ?? null,
    }));
    return data;
  }, []);

  const startPolling = useCallback(
    (jobId: string) => {
      const deadline = Date.now() + MAX_POLL_MS;
      const tick = async () => {
        tickElapsed();
        try {
          const data = await pollOnce(jobId);
          if (
            data.status === 'succeeded' ||
            data.status === 'failed' ||
            data.status === 'cancelled'
          ) {
            setState((s) => ({ ...s, isPolling: false }));
            clearTimers();
            return;
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          const message = err instanceof Error ? err.message : 'poll failed';
          setState((s) => ({ ...s, error: message, isPolling: false }));
          clearTimers();
          return;
        }
        if (Date.now() > deadline) {
          setState((s) => ({
            ...s,
            error: `等待超时（${Math.round(MAX_POLL_MS / 1000)}s）`,
            isPolling: false,
          }));
          clearTimers();
          return;
        }
        timerRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
      };
      void tick();
    },
    [clearTimers, pollOnce, tickElapsed],
  );

  const start = useCallback(
    async (req: StartInput): Promise<string> => {
      clearTimers();
      startTsRef.current = Date.now();
      setState({ ...INITIAL, isPolling: true, isUploading: 'imageDataUrl' in req, elapsedMs: 0 });

      let imageId: string;
      try {
        imageId = await uploadIfNeeded(req);
      } catch (err) {
        const message = err instanceof Error ? err.message : '上传失败';
        setState((s) => ({ ...s, error: message, isPolling: false, isUploading: false }));
        throw err;
      }
      setState((s) => ({ ...s, imageId }));

      abortRef.current = new AbortController();
      let res: Response;
      try {
        res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageId,
            style: req.style,
            features: req.features,
          }),
          signal: abortRef.current.signal,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : '提交失败';
        setState((s) => ({ ...s, error: message, isPolling: false }));
        throw err;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const message = text || `HTTP ${res.status}`;
        setState((s) => ({ ...s, error: message, isPolling: false }));
        throw new Error(message);
      }
      const data = (await res.json()) as GenerationResponse;
      setState((s) => ({ ...s, jobId: data.jobId, status: data.status, isUploading: false }));
      startPolling(data.jobId);
      return data.jobId;
    },
    [clearTimers, startPolling, uploadIfNeeded],
  );

  const cancel = useCallback(async (): Promise<void> => {
    const id = state.jobId;
    if (!id) {
      clearTimers();
      setState(INITIAL);
      return;
    }
    clearTimers();
    try {
      await fetch(`/api/generate/${id}`, { method: 'DELETE' });
    } catch {
      // Best-effort. Local state still flips below.
    }
    setState((s) => ({ ...s, status: 'cancelled', isPolling: false, isUploading: false }));
  }, [clearTimers, state.jobId]);

  const reset = useCallback(() => {
    clearTimers();
    startTsRef.current = null;
    setState(INITIAL);
  }, [clearTimers]);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  return { ...state, start, cancel, reset };
}
