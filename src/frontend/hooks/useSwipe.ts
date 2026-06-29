// Touch swipe gesture hook — 监听 element 上的水平滑动, 触发 onSwipeLeft / onSwipeRight.
// 阈值 50px + 速度加权, 避免误触. 支持 touchstart/touchmove/touchend 三件套.

import { useEffect, useRef } from 'react';

export interface SwipeOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** 触发回调的最小水平距离 (px). 默认 50. */
  threshold?: number;
  /** 速度阈值 (px/ms), 0.3 偏慢, 0.5 偏快. 默认 0.3. */
  velocityThreshold?: number;
}

export interface SwipeInput {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  durationMs: number;
  threshold?: number;
  velocityThreshold?: number;
}

export type SwipeResult = 'left' | 'right' | 'none';

/**
 * 纯函数版 swipe 判定 — 便于测试.
 * 返回 'left' / 'right' / 'none'.
 */
export function detectSwipe(input: SwipeInput): SwipeResult {
  const dx = input.endX - input.startX;
  const dy = input.endY - input.startY;
  const dt = Math.max(1, input.durationMs);
  const vx = Math.abs(dx) / dt;
  const threshold = input.threshold ?? 50;
  const vTh = input.velocityThreshold ?? 0.3;

  if (Math.abs(dx) < threshold && vx < vTh) return 'none';
  if (Math.abs(dx) < Math.abs(dy)) return 'none';
  return dx < 0 ? 'left' : 'right';
}

interface TouchState {
  startX: number;
  startY: number;
  startT: number;
  triggered: boolean;
}

export function useSwipe(
  ref: React.RefObject<HTMLElement | null>,
  opts: SwipeOptions,
): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const stateRef = useRef<TouchState | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function onStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const t = e.touches[0]!;
      stateRef.current = {
        startX: t.clientX,
        startY: t.clientY,
        startT: Date.now(),
        triggered: false,
      };
    }

    function onMove(e: TouchEvent) {
      const s = stateRef.current;
      if (!s || s.triggered) return;
      if (e.touches.length !== 1) return;
      const t = e.touches[0]!;
      const dx = t.clientX - s.startX;
      const dy = t.clientY - s.startY;
      if (Math.abs(dx) > Math.abs(dy) * 1.5) {
        e.preventDefault();
      }
    }

    function onEnd(e: TouchEvent) {
      const s = stateRef.current;
      if (!s || s.triggered) return;
      const t = e.changedTouches[0]!;
      const result = detectSwipe({
        startX: s.startX,
        startY: s.startY,
        endX: t.clientX,
        endY: t.clientY,
        durationMs: Date.now() - s.startT,
        threshold: optsRef.current.threshold,
        velocityThreshold: optsRef.current.velocityThreshold,
      });
      stateRef.current = null;
      if (result === 'none') return;
      s.triggered = true;
      if (result === 'left') optsRef.current.onSwipeLeft?.();
      else optsRef.current.onSwipeRight?.();
    }

    function onCancel() {
      stateRef.current = null;
    }

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    };
  }, [ref]);
}
