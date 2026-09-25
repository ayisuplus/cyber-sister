/**
 * 她的组织层（路线图 C23，见 docs/architecture/非对称记忆架构.md）：
 * 她用你的记忆自行推断、自行整理出来的东西——记忆之间的关系、对你的理解、惦记的事——都在 inferences 一张表里，
 * 这里是唯一的读写入口。
 *
 * - 永远不是记忆：进聊天标成「她自己的联想」、不当事实；进根只能经来信建议、你点同意。
 * - 每一条都有依据（basis，与 Memory.sources 同形）。依据的根被改就作废（stale），被删就连同引文删除。
 * - 你在「她猜的」里删掉的是否决（vetoed）：内容与依据清空，只留去重键，她不会再推出同一条。
 * - 生命周期：active → stale（根被改）/ vetoed（你删掉）/ closed（问过、采纳或不用）；理解 30 天后过期，惦记的事过了三天不再问。
 */
import prisma from '../../prisma/client.js'
import { HttpError } from '../../utils/dbHelpers.js'
import { normalizeKey } from '../../utils/normalizeKey.js'
import { localClock } from '../contextBlocks.js'

export const INFERENCE_KINDS = ['relation', 'insight', 'followup']
export const RELATIONS = ['similar', 'related', 'contradicts']
export const INSIGHT_CATEGORIES = ['pattern', 'hypothesis', 'conflict', 'summary']
export const INSIGHT_TTL_DAYS = 30
export const FOLLOW_UP_WINDOW_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000
const RELATION_WORDS = { similar: '说的可能是一回事', related: '有关', contradicts: '好像互相矛盾' }
const MAX_RELATION_SIDE = 60

/** 北京时间「今天」的 UTC 零点。 */
export const todayKey = (now = new Date()) => localClock(now).dayKey
const dayString = (date) => new Date(date).toISOString().slice(0, 10)
const clip = (text, max) => {
  const chars = [...String(text ?? '').trim()]
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('')
}

/** 关系给她看的那一句：「A」与「B」说的可能是一回事。 */
export const relationContent = (fromContent, toContent, relation) =>
  `「${clip(fromContent, MAX_RELATION_SIDE)}」与「${clip(toContent, MAX_RELATION_SIDE)}」${RELATION_WORDS[relation] ?? RELATION_WORDS.related}`

/**
 * 去重键：同一条只存一行。与迁移 20260925150000_inferences 里的 SQL 逐字一致。
 * 关系按两端 id 排序（无向）+ 关系种类；惦记的事按哪天问 + 那件事；理解按内容。
 */
export function dedupeKeyOf({ kind, content, payload = {}, dueOn = null }) {
  if (kind === 'relation') {
    const [a, b] = [String(payload.fromMemoryId), String(payload.toMemoryId)].sort()
    return `relation:${a}:${b}:${payload.relation}`
  }
  if (kind === 'followup') return `followup:${dayString(dueOn)}:${normalizeKey(payload.about)}`
  return `insight:${normalizeKey(content)}`
}

const notExpired = (now) => ({ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] })

/**
 * 存下她这一次整理出的东西。已经有的（有效、否决过、已结束）不重复记；
 * 作废过的同一条，这次依据又成立了，就按新依据复活。可传事务。
 * @param {{ kind, content, payload?, basis?, basisMemoryIds?, dueOn?, expiresAt? }[]} items 已经校验、过滤过的
 */
export async function saveInferences(userId, items, { producedBy, database = prisma } = {}) {
  const rows = items.map((item) => ({
    userId,
    // 导入包里作废的关系原样作废；其余新整理的都是有效
    status: item.status === 'stale' ? 'stale' : 'active',
    kind: item.kind,
    content: item.content,
    payload: item.payload ?? {},
    basis: item.basis ?? [],
    basisMemoryIds: [...new Set(item.basisMemoryIds ?? [])],
    dueOn: item.dueOn ?? null,
    expiresAt: item.expiresAt ?? null,
    dedupeKey: dedupeKeyOf(item),
    producedBy,
  }))
  // 同一批里重复的留第一条（模型给的顺序就是它自己的轻重）
  const unique = rows.filter((row, index) => rows.findIndex((other) => other.dedupeKey === row.dedupeKey) === index)
  if (!unique.length) return { created: 0, revived: 0, skipped: items.length }
  const existing = await database.inference.findMany({
    where: { userId, dedupeKey: { in: unique.map((row) => row.dedupeKey) } },
    select: { id: true, dedupeKey: true, status: true },
  })
  const byKey = new Map(existing.map((row) => [row.dedupeKey, row]))
  const fresh = unique.filter((row) => !byKey.has(row.dedupeKey))
  const revive = unique.filter((row) => row.status === 'active' && byKey.get(row.dedupeKey)?.status === 'stale')
  for (const row of revive) {
    const { userId: _userId, dedupeKey: _key, ...data } = row
    // eslint-disable-next-line no-await-in-loop
    await database.inference.updateMany({
      where: { id: byKey.get(row.dedupeKey).id, userId, status: 'stale' },
      data: { ...data, outcome: null, letteredAt: null, proposedIn: null },
    })
  }
  // 并发的另一次整理可能刚写了同一条：唯一约束兜底，撞上就算已有
  const created = fresh.length ? (await database.inference.createMany({ data: fresh, skipDuplicates: true })).count : 0
  return { created, revived: revive.length, skipped: items.length - created - revive.length }
}

/** 有效、没过期的组织层条目。kinds 缺省为全部。 */
export function listActiveInferences(userId, { kinds = INFERENCE_KINDS, now = new Date(), database = prisma, where = {} } = {}) {
  return database.inference.findMany({
    where: { userId, status: 'active', kind: { in: kinds }, ...notExpired(now), ...where },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  })
}

/** 依据里的这条根被改了意思：靠旧说法推出来的全部作废，不再进聊天、不再进信。 */
export function markStaleForMemory(database, userId, memoryId) {
  return database.inference.updateMany({
    where: { userId, status: 'active', basisMemoryIds: { has: memoryId } },
    data: { status: 'stale' },
  })
}

/** 根被删：以它为依据的条目连同引文一起删除（包括否决留下的去重键）。 */
export function deleteForMemories(database, userId, memoryIds) {
  if (!memoryIds.length) return { count: 0 }
  return database.inference.deleteMany({ where: { userId, basisMemoryIds: { hasSome: memoryIds } } })
}

/** 「她猜的」里删掉一条：内容与依据清空，只留去重键，她不会再推出同一条。 */
export async function vetoInference(userId, id) {
  const result = await prisma.inference.updateMany({
    where: { id: String(id ?? ''), userId, status: 'active' },
    data: { status: 'vetoed', content: '', payload: {}, basis: [] },
  })
  if (result.count === 0) throw new HttpError('这一条已经不在了', 404)
  return { success: true }
}

/** 写信用过的素材记一笔：下一封不再重复，但她的联想里照样还在。 */
export function markLettered(database, userId, ids, at = new Date()) {
  if (!ids.length) return { count: 0 }
  return database.inference.updateMany({ where: { userId, id: { in: ids } }, data: { letteredAt: at } })
}

/** 结束一条（问过 / 建议被采纳 / 不用）。 */
export function closeInferences(database, userId, ids, outcome, proposedIn = undefined) {
  if (!ids.length) return { count: 0 }
  return database.inference.updateMany({
    where: { userId, id: { in: ids }, status: 'active' },
    data: { status: 'closed', outcome, ...(proposedIn !== undefined ? { proposedIn } : {}) },
  })
}

const quotesOf = (basis) => (Array.isArray(basis) ? basis : [])
  .map((source) => (typeof source?.quote === 'string' ? source.quote.trim() : ''))
  .filter(Boolean)
  .slice(0, 2)

/** 「她猜的」：有效的都列出来，标明没经你确认；每条带至多两句依据原话。 */
export async function listForHer(userId, now = new Date()) {
  const rows = await listActiveInferences(userId, { now })
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    content: row.content,
    because: quotesOf(row.basis),
    dueOn: row.dueOn ? dayString(row.dueOn) : null,
    createdAt: row.createdAt,
  }))
}

// ── 惦记的事（followUpService 在此之上保留原来的接口） ──────────────────────

const asFollowUp = (row) => ({
  id: row.id,
  about: row.payload?.about ?? '',
  ask: row.payload?.ask ?? row.content,
  askOn: row.dueOn,
  createdAt: row.createdAt,
})

/** 还在惦记的：没问过、没过窗口。 */
export async function listFollowUpInferences(userId, now = new Date()) {
  const rows = await prisma.inference.findMany({
    where: { userId, kind: 'followup', status: 'active', dueOn: { gte: new Date(todayKey(now) - (FOLLOW_UP_WINDOW_DAYS - 1) * DAY_MS) } },
    orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
  })
  return rows.map(asFollowUp)
}

/** 到了日子：当天起三天内。 */
export async function listDueFollowUpInferences(userId, now = new Date()) {
  const today = todayKey(now)
  const rows = await prisma.inference.findMany({
    where: { userId, kind: 'followup', status: 'active', dueOn: { lte: new Date(today), gte: new Date(today - (FOLLOW_UP_WINDOW_DAYS - 1) * DAY_MS) } },
    orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
  })
  return rows.map(asFollowUp)
}

/** 今天已经问过的：北京时间今天零点（UTC 前一天 16:00）之后结束的。 */
export async function listAskedFollowUpsToday(userId, now = new Date()) {
  const rows = await prisma.inference.findMany({
    where: { userId, kind: 'followup', status: 'closed', outcome: 'asked', updatedAt: { gte: new Date(todayKey(now) - 8 * 60 * 60 * 1000) } },
    select: { content: true, payload: true },
  })
  return rows.map((row) => ({ ask: row.payload?.ask ?? row.content }))
}

/** 点了「知道了」：这件事问过了。 */
export async function markFollowUpAskedInference(userId, id) {
  const result = await prisma.inference.updateMany({
    where: { id: String(id ?? ''), userId, kind: 'followup', status: 'active' },
    data: { status: 'closed', outcome: 'asked' },
  })
  if (result.count === 0) {
    const existing = await prisma.inference.findFirst({ where: { id: String(id ?? ''), userId, kind: 'followup' }, select: { id: true } })
    if (!existing) throw new HttpError('这件事不存在', 404)
  }
  return { success: true }
}
