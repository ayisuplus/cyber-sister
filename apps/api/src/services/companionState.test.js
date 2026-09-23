import { describe, expect, it } from 'vitest'
import { advanceCompanionState, companionPacing, companionStatePrompt, createCompanionState } from './companionState.js'

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

  it('连续冒犯两句放慢、四句简短并说明边界；一句正常的话回到自然交流，信任仍低于之前', () => {
    const hostile = { threat: 0.8, violation: 0.8 }
    let state = createCompanionState(1000)
    const before = state.trust
    state = step(state, hostile)
    expect(state.protection.mode).toBe('open')
    state = step(state, hostile)
    expect(state.protection.mode).toBe('guarded')
    state = step(step(state, hostile), hostile)
    expect(state.protection.mode).toBe('withdrawn')
    state = step(state, { positive: 1 })
    expect(state.protection.mode).toBe('open')
    expect(state.trust).toBeLessThan(before)
  })

  it('隔半小时以上算新的一次聊天，恢复不打断；没有会话字段的旧状态照样能读', () => {
    const initial = createCompanionState(0)
    const talking = step(step(initial, {}, 10 * 60_000), {}, 35 * 60_000)
    expect(talking.session.startedAt).toBe(0)
    expect(step(talking, {}, 70 * 60_000).session.startedAt).toBe(70 * 60_000)
    expect(step(talking, { kind: 'recovery', recovery: 1 }, 200 * 60_000).session.startedAt).toBe(0)
    const { session: _session, ...legacy } = talking
    expect(step(legacy, {}, 36 * 60_000).session.startedAt).toBe(35 * 60_000)
  })

  it('分寸只在这里决定：深夜、聊得久、久别、心情低、经期各有一条，她这一句的要求排最前', () => {
    const state = createCompanionState(0)
    const at = (moment) => companionPacing(state, moment).join('\n')
    for (const hour of [22, 23, 0, 4]) expect(at({ hour })).toContain('很晚')
    for (const hour of [5, 15, 21]) expect(at({ hour })).not.toContain('很晚')
    expect(at({ hour: 23, sessionMinutes: 75 })).toContain('早点休息')
    expect(at({ hour: 15, sessionMinutes: 75 })).not.toContain('早点休息')
    expect(at({ gapMs: 3 * 24 * 3_600_000 })).toContain('不追问')
    expect(at({ gapMs: 2 * 24 * 3_600_000 })).not.toContain('不追问')
    expect(at({ lowMood: true })).toContain('先陪着')
    expect(companionPacing(state, { hour: 23, lowMood: true, asksShort: true })[0]).toContain('简短')
    expect(companionPacing(state, {})).toEqual([])
  })

  it('经期只在同意后给出，只调分寸：不提起、不归因；没有时整块不出现「经期」', () => {
    const state = createCompanionState(0)
    expect(companionStatePrompt(state, { hour: 23, lowMood: true })).not.toContain('经期')
    const period = companionStatePrompt(state, { cyclePhase: 'period' })
    expect(period).toContain('不要提起经期')
    expect(period).toContain('不要把她的情绪归因于经期')
    expect(period).toContain('不要向她复述')
  })

  it('过期时间不倒退，非法数值和未知状态版本拒绝，重复计算完全一致', () => {
    const initial = createCompanionState(2000)
    expect(step(initial, {}, 1000).updatedAt).toBe(2000)
    for (const value of [NaN, Infinity, '1']) expect(() => step(initial, { stimulus: value })).toThrow()
    expect(() => step({ ...initial, schemaVersion: 2 })).toThrow('不支持')
    expect(step(initial, severe)).toEqual(step(initial, severe))
  })
})
