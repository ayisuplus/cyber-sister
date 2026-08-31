// hooks-ssr.test.tsx — 手势/焦点 hooks 的行为测试 (无 jsdom, SSR 策略).
//
// 策略:
// 1. vi.mock('react') — useEffect 同步执行 (SSR 本不跑 effect), useRef 出队预置 ref,
//    useState 返回可控值 + 记录用 setter. 这样 renderToString 渲染 harness 组件时,
//    hook 体与 effect 体真实运行, 事件处理器真实挂到 fake element 上.
// 2. fake element 只实现 handler 触碰的最小接口 (addEventListener / removeEventListener /
//    scrollTop / getBoundingClientRect / querySelectorAll / contains), 监听器存入 Map.
// 3. 渲染后直接 fire 合成事件 ({ clientX, touches, preventDefault: spy }), 断言副作用:
//    回调 spy、state setter 调用、cancelAnimationFrame、focus() 调用等.

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

// ---------- react mock 控制 ----------

const mockCtl = vi.hoisted(() => ({
  /** useRef 出队队列 — 按 hook 内 useRef 调用顺序预置. */
  refQueue: [] as Array<{ current: unknown }>,
  /** useState 返回值覆盖队列 — 按 useState 调用顺序. */
  stateQueue: [] as unknown[],
  /** 每次 useState 记录一个 setter spy (按调用顺序). */
  setters: [] as Mock[],
  /** useEffect 回调的返回值 (cleanup 函数或 undefined). */
  cleanups: [] as Array<undefined | (() => void)>,
}));

vi.mock('react', async (importOriginal) => {
  // importOriginal 返回 unknown; react 为熟知的模块命名空间, 一次命名 cast.
  const actual = (await importOriginal()) as typeof React & Record<string, unknown>;
  // react-dom/server (CJS) 从 require('react') 上读共享 internals, 必须透传.
  const internals = actual['__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED'];
  return {
    ...actual,
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: internals,
    useEffect: (fn: () => undefined | (() => void)): void => {
      mockCtl.cleanups.push(fn());
    },
    useRef: <T,>(initial: T): { current: T } =>
      mockCtl.refQueue.length > 0
        ? (mockCtl.refQueue.shift() as { current: T })
        : { current: initial },
    useState: <T,>(initial: T): [T, (v: T) => void] => {
      const setter = vi.fn();
      mockCtl.setters.push(setter);
      const value =
        mockCtl.stateQueue.length > 0 ? (mockCtl.stateQueue.shift() as T) : initial;
      const typedSetter: (v: T) => void = setter; // Mock 兼容任意 setter 签名
      return [value, typedSetter];
    },
  };
});

import { useFocusTrap } from '../src/frontend/hooks/useFocusTrap';
import { useLongPress, type LongPressOptions } from '../src/frontend/hooks/useLongPress';
import {
  usePullToRefresh,
  type PullToRefreshOptions,
} from '../src/frontend/hooks/usePullToRefresh';
import { useSwipe, type SwipeOptions } from '../src/frontend/hooks/useSwipe';

// ---------- fake element / 合成事件 ----------

type Listener = (e: never) => unknown;

interface FakeEl {
  listeners: Map<string, Listener[]>;
  addEventListener: Mock;
  removeEventListener: Mock;
  scrollTop: number;
  fire(type: string, ev?: unknown): unknown;
  [key: string]: unknown;
}

function makeFakeEl(extra: Record<string, unknown> = {}): FakeEl {
  const listeners = new Map<string, Listener[]>();
  const el: FakeEl = {
    listeners,
    scrollTop: 0,
    addEventListener: vi.fn((type: string, fn: Listener) => {
      const arr = listeners.get(type) ?? [];
      arr.push(fn);
      listeners.set(type, arr);
    }),
    removeEventListener: vi.fn((type: string, fn: Listener) => {
      const arr = listeners.get(type) ?? [];
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    }),
    fire(type: string, ev: unknown = {}) {
      let last: unknown;
      for (const fn of listeners.get(type) ?? []) last = fn(ev as never);
      return last;
    },
  };
  Object.assign(el, extra);
  return el;
}

/** 合成 touch 事件: points = [[clientX, clientY], ...]. */
function touchEv(points: Array<[number, number]>) {
  const make = ([clientX, clientY]: [number, number]) => ({ clientX, clientY });
  return {
    touches: points.map(make),
    changedTouches: points.map(make),
    preventDefault: vi.fn(),
  };
}

function keyEv(key: string, over: Record<string, unknown> = {}) {
  return { key, shiftKey: false, preventDefault: vi.fn(), ...over };
}

// ---------- 全局时序 ----------

beforeEach(() => {
  mockCtl.refQueue.length = 0;
  mockCtl.stateQueue.length = 0;
  mockCtl.setters.length = 0;
  mockCtl.cleanups.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ============================================================
// useFocusTrap
// ============================================================

function fakeFocusable(visible = true) {
  return {
    offsetParent: visible ? ({} as Element) : null,
    focus: vi.fn(),
  };
}
/** document 是 stub 的 plain object; 一处命名 cast, 测试内只调本函数. */
function setActiveElement(node: unknown): void {
  const docShim = document as unknown as { activeElement: unknown };
  docShim.activeElement = node;
}

function makeContainer(nodes: unknown[], contained: unknown[] = []): FakeEl {
  return makeFakeEl({
    querySelectorAll: vi.fn(() => nodes),
    contains: vi.fn((n: unknown) => contained.includes(n)),
  });
}

function FocusHarness(props: { refParam: { current: unknown }; active?: boolean }) {
  useFocusTrap(props.refParam as React.RefObject<HTMLElement | null>, props.active ?? true);
  return React.createElement('div', null, 'trap');
}

function renderFocusTrap(
  el: FakeEl | null,
  active = true,
): { refParam: { current: unknown }; html: string } {
  const refParam = { current: el as unknown };
  const html = renderToString(
    React.createElement(FocusHarness, { refParam, active }),
  );
  return { refParam, html };
}

describe('useFocusTrap', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { activeElement: null as unknown });
  });

  it('active=false 时不聚焦也不挂监听', () => {
    const node = fakeFocusable();
    const el = makeContainer([node]);
    renderFocusTrap(el, false);
    expect(node.focus).not.toHaveBeenCalled();
    expect(el.addEventListener).not.toHaveBeenCalled();
    expect(mockCtl.cleanups[0]).toBeUndefined();
  });

  it('ref.current 为 null 时不做任何事', () => {
    expect(() => renderFocusTrap(null)).not.toThrow();
    expect(mockCtl.cleanups[0]).toBeUndefined();
  });

  it('挂载时聚焦第一个可见可聚焦节点, 隐藏节点被过滤', () => {
    const hidden = fakeFocusable(false);
    const visible = fakeFocusable();
    const el = makeContainer([hidden, visible]);
    renderFocusTrap(el);
    expect(hidden.focus).not.toHaveBeenCalled();
    expect(visible.focus).toHaveBeenCalledTimes(1);
    expect(el.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('隐藏但持有 document.activeElement 的节点保留在可聚焦列表中', () => {
    const hiddenActive = fakeFocusable(false);
    const visible = fakeFocusable();
    setActiveElement(hiddenActive);
    const el = makeContainer([hiddenActive, visible], [hiddenActive]);
    renderFocusTrap(el);
    // hiddenActive 是列表第一项 → 初始聚焦它
    expect(hiddenActive.focus).toHaveBeenCalledTimes(1);
    expect(visible.focus).not.toHaveBeenCalled();
  });

  it('无可聚焦节点时初始不聚焦, Tab 也不 preventDefault', () => {
    const el = makeContainer([]);
    renderFocusTrap(el);
    const e = keyEv('Tab');
    el.fire('keydown', e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('非 Tab 键直接忽略', () => {
    const node = fakeFocusable();
    const el = makeContainer([node]);
    renderFocusTrap(el);
    node.focus.mockClear();
    const e = keyEv('Enter');
    el.fire('keydown', e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(node.focus).not.toHaveBeenCalled();
  });

  it('Tab 在最后一个节点上 → 循环到第一个', () => {
    const first = fakeFocusable();
    const middle = fakeFocusable();
    const last = fakeFocusable();
    setActiveElement(last);
    const el = makeContainer([first, middle, last], [first, middle, last]);
    renderFocusTrap(el);
    first.focus.mockClear();
    const e = keyEv('Tab');
    el.fire('keydown', e);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(first.focus).toHaveBeenCalledTimes(1);
  });

  it('Tab 且焦点在容器外 → 拉回第一个节点', () => {
    const first = fakeFocusable();
    const last = fakeFocusable();
    // activeElement 为容器外的节点 (contains 返回 false)
    setActiveElement(fakeFocusable());
    const el = makeContainer([first, last], [first, last]);
    renderFocusTrap(el);
    first.focus.mockClear();
    const e = keyEv('Tab');
    el.fire('keydown', e);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(first.focus).toHaveBeenCalledTimes(1);
  });

  it('Tab 且 activeElement 为 null → 视为容器外, 拉回第一个', () => {
    const first = fakeFocusable();
    const el = makeContainer([first], [first]);
    renderFocusTrap(el);
    first.focus.mockClear();
    const e = keyEv('Tab');
    el.fire('keydown', e);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(first.focus).toHaveBeenCalledTimes(1);
  });

  it('Tab 在中间节点上不循环 (不 preventDefault)', () => {
    const first = fakeFocusable();
    const middle = fakeFocusable();
    const last = fakeFocusable();
    setActiveElement(middle);
    const el = makeContainer([first, middle, last], [first, middle, last]);
    renderFocusTrap(el);
    first.focus.mockClear();
    const e = keyEv('Tab');
    el.fire('keydown', e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(first.focus).not.toHaveBeenCalled();
    expect(last.focus).not.toHaveBeenCalled();
  });

  it('Shift+Tab 在第一个节点上 → 循环到最后一个', () => {
    const first = fakeFocusable();
    const last = fakeFocusable();
    setActiveElement(first);
    const el = makeContainer([first, last], [first, last]);
    renderFocusTrap(el);
    first.focus.mockClear();
    const e = keyEv('Tab', { shiftKey: true });
    el.fire('keydown', e);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(last.focus).toHaveBeenCalledTimes(1);
  });

  it('Shift+Tab 且焦点在容器外 → 拉回最后一个节点', () => {
    const first = fakeFocusable();
    const last = fakeFocusable();
    setActiveElement(fakeFocusable());
    const el = makeContainer([first, last], [first, last]);
    renderFocusTrap(el);
    first.focus.mockClear();
    const e = keyEv('Tab', { shiftKey: true });
    el.fire('keydown', e);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(last.focus).toHaveBeenCalledTimes(1);
  });

  it('Shift+Tab 在中间节点上不循环', () => {
    const first = fakeFocusable();
    const middle = fakeFocusable();
    const last = fakeFocusable();
    setActiveElement(middle);
    const el = makeContainer([first, middle, last], [first, middle, last]);
    renderFocusTrap(el);
    const e = keyEv('Tab', { shiftKey: true });
    el.fire('keydown', e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(last.focus).not.toHaveBeenCalled();
  });

  it('cleanup 移除 keydown 监听', () => {
    const node = fakeFocusable();
    const el = makeContainer([node]);
    renderFocusTrap(el);
    const cleanup = mockCtl.cleanups[0];
    expect(typeof cleanup).toBe('function');
    cleanup!();
    expect(el.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(el.listeners.get('keydown')).toHaveLength(0);
  });
});

// ============================================================
// useLongPress
// ============================================================

interface LPState {
  startT: number;
  startX: number;
  startY: number;
  rafId: number;
  triggered: boolean;
}

function LongPressHarness(props: { opts: LongPressOptions }) {
  const s = useLongPress(props.opts);
  return React.createElement('div', {
    'data-progress': s.progress,
    'data-pressing': String(s.isPressing),
  });
}

function renderLongPress(opts: LongPressOptions, el: FakeEl | null) {
  const elRef = { current: el as unknown };
  const stateRef: { current: LPState | null } = { current: null };
  // useRef 顺序: ref → stateRef → optsRef
  mockCtl.refQueue.push(elRef, stateRef, { current: null });
  const html = renderToString(React.createElement(LongPressHarness, { opts }));
  const setProgress = mockCtl.setters[0]!;
  const setIsPressing = mockCtl.setters[1]!;
  return { html, elRef, stateRef, setProgress, setIsPressing };
}

describe('useLongPress', () => {
  let rafCbs: Array<(t: number) => void>;
  let cancelled: number[];
  let nextRafId: number;

  beforeEach(() => {
    rafCbs = [];
    cancelled = [];
    nextRafId = 1;
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
      rafCbs.push(cb);
      return nextRafId++;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      cancelled.push(id);
    });
  });

  function lastTick(): (t: number) => void {
    expect(rafCbs.length).toBeGreaterThan(0);
    return rafCbs[rafCbs.length - 1]!;
  }

  it('SSR 渲染初始 progress=0 / pressing=false, 并挂 9 个监听', () => {
    const el = makeFakeEl();
    const { html } = renderLongPress({ onLongPress: vi.fn() }, el);
    expect(html).toContain('data-progress="0"');
    expect(html).toContain('data-pressing="false"');
    for (const type of [
      'touchstart',
      'touchmove',
      'touchend',
      'touchcancel',
      'mousedown',
      'mouseup',
      'mouseleave',
      'keydown',
      'keyup',
    ]) {
      expect(el.listeners.get(type)).toHaveLength(1);
    }
  });

  it('ref.current 为 null 时不挂监听', () => {
    renderLongPress({ onLongPress: vi.fn() }, null);
    expect(mockCtl.cleanups[0]).toBeUndefined();
  });

  it('touchstart 单指开始长按: 记录状态并调度 raf', () => {
    const el = makeFakeEl();
    const { stateRef, setIsPressing, setProgress } = renderLongPress(
      { onLongPress: vi.fn() },
      el,
    );
    el.fire('touchstart', touchEv([[50, 60]]));
    expect(stateRef.current).toMatchObject({ startX: 50, startY: 60, triggered: false });
    expect(setIsPressing).toHaveBeenCalledWith(true);
    expect(setProgress).toHaveBeenCalledWith(0);
    expect(rafCbs).toHaveLength(1);
  });

  it('touchstart 多指不触发', () => {
    const el = makeFakeEl();
    const { stateRef } = renderLongPress({ onLongPress: vi.fn() }, el);
    el.fire('touchstart', touchEv([[50, 60], [70, 80]]));
    expect(stateRef.current).toBeNull();
    expect(rafCbs).toHaveLength(0);
  });

  it('disabled 时 touchstart 不触发', () => {
    const el = makeFakeEl();
    const { stateRef, setIsPressing } = renderLongPress(
      { onLongPress: vi.fn(), disabled: true },
      el,
    );
    el.fire('touchstart', touchEv([[50, 60]]));
    expect(stateRef.current).toBeNull();
    expect(setIsPressing).not.toHaveBeenCalled();
  });

  it('重复 start (已在长按中) 被忽略', () => {
    const el = makeFakeEl();
    const { stateRef } = renderLongPress({ onLongPress: vi.fn() }, el);
    el.fire('touchstart', touchEv([[50, 60]]));
    const first = stateRef.current;
    el.fire('mousedown', { clientX: 5, clientY: 5 });
    expect(stateRef.current).toBe(first);
    expect(rafCbs).toHaveLength(1);
  });

  it('tick 推进: 按 elapsed/duration 更新 progress 并重排 raf', () => {
    const onLongPress = vi.fn();
    const el = makeFakeEl();
    const { stateRef, setProgress } = renderLongPress(
      { onLongPress, durationMs: 500 },
      el,
    );
    el.fire('touchstart', touchEv([[0, 0]]));
    vi.setSystemTime(1_000 + 250);
    lastTick()(0);
    expect(setProgress).toHaveBeenLastCalledWith(0.5);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(rafCbs).toHaveLength(2);
    expect(stateRef.current).not.toBeNull();
  });

  it('tick 到达时长: 触发 onLongPress, 100ms 后复位', () => {
    const onLongPress = vi.fn();
    const el = makeFakeEl();
    const { stateRef, setProgress, setIsPressing } = renderLongPress(
      { onLongPress, durationMs: 500 },
      el,
    );
    el.fire('touchstart', touchEv([[0, 0]]));
    vi.setSystemTime(1_000 + 500);
    lastTick()(0);
    expect(setProgress).toHaveBeenLastCalledWith(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(stateRef.current?.triggered).toBe(true);
    // 反馈展示 100ms 后复位
    setProgress.mockClear();
    setIsPressing.mockClear();
    vi.advanceTimersByTime(100);
    expect(stateRef.current).toBeNull();
    expect(setProgress).toHaveBeenCalledWith(0);
    expect(setIsPressing).toHaveBeenCalledWith(false);
  });

  it('触发后残留的 tick 直接返回 (triggered 守卫)', () => {
    const onLongPress = vi.fn();
    const el = makeFakeEl();
    const { setProgress } = renderLongPress({ onLongPress, durationMs: 500 }, el);
    el.fire('touchstart', touchEv([[0, 0]]));
    vi.setSystemTime(1_000 + 600);
    lastTick()(0);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    setProgress.mockClear();
    lastTick()(0); // stateRef 仍在 (timeout 未跑), triggered=true → 早退
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(setProgress).not.toHaveBeenCalled();
    expect(rafCbs).toHaveLength(1); // 未重排
  });

  it('cancel 后残留的 tick 直接返回 (stateRef 为 null 守卫)', () => {
    const el = makeFakeEl();
    const { stateRef, setProgress } = renderLongPress({ onLongPress: vi.fn() }, el);
    el.fire('touchstart', touchEv([[0, 0]]));
    el.fire('touchend');
    expect(stateRef.current).toBeNull();
    setProgress.mockClear();
    lastTick()(0);
    expect(setProgress).not.toHaveBeenCalled();
    expect(rafCbs).toHaveLength(1);
  });

  it('touchmove 位移低于阈值不取消, 超过阈值取消', () => {
    const el = makeFakeEl();
    const { stateRef, setIsPressing } = renderLongPress(
      { onLongPress: vi.fn(), movementThreshold: 10 },
      el,
    );
    el.fire('touchstart', touchEv([[100, 100]]));
    el.fire('touchmove', touchEv([[105, 100]])); // 5px < 10
    expect(stateRef.current).not.toBeNull();
    el.fire('touchmove', touchEv([[100, 115]])); // 15px > 10
    expect(stateRef.current).toBeNull();
    expect(cancelled.length).toBeGreaterThan(0);
    expect(setIsPressing).toHaveBeenLastCalledWith(false);
  });

  it('touchmove 无按压状态时不做事', () => {
    const el = makeFakeEl();
    renderLongPress({ onLongPress: vi.fn() }, el);
    el.fire('touchmove', touchEv([[999, 999]]));
    expect(cancelled).toHaveLength(0);
  });

  it('touchend / touchcancel 取消长按', () => {
    const el = makeFakeEl();
    const { stateRef, setProgress, setIsPressing } = renderLongPress(
      { onLongPress: vi.fn() },
      el,
    );
    el.fire('touchstart', touchEv([[0, 0]]));
    el.fire('touchend');
    expect(stateRef.current).toBeNull();
    expect(cancelled).toHaveLength(1);
    expect(setProgress).toHaveBeenLastCalledWith(0);
    expect(setIsPressing).toHaveBeenLastCalledWith(false);

    el.fire('touchstart', touchEv([[0, 0]]));
    expect(stateRef.current).not.toBeNull();
    el.fire('touchcancel');
    expect(stateRef.current).toBeNull();
  });

  it('无按压时 touchend 是 no-op (不 cancelAnimationFrame)', () => {
    const el = makeFakeEl();
    renderLongPress({ onLongPress: vi.fn() }, el);
    el.fire('touchend');
    expect(cancelled).toHaveLength(0);
  });

  it('mousedown 开始, mouseup / mouseleave 取消', () => {
    const el = makeFakeEl();
    const { stateRef } = renderLongPress({ onLongPress: vi.fn() }, el);
    el.fire('mousedown', { clientX: 10, clientY: 20 });
    expect(stateRef.current).toMatchObject({ startX: 10, startY: 20 });
    el.fire('mouseup');
    expect(stateRef.current).toBeNull();

    el.fire('mousedown', { clientX: 1, clientY: 2 });
    expect(stateRef.current).not.toBeNull();
    el.fire('mouseleave');
    expect(stateRef.current).toBeNull();
  });

  it('keydown Space/Enter 以元素中心为起点开始长按并 preventDefault', () => {
    const el = makeFakeEl({
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 40 }),
    });
    const { stateRef } = renderLongPress({ onLongPress: vi.fn() }, el);
    const e = keyEv(' ');
    el.fire('keydown', e);
    expect(stateRef.current).toMatchObject({ startX: 60, startY: 40 });
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    el.fire('keyup', keyEv(' '));
    expect(stateRef.current).toBeNull();

    const e2 = keyEv('Enter');
    el.fire('keydown', e2);
    expect(stateRef.current).not.toBeNull();
    expect(e2.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('keydown 在已按压时不重复 start, 也不 preventDefault', () => {
    const el = makeFakeEl({
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
    });
    const { stateRef } = renderLongPress({ onLongPress: vi.fn() }, el);
    el.fire('touchstart', touchEv([[3, 4]]));
    const first = stateRef.current;
    const e = keyEv(' ');
    el.fire('keydown', e);
    expect(stateRef.current).toBe(first);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(rafCbs).toHaveLength(1);
  });

  it('keydown 其他键忽略; ref.current 变 null 时退回 0,0 起点', () => {
    const el = makeFakeEl();
    const { stateRef, elRef } = renderLongPress({ onLongPress: vi.fn() }, el);
    el.fire('keydown', keyEv('a'));
    expect(stateRef.current).toBeNull();

    elRef.current = null;
    const e = keyEv('Enter');
    el.fire('keydown', e);
    expect(stateRef.current).toMatchObject({ startX: 0, startY: 0 });
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('keyup Space/Enter 取消, 其他键忽略', () => {
    const el = makeFakeEl({
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
    });
    const { stateRef } = renderLongPress({ onLongPress: vi.fn() }, el);
    el.fire('keyup', keyEv('a'));
    expect(cancelled).toHaveLength(0);

    el.fire('keydown', keyEv('Enter'));
    expect(stateRef.current).not.toBeNull();
    el.fire('keyup', keyEv('Enter'));
    expect(stateRef.current).toBeNull();
    expect(cancelled).toHaveLength(1);
  });

  it('cleanup: 取消进行中的长按并移除全部 9 个监听', () => {
    const el = makeFakeEl();
    const { stateRef } = renderLongPress({ onLongPress: vi.fn() }, el);
    el.fire('touchstart', touchEv([[0, 0]]));
    const cleanup = mockCtl.cleanups[0]!;
    cleanup();
    expect(stateRef.current).toBeNull();
    expect(cancelled.length).toBeGreaterThan(0);
    expect(el.removeEventListener).toHaveBeenCalledTimes(9);
    expect(el.listeners.get('touchstart')).toHaveLength(0);
    expect(el.listeners.get('keyup')).toHaveLength(0);
  });
});

// ============================================================
// usePullToRefresh
// ============================================================

interface PullState {
  startY: number;
  startScrollY: number;
  triggered: boolean;
}

function PullHarness(props: { opts: PullToRefreshOptions }) {
  const s = usePullToRefresh(props.opts);
  return React.createElement('div', {
    'data-pull': s.pullDistance,
    'data-refreshing': String(s.isRefreshing),
  });
}

function renderPullToRefresh(
  opts: PullToRefreshOptions,
  el: FakeEl | null,
  state: { pullDistance?: number; isRefreshing?: boolean } = {},
) {
  const elRef = { current: el as unknown };
  const stateRef: { current: PullState | null } = { current: null };
  // useRef 顺序: ref → stateRef → optsRef
  mockCtl.refQueue.push(elRef, stateRef, { current: null });
  // useState 顺序: pullDistance → isRefreshing
  mockCtl.stateQueue.push(state.pullDistance ?? 0, state.isRefreshing ?? false);
  const html = renderToString(React.createElement(PullHarness, { opts }));
  const setPullDistance = mockCtl.setters[0]!;
  const setIsRefreshing = mockCtl.setters[1]!;
  return { html, elRef, stateRef, setPullDistance, setIsRefreshing };
}

describe('usePullToRefresh', () => {
  it('SSR 渲染初始状态并挂 4 个监听', () => {
    const el = makeFakeEl();
    const { html } = renderPullToRefresh({ onRefresh: vi.fn() }, el);
    expect(html).toContain('data-pull="0"');
    expect(html).toContain('data-refreshing="false"');
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      expect(el.listeners.get(type)).toHaveLength(1);
    }
  });

  it('ref.current 为 null 时不挂监听', () => {
    renderPullToRefresh({ onRefresh: vi.fn() }, null);
    expect(mockCtl.cleanups[0]).toBeUndefined();
  });

  it('touchstart 在顶部单指时记录起始状态', () => {
    const el = makeFakeEl();
    const { stateRef } = renderPullToRefresh({ onRefresh: vi.fn() }, el);
    el.scrollTop = 0;
    el.fire('touchstart', touchEv([[0, 100]]));
    expect(stateRef.current).toMatchObject({
      startY: 100,
      startScrollY: 0,
      triggered: false,
    });
  });

  it('disabled 时 touchstart 不记录', () => {
    const el = makeFakeEl();
    const { stateRef } = renderPullToRefresh({ onRefresh: vi.fn(), disabled: true }, el);
    el.fire('touchstart', touchEv([[0, 100]]));
    expect(stateRef.current).toBeNull();
  });

  it('isRefreshing 时 touchstart 不记录', () => {
    const el = makeFakeEl();
    const { stateRef } = renderPullToRefresh({ onRefresh: vi.fn() }, el, {
      isRefreshing: true,
    });
    el.fire('touchstart', touchEv([[0, 100]]));
    expect(stateRef.current).toBeNull();
  });

  it('多指 touchstart 不记录', () => {
    const el = makeFakeEl();
    const { stateRef } = renderPullToRefresh({ onRefresh: vi.fn() }, el);
    el.fire('touchstart', touchEv([[0, 100], [0, 200]]));
    expect(stateRef.current).toBeNull();
  });

  it('scrollTop > 5 (不在顶部) 时 touchstart 不记录', () => {
    const el = makeFakeEl();
    el.scrollTop = 10;
    const { stateRef } = renderPullToRefresh({ onRefresh: vi.fn() }, el);
    el.fire('touchstart', touchEv([[0, 100]]));
    expect(stateRef.current).toBeNull();
  });

  it('touchmove 下拉: 阻尼距离写入 setPullDistance, >5 时 preventDefault', () => {
    const el = makeFakeEl();
    const { setPullDistance } = renderPullToRefresh({ onRefresh: vi.fn() }, el);
    el.fire('touchstart', touchEv([[0, 100]]));
    const e = touchEv([[0, 125]]); // dy=25 → sqrt(25)*12 = 60
    el.fire('touchmove', e);
    expect(setPullDistance).toHaveBeenLastCalledWith(60);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('touchmove 阻尼距离 ≤5 时不 preventDefault', () => {
    const el = makeFakeEl();
    const { setPullDistance } = renderPullToRefresh({ onRefresh: vi.fn() }, el);
    el.fire('touchstart', touchEv([[0, 100]]));
    const e = touchEv([[0, 100.1]]); // dy=0.1 → ≈3.79
    el.fire('touchmove', e);
        // 浮点位移 → 阻尼值 >0 且 ≤5 即可 (精确值受浮点误差影响)
    const damped = setPullDistance.mock.lastCall![0] as number;
    expect(damped).toBeGreaterThan(0);
    expect(damped).toBeLessThanOrEqual(5);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('touchmove 上拉 (dy<0) → 距离 0 且不 preventDefault', () => {
    const el = makeFakeEl();
    const { setPullDistance } = renderPullToRefresh({ onRefresh: vi.fn() }, el);
    el.fire('touchstart', touchEv([[0, 100]]));
    const e = touchEv([[0, 50]]);
    el.fire('touchmove', e);
    expect(setPullDistance).toHaveBeenLastCalledWith(0);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('touchmove 无状态 / 多指时不做事', () => {
    const el = makeFakeEl();
    const { setPullDistance } = renderPullToRefresh({ onRefresh: vi.fn() }, el);
    el.fire('touchmove', touchEv([[0, 200]]));
    expect(setPullDistance).not.toHaveBeenCalled();

    el.fire('touchstart', touchEv([[0, 100]]));
    setPullDistance.mockClear();
    el.fire('touchmove', touchEv([[0, 200], [0, 300]]));
    expect(setPullDistance).not.toHaveBeenCalled();
  });

  it('touchmove 中页面发生滚动 (scrollTop 比起始大) → 取消下拉', () => {
    const el = makeFakeEl();
    const { stateRef, setPullDistance } = renderPullToRefresh({ onRefresh: vi.fn() }, el);
    el.fire('touchstart', touchEv([[0, 100]]));
    el.scrollTop = 20; // > startScrollY(0)
    el.fire('touchmove', touchEv([[0, 150]]));
    expect(stateRef.current).toBeNull();
    expect(setPullDistance).toHaveBeenLastCalledWith(0);
  });

  it('touchend 距离低于阈值 → 归零且不刷新', async () => {
    const onRefresh = vi.fn();
    const el = makeFakeEl();
    const { stateRef, setPullDistance } = renderPullToRefresh({ onRefresh }, el, {
      pullDistance: 69,
    });
    el.fire('touchstart', touchEv([[0, 100]]));
    await el.fire('touchend');
    expect(stateRef.current).toBeNull();
    expect(setPullDistance).toHaveBeenLastCalledWith(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('touchend 距离等于阈值 → 触发刷新流程', async () => {
    const onRefresh = vi.fn(async () => {});
    const el = makeFakeEl();
    const { setIsRefreshing, setPullDistance } = renderPullToRefresh({ onRefresh }, el, {
      pullDistance: 70,
    });
    el.fire('touchstart', touchEv([[0, 100]]));
    await el.fire('touchend');
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(setIsRefreshing.mock.calls.map((c) => c[0])).toEqual([true, false]);
    expect(setPullDistance).toHaveBeenLastCalledWith(0);
  });

  it('touchend 无状态时立即返回', async () => {
    const onRefresh = vi.fn();
    const el = makeFakeEl();
    const { setPullDistance, setIsRefreshing } = renderPullToRefresh({ onRefresh }, el);
    await el.fire('touchend');
    expect(onRefresh).not.toHaveBeenCalled();
    expect(setPullDistance).not.toHaveBeenCalled();
    expect(setIsRefreshing).not.toHaveBeenCalled();
  });

  it('onRefresh  reject 时 finally 仍复位状态, 错误向外传播', async () => {
    const onRefresh = vi.fn(async () => {
      throw new Error('network');
    });
    const el = makeFakeEl();
    const { setIsRefreshing, setPullDistance } = renderPullToRefresh({ onRefresh }, el, {
      pullDistance: 100,
    });
    el.fire('touchstart', touchEv([[0, 100]]));
    await expect(el.fire('touchend')).rejects.toThrow('network');
    expect(setIsRefreshing.mock.calls.map((c) => c[0])).toEqual([true, false]);
    expect(setPullDistance).toHaveBeenLastCalledWith(0);
  });

  it('touchcancel 清空状态并归零', () => {
    const el = makeFakeEl();
    const { stateRef, setPullDistance } = renderPullToRefresh({ onRefresh: vi.fn() }, el);
    el.fire('touchstart', touchEv([[0, 100]]));
    expect(stateRef.current).not.toBeNull();
    el.fire('touchcancel');
    expect(stateRef.current).toBeNull();
    expect(setPullDistance).toHaveBeenLastCalledWith(0);
  });

  it('cleanup 移除全部 4 个监听', () => {
    const el = makeFakeEl();
    renderPullToRefresh({ onRefresh: vi.fn() }, el);
    mockCtl.cleanups[0]!();
    expect(el.removeEventListener).toHaveBeenCalledTimes(4);
    expect(el.listeners.get('touchstart')).toHaveLength(0);
    expect(el.listeners.get('touchcancel')).toHaveLength(0);
  });
});

// ============================================================
// useSwipe
// ============================================================

interface SwipeState {
  startX: number;
  startY: number;
  startT: number;
  triggered: boolean;
}

function SwipeHarness(props: {
  refParam: { current: unknown };
  opts: SwipeOptions;
}) {
  useSwipe(props.refParam as React.RefObject<HTMLElement | null>, props.opts);
  return React.createElement('div', null, 'swipe');
}

function renderSwipe(el: FakeEl | null, opts: SwipeOptions) {
  const refParam = { current: el as unknown };
  const stateRef: { current: SwipeState | null } = { current: null };
  // useRef 顺序: optsRef → stateRef
  mockCtl.refQueue.push({ current: opts }, stateRef);
  const html = renderToString(React.createElement(SwipeHarness, { refParam, opts }));
  return { html, refParam, stateRef };
}

describe('useSwipe', () => {
  it('挂载 touchstart/move/end/cancel 4 个监听', () => {
    const el = makeFakeEl();
    renderSwipe(el, {});
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      expect(el.listeners.get(type)).toHaveLength(1);
    }
  });

  it('ref.current 为 null 时不挂监听', () => {
    renderSwipe(null, { onSwipeLeft: vi.fn() });
    expect(mockCtl.cleanups[0]).toBeUndefined();
  });

  it('左滑触发 onSwipeLeft 并清空状态', () => {
    const onSwipeLeft = vi.fn();
    const el = makeFakeEl();
    const { stateRef } = renderSwipe(el, { onSwipeLeft });
    el.fire('touchstart', touchEv([[200, 100]]));
    expect(stateRef.current).toMatchObject({ startX: 200, startY: 100, triggered: false });
    el.fire('touchend', touchEv([[100, 100]]));
    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
    expect(stateRef.current).toBeNull();
  });

  it('右滑触发 onSwipeRight', () => {
    const onSwipeRight = vi.fn();
    const el = makeFakeEl();
    renderSwipe(el, { onSwipeRight });
    el.fire('touchstart', touchEv([[100, 100]]));
    el.fire('touchend', touchEv([[200, 100]]));
    expect(onSwipeRight).toHaveBeenCalledTimes(1);
  });

  it('vertical 方向: 上滑/下滑触发 onSwipeUp/onSwipeDown', () => {
    const onSwipeUp = vi.fn();
    const onSwipeDown = vi.fn();
    const el = makeFakeEl();
    renderSwipe(el, { onSwipeUp, onSwipeDown, direction: 'vertical' });
    el.fire('touchstart', touchEv([[100, 200]]));
    el.fire('touchend', touchEv([[100, 100]]));
    expect(onSwipeUp).toHaveBeenCalledTimes(1);

    el.fire('touchstart', touchEv([[100, 100]]));
    el.fire('touchend', touchEv([[100, 200]]));
    expect(onSwipeDown).toHaveBeenCalledTimes(1);
  });

  it('慢速小位移判定为 none, 不触发回调', () => {
    const onSwipeLeft = vi.fn();
    const el = makeFakeEl();
    const { stateRef } = renderSwipe(el, { onSwipeLeft });
    el.fire('touchstart', touchEv([[100, 100]]));
    vi.setSystemTime(1_000 + 500); // 5px / 500ms → vx=0.01 < 0.3
    el.fire('touchend', touchEv([[95, 100]]));
    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(stateRef.current).toBeNull();
  });

  it('多指 touchstart 不记录, 后续 end 不触发', () => {
    const onSwipeLeft = vi.fn();
    const el = makeFakeEl();
    const { stateRef } = renderSwipe(el, { onSwipeLeft });
    el.fire('touchstart', touchEv([[200, 100], [300, 100]]));
    expect(stateRef.current).toBeNull();
    el.fire('touchend', touchEv([[0, 100]]));
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('未注册对应方向回调时不报错', () => {
    const el = makeFakeEl();
    renderSwipe(el, {}); // 无 onSwipeLeft
    el.fire('touchstart', touchEv([[200, 100]]));
    expect(() => el.fire('touchend', touchEv([[100, 100]]))).not.toThrow();
  });

  it('touchmove 水平主导时 preventDefault, 垂直主导时不', () => {
    const el = makeFakeEl();
    renderSwipe(el, {});
    el.fire('touchstart', touchEv([[0, 0]]));
    const hEv = touchEv([[100, 10]]); // |dx|=100 > |dy|*1.5
    el.fire('touchmove', hEv);
    expect(hEv.preventDefault).toHaveBeenCalledTimes(1);

    const vEv = touchEv([[10, 100]]);
    el.fire('touchmove', vEv);
    expect(vEv.preventDefault).not.toHaveBeenCalled();
  });

  it('vertical 方向: touchmove 垂直主导时 preventDefault', () => {
    const el = makeFakeEl();
    renderSwipe(el, { direction: 'vertical' });
    el.fire('touchstart', touchEv([[0, 0]]));
    const vEv = touchEv([[10, 100]]); // |dy|=100 > |dx|*1.5
    el.fire('touchmove', vEv);
    expect(vEv.preventDefault).toHaveBeenCalledTimes(1);

    const hEv = touchEv([[100, 10]]);
    el.fire('touchmove', hEv);
    expect(hEv.preventDefault).not.toHaveBeenCalled();
  });

  it('touchmove 无状态或多指时不 preventDefault', () => {
    const el = makeFakeEl();
    renderSwipe(el, {});
    const e1 = touchEv([[500, 0]]);
    el.fire('touchmove', e1); // 未 start
    expect(e1.preventDefault).not.toHaveBeenCalled();

    el.fire('touchstart', touchEv([[0, 0]]));
    const e2 = touchEv([[500, 0], [0, 0]]);
    el.fire('touchmove', e2); // 多指
    expect(e2.preventDefault).not.toHaveBeenCalled();
  });

  it('touchend 无状态时是 no-op', () => {
    const onSwipeLeft = vi.fn();
    const el = makeFakeEl();
    renderSwipe(el, { onSwipeLeft });
    el.fire('touchend', touchEv([[0, 0]]));
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('touchcancel 清空状态: 之后 end 不触发回调', () => {
    const onSwipeLeft = vi.fn();
    const el = makeFakeEl();
    const { stateRef } = renderSwipe(el, { onSwipeLeft });
    el.fire('touchstart', touchEv([[200, 100]]));
    el.fire('touchcancel');
    expect(stateRef.current).toBeNull();
    el.fire('touchend', touchEv([[0, 100]]));
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('一次手势结束后再次 touchend 不重复触发', () => {
    const onSwipeLeft = vi.fn();
    const el = makeFakeEl();
    renderSwipe(el, { onSwipeLeft });
    el.fire('touchstart', touchEv([[200, 100]]));
    el.fire('touchend', touchEv([[100, 100]]));
    el.fire('touchend', touchEv([[100, 100]]));
    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
  });

  it('cleanup 移除全部 4 个监听', () => {
    const el = makeFakeEl();
    renderSwipe(el, {});
    mockCtl.cleanups[0]!();
    expect(el.removeEventListener).toHaveBeenCalledTimes(4);
    expect(el.listeners.get('touchstart')).toHaveLength(0);
    expect(el.listeners.get('touchcancel')).toHaveLength(0);
  });

  it('水平模式下快速但垂直主导的滑动判定为 none', () => {
    const onSwipeLeft = vi.fn();
    const onSwipeDown = vi.fn();
    const el = makeFakeEl();
    renderSwipe(el, { onSwipeLeft, onSwipeDown });
    el.fire('touchstart', touchEv([[0, 0]]));
    // dx=30 (<50 但极快, 通过阈值+速度检查), dy=100 主导 → none
    el.fire('touchend', touchEv([[30, 100]]));
    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeDown).not.toHaveBeenCalled();
  });
  it('vertical 模式下快速但水平主导的滑动判定为 none', () => {
    const onSwipeRight = vi.fn();
    const onSwipeDown = vi.fn();
    const el = makeFakeEl();
    renderSwipe(el, { onSwipeRight, onSwipeDown, direction: 'vertical' });
    el.fire('touchstart', touchEv([[0, 0]]));
    // dy=30 (<50 但极快), dx=100 主导 → none
    el.fire('touchend', touchEv([[100, 30]]));
    expect(onSwipeRight).not.toHaveBeenCalled();
    expect(onSwipeDown).not.toHaveBeenCalled();
  });

  it('残留的 triggered 状态: move/end 守卫直接返回', () => {
    const onSwipeLeft = vi.fn();
    const el = makeFakeEl();
    const { stateRef } = renderSwipe(el, { onSwipeLeft });
    // 模拟已完成手势残留的 triggered 状态 (守卫分支)
    stateRef.current = { startX: 0, startY: 0, startT: 1_000, triggered: true };
    const moveEv = touchEv([[200, 0]]);
    el.fire('touchmove', moveEv);
    expect(moveEv.preventDefault).not.toHaveBeenCalled();
    el.fire('touchend', touchEv([[200, 0]]));
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });
});
