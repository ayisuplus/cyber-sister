import { describe, expect, it } from 'vitest'
import {
  DOWNGRADE_EMA_MS,
  SWITCH_COOLDOWN_MS,
  TIERS,
  UPGRADE_EMA_MS,
  UPGRADE_HOLD_MS,
  decideTier,
  updateEma,
} from './degradePolicy'

describe('updateEma', () => {
  it('首个样本直接作为 EMA 初值', () => {
    expect(updateEma(null, 200)).toBe(200)
  })

  it('按 α=0.2 平滑新样本', () => {
    expect(updateEma(100, 200)).toBeCloseTo(120)
    expect(updateEma(100, 50)).toBeCloseTo(90)
  })

  it('支持自定义 α', () => {
    expect(updateEma(100, 200, 0.5)).toBeCloseTo(150)
  })
})

describe('decideTier 降档', () => {
  it('EMA 超阈值且冷却期满 → 降一档', () => {
    expect(decideTier({ emaMs: DOWNGRADE_EMA_MS + 1, tier: 0, sinceMs: 0, nowMs: SWITCH_COOLDOWN_MS }))
      .toEqual({ tier: 1, changed: true })
  })

  it('冷却期未满 → 不换档', () => {
    expect(decideTier({ emaMs: 500, tier: 0, sinceMs: 0, nowMs: SWITCH_COOLDOWN_MS - 1 }))
      .toEqual({ tier: 0, changed: false })
  })

  it('已在最低档 → 不再降', () => {
    expect(decideTier({ emaMs: 500, tier: TIERS.length - 1, sinceMs: 0, nowMs: 99999 }))
      .toEqual({ tier: TIERS.length - 1, changed: false })
  })

  it('EMA 恰好等于阈值（不超出）→ 不降档', () => {
    expect(decideTier({ emaMs: DOWNGRADE_EMA_MS, tier: 0, sinceMs: 0, nowMs: 99999 }))
      .toEqual({ tier: 0, changed: false })
  })
})

describe('decideTier 升档', () => {
  it('EMA 低于阈值且稳定停留满观察窗 → 升一档', () => {
    expect(decideTier({ emaMs: UPGRADE_EMA_MS - 1, tier: 2, sinceMs: 0, nowMs: UPGRADE_HOLD_MS }))
      .toEqual({ tier: 1, changed: true })
  })

  it('迟滞：停留未满观察窗 → 不升档（防振荡）', () => {
    expect(decideTier({ emaMs: 10, tier: 2, sinceMs: 0, nowMs: UPGRADE_HOLD_MS - 1 }))
      .toEqual({ tier: 2, changed: false })
  })

  it('已在最高档 → 不再升', () => {
    expect(decideTier({ emaMs: 1, tier: 0, sinceMs: 0, nowMs: 99999 }))
      .toEqual({ tier: 0, changed: false })
  })

  it('EMA 恰好等于阈值（不低于）→ 不升档', () => {
    expect(decideTier({ emaMs: UPGRADE_EMA_MS, tier: 1, sinceMs: 0, nowMs: 99999 }))
      .toEqual({ tier: 1, changed: false })
  })
})

describe('decideTier 中间区间', () => {
  it('EMA 介于两个阈值之间 → 不换档', () => {
    expect(decideTier({ emaMs: 80, tier: 1, sinceMs: 0, nowMs: 99999 }))
      .toEqual({ tier: 1, changed: false })
  })
})
