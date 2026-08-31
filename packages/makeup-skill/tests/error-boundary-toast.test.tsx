// error-boundary-toast.test.tsx — ErrorBoundary 类组件 + Toast 系统测试.
//
// 策略:
// - ErrorBoundary: SSR 下 error boundary 不捕获渲染错误, 直接实例化类组件,
//   手动调用 getDerivedStateFromError / componentDidCatch / reset / render
//   覆盖全部分支.
// - Toast: vi.mock('react') 用 slot 化 useState (跨 render 持久) + 捕获 useEffect,
//   模拟持久组件实例: push toast → 重渲染验证视口, 手动触发 auto-dismiss effect.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React, { type ErrorInfo, type ReactNode } from 'react';

// ---------- react hook 接管 ----------

const ctl = vi.hoisted(() => ({
  /** useState 持久 slot — 跨 render 保留, 模拟同一个组件实例. */
  stateSlots: [] as Array<{ value: unknown }>,
  /** 每次 render 前清零的调用游标. */
  stateCursor: 0,
  /** useEffect 捕获的回调 (每次 render 重置). */
  effects: [] as Array<() => unknown>,
  /** track 埋点记录. */
  trackCalls: [] as string[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof React & Record<string, unknown>;
  return {
    ...actual,
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED:
      actual['__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED'],
    useState: <T,>(initial: T | (() => T)): [T, (v: T | ((p: T) => T)) => void] => {
      const i = ctl.stateCursor++;
      const slot = (ctl.stateSlots[i] ??= {
        value: typeof initial === 'function' ? (initial as () => T)() : initial,
      });
      const set = (v: T | ((p: T) => T)) => {
        slot.value = typeof v === 'function' ? (v as (p: T) => T)(slot.value as T) : v;
      };
      return [slot.value as T, set];
    },
    useEffect: (fn: () => unknown): void => {
      ctl.effects.push(fn);
    },
  };
});

vi.mock('../src/shared/analytics', () => ({
  track: (event: string) => {
    ctl.trackCalls.push(event);
  },
  startTimer: () => () => 0,
  getSessionId: () => 'test-session-id',
}));

import { ErrorBoundary } from '../src/frontend/components/ErrorBoundary';
import { ToastProvider, useToast } from '../src/frontend/components/Toast';

beforeEach(() => {
  ctl.stateSlots.length = 0;
  ctl.stateCursor = 0;
  ctl.effects.length = 0;
  ctl.trackCalls.length = 0;
});

// ---------- ErrorBoundary ----------

describe('ErrorBoundary', () => {
  it('无错误时渲染 children', () => {
    const html = renderToStaticMarkup(
      <ErrorBoundary>
        <div>正常内容</div>
      </ErrorBoundary>,
    );
    expect(html).toContain('正常内容');
  });

  it('getDerivedStateFromError 把异常写入 state', () => {
    const err = new Error('boom');
    expect(ErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err });
  });

  it('componentDidCatch 埋点 app_error', () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.componentDidCatch(new Error('x'), { componentStack: '' } as ErrorInfo);
    expect(ctl.trackCalls).toEqual(['app_error']);
  });

  it('错误态无自定义 fallback → 渲染默认兜底页', () => {
    const boundary = new ErrorBoundary({ children: <div>child</div> });
    boundary.state = { error: new Error('渲染挂了') };
    const html = renderToStaticMarkup(boundary.render() as React.ReactElement);
    expect(html).toContain('出错了');
    expect(html).toContain('再试一次');
    expect(html).not.toContain('child');
  });

  it('错误态有自定义 fallback → 调用 fallback(error, reset)', () => {
    const fallback = vi.fn((error: Error, _reset: () => void): ReactNode =>
      React.createElement('div', null, `自定义兜底:${error.message}`),
    );
    const boundary = new ErrorBoundary({ children: null, fallback });
    const err = new Error('自定义错误');
    boundary.state = { error: err };
    const html = renderToStaticMarkup(boundary.render() as React.ReactElement);
    expect(html).toContain('自定义兜底:自定义错误');
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback.mock.calls[0]![0]).toBe(err);
    expect(typeof fallback.mock.calls[0]![1]).toBe('function');
  });

  it('reset: 清空 error state 并调用 onReset', () => {
    const onReset = vi.fn();
    const boundary = new ErrorBoundary({ children: null, onReset });
    boundary.state = { error: new Error('x') };
    const setStateSpy = vi
      .spyOn(boundary, 'setState')
      .mockImplementation(((partial: unknown) => {
        boundary.state = partial as { error: Error | null };
      }) as typeof boundary.setState);
    boundary.reset();
    expect(setStateSpy).toHaveBeenCalledWith({ error: null });
    expect(boundary.state).toEqual({ error: null });
    expect(onReset).toHaveBeenCalledTimes(1);
    setStateSpy.mockRestore();
  });

  it('reset: 无 onReset 时不报错', () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = { error: new Error('x') };
    const setStateSpy = vi.spyOn(boundary, 'setState').mockImplementation((() => {}) as never);
    expect(() => boundary.reset()).not.toThrow();
    setStateSpy.mockRestore();
  });

  it('初始 state 无错误', () => {
    const boundary = new ErrorBoundary({ children: null });
    expect(boundary.state).toEqual({ error: null });
  });
});

// ---------- Toast ----------

/** useToast 返回的可调用 api 结构 (Toast.tsx 未导出该接口, 测试内声明同形结构). */
interface ToastApiShape {
  (message: string, kind?: 'info' | 'success' | 'warn' | 'error'): void;
  success: (message: string) => void;
  error: (message: string) => void;
  warn: (message: string) => void;
  info: (message: string) => void;
}

/** 渲染 ToastProvider + 捕获 useToast api 的消费者. */
function renderToastTree(): { html: string; api: ToastApiShape } {
  ctl.stateCursor = 0;
  ctl.effects.length = 0;
  let api: ToastApiShape | null = null;
  function Consumer() {
    api = useToast();
    return null;
  }
  const html = renderToStaticMarkup(
    <ToastProvider>
      <Consumer />
    </ToastProvider>,
  );
  return { html, api: api! };
}

/** ToastProvider 的 items 状态 slot (provider 第一个 useState). */
function items(): Array<{ id: number; message: string; kind: string }> {
  return ctl.stateSlots[0]!.value as Array<{ id: number; message: string; kind: string }>;
}

describe('ToastProvider SSR', () => {
  it('空态渲染 children + 通知视口容器', () => {
    const { html } = renderToastTree();
    expect(html).toContain('role="region"');
    expect(html).toContain('通知');
  });

  it('useToast 在 provider 外调用 → 抛错', () => {
    function Orphan() {
      useToast();
      return null;
    }
    expect(() => renderToStaticMarkup(<Orphan />)).toThrow(
      'useToast 必须在 <ToastProvider> 内使用',
    );
  });
});

describe('Toast push / 渲染', () => {
  it('api(消息) 默认 kind=info; 重渲染后出现 toast', () => {
    const { api } = renderToastTree();
    api('普通提示');
    expect(items()).toEqual([{ id: 1, message: '普通提示', kind: 'info' }]);
    const { html } = renderToastTree();
    expect(html).toContain('普通提示');
    expect(html).toContain('bg-white/95');
  });

  it('便捷方法 success/warn/error 带对应样式', () => {
    const { api } = renderToastTree();
    api.success('成功啦');
    api.warn('注意哦');
    api.error('出错了');
    api.info('小知识');
    // MAX_VISIBLE=3: 最早的一条被裁掉
    expect(items().map((t) => t.message)).toEqual(['注意哦', '出错了', '小知识']);
    const { html } = renderToastTree();
    expect(html).toContain('bg-amber-50');
    expect(html).toContain('bg-rose-50');
    expect(html).toContain('bg-white/95');
    expect(html).not.toContain('成功啦');
  });

  it('success 样式类渲染 (单条)', () => {
    const { api } = renderToastTree();
    api.success('已保存 ✓');
    const { html } = renderToastTree();
    expect(html).toContain('bg-emerald-50');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it('id 自增: 同一实例内 push 多条 id 递增', () => {
    const { api } = renderToastTree();
    api('a');
    api('b');
    const ids = items().map((t) => t.id);
    expect(ids).toEqual([1, 2]);
  });
});

describe('Toast 自动消失 (effect 手动触发)', () => {
  const realWindow = globalThis.window;

  beforeEach(() => {
    // Toast 的 effect 用 window.setTimeout; Node 下补一个可控 stub.
    (globalThis as Record<string, unknown>).window = {
      setTimeout: vi.fn(() => 7),
      clearTimeout: vi.fn(),
    };
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).window = realWindow;
  });

  it('toast effect 注册 4s 定时器; 到期回调移除该条', () => {
    const { api } = renderToastTree();
    api('会自动消失');
    renderToastTree(); // 重渲染, 捕获 Toast 的 effect
    expect(ctl.effects).toHaveLength(1);
    const cleanup = ctl.effects[0]!() as (() => void) | undefined;
    const w = globalThis.window as unknown as {
      setTimeout: ReturnType<typeof vi.fn>;
      clearTimeout: ReturnType<typeof vi.fn>;
    };
    expect(w.setTimeout).toHaveBeenCalledWith(expect.any(Function), 4000);

    // 到期 → onRemove(id) → items 清空
    const timeoutFn = w.setTimeout.mock.calls[0]![0] as () => void;
    timeoutFn();
    expect(items()).toEqual([]);

    // cleanup → clearTimeout (timerRef.current !== null 分支)
    cleanup?.();
    expect(w.clearTimeout).toHaveBeenCalledWith(7);
  });

  it('多条 toast 各自注册定时器; 移除一条不影响其他', () => {
    const { api } = renderToastTree();
    api('第一条');
    api('第二条');
    renderToastTree();
    expect(ctl.effects).toHaveLength(2);
    const w = globalThis.window as unknown as {
      setTimeout: ReturnType<typeof vi.fn>;
    };
    // 手动触发两个 Toast 的 effect, 注册定时器
    for (const fn of ctl.effects) fn();
    // 触发第一条的到期回调
    const firstTimeout = w.setTimeout.mock.calls[0]![0] as () => void;
    firstTimeout();
    expect(items().map((t) => t.message)).toEqual(['第二条']);
  });
});
