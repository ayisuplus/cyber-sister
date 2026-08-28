// Tests for dampPullDistance pure function in usePullToRefresh hook.

import { describe, it, expect } from 'vitest';
import { dampPullDistance } from '../src/frontend/hooks/usePullToRefresh';

describe('dampPullDistance: rubber-band damping', () => {
  it('returns 0 for zero or negative input', () => {
    expect(dampPullDistance(0, 120)).toBe(0);
    expect(dampPullDistance(-50, 120)).toBe(0);
  });

  it('returns small value for small input (sqrt dampening)', () => {
    // 4px → sqrt(4)*12 = 24
    expect(dampPullDistance(4, 120)).toBe(24);
  });

  it('caps at maxPull', () => {
    expect(dampPullDistance(10000, 120)).toBe(120);
  });

  it('default maxPull 120', () => {
    expect(dampPullDistance(200, 120)).toBeLessThanOrEqual(120);
  });

  it('produces diminishing returns (rubber-band feel)', () => {
    // 50px → sqrt(50)*12 ≈ 84.85
    const a = dampPullDistance(50, 120);
    // 100px → sqrt(100)*12 = 120 (capped)
    const b = dampPullDistance(100, 120);
    // 200px → also 120 (capped)
    const c = dampPullDistance(200, 120);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(b);
    expect(b).toBe(c); // both capped
  });

  it('respects smaller maxPull', () => {
    // 50px → sqrt(50)*12 ≈ 84.85, capped at 50
    expect(dampPullDistance(50, 50)).toBe(50);
  });
});
