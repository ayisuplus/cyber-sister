import { Prisma } from '@prisma/client'
import prisma from '../prisma/client.js'
import { localClock } from './contextBlocks.js'

/**
 * 「她这几天」：「她」页的一本手账，写她为你做过、有据可查的事，按北京时间的日子分组。
 *
 * 全部从已有记录拼出来、按模板写：不调模型，不另存一份，没有记录的事一个字不写。来源：
 * - 她的组织层：回想时猜了什么、连了哪两条记忆、记下了哪件惦记的事；你改过记忆后收起的、你删掉的；惦记的事到日子问过你的；
 * - 来信，以及信里的建议你采纳了还是没用；
 * - 记忆里你让她记下的；
 * - 聊天时她翻过的书（页边批注）；
 * - 花草图鉴里她帮你认过、你收进来的花草（只算认过的：你自己写名字收的不是她做的事）。
 * 回想跟着写信走（路线图 C23），写信关着时她不在你不在的时候整理，手账如实说明（lettersOn）。
 */
export const JOURNAL_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_QUOTE = 24
// 一天里「记下了」超过这么多条就合成一句，不刷屏
const MAX_REMEMBER_LINES = 3
const MAX_BOOKS_PER_DAY = 2
// 一天里认过的花草超过这么多株就合成一句
const MAX_PLANT_LINES = 2

const quote = (text) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > MAX_QUOTE ? `${clean.slice(0, MAX_QUOTE)}…` : clean
}
const dayOf = (date) => new Date(localClock(new Date(date)).dayKey).toISOString().slice(0, 10)
const countBy = (items, keyOf) => items.reduce((map, item) => map.set(keyOf(item), [...(map.get(keyOf(item)) ?? []), item]), new Map())
const latest = (items, field) => items.reduce((max, item) => (item[field] > max ? item[field] : max), items[0][field])

/** 你采纳了信里的哪种建议，手账里怎么说 */
const ACCEPTED = {
  edit_memory: '改了一条记忆',
  delete_memory: '删了一条记忆',
  plan: '把一件事排进了安排',
  merge_memories: '把两条记忆合成了一条',
  resolve_conflict: '定下了两条对不上的记忆',
  promote_inference: '把她猜的一件事记了下来',
}

function reflectionEntries(inferences, memoryText) {
  const produced = inferences.filter((row) => row.producedBy?.startsWith('reflection:'))
  return [...countBy(produced, (row) => dayOf(row.createdAt))].map(([, rows]) => {
    const byKind = countBy(rows, (row) => row.kind)
    const parts = []
    const insights = byKind.get('insight')?.length ?? 0
    const relations = byKind.get('relation') ?? []
    const followups = byKind.get('followup')?.length ?? 0
    if (insights) parts.push(`猜了 ${insights} 件事`)
    if (relations.length) {
      const [first] = relations
      const from = memoryText.get(first.payload?.fromMemoryId)
      const to = memoryText.get(first.payload?.toMemoryId)
      parts.push(relations.length === 1 && from && to ? `把「${quote(from)}」和「${quote(to)}」连在了一起` : `把 ${relations.length} 对记忆连了起来`)
    }
    if (followups) parts.push(`记下了 ${followups} 件她惦记的事`)
    return { kind: 'reflect', at: latest(rows, 'createdAt'), text: `回想了你最近说的话，${parts.join('，')}。` }
  })
}

function tidyEntries(inferences, since) {
  const recent = (status) => inferences.filter((row) => row.status === status && row.updatedAt >= since)
  const entries = []
  for (const [, rows] of countBy(recent('stale'), (row) => dayOf(row.updatedAt))) {
    entries.push({ kind: 'tidy', at: latest(rows, 'updatedAt'), text: `你改过记忆之后，她把靠旧说法猜的 ${rows.length} 件事收起来了。` })
  }
  for (const [, rows] of countBy(recent('vetoed'), (row) => dayOf(row.updatedAt))) {
    entries.push({ kind: 'tidy', at: latest(rows, 'updatedAt'), text: `你说她猜错了 ${rows.length} 件，她记下了，不会再这样猜。` })
  }
  for (const row of inferences) {
    if (row.kind !== 'followup' || row.outcome !== 'asked' || row.updatedAt < since) continue
    const about = row.payload?.about
    entries.push({ kind: 'ask', at: row.updatedAt, text: about ? `记得你说过「${quote(about)}」，那天问了你一句。` : '记得你说过的一件事，那天问了你一句。' })
  }
  return entries
}

function letterEntries(letters, since) {
  const entries = []
  for (const letter of letters) {
    const suggestions = Array.isArray(letter.suggestions) ? letter.suggestions : []
    if (letter.createdAt >= since) {
      entries.push({ kind: 'letter', at: letter.createdAt, text: `给你写了一封信${suggestions.length ? `，里面有 ${suggestions.length} 条建议` : ''}。` })
    }
    // 处理时间 decidedAt 自 2026-09-26 起记下；更早处理的没有时间，不写进手账
    const decided = suggestions.filter((item) => item?.decidedAt && new Date(item.decidedAt) >= since)
    for (const item of decided.filter((entry) => entry.decided === 'accepted')) {
      entries.push({ kind: 'decide', at: new Date(item.decidedAt), text: `你采纳了她在信里的建议，${ACCEPTED[item.kind] ?? '改了一处'}。` })
    }
    for (const [, rows] of countBy(decided.filter((entry) => entry.decided === 'dismissed'), (item) => dayOf(item.decidedAt))) {
      entries.push({ kind: 'decide', at: new Date(latest(rows, 'decidedAt')), text: `信里有 ${rows.length} 条建议你没用，她知道了。` })
    }
  }
  return entries
}

function rememberEntries(memories) {
  const entries = []
  for (const [, rows] of countBy(memories, (memory) => dayOf(memory.createdAt))) {
    const imported = rows.filter((memory) => memory.origin === 'import')
    const told = rows.filter((memory) => memory.origin === 'manual' || memory.origin === 'suggestion')
    if (imported.length) entries.push({ kind: 'remember', at: latest(imported, 'createdAt'), text: `从你带来的迁移包里记下了 ${imported.length} 条。` })
    if (told.length > MAX_REMEMBER_LINES) {
      entries.push({ kind: 'remember', at: latest(told, 'createdAt'), text: `记下了你说的 ${told.length} 件事，比如「${quote(told[0].content)}」。` })
      continue
    }
    for (const memory of told) {
      entries.push({ kind: 'remember', at: memory.createdAt, text: memory.origin === 'suggestion' ? `记住了你说的「${quote(memory.content)}」。` : `你告诉她「${quote(memory.content)}」，她记下了。` })
    }
  }
  return entries
}

/** 一天里翻过的书：书名 → 章名（去重，保持先后） */
function booksOf(messages) {
  const books = new Map()
  const notes = messages.flatMap((message) => (Array.isArray(message.bookNotes) ? message.bookNotes : []))
  for (const note of notes) {
    const title = note?.title ?? note?.book
    if (!title) continue
    const chapters = books.get(title) ?? new Set()
    for (const chapter of note.chapters ?? []) if (chapter?.title) chapters.add(chapter.title)
    books.set(title, chapters)
  }
  return books
}

function bookEntries(messages) {
  const entries = []
  for (const [, rows] of countBy(messages, (message) => dayOf(message.createdAt))) {
    const books = booksOf(rows)
    if (!books.size) continue
    const named = [...books].slice(0, MAX_BOOKS_PER_DAY).map(([title, chapters]) => `《${title}》${[...chapters].slice(0, 2).map((chapter) => `「${chapter}」`).join('')}`)
    const more = books.size > MAX_BOOKS_PER_DAY ? `等 ${books.size} 本书` : ''
    entries.push({ kind: 'book', at: latest(rows, 'createdAt'), text: `聊天时翻了${named.join('、')}${more}。` })
  }
  return entries
}

function plantEntries(plants) {
  const entries = []
  for (const [, rows] of countBy(plants, (plant) => dayOf(plant.createdAt))) {
    if (rows.length > MAX_PLANT_LINES) {
      entries.push({ kind: 'plant', at: latest(rows, 'createdAt'), text: `帮你认了 ${rows.length} 株花草，比如「${quote(rows[0].name)}」，你都收进了图鉴。` })
      continue
    }
    for (const plant of rows) entries.push({ kind: 'plant', at: plant.createdAt, text: `帮你认了「${quote(plant.name)}」，你把它收进了图鉴。` })
  }
  return entries
}

/**
 * 最近 days 天（含今天，北京时间）的手账：{ days: [{ date, entries: [{ kind, at, text }] }], lettersOn, windowDays }。
 * 日子从近到远，一天里按时间先后。kind：reflect | letter | decide | tidy | ask | remember | book | plant。
 */
export async function loadJournal(userId, { now = new Date(), days = JOURNAL_DAYS, database = prisma } = {}) {
  const firstDayKey = localClock(now).dayKey - (days - 1) * DAY_MS
  // 多取一天再按北京时间的日子筛：查询条件只要不漏
  const since = new Date(firstDayKey - DAY_MS)
  const [user, inferences, letters, memories, messages, plants] = await Promise.all([
    database.user.findUnique({ where: { id: userId }, select: { letterFreqDays: true } }),
    database.inference.findMany({
      where: { userId, OR: [{ createdAt: { gte: since } }, { updatedAt: { gte: since } }] },
      select: { kind: true, status: true, outcome: true, producedBy: true, payload: true, createdAt: true, updatedAt: true },
    }),
    database.letter.findMany({ where: { userId, OR: [{ createdAt: { gte: since } }, { updatedAt: { gte: since } }] }, select: { createdAt: true, suggestions: true } }),
    database.memory.findMany({ where: { userId, createdAt: { gte: since } }, select: { content: true, origin: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
    database.message.findMany({
      where: { role: 'assistant', createdAt: { gte: since }, bookNotes: { not: Prisma.DbNull }, conversation: { userId } },
      select: { bookNotes: true, createdAt: true },
    }),
    database.plantEntry.findMany({
      where: { userId, createdAt: { gte: since }, promptVersion: { not: null } },
      select: { name: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ])
  // 回想里连起来的那一对：只为每天第一条关系查一次正文
  const pairIds = inferences.filter((row) => row.kind === 'relation' && row.producedBy?.startsWith('reflection:'))
    .flatMap((row) => [row.payload?.fromMemoryId, row.payload?.toMemoryId]).filter(Boolean)
  const linked = pairIds.length
    ? await database.memory.findMany({ where: { userId, id: { in: [...new Set(pairIds)] } }, select: { id: true, content: true } })
    : []
  const memoryText = new Map(linked.map((memory) => [memory.id, memory.content]))

  const inWindow = (entry) => localClock(new Date(entry.at)).dayKey >= firstDayKey
  const entries = [
    ...reflectionEntries(inferences, memoryText),
    ...tidyEntries(inferences, since),
    ...letterEntries(letters, since),
    ...rememberEntries(memories),
    ...bookEntries(messages),
    ...plantEntries(plants),
  ].filter(inWindow)

  const byDay = countBy(entries, (entry) => dayOf(entry.at))
  return {
    windowDays: days,
    lettersOn: Boolean(user?.letterFreqDays),
    days: [...byDay.keys()].sort().reverse().map((date) => ({
      date,
      entries: byDay.get(date).sort((a, b) => new Date(a.at) - new Date(b.at)).map(({ kind, at, text }) => ({ kind, at: new Date(at).toISOString(), text })),
    })),
  }
}
