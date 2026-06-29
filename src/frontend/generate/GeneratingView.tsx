// GeneratingView — progress UI for async image generation.
// Renders one of four states:
//   - idle    : no job yet, big "开始生成" CTA
//   - pending : queued or running, animated progress + elapsed timer
//   - done    : succeeded, shows the result image with a "重试" / "用这张" pair
//   - error   : failed or cancelled, shows the message and a retry button

import { useEffect, useState } from 'react';
import type { MakeupLook } from '@shared/types';

interface Props {
  look: MakeupLook | null;
  imageId: string | null;
  status: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  resultUrl: string | null;
  error: string | null;
  elapsedMs: number | null;
  onStart: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onUse: () => void;
}

const TIPS = [
  '正在分析你的面部光线',
  '把五官位置映射到画面',
  '选择匹配你肤色的色调',
  '叠加腮红 / 唇色 / 眼影',
  '最后做精修与高光',
];

function fmtSeconds(ms: number): string {
  return `${Math.max(0, Math.floor(ms / 1000))}s`;
}

export default function GeneratingView({
  look,
  imageId,
  status,
  resultUrl,
  error,
  elapsedMs,
  onStart,
  onCancel,
  onRetry,
  onUse,
}: Props) {
  const [tipIdx, setTipIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [fadeKey, setFadeKey] = useState(0);
  useEffect(() => {
    if (status !== 'queued' && status !== 'running') return;
    if (paused) return;
    const t = window.setInterval(() => {
      setTipIdx((i) => (i + 1) % TIPS.length);
      setFadeKey((k) => k + 1);
    }, 3000);
    return () => window.clearInterval(t);
  }, [status, paused]);

  const canStart = imageId !== null && look !== null && status === 'idle';
  const isPending = status === 'queued' || status === 'running';
  const isDone = status === 'succeeded';
  const isError = status === 'failed' || status === 'cancelled';

  return (
    <div className="text-left space-y-4">
      <div>
        <div className="chip-tag mb-1.5">妆容预览 · 大模型生成</div>
        <h2 className="font-serif text-xl font-bold text-ink mt-1">
          {look ? `把「${look.name}」穿到你脸上` : '一键试妆'}
        </h2>
        <p className="text-sm text-ink-soft/70 mt-1">
          模型在云端渲染，通常 30 秒 ~ 2 分钟。可以同时开始跟妆教程。
        </p>
      </div>

      {/* Image area */}
      <div className="relative card-soft overflow-hidden" style={{ aspectRatio: '4 / 5' }}>
        {isDone && resultUrl ? (
          <img
            src={resultUrl}
            alt={look?.name ?? '生成的妆容预览'}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, rgba(253,242,243,0.9), rgba(234,182,188,0.45))',
            }}
          >
            {isPending ? (
              <div className="text-center px-6">
                <div className="relative w-16 h-16 mx-auto mb-4">
                  <div
                    className="absolute inset-0 rounded-full animate-spin-slow"
                    style={{
                      background: 'conic-gradient(from 0deg, #C86B77, #EAB6BC, #C86B77)',
                      mask: 'radial-gradient(circle, transparent 55%, black 56%)',
                      WebkitMask: 'radial-gradient(circle, transparent 55%, black 56%)',
                    }}
                  />
                  <div className="absolute inset-2 rounded-full bg-white/85 backdrop-blur flex items-center justify-center text-2xl">
                    💄
                  </div>
                </div>
                <p
                  key={fadeKey}
                  className="font-serif text-base text-ink animate-fade-up cursor-default"
                  onMouseEnter={() => setPaused(true)}
                  onMouseLeave={() => setPaused(false)}
                  onFocus={() => setPaused(true)}
                  onBlur={() => setPaused(false)}
                  title="悬停暂停轮播"
                >
                  {TIPS[tipIdx]}
                </p>
                <p className="text-xs text-ink-soft/70 mt-2">
                  已等待 {elapsedMs !== null ? fmtSeconds(elapsedMs) : '0s'}
                </p>
              </div>
            ) : isError ? (
              <div className="text-center px-6">
                <div className="text-4xl mb-2">🥺</div>
                <p className="font-serif text-base text-ink">{error ?? '生成失败'}</p>
                <p className="text-xs text-ink-soft/60 mt-1">可以换一张图，或者再试一次</p>
              </div>
            ) : (
              <div className="text-center px-6">
                <div className="text-4xl mb-2">✨</div>
                <p className="font-serif text-base text-ink">还没有生成</p>
                <p className="text-xs text-ink-soft/60 mt-1">
                  {imageId ? '点下方按钮开始' : '需要先上传一张照片'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {status === 'idle' && (
          <button
            type="button"
            onClick={onStart}
            disabled={!canStart}
            data-testid="generate-start"
            className="btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            生成妆容预览 →
          </button>
        )}
        {isPending && (
          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary flex-1"
            data-testid="generate-cancel"
          >
            取消
          </button>
        )}
        {isDone && (
          <>
            <button
              type="button"
              onClick={onUse}
              className="btn-primary flex-1"
              data-testid="generate-use"
            >
              用这张 →
            </button>
            <button
              type="button"
              onClick={onRetry}
              className="btn-secondary"
              data-testid="generate-retry"
            >
              再试一张
            </button>
          </>
        )}
        {isError && (
          <button
            type="button"
            onClick={onRetry}
            className="btn-primary flex-1"
            data-testid="generate-retry"
          >
            重试
          </button>
        )}
      </div>
    </div>
  );
}
