// Touch swipe gesture hook — 监听 element 上的滑动, 触发回调.
// 支持水平 (left/right) 和垂直 (up/down) 两种方向.
// 阈值 50px + 速度加权, 避免误触. 默认水平方向.

import { useEffect, useRef } from 'react';

export interface SwipeOptions {
  /** 左滑 (水平方向) / 下滑 (垂直方向). */
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  /** 触发回调的最小距离 (px). 默认 50. */
  threshold?: number;
  /** 速度阈值 (px/ms), 0.3 偏慢, 0.5 偏快. 默认 0.3. */
  velocityThreshold?: number;
  /** 滑动方向. 'horizontal' (默认) 适合翻页/tab; 'vertical' 适合下拉/关闭. */
  direction?: 'horizontal' | 'vertical';
}

export interface SwipeInput {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  durationMs: number;
  threshold?: number;
  velocityThreshold?: number;
  direction?: 'horizontal' | 'vertical';
}

export type SwipeResult = 'left' | 'right' | 'up' | 'down' | 'none';

/**
 * 纯函数版 swipe 判定 — 便于测试.
 */
export function detectSwipe(input: SwipeInput): SwipeResult {
  const dx = input.endX - input.startX;
  const dy = input.endY - input.startY;
  const dt = Math.max(1, input.durationMs);
  const direction = input.direction ?? 'horizontal';
  const threshold = input.threshold ?? 50;
  const vTh = input.velocityThreshold ?? 0.3;

  if (direction === 'horizontal') {
    const vx = Math.abs(dx) / dt;
    if (Math.abs(dx) < threshold && vx < vTh) return 'none';
    if (Math.abs(dx) < Math.abs(dy)) return 'none';
    return dx < 0 ? 'left' : 'right';
  } else {
    const vy = Math.abs(dy) / dt;
    if (Math.abs(dy) < threshold && vy < vTh) return 'none';
    if (Math.abs(dy) < Math.abs(dx)) return 'none';
    return dy < 0 ? 'up' : 'down';
  }
}

interface TouchState {
  startX: number;
  startY: number;
  startT: number;
  triggered: boolean;
}

export function useSwipe<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
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
      const dir = optsRef.current.direction ?? 'horizontal';
      // 主要方向位移大时 preventDefault
      if (dir === 'horizontal' && Math.abs(dx) > Math.abs(dy) * 1.5) {
        e.preventDefault();
      } else if (dir === 'vertical' && Math.abs(dy) > Math.abs(dx) * 1.5) {
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
        direction: optsRef.current.direction,
      });
      stateRef.current = null;
      if (result === 'none') return;
      s.triggered = true;
      switch (result) {
        case 'left':
          optsRef.current.onSwipeLeft?.();
          break;
        case 'right':
          optsRef.current.onSwipeRight?.();
          break;
        case 'up':
          optsRef.current.onSwipeUp?.();
          break;
        case 'down':
          optsRef.current.onSwipeDown?.();
          break;
      }
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
