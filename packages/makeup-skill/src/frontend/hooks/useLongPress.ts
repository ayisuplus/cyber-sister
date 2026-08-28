// useLongPress — 长按手势 hook, 触发回调并提供进度反馈.
// 视觉: 在元素上叠加一个从 0 到 1 的进度, 配合 CSS 动画.
// 触感: 开始时轻 tap, 触发时 success.
// 键盘: 支持 (Space/Enter 持续按 500ms 也算长按).

import { useEffect, useRef, useState } from 'react';

export interface LongPressOptions {
  onLongPress: () => void;
  /** 长按触发时间 (ms). 默认 500. */
  durationMs?: number;
  /** 是否禁用. */
  disabled?: boolean;
  /** 移动距离超过这个值就取消 (px). 默认 10. */
  movementThreshold?: number;
}

export interface LongPressState<T extends HTMLElement = HTMLElement> {
  /** 0..1 进度. */
  progress: number;
  /** 是否正在长按中. */
  isPressing: boolean;
  ref: React.RefObject<T | null>;
}

/**
 * 纯函数版进度计算 — 0..1 范围, 给定 elapsed ms 和总时长.
 * 公开用于测试与未来其他 UI 场景.
 */
export function longPressProgress(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, elapsedMs / durationMs));
}

/**
 * 判断移动是否超出阈值.
 */
export function exceedsMovementThreshold(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  threshold: number,
): boolean {
  return Math.hypot(currentX - startX, currentY - startY) > threshold;
}

export function useLongPress<T extends HTMLElement = HTMLElement>(
  opts: LongPressOptions,
): LongPressState<T> {
  const { onLongPress, durationMs = 500, disabled = false, movementThreshold = 10 } = opts;
  const ref = useRef<T | null>(null);
  const [progress, setProgress] = useState(0);
  const [isPressing, setIsPressing] = useState(false);
  const stateRef = useRef<{
    startT: number;
    startX: number;
    startY: number;
    rafId: number;
    triggered: boolean;
  } | null>(null);
  const optsRef = useRef({ onLongPress, disabled, durationMs, movementThreshold });
  optsRef.current = { onLongPress, disabled, durationMs, movementThreshold };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function tick() {
      const s = stateRef.current;
      if (!s || s.triggered) return;
      const elapsed = Date.now() - s.startT;
      const p = Math.min(1, elapsed / optsRef.current.durationMs);
      setProgress(p);
      if (p >= 1) {
        s.triggered = true;
        optsRef.current.onLongPress();
        // 保持 isPressing=true 一小段时间, 让用户看到反馈
        setTimeout(() => {
          stateRef.current = null;
          setProgress(0);
          setIsPressing(false);
        }, 100);
        return;
      }
      s.rafId = requestAnimationFrame(tick);
    }

    function start(x: number, y: number) {
      if (optsRef.current.disabled || stateRef.current) return;
      stateRef.current = {
        startT: Date.now(),
        startX: x,
        startY: y,
        rafId: 0,
        triggered: false,
      };
      setIsPressing(true);
      setProgress(0);
      stateRef.current.rafId = requestAnimationFrame(tick);
    }

    function cancel() {
      const s = stateRef.current;
      if (!s) return;
      cancelAnimationFrame(s.rafId);
      stateRef.current = null;
      setProgress(0);
      setIsPressing(false);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const t = e.touches[0]!;
      start(t.clientX, t.clientY);
    }
    function onTouchMove(e: TouchEvent) {
      const s = stateRef.current;
      if (!s) return;
      const t = e.touches[0]!;
      if (
        Math.hypot(t.clientX - s.startX, t.clientY - s.startY) > optsRef.current.movementThreshold
      ) {
        cancel();
      }
    }
    function onTouchEnd() {
      cancel();
    }

    function onMouseDown(e: MouseEvent) {
      start(e.clientX, e.clientY);
    }
    function onMouseUp() {
      cancel();
    }
    function onMouseLeave() {
      cancel();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === ' ' || e.key === 'Enter') {
        if (stateRef.current) return; // 已经在长按中
        const r = ref.current?.getBoundingClientRect();
        start((r?.left ?? 0) + (r?.width ?? 0) / 2, (r?.top ?? 0) + (r?.height ?? 0) / 2);
        e.preventDefault();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === ' ' || e.key === 'Enter') {
        cancel();
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('mouseup', onMouseUp);
    el.addEventListener('mouseleave', onMouseLeave);
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('keyup', onKeyUp);

    return () => {
      cancel();
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('mouseleave', onMouseLeave);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return { progress, isPressing, ref };
}
