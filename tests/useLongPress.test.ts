// Tests for the long-press progress calculation.

import { describe, it, expect } from 'vitest';
import {
  longPressProgress,
  exceedsMovementThreshold,
} from '../src/frontend/hooks/useLongPress';

describe('longPressProgress', () => {
  it('returns 0 at start', () => {
    expect(longPressProgress(0, 500)).toBe(0);
  });

  it('returns 1 at full duration', () => {
    expect(longPressProgress(500, 500)).toBe(1);
  });

  it('clamps to 1 when elapsed exceeds duration', () => {
    expect(longPressProgress(1000, 500)).toBe(1);
  });

  it('returns linear progress for partial elapsed', () => {
    expect(longPressProgress(250, 500)).toBe(0.5);
  });

  it('clamps to 0 for negative elapsed', () => {
    expect(longPressProgress(-100, 500)).toBe(0);
  });

  it('handles zero duration as immediate completion', () => {
    expect(longPressProgress(0, 0)).toBe(1);
  });

  it('handles negative duration as immediate completion', () => {
    expect(longPressProgress(100, -1)).toBe(1);
  });
});

describe('exceedsMovementThreshold', () => {
  it('returns false for zero movement', () => {
    expect(exceedsMovementThreshold(100, 100, 100, 100, 10)).toBe(false);
  });

  it('returns false for small movement within threshold', () => {
    expect(exceedsMovementThreshold(100, 100, 105, 103, 10)).toBe(false);
  });

  it('returns true for movement over threshold (horizontal)', () => {
    expect(exceedsMovementThreshold(100, 100, 115, 100, 10)).toBe(true);
  });

  it('returns true for movement over threshold (vertical)', () => {
    expect(exceedsMovementThreshold(100, 100, 100, 120, 10)).toBe(true);
  });

  it('returns true for diagonal movement over threshold', () => {
    // 7+7 = ~10, equal to threshold 10 — should not exceed
    expect(exceedsMovementThreshold(100, 100, 107, 107, 10)).toBe(false);
    // 8+8 = ~11.3, over threshold 10
    expect(exceedsMovementThreshold(100, 100, 108, 108, 10)).toBe(true);
  });

  it('respects custom threshold', () => {
    expect(exceedsMovementThreshold(100, 100, 106, 100, 5)).toBe(true);
  });
});
