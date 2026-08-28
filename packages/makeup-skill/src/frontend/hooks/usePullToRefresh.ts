// Pull-to-refresh hook — 移动端下拉刷新, 触发 onRefresh 回调.
// 监听 touchstart/move/end, 距离阈值默认 70px, 释放后回弹.
// 垂直滚动优先: 水平位移大时不触发, 防止和左右滑冲突.

import { useEffect, useRef, useState } from 'react';

export interface PullToRefreshOptions {
  onRefresh: () => void | Promise<void>;
  /** 触发刷新的最小下拉距离 (px). 默认 70. */
  threshold?: number;
  /** 最大下拉距离 (px), 超过不再继续拉, 防止橡皮筋. 默认 120. */
  maxPull?: number;
  /** 是否禁用 (例如加载中). 默认 false. */
  disabled?: boolean;
}

interface PullState {
  startY: number;
  startScrollY: number;
  triggered: boolean;
}

export interface PullToRefreshState<T extends HTMLElement = HTMLElement> {
  /** 当前下拉距离 (0..maxPull). 0 时不显示. */
  pullDistance: number;
  /** 是否正在刷新 (用户已释放超过阈值, onRefresh 进行中). */
  isRefreshing: boolean;
  /** 容器 ref, 挂到滚动容器上. */
  ref: React.RefObject<T | null>;
}

/**
 * 纯函数: 把原始下拉距离转为带阻尼 + 封顶的距离.
 * 模拟橡皮筋效果 — 越往下越难拉.
 * 公开用于测试.
 */
export function dampPullDistance(rawDy: number, maxPull: number): number {
  if (rawDy <= 0) return 0;
  return Math.min(maxPull, Math.sqrt(rawDy) * 12);
}

export function usePullToRefresh<T extends HTMLElement = HTMLElement>(
  opts: PullToRefreshOptions,
): PullToRefreshState<T> {
  const { onRefresh, threshold = 70, maxPull = 120, disabled = false } = opts;
  const ref = useRef<T | null>(null);
  const stateRef = useRef<PullState | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const optsRef = useRef({ onRefresh, disabled, threshold, maxPull });
  optsRef.current = { onRefresh, disabled, threshold, maxPull };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function onStart(e: TouchEvent) {
      if (optsRef.current.disabled || isRefreshing) return;
      if (e.touches.length !== 1) return;
      if (el!.scrollTop > 5) return;
      const t = e.touches[0]!;
      stateRef.current = {
        startY: t.clientY,
        startScrollY: el!.scrollTop,
        triggered: false,
      };
    }

    function onMove(e: TouchEvent) {
      const s = stateRef.current;
      if (!s) return;
      if (e.touches.length !== 1) return;
      const t = e.touches[0]!;
      const dy = t.clientY - s.startY;
      if (el!.scrollTop > s.startScrollY) {
        stateRef.current = null;
        setPullDistance(0);
        return;
      }
      const damped = dampPullDistance(dy, optsRef.current.maxPull);
      setPullDistance(damped);
      if (damped > 5) e.preventDefault();
    }

    async function onEnd() {
      const s = stateRef.current;
      stateRef.current = null;
      if (!s) return;
      const dist = pullDistance;
      if (dist < optsRef.current.threshold) {
        setPullDistance(0);
        return;
      }
      setIsRefreshing(true);
      try {
        await optsRef.current.onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    }

    function onCancel() {
      stateRef.current = null;
      setPullDistance(0);
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
  }, [isRefreshing, pullDistance]);

  return { pullDistance, isRefreshing, ref };
}
