/**
 * 角色自身的计算模型。纯函数，不读取用户档案、调用模型或写数据库。
 * 图中的未定义 f 用有界启发式补足；参数是产品模拟参数，不是生理测量标定。
 */
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const learn = (model, evidence) => model + 0.08 * (evidence - model)
const MINUTE_MS = 60_000
// 隔了这么久再说话，就算新的一次（「今晚已经聊了多久」从这里算起）
const SESSION_GAP_MS = 30 * MINUTE_MS
const DAY_MS = 24 * 60 * MINUTE_MS
const MODE_RANK = { open: 0, guarded: 1, withdrawn: 2, sealed: 3 }

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
    session: { startedAt: number(now, 0, 0, Number.MAX_SAFE_INTEGER) },
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
  const strainMode = strain > 0.65 ? 'withdrawn' : strain > 0.35 ? 'guarded' : 'open'
  // 连续冒犯：两句放慢、四句简短并说明边界；一句正常的话就回到自然交流——不记仇，信任另算、慢慢才涨回来
  const streakMode = threatStreak >= 4 ? 'withdrawn' : threatStreak >= 2 ? 'guarded' : 'open'
  const mode = recovery === 1 ? 'open' : seal || staysSealed ? 'sealed'
    : MODE_RANK[strainMode] >= MODE_RANK[streakMode] ? strainMode : streakMode
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
    session: nextSession(prior, updatedAt, observation.kind === 'recovery'),
  }
  return { state, appraisal: { pain, cold, heat, disappointment, impact, avoidance, seal: mode === 'sealed', trustDelta } }
}

/** 这次聊天从什么时候开始：隔了半小时以上算新的一次；恢复不打断。旧状态没有这一项时从上次更新算起。 */
function nextSession(prior, updatedAt, isRecovery) {
  const current = prior.session ?? { startedAt: prior.updatedAt }
  if (isRecovery || updatedAt - prior.updatedAt <= SESSION_GAP_MS) return { ...current }
  return { startedAt: updatedAt }
}

const PACING = {
  guarded: '放慢节奏：平静地接住，不反击也不讨好，先澄清一件事。',
  withdrawn: '简短表达：平静地说明你愿意好好聊，给她一个可以继续的选项；不冷战，不说教。',
  sealed: '保持简短、平稳，提供恢复交流的选项。',
}

const isLateNight = (hour) => Number.isInteger(hour) && (hour >= 22 || hour < 5)

/**
 * 这一轮该怎么说——「她用什么节奏跟你说话」只在这里决定。
 * moment 是本轮的临时输入（北京时间几点、隔了多久、这次聊了多久、这一句的要求、心情、经期），
 * 只影响这一轮，不写进状态。按优先级排好：她这一句明确的要求永远在最前。
 * @param {{ hour?: number, gapMs?: number, sessionMinutes?: number, asksShort?: boolean, asksLong?: boolean, lowMood?: boolean, cyclePhase?: 'period' | null }} [moment]
 */
export function companionPacing(state, moment = {}) {
  const late = isLateNight(moment.hour)
  return [
    moment.asksShort ? '她这一句要你简短：三句以内，只说最要紧的。' : null,
    !moment.asksShort && moment.asksLong ? '她这一句想听详细的：可以展开说，但保持条理。' : null,
    PACING[state.protection.mode] ?? null,
    late ? '现在很晚了：说得短一点、慢一点，少给建议和待办，不催她做事；她想聊就陪着。' : null,
    late && moment.sessionMinutes >= 60 ? '你们已经聊了一个多小时：合适的时候轻轻说一句早点休息，只说一次，不要赶她走。' : null,
    moment.gapMs >= 3 * DAY_MS ? '隔了好几天她才来：先回应她现在说的，不追问她为什么没来，也不要一上来接着上次的话题。' : null,
    moment.lowMood ? '她这会儿心情不太好：先陪着、先听，少讲道理，建议最多一条。' : null,
    moment.cyclePhase === 'period' ? '她这几天在经期，身体可能不太舒服：更软、更有耐心，少安排事情。不要提起经期或身体，除非她自己说起；也不要把她的情绪归因于经期。' : null,
  ].filter(Boolean)
}

/** 模型只得到受控的表达倾向。原始观测和用户文字不拼接进系统指令。 */
export function companionStatePrompt(state, moment = {}) {
  if (state.schemaVersion !== 1) throw new TypeError('不支持的角色状态版本')
  const expression = state.learning.brevity > 0.6 ? '偏简洁' : state.learning.brevity < 0.4 ? '偏详细' : '适中'
  return [
    '【这一轮的分寸】由角色运行状态和此刻的情况算出，只决定你这一轮怎么说；不是关于她的结论，不要向她复述。',
    ...companionPacing(state, moment).map((line) => `- ${line}`),
    `- 已学到的表达长度：${expression}；她这一句明确的要求优先于这个倾向。`,
    `- 熟悉程度：${state.trust > 0.6 ? '逐渐熟悉，语气可以自然一些' : '逐步建立，保持尊重与清晰'}。`,
    `- ${state.learning.expectedOutcome < 0.45 ? '近期执行结果低于预期，本轮先核对能做到的事情。' : '依据实际完成的结果交流。'}`,
    '优先回应她当前的请求。状态不会改变工具权限或事实判断。',
    '不声称具有真实身体痛觉，不用受伤、信任分数或离开威胁要求用户安慰、付费或继续互动。',
  ].join('\n')
}
