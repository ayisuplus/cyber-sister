// Tests for the haptic utility — feature detection + safe call.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { haptic, isHapticSupported } from '../src/frontend/utils/haptic';

// 测试用可变 Navigator: vibrate 可选,方便 delete/mock
type MutableNavigator = Omit<Navigator, 'vibrate'> & { vibrate?: unknown };
const mutableNav = () => navigator as MutableNavigator;

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
      delete mutableNav().vibrate;
    }
  });

  it('returns false when navigator.vibrate is not a function', () => {
    if (typeof navigator !== 'undefined') {
      delete mutableNav().vibrate;
    }
    expect(haptic('tap')).toBe(false);
  });

  it('returns true when navigator.vibrate is a function and call succeeds', () => {
    if (typeof navigator === 'undefined') return;
    mutableNav().vibrate = () => true;
    expect(haptic('tap')).toBe(true);
  });

  it('returns false when navigator.vibrate throws', () => {
    if (typeof navigator === 'undefined') return;
    mutableNav().vibrate = () => {
      throw new Error('not allowed');
    };
    expect(haptic('success')).toBe(false);
  });

  it('does not throw on each pattern', () => {
    if (typeof navigator === 'undefined') return;
    const spy = vi.fn(() => true);
    mutableNav().vibrate = spy;
    for (const p of ['tap', 'select', 'success', 'error'] as const) {
      expect(() => haptic(p)).not.toThrow();
    }
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('passes through the right pattern values', () => {
    if (typeof navigator === 'undefined') return;
    const spy = vi.fn(() => true);
    mutableNav().vibrate = spy;
    haptic('tap');
    haptic('select');
    haptic('success');
    haptic('error');
    expect(spy).toHaveBeenNthCalledWith(1, 10);
    expect(spy).toHaveBeenNthCalledWith(2, 5);
    expect(spy).toHaveBeenNthCalledWith(3, [10, 30, 20]);
    expect(spy).toHaveBeenNthCalledWith(4, [20, 40, 20, 40, 30]);
  });
});
