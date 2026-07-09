// Tests for detectSwipe pure function in useSwipe hook.

import { describe, it, expect } from 'vitest';
import { detectSwipe, type SwipeInput } from '../src/frontend/hooks/useSwipe';

function makeInput(over: Partial<SwipeInput> = {}): SwipeInput {
  return {
    startX: 100,
    startY: 100,
    endX: 200,
    endY: 100,
    durationMs: 100,
    ...over,
  };
}

describe('detectSwipe: left swipe (next)', () => {
  it('returns "left" for clear left swipe past threshold', () => {
    expect(detectSwipe(makeInput({ startX: 200, endX: 100 }))).toBe('left');
  });

  it('returns "left" for default threshold and 100px left', () => {
    expect(detectSwipe(makeInput({ startX: 150, endX: 50 }))).toBe('left');
  });
});

describe('detectSwipe: right swipe (prev)', () => {
  it('returns "right" for clear right swipe past threshold', () => {
    expect(detectSwipe(makeInput({ startX: 100, endX: 200 }))).toBe('right');
  });
});

describe('detectSwipe: noise rejection', () => {
  it('rejects motion below threshold with slow velocity', () => {
    expect(detectSwipe(makeInput({ startX: 110, endX: 100, durationMs: 500 }))).toBe('none');
  });

  it('accepts small but fast motion (velocity overrides distance)', () => {
    // 50px in 10ms = 5 px/ms, well above 0.3
    expect(detectSwipe(makeInput({ startX: 150, endX: 100, durationMs: 10 }))).toBe('left');
  });

  it('rejects vertical-dominant motion', () => {
    // 100px left but 200px down — clearly vertical scroll
    expect(detectSwipe(makeInput({ startX: 200, endY: 300, endX: 100, durationMs: 100 }))).toBe(
      'none',
    );
  });

  it('rejects 0 distance', () => {
    expect(detectSwipe(makeInput({ startX: 100, endX: 100 }))).toBe('none');
  });
});

describe('detectSwipe: custom thresholds', () => {
  it('respects higher threshold', () => {
    // 100px with threshold 200 — should reject
    expect(
      detectSwipe(makeInput({ startX: 200, endX: 100, durationMs: 5000, threshold: 200 })),
    ).toBe('none');
  });

  it('respects lower threshold', () => {
    // 20px with threshold 10 — should accept
    expect(detectSwipe(makeInput({ startX: 120, endX: 100, threshold: 10 }))).toBe('left');
  });

  it('respects custom velocityThreshold', () => {
    // 100px in 500ms = 0.2 px/ms, threshold 50, vTh 0.3 — reject (slow)
    expect(
      detectSwipe(
        makeInput({
          startX: 130,
          endX: 100,
          durationMs: 500,
          threshold: 50,
          velocityThreshold: 0.3,
        }),
      ),
    ).toBe('none');
  });
});

describe('detectSwipe: durationMs edge cases', () => {
  it('handles 0ms duration without dividing by zero', () => {
    // Even 0ms duration is safe — clamped to 1
    expect(() => detectSwipe(makeInput({ durationMs: 0 }))).not.toThrow();
  });

  describe('detectSwipe: vertical direction', () => {
    it('returns "down" for downward swipe past threshold', () => {
      expect(
        detectSwipe({
          startX: 100,
          startY: 100,
          endX: 100,
          endY: 200,
          durationMs: 100,
          direction: 'vertical',
        }),
      ).toBe('down');
    });

    it('returns "up" for upward swipe past threshold', () => {
      expect(
        detectSwipe({
          startX: 100,
          startY: 200,
          endX: 100,
          endY: 100,
          durationMs: 100,
          direction: 'vertical',
        }),
      ).toBe('up');
    });

    it('rejects horizontal-dominant motion in vertical mode', () => {
      expect(
        detectSwipe({
          startX: 100,
          startY: 100,
          endX: 300,
          endY: 110,
          durationMs: 100,
          direction: 'vertical',
        }),
      ).toBe('none');
    });
  });
});
