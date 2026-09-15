import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import { advanceCompanionState, companionStatePrompt, createCompanionState } from './companionState.js'

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

/** 只采集可归因的交互信号；身体词语、情绪倾诉和助手猜测都不是角色传感器。 */
export function prepareCompanionTurn(userId, user, content, relevantMemories = [], now = Date.now()) {
  const base = snapshot(user, now)
  const text = content.trim()
  const brevity = /(?:^|[。！!\n])(?:请)?(?:简短一点|简单点|少说一点)[。！!\s]*$/u.test(text) ? 1
    : /(?:^|[。！!\n])(?:请)?(?:详细一点|展开讲讲|多说一点)[。！!\s]*$/u.test(text) ? 0 : undefined
  const observation = {
    kind: 'interaction',
    load: Math.min(1, text.length / 4000),
    positive: /^(?:谢谢你|谢谢|多谢|你帮到我了|这很有帮助)[！!。\s]*$/u.test(text) ? 1 : 0,
    ...(brevity !== undefined ? { brevity } : {}),
    candidates: [
      { id: 'current', kind: 'message', salience: 1, goal: 1 },
      ...relevantMemories.map((memory, index) => ({
        id: memory.id, kind: 'memory', salience: Math.max(0, 0.9 - index * 0.1), goal: 0.8, memory: 1,
      })),
    ],
  }
  const preview = advanceCompanionState(base.state, observation, now)
  const selectedIds = new Set(preview.state.attention.foreground.filter((item) => item.kind === 'memory').map((item) => item.id))
  return {
    userId, basedOnRevision: base.revision, recoveryEpoch: base.state.recoveryEpoch,
    observation,
    // 本轮先感受再说话，但只有成功提交时才成为下一轮的持久状态。
    systemMessage: { role: 'system', content: companionStatePrompt(preview.state) },
    memories: relevantMemories.filter((memory) => selectedIds.has(memory.id)),
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
