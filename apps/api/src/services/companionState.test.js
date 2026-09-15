import { describe, expect, it } from 'vitest'
import { advanceCompanionState, companionStatePrompt, createCompanionState } from './companionState.js'

const step = (state, observation = {}, now = 1000) => advanceCompanionState(state, observation, now).state
const severe = { stimulus: 0.9, threat: 0.9, helplessness: 0.9, controlLoss: 0.9, violation: 0.9, escapeFailure: 0.9, recoveryFailure: 0.9, duration: 1 }

describe('companion numerical experience model', () => {
  it('同一刺激会因角色敏感度和当前状态产生不同痛感，输入保持不变', () => {
    const rested = createCompanionState(1000)
    const tired = { ...rested, body: { ...rested.body, fatigue: 0.6, injury: 0.2 } }
    const before = JSON.stringify(tired)
    expect(step(tired, { stimulus: 0.3 }).affect.pain).toBeGreaterThan(step(rested, { stimulus: 0.3 }).affect.pain)
    expect(step({ ...rested, traits: { ...rested.traits, painSensitivity: 0.5 } }, { stimulus: 0.3 }).affect.pain).toBeCloseTo(0.15)
    expect(JSON.stringify(tired)).toBe(before)
  })

  it('冷热同时考虑活动、体温和补水；缺少温度观测时不捏造身体感觉', () => {
    const cold = { environmentTemperature: 10, bodyTemperature: 37 }
    expect(step(null, cold).affect.cold).toBeGreaterThan(step(null, { ...cold, activity: 0.8 }).affect.cold)
    const heat = { environmentTemperature: 32, bodyTemperature: 37.5 }
    expect(step(null, { ...heat, hydration: 0.2 }).affect.heat).toBeGreaterThan(step(null, { ...heat, hydration: 1 }).affect.heat)
    expect(step(null).affect).toMatchObject({ pain: 0, cold: 0, heat: 0 })
  })

  it('正向预测误差和无结果证据不会产生失望；高期望和重要性放大负向误差', () => {
    expect(step(null, { expectation: 0.5, outcome: 1, importance: 1 }).affect.disappointment).toBe(0)
    expect(step(null, { expectation: 0.9, importance: 1 }).affect.disappointment).toBe(0)
    expect(step(null, { expectation: 0.9, outcome: 0, importance: 1 }).affect.disappointment)
      .toBeGreaterThan(step(null, { expectation: 0.5, outcome: 0, importance: 0.5 }).affect.disappointment)
  })

  it('注意力有阈值和容量，当前消息始终保留，弱线索在后台', () => {
    const candidates = [
      { id: 'current', kind: 'message' },
      ...[0.95, 0.8, 0.7, 0.05].map((score, index) => ({ id: `m${index}`, kind: 'memory', salience: score, memory: score, goal: score })),
    ]
    const state = step(null, { candidates })
    expect(state.attention.foreground.map((item) => item.id)).toEqual(['current', 'm0', 'm1'])
    expect(state.attention.backgroundCount).toBe(3)
  })

  it('信任按实际互动缓慢累积，有界且不会因离线下降', () => {
    const initial = createCompanionState(1000)
    const positive = step(initial, { positive: 1, consistency: 1 })
    expect(positive.trust).toBeCloseTo(0.57)
    expect(step(positive, {}, 10_000_000).trust).toBe(positive.trust)
    expect(step(positive, { violation: 1, boundaryViolation: 1 }).trust).toBeCloseTo(0.37)
    let state = initial
    for (let i = 0; i < 200; i++) state = step(state, { positive: 1 })
    expect(state.trust).toBe(1)
    for (let i = 0; i < 200; i++) state = step(state, { violation: 1 })
    expect(state.trust).toBe(0)
  })

  it('伤害受无助、不可控、持续时间共同影响；负荷单独可触发回避', () => {
    expect(step(null, severe).affect.impact).toBeGreaterThan(step(null, { ...severe, controlLoss: 0 }).affect.impact)
    expect(step(null, { threat: 1, overload: 1, controlLoss: 1, expectedCost: 1 }).protection.mode).toBe('withdrawn')
  })

  it.each(['threat', 'stimulus', 'helplessness', 'controlLoss', 'violation', 'escapeFailure', 'recoveryFailure'])('封存是持续且多条件的合取门，缺少 %s 不触发', (missing) => {
    let state = null
    for (let i = 0; i < 8; i++) state = step(state, { ...severe, [missing]: 0 })
    expect(state.protection.mode).not.toBe('sealed')
  })

  it('封存可以恢复，保留角色参数、信任、学习模型和经历数量', () => {
    let state = step(null, { brevity: 1, positive: 1 })
    for (let i = 0; i < 2; i++) state = step(state, severe)
    expect(state.protection.mode).not.toBe('sealed')
    state = step(state, severe)
    expect(state.protection.mode).toBe('sealed')
    const restored = step(state, { kind: 'recovery', recovery: 1 })
    expect(restored.protection.mode).toBe('open')
    for (const key of ['traits', 'trust', 'learning', 'experienceCount']) expect(restored[key]).toEqual(state[key])
    expect(step(state, {}, 3_600_000).protection.mode).not.toBe('sealed')
  })

  it('一次经历小幅更新，多次一致证据改变后续表达；中性聊天不冒充学习证据', () => {
    const initial = createCompanionState(1000)
    let state = step(initial, { brevity: 1, outcome: 1 })
    expect(state.learning.brevity).toBeCloseTo(0.54)
    expect(step(state).learning).toEqual(state.learning)
    for (let i = 0; i < 12; i++) state = step(state, { brevity: 1, outcome: 1 })
    expect(companionStatePrompt(state)).toContain('偏简洁')
    expect(state.learning.expectedOutcome).toBeGreaterThan(0.8)
    expect(initial.learning.samples).toBe(0)
  })

  it('过期时间不倒退，非法数值和未知状态版本拒绝，重复计算完全一致', () => {
    const initial = createCompanionState(2000)
    expect(step(initial, {}, 1000).updatedAt).toBe(2000)
    for (const value of [NaN, Infinity, '1']) expect(() => step(initial, { stimulus: value })).toThrow()
    expect(() => step({ ...initial, schemaVersion: 2 })).toThrow('不支持')
    expect(step(initial, severe)).toEqual(step(initial, severe))
  })
})
