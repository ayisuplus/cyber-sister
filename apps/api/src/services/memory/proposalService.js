/**
 * 提议通道（路线图 C23，见 docs/architecture/非对称记忆架构.md）：她的建议只能从来信回到根，你点同意才算数。
 *
 * 看信时点「同意采纳」或「不用」，都在同一个事务里完成：写根、回写这条建议的处理结果、
 * 结束她依据的那条整理（关系或理解）。中途任何一步失败（版本变了、记忆不在了），整体回滚，什么都不变。
 * 写根的那一版带来源链：{ letterId, index, kind, inferenceIds }，以后能回答「它是怎么变成现在这样的」。
 *
 * - edit_memory / delete_memory / plan：原来的三种，行为不变，只是进了同一个事务、改记忆时带来源链。
 * - merge_memories：两条说的是一回事——第一条改成合并后的一句，第二条删掉。
 * - resolve_conflict：两条互相矛盾——你选留第一条（keep: 'a'）、留第二条（'b'），或改成一句新的（'edit'，改第一条、删第二条）。
 * - promote_inference：她有原话作证的理解——记成一条新的根（origin=promoted），来源是她当时引的原话。
 * - 不用：原来的三种什么都不动；从草稿来的三种把那条整理结束为「不用」，她不会再拿同一条来提。
 */
import prisma from '../../prisma/client.js'
import { HttpError } from '../../utils/dbHelpers.js'
import logger from '../../utils/logger.js'
import { localClock } from '../contextBlocks.js'
import { applyMemoryChange, createMemory, eraseOwnedMemory } from '../memoryService.js'
import { assertRevision, validateSources, withMemoryTransaction } from '../memoryGovernance.js'
import { createScheduledReminder } from '../reminderService.js'
import { embedMemory } from '../embeddingService.js'
import { closeInferences } from './inferenceService.js'

const DAY_MS = 24 * 60 * 60 * 1000
const DRAFT_KINDS = new Set(['merge_memories', 'resolve_conflict', 'promote_inference'])
const KEEP_CHOICES = new Set(['a', 'b', 'edit'])

/** 明天（北京时间）的 'yyyy-MM-dd'：plan 建议没写日子时的缺省安排日。 */
function tomorrowDate(now = new Date()) {
  const day = new Date(localClock(now).dayKey + DAY_MS)
  return `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`
}

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '')

/** 记忆不在了统一说成人话；别的错误原样抛（版本冲突 409 透传，不自动覆盖）。 */
async function onMemory(task) {
  try {
    return await task()
  } catch (error) {
    if (error?.statusCode === 404) throw new HttpError('这条记忆已经不在了', 404)
    throw error
  }
}

/** 这条建议依据的整理还有效才能采纳：你之后改过相关的记忆，它就作废了，旧建议不再照办。 */
async function assertDraftsActive(tx, userId, ids) {
  if (!ids.length) return
  const active = await tx.inference.count({ where: { userId, id: { in: ids }, status: 'active' } })
  if (active !== ids.length) {
    throw Object.assign(new HttpError('这条建议依据的记忆已经变了，先看看现在的样子再说', 409), { code: 'PROPOSAL_STALE' })
  }
}

/** 依据的原话里还站得住的留作新记忆的来源；原话已经删掉的就不带（来源链仍在版本记录上）。 */
async function stillValidSources(tx, userId, basis) {
  const kept = []
  for (const source of Array.isArray(basis) ? basis : []) {
    try {
      // eslint-disable-next-line no-await-in-loop
      kept.push(...await validateSources(tx, userId, [source]))
    } catch {
      // 这一句原话已经不在了
    }
  }
  return kept
}

/** 在事务里改一条根，并带上来源链；返回它的 id（事务提交后要重算向量）。 */
async function rewrite({ tx, userId, proposal }, memory, content) {
  const updated = await onMemory(() => applyMemoryChange(tx, userId, memory.id, { content, expectedRevision: memory.revision },
    { action: 'accept_suggestion', proposal }))
  return updated.id
}

/** 在事务里删一条根，先核对还是她提建议时的那一版。 */
const drop = ({ tx, userId }, memory) => onMemory(() => eraseOwnedMemory(tx, userId, memory.id, { expectedRevision: memory.revision }))

/** 采纳时按种类写根。每种返回 { edited: [改过内容的记忆 id], already? }。 */
const ACCEPT = {
  async edit_memory(ctx) {
    const { item, body, content } = ctx
    return { edited: [await rewrite(ctx, { id: item.memoryId, revision: body.expectedRevision ?? item.memoryRevision }, content || item.suggestText)] }
  },
  async delete_memory({ tx, userId, item }) {
    try {
      await eraseOwnedMemory(tx, userId, item.memoryId)
      return { edited: [] }
    } catch (error) {
      // 记忆已经不在了：建议照常算采纳
      if (error?.statusCode !== 404) throw error
      return { edited: [], already: true }
    }
  },
  async plan({ tx, userId, item }) {
    await createScheduledReminder(userId, {
      content: item.suggestText, freq: 'once', date: item.planDate ?? tomorrowDate(), time: '09:00', instruction: item.instruction ?? null,
    }, tx)
    return { edited: [] }
  },
  async merge_memories(ctx) {
    const [a, b] = ctx.item.pair
    const edited = [await rewrite(ctx, a, ctx.content || ctx.item.suggestText)]
    await drop(ctx, b)
    return { edited }
  },
  async resolve_conflict(ctx) {
    const { tx, userId, item, body, content } = ctx
    const [a, b] = item.pair
    if (!KEEP_CHOICES.has(body.keep)) throw new HttpError('请选留哪一条：keep 只能是 a、b 或 edit', 400)
    if (body.keep === 'edit') {
      if (!(content || item.suggestText)) throw new HttpError('改成什么？写下统一的说法', 400)
      const edited = [await rewrite(ctx, a, content || item.suggestText)]
      await drop(ctx, b)
      return { edited }
    }
    const [kept, dropped] = body.keep === 'a' ? [a, b] : [b, a]
    // 留下的那条也要还是她提建议时看到的样子
    const current = await tx.memory.findFirst({ where: { id: kept.id, userId }, select: { revision: true } })
    if (!current) throw new HttpError('这条记忆已经不在了', 404)
    assertRevision(current, kept.revision)
    await drop(ctx, dropped)
    return { edited: [] }
  },
  async promote_inference({ tx, userId, item, content, proposal }) {
    const draft = await tx.inference.findFirst({ where: { id: item.inferenceIds[0], userId }, select: { basis: true } })
    const sources = await stillValidSources(tx, userId, draft?.basis)
    const memory = await createMemory(userId, { type: 'semantic', content: content || item.suggestText, origin: 'promoted', sources }, {
      tx, action: 'accept_suggestion', proposal, trustedSources: true, projectEmbedding: false,
    })
    return { edited: [memory.id] }
  },
}

function accept(tx, userId, item, body, proposal) {
  const handler = Object.hasOwn(ACCEPT, item.kind) ? ACCEPT[item.kind] : null
  if (!handler) throw new HttpError('这条建议已经不在了', 404)
  return handler({ tx, userId, item, body, proposal, content: trimmed(body.content) })
}

/**
 * 处理来信里的一条建议。decision：accept | dismiss；body 可带 content（你改过的正文）、
 * expectedRevision（改记忆时）、keep（定夺矛盾时）。返回 { letter, already? }。
 */
export async function decideSuggestion(userId, letterId, rawIndex, body = {}) {
  const { decision } = body
  if (decision !== 'accept' && decision !== 'dismiss') throw new HttpError('decision只能是accept或dismiss', 400)
  const index = Number(rawIndex)
  const outcome = await withMemoryTransaction(userId, async (tx) => {
    const letter = await tx.letter.findFirst({ where: { id: letterId, userId } })
    if (!letter) throw new HttpError('信件不存在', 404)
    const suggestions = Array.isArray(letter.suggestions) ? [...letter.suggestions] : []
    if (!Number.isInteger(index) || index < 0 || index >= suggestions.length) throw new HttpError('这条建议已经不在了', 404)
    const item = suggestions[index]
    if (item?.decided != null) throw new HttpError('这条建议已经处理过了', 409)

    const inferenceIds = DRAFT_KINDS.has(item.kind) && Array.isArray(item.inferenceIds) ? item.inferenceIds : []
    const proposal = { letterId: letter.id, index, kind: item.kind, inferenceIds }
    let result = { edited: [] }
    if (decision === 'accept') {
      await assertDraftsActive(tx, userId, inferenceIds)
      // 先结束她依据的那条整理，再写根：改根时让其他依据它的整理作废，这一条已经有了结果
      await closeInferences(tx, userId, inferenceIds, 'accepted', { letterId: letter.id, index })
      result = await accept(tx, userId, item, body, proposal)
    } else {
      // 不用：她依据的那条整理结束为「不用」，不会再拿同一条来提
      await closeInferences(tx, userId, inferenceIds, 'declined', { letterId: letter.id, index })
    }
    // decidedAt：「她这几天」手账按它把处理写进那一天
    suggestions[index] = { ...item, decided: decision === 'accept' ? 'accepted' : 'dismissed', decidedAt: new Date().toISOString() }
    const updated = await tx.letter.update({ where: { id: letter.id }, data: { suggestions } })
    return { letter: updated, ...result }
  })

  // 事务提交之后：改过内容的记忆重算向量（失败只是这轮没有向量）
  if (outcome.edited.length) {
    const memories = await prisma.memory.findMany({ where: { userId, id: { in: outcome.edited } } })
    for (const memory of memories) void embedMemory(memory)
  }
  logger.info('来信建议已处理', { userId, decision, edited: outcome.edited.length })
  return { letter: outcome.letter, ...(outcome.already ? { success: true, already: true } : {}) }
}
