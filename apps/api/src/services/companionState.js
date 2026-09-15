/**
 * 角色自身的计算模型。纯函数，不读取用户档案、调用模型或写数据库。
 * 图中的未定义 f 用有界启发式补足；参数是产品模拟参数，不是生理测量标定。
 */
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const learn = (model, evidence) => model + 0.08 * (evidence - model)

function number(value, fallback = 0, min = 0, max = 1) {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('角色观测必须为有限数值')
  return clamp(value, min, max)
}

export function createCompanionState(now = 0) {
  return {
    schemaVersion: 1,
    updatedAt: number(now, 0, 0, Number.MAX_SAFE_INTEGER),
    experienceCount: 0,
    recoveryEpoch: 0,
    traits: { painSensitivity: 1, coldSensitivity: 1, heatSensitivity: 1 },
    body: { fatigue: 0, injury: 0, hydration: 1 },
    affect: { pain: 0, cold: 0, heat: 0, disappointment: 0, impact: 0 },
    trust: 0.5,
    protection: { mode: 'open', strain: 0, threatStreak: 0 },
    learning: { samples: 0, expectedOutcome: 0.5, brevity: 0.5 },
    attention: { foreground: [], backgroundCount: 0 },
  }
}

function compete(candidates) {
  const ranked = candidates.map((candidate, index) => ({
    id: candidate.id,
    kind: candidate.kind,
    score: 0.35 * number(candidate.salience) + 0.2 * number(candidate.need)
      + 0.2 * number(candidate.emotion) + 0.15 * number(candidate.goal) + 0.1 * number(candidate.memory),
    index,
  })).sort((a, b) => Number(b.kind === 'message') - Number(a.kind === 'message') || b.score - a.score || a.index - b.index)
  const foreground = ranked.filter((item) => item.kind === 'message' || item.score > 0.4).slice(0, 3)
    .map(({ index: _index, ...item }) => item)
  return { foreground, backgroundCount: candidates.length - foreground.length }
}

/** Observation -> appraisal -> state/attention -> bounded learning. now 必须由调用方传入以便重放。 */
export function advanceCompanionState(previous, observation = {}, now = 0) {
  const prior = previous ?? createCompanionState(now)
  if (prior.schemaVersion !== 1) throw new TypeError('不支持的角色状态版本')
  const updatedAt = Math.max(prior.updatedAt, number(now, 0, 0, Number.MAX_SAFE_INTEGER))
  // 时间只用于恢复瞬态负荷，不因用户离线改变信任或学习模型。
  const rest = Math.min(1, (updatedAt - prior.updatedAt) / 3_600_000)
  const recovery = number(observation.recovery)
  const retention = (1 - 0.7 * rest) * (1 - recovery)
  const body = {
    fatigue: clamp(number(observation.fatigue, prior.body.fatigue) * retention + number(observation.load) * 0.08),
    injury: number(observation.injury, prior.body.injury),
    hydration: number(observation.hydration, prior.body.hydration),
  }
  const stimulus = number(observation.stimulus)
  const pain = clamp(stimulus * number(prior.traits.painSensitivity, 1, 0, 2) * (1 + body.fatigue + body.injury))
  const environment = observation.environmentTemperature
  const bodyTemperature = observation.bodyTemperature
  const hasTemperature = environment != null && bodyTemperature != null
  const env = number(environment, 22, -80, 80)
  const temp = number(bodyTemperature, 37, 20, 45)
  const activity = number(observation.activity)
  const cold = hasTemperature ? clamp(((22 - env) / 20 + (37 - temp) / 4 - activity * 0.3)
    * number(prior.traits.coldSensitivity, 1, 0, 2) * (1 + body.fatigue)) : prior.affect.cold * retention
  const heat = hasTemperature ? clamp(((env - 26) / 20 + (temp - 37) / 4 + activity * 0.3)
    * number(prior.traits.heatSensitivity, 1, 0, 2) * (1 + 1 - body.hydration)) : prior.affect.heat * retention
  const expectation = number(observation.expectation, prior.learning.expectedOutcome)
  const hasOutcome = observation.outcome != null
  const outcome = number(observation.outcome)
  const disappointment = hasOutcome ? expectation * number(observation.importance) * Math.max(0, expectation - outcome) : 0
  const threat = number(observation.threat)
  const helplessness = number(observation.helplessness)
  const controlLoss = number(observation.controlLoss)
  const violation = number(observation.violation)
  const boundary = number(observation.boundaryViolation)
  const impact = clamp(Math.max(pain, disappointment) * helplessness * controlLoss * number(observation.duration)
    + prior.affect.impact * retention * 0.9)
  const avoidance = clamp(0.35 * threat + 0.25 * number(observation.overload, body.fatigue)
    + 0.25 * controlLoss + 0.15 * number(observation.expectedCost))
  const threatStreak = threat > 0.6 && (violation > 0.6 || boundary > 0.6) ? prior.protection.threatStreak + 1 : 0
  // 合取门而非简单总分：任一条件缺失都不能由其他高分补偿。
  const seal = threatStreak >= 3 && threat > 0.6 && pain > 0.6 && helplessness > 0.6 && controlLoss > 0.6
    && Math.max(violation, boundary) > 0.6 && number(observation.escapeFailure) > 0.6 && number(observation.recoveryFailure) > 0.6
  const strain = clamp(Math.max(avoidance, impact, prior.protection.strain * retention * 0.9))
  const staysSealed = prior.protection.mode === 'sealed' && strain > 0.35
  const mode = recovery === 1 ? 'open' : seal || staysSealed ? 'sealed' : strain > 0.65 ? 'withdrawn' : strain > 0.35 ? 'guarded' : 'open'
  const trustDelta = 0.04 * number(observation.positive) + 0.03 * number(observation.consistency) - 0.1 * violation - 0.1 * boundary
  const learning = { ...prior.learning }
  if (hasOutcome || observation.brevity != null) {
    learning.samples += 1
    if (hasOutcome) learning.expectedOutcome = learn(learning.expectedOutcome, outcome)
    if (observation.brevity != null) learning.brevity = learn(learning.brevity, number(observation.brevity))
  }
  const need = Math.max(pain, cold, heat, body.fatigue)
  const attention = compete([
    ...(observation.candidates ?? []),
    { id: 'body', kind: 'body', salience: need, need, emotion: Math.max(disappointment, impact), goal: 0.3 },
  ])
  const state = {
    ...prior,
    updatedAt,
    experienceCount: prior.experienceCount + (observation.kind === 'recovery' ? 0 : 1),
    traits: { ...prior.traits },
    body,
    affect: { pain, cold, heat, disappointment, impact },
    trust: clamp(prior.trust + trustDelta),
    protection: { mode, strain: recovery === 1 ? 0 : strain, threatStreak: recovery === 1 ? 0 : threatStreak },
    learning,
    attention,
  }
  return { state, appraisal: { pain, cold, heat, disappointment, impact, avoidance, seal: mode === 'sealed', trustDelta } }
}

/** 模型只得到受控的表达倾向。原始观测和用户文字不拼接进系统指令。 */
export function companionStatePrompt(state) {
  if (state.schemaVersion !== 1) throw new TypeError('不支持的角色状态版本')
  const pacing = { open: '自然交流', guarded: '放慢节奏，先澄清一件事', withdrawn: '简短表达，说明边界并给一个可继续的选项', sealed: '保持简短、平稳，提供恢复交流的选项' }
  const expression = state.learning.brevity > 0.6 ? '偏简洁' : state.learning.brevity < 0.4 ? '偏详细' : '适中'
  return [
    '【角色运行状态】这是 AI 角色自身的数值模拟，只影响表达节奏，不是用户的心理档案。',
    `本轮节奏：${pacing[state.protection.mode] || pacing.open}；已学习的表达长度：${expression}。`,
    `角色对互动的熟悉程度：${state.trust > 0.6 ? '逐渐熟悉，语气可以自然一些' : '逐步建立，保持尊重与清晰'}。`,
    state.learning.expectedOutcome < 0.45 ? '近期执行结果低于预期，本轮先核对能做到的事情。' : '依据实际完成的结果交流。',
    '优先回应用户当前请求；当前明确表达的偏好优先于历史倾向。状态不会改变工具权限或事实判断。',
    '不声称具有真实身体痛觉，不用受伤、信任分数或离开威胁要求用户安慰、付费或继续互动。',
  ].join('\n')
}
