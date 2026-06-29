// Tests for the haptic utility — feature detection + safe call.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { haptic, isHapticSupported } from '../src/frontend/utils/haptic';

describe('haptic: feature detection', () => {
  it('isHapticSupported returns a boolean', () => {
    expect(typeof isHapticSupported()).toBe('boolean');
  });

  it('isHapticSupported reflects navigator.vibrate presence', () => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      expect(isHapticSupported()).toBe(true);
    } else {
      expect(isHapticSupported()).toBe(false);
    }
  });
});

describe('haptic: call', () => {
  beforeEach(() => {
    if (typeof navigator !== 'undefined') {
      delete (navigator as Navigator & { vibrate?: unknown }).vibrate;
    }
  });

  it('returns false when navigator.vibrate is not a function', () => {
    if (typeof navigator !== 'undefined') {
      delete (navigator as Navigator & { vibrate?: unknown }).vibrate;
    }
    expect(haptic('tap')).toBe(false);
  });

  it('returns true when navigator.vibrate is a function and call succeeds', () => {
    if (typeof navigator === 'undefined') return;
    (navigator as Navigator & { vibrate: (p: number | number[]) => boolean }).vibrate = (
      _p: number | number[],
    ) => true;
    expect(haptic('tap')).toBe(true);
  });

  it('returns false when navigator.vibrate throws', () => {
    if (typeof navigator === 'undefined') return;
    (navigator as Navigator & { vibrate: () => boolean }).vibrate = () => {
      throw new Error('not allowed');
    };
    expect(haptic('success')).toBe(false);
  });

  it('does not throw on each pattern', () => {
    if (typeof navigator === 'undefined') return;
    const spy = vi.fn(() => true);
    (navigator as Navigator & { vibrate: (p: number | number[]) => boolean }).vibrate = spy;
    for (const p of ['tap', 'select', 'success', 'error'] as const) {
      expect(() => haptic(p)).not.toThrow();
    }
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('passes through the right pattern values', () => {
    if (typeof navigator === 'undefined') return;
    const spy = vi.fn(() => true);
    (navigator as Navigator & { vibrate: (p: number | number[]) => boolean }).vibrate = spy;
    haptic('tap');
    haptic('select');
    haptic('success');
    haptic('error');
    expect(spy.mock.calls[0][0]).toBe(10);
    expect(spy.mock.calls[1][0]).toBe(5);
    expect(spy.mock.calls[2][0]).toEqual([10, 30, 20]);
    expect(spy.mock.calls[3][0]).toEqual([20, 40, 20, 40, 30]);
  });
});
