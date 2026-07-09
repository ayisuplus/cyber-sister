// useFocusTrap — 焦点陷阱 hook. 容器内按 Tab 时循环焦点, 不跑出去.
// 用在模态 / 抽屉 / 弹层中, 保证键盘 / 屏读用户不迷路.

import { useEffect } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;

    function getFocusable(): HTMLElement[] {
      if (!el) return [];
      const nodes = el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      return Array.from(nodes).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );
    }

    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const items = getFocusable();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (current === first || !el!.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (current === last || !el!.contains(current)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    const initial = getFocusable()[0];
    if (initial) initial.focus();

    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [ref, active]);
}
