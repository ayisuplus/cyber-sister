// 轻量 Toast 系统 — 单实例 provider, 用 useToast() 触发.
// 自动消失 (4s), 最多同时 3 条.
//
// 用法:
//   <ToastProvider>...</ToastProvider>     // 在 App 顶层包
//   const toast = useToast();
//   toast('已保存 ✓', 'success');           // 显示一条

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastApi {
  (message: string, kind?: ToastKind): void;
  success: (message: string) => void;
  error: (message: string) => void;
  warn: (message: string) => void;
  info: (message: string) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId.current++;
    setItems((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), { id, message, kind }]);
  }, []);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // 构造可调用对象 + 便捷方法. 用类型守卫保留 ToastApi 形状.
  const api = Object.assign(
    (msg: string, kind: ToastKind = 'info') => push(msg, kind),
    {
      success: (msg: string) => push(msg, 'success'),
      error: (msg: string) => push(msg, 'error'),
      warn: (msg: string) => push(msg, 'warn'),
      info: (msg: string) => push(msg, 'info'),
    } satisfies Pick<ToastApi, 'success' | 'error' | 'warn' | 'info'>,
  ) as ToastApi;
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <ToastViewport items={items} onRemove={remove} />
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast 必须在 <ToastProvider> 内使用');
  return ctx;
}

function ToastViewport({
  items,
  onRemove,
}: {
  items: ToastItem[];
  onRemove: (id: number) => void;
}) {
  return (
    <div
      role="region"
      aria-label="通知"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none px-4 w-full max-w-sm"
    >
      {items.map((t) => (
        <Toast key={t.id} item={t} onRemove={onRemove} />
      ))}
    </div>
  );
}

const KIND_STYLE: Record<ToastKind, string> = {
  info: 'bg-white/95 text-ink border-ink-soft/20',
  success: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  warn: 'bg-amber-50 text-amber-900 border-amber-200',
  error: 'bg-rose-50 text-rose-900 border-rose-300',
};

function Toast({ item, onRemove }: { item: ToastItem; onRemove: (id: number) => void }) {
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    timerRef.current = window.setTimeout(() => onRemove(item.id), AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [item.id, onRemove]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto animate-fade-up rounded-2xl border px-4 py-2.5 text-sm shadow-md max-w-full ${KIND_STYLE[item.kind]}`}
    >
      {item.message}
    </div>
  );
}
