import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'
import { advanceCompanionState, companionStatePrompt, createCompanionState } from './companionState.js'
import { localClock } from './contextBlocks.js'
import { detectEmotion } from './detection.js'

const DAY_MS = 24 * 60 * 60 * 1000
const SESSION_GAP_MS = 30 * 60 * 1000
const LOW_MOODS = new Set(['sad', 'angry', 'anxious'])
// 没填结束日的经期按 5 天算；填了也最多看 10 天，免得一条忘了收尾的记录让她一直「在经期」
const DEFAULT_PERIOD_DAYS = 5
const MAX_PERIOD_DAYS = 10

// 转述别人的话（「她说谢谢你」「他骂我：你真蠢」）和被否定的说法（「不要简短一点」）都不算她对你说的
const REPORTED = /(?:说|讲|问|回|叫|骂)[：:，,]?\s*[「“"']?$/u
const NEGATED = /(?:不要|不用|不必|别|不想)$/u
const ASKS_SHORT = /简短(?:一)?点|(?:说|讲)(?:得)?简单(?:一)?点|少说(?:一)?点|说重点|长话短说|(?:说|讲|回|写)(?:得|的)(?:太|有点)长|(?:^|[。！!？?\n])太长(?:了|啦)|别(?:说|讲)(?:那么|这么)多|(?:不用|不要|别)(?:太|那么)?详细|一句话(?:说|讲)/gu
const ASKS_LONG = /详细(?:一)?点|展开(?:讲讲|说说|讲|说)|多说(?:一)?点|具体(?:一)?点|说(?:得)?详细|再多(?:讲|说)(?:一)?点/gu
const THANKS = /谢谢|多谢|感谢|你真好|有你真好|幸好有你|还好有你|好多了|舒服多了/gu
// 冲着她说的重话；带笑的互怼（「直爽」风格下常见）不算
const HOSTILE = /你(?:这个|个|真|好|太|是不是|怎么这么|就是个)?(?:蠢|笨|傻|废物|垃圾|有病|智障|脑残|白痴|没用)|闭嘴|(?:^|[，,。！!\s])滚(?:开|蛋|吧)?(?=[！!。，,\s]|$)|你(?:算)?(?:个)?什么东西/gu
const PLAYFUL = /哈哈|嘿嘿|hh|233|😂|🤣|狗头|doge/iu

function saysDirectly(text, pattern) {
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(0, match.index)
    if (!REPORTED.test(before) && !NEGATED.test(before)) return true
  }
  return false
}

const SELECT_STATE = { companionState: true, companionRevision: true }

function conflict() {
  const error = new HttpError('角色状态已变化，请刷新后重试', 409)
  error.code = 'COMPANION_CONFLICT'
  return error
}

function snapshot(user, now) {
  if (!user) throw new HttpError('用户不存在', 404)
  return { revision: user.companionRevision ?? 0, state: user.companionState ?? createCompanionState(now) }
}

/** 这一句的长短要求：1 简短、0 详细、undefined 没说。 */
function brevityOf(text) {
  if (saysDirectly(text, ASKS_SHORT)) return 1
  return saysDirectly(text, ASKS_LONG) ? 0 : undefined
}

/**
 * 只采集可归因的交互信号：她直接对你说的长短要求、道谢、冲你说的重话，以及隔了多久才回来。
 * 身体词语、情绪倾诉、转述和助手猜测都不是角色传感器。
 */
function observe(text, prior, now, relevantMemories) {
  const brevity = brevityOf(text)
  const hostile = !PLAYFUL.test(text) && saysDirectly(text, HOSTILE)
  const returning = prior.experienceCount > 0 && now - prior.updatedAt > SESSION_GAP_MS
  return {
    kind: 'interaction',
    load: Math.min(1, text.length / 4000),
    positive: saysDirectly(text, THANKS) ? 1 : 0,
    ...(returning ? { consistency: 1 } : {}),
    ...(hostile ? { threat: 0.8, violation: 0.8 } : {}),
    ...(brevity !== undefined ? { brevity } : {}),
    candidates: [
      { id: 'current', kind: 'message', salience: 1, goal: 1 },
      ...relevantMemories.map((memory, index) => ({
        id: memory.id, kind: 'memory', salience: Math.max(0, 0.9 - index * 0.1), goal: 0.8, memory: 1,
      })),
    ],
  }
}

/** 本轮的临时输入：只影响这一轮怎么说，不写进状态。 */
function momentOf(text, prior, preview, observation, now, inputs) {
  return {
    hour: localClock(new Date(now)).hour,
    gapMs: prior.experienceCount > 0 ? Math.max(0, now - prior.updatedAt) : 0,
    sessionMinutes: Math.max(0, now - preview.session.startedAt) / 60_000,
    asksShort: observation.brevity === 1,
    asksLong: observation.brevity === 0,
    lowMood: LOW_MOODS.has(detectEmotion(text)) || inputs.recentLowMood === true,
    cyclePhase: inputs.cyclePhase === 'period' ? 'period' : null,
  }
}

/**
 * 准备这一轮：先感受再说话，但只有成功提交时才成为下一轮的持久状态。
 * inputs 来自 loadCompanionInputs（最近两天的日记心情；两个经期同意都开时的经期阶段）。
 */
export function prepareCompanionTurn(userId, user, content, relevantMemories = [], { now = Date.now(), inputs = {} } = {}) {
  const base = snapshot(user, now)
  const text = content.trim()
  const observation = observe(text, base.state, now, relevantMemories)
  const preview = advanceCompanionState(base.state, observation, now)
  const selectedIds = new Set(preview.state.attention.foreground.filter((item) => item.kind === 'memory').map((item) => item.id))
  const moment = momentOf(text, base.state, preview.state, observation, now, inputs)
  return {
    userId, basedOnRevision: base.revision, recoveryEpoch: base.state.recoveryEpoch,
    observation,
    systemMessage: { role: 'system', content: companionStatePrompt(preview.state, moment) },
    // 相关的都交给她；内核的注意力只决定哪几条此刻值得主动提起（foreground），不再决定她能不能看见
    memories: relevantMemories.map((memory) => ({ ...memory, foreground: selectedIds.has(memory.id) })),
  }
}

/** 某条经期记录在 today 这天是不是还在经期里（都是北京时间日历日，按 UTC 零点存）。 */
export function cyclePhaseOn(record, todayKey) {
  if (!record?.startDate) return null
  const start = new Date(record.startDate).getTime()
  const planned = record.endDate ? new Date(record.endDate).getTime() : start + (DEFAULT_PERIOD_DAYS - 1) * DAY_MS
  const last = Math.min(planned, start + (MAX_PERIOD_DAYS - 1) * DAY_MS)
  return todayKey >= start && todayKey <= last ? 'period' : null
}

const quietly = async (label, userId, task, fallback) => {
  try {
    return await task()
  } catch (error) {
    logger.warn('这一轮少了一项分寸输入', { userId, source: label, error: error.message })
    return fallback
  }
}

/**
 * 这一轮分寸要用的你的数据：最近两天日记的心情；只有「记录经期」和「顾及周期」两个同意都开时才读经期。
 * 任何一处取不到都当作没有，不影响聊天。
 */
export async function loadCompanionInputs(userId, user, now = new Date()) {
  const today = localClock(now).dayKey
  const cycleAllowed = Boolean(user?.periodConsentAt && user?.periodToneAt)
  const [moods, period] = await Promise.all([
    quietly('diary', userId, () => prisma.diaryEntry.findMany({ where: { userId, day: { gte: new Date(today - DAY_MS) } }, select: { mood: true } }), []),
    cycleAllowed
      ? quietly('period', userId, () => prisma.periodRecord.findFirst({ where: { userId }, orderBy: { startDate: 'desc' }, select: { startDate: true, endDate: true } }), null)
      : null,
  ])
  return {
    recentLowMood: moods.some((entry) => LOW_MOODS.has(entry.mood)),
    cyclePhase: cycleAllowed ? cyclePhaseOn(period, today) : null,
  }
}

async function lockedSnapshot(tx, userId, signal) {
  signal?.throwIfAborted()
  const owner = await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`
  signal?.throwIfAborted()
  if (owner.length === 0) throw new HttpError('用户不存在', 404)
  const user = await tx.user.findUnique({ where: { id: userId }, select: SELECT_STATE })
  signal?.throwIfAborted()
  return snapshot(user, Date.now())
}

/** 与两条聊天消息共用事务；锁后重读并重算，跨会话并发完成也不丢经历。 */
export async function commitCompanionTurn(tx, userId, prepared, toolRuns, signal) {
  if (prepared.userId !== userId) throw new HttpError('角色不属于当前用户', 403)
  const latest = await lockedSnapshot(tx, userId, signal)
  if (latest.state.recoveryEpoch !== prepared.recoveryEpoch) {
    // 恢复覆盖旧状态更新，但仍允许已完成回复/工具记录保存，避免诱发重试副作用。
    return { schemaVersion: 1, status: 'superseded', basedOnRevision: prepared.basedOnRevision, revision: latest.revision }
  }
  const observation = {
    ...prepared.observation,
    // 工具失败影响角色对自身执行效果的预期，不扣减对用户的信任。
    ...(toolRuns.length ? { outcome: toolRuns.filter((run) => run.ok).length / toolRuns.length, importance: 0.7 } : {}),
  }
  const { state, appraisal } = advanceCompanionState(latest.state, observation, Date.now())
  const revision = latest.revision + 1
  await tx.user.update({ where: { id: userId }, data: { companionState: state, companionRevision: revision } })
  signal?.throwIfAborted()
  return { schemaVersion: 1, status: 'applied', basedOnRevision: prepared.basedOnRevision, revision, observation, appraisal }
}

export async function getCompanionState(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: SELECT_STATE })
  return snapshot(user, Date.now())
}

/** 恢复瞬态状态，保留身份、信任和已学习参数，并使恢复前的在途回复失效。 */
// eslint-disable-next-line require-await -- 校验错误以 rejected Promise 交给 HTTP 层处理。
export async function recoverCompanionState(userId, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new HttpError('需要提供角色当前版本号', 400)
  return prisma.$transaction(async (tx) => {
    const latest = await lockedSnapshot(tx, userId)
    if (latest.revision !== expectedRevision) throw conflict()
    const { state } = advanceCompanionState(latest.state, { kind: 'recovery', recovery: 1 }, Date.now())
    state.recoveryEpoch += 1
    const revision = latest.revision + 1
    await tx.user.update({ where: { id: userId }, data: { companionState: state, companionRevision: revision } })
    return { revision, state }
  })
}
