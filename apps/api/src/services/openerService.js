/**
 * 开场话题：空白对话第一屏摆出来的那几条，从她自己的线索里来——
 * 她惦记的事、你在读的那本书、你最近写下的手记。
 *
 * - 只读、不发模型、不落库；同一份数据两次调用结果一致（不随机、不按时间抽签），便于测试。
 * - 手记是你自己写下的私密文字：从它来的那条只填进输入框（draft），绝不替你开口。
 * - 某一处读不到就当作没有这条，整片不失败；三处都空就返回空数组，前端用本机静态池兜底。
 */
import * as followUpService from './followUpService.js'
import * as readingService from './readingService.js'
import prisma from '../prisma/client.js'
import logger from '../utils/logger.js'

export const MAX_OPENERS = 4
const LABEL_MAX = 14
// 书名在 label 里还要占两边的《》
const BOOK_LABEL_TITLE_MAX = LABEL_MAX - 2
const BOOK_TITLE_MAX = 30
const NOTE_LINE_MAX = 40
const TEXT_MAX = 60

// 「为什么看到这条」：如实写出来源。她不出声、不加推送，这里也不说情感诱导的话。
const WHY = { followUp: '你之前说过这件事', book: '你正在读这本', note: '你最近写下的一行' }

/** 压成一行、去掉多余空白，最多 max 个字（含结尾的省略号）。 */
function clip(text, max) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  const chars = [...flat]
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : flat
}

/** 一处读不到就当作没有这条：开场话题不能因为某个来源出错而整片失败。 */
async function readOrNone(source, read) {
  try {
    const items = await read()
    return Array.isArray(items) ? items : []
  } catch (error) {
    logger.warn('开场话题的来源没读到', { source, error: error.message })
    return []
  }
}

const followUpOpener = (item) => {
  const text = clip(item.ask, TEXT_MAX)
  if (!text) return null
  return {
    id: `followup:${item.id}`,
    label: clip(`惦记的：${item.about}`, LABEL_MAX),
    text,
    why: WHY.followUp,
  }
}

const bookOpener = (book) => {
  const title = clip(book?.title, BOOK_TITLE_MAX)
  if (!title) return null
  return {
    id: `book:${book.id}`,
    label: `《${clip(book.title, BOOK_LABEL_TITLE_MAX)}》`,
    text: `我在读《${title}》，想跟你聊聊这本书`,
    why: WHY.book,
  }
}

/** 手记只取第一行：正文是你自己的话，不改写、不自动发出去。 */
const noteOpener = (note) => {
  const line = clip(String(note?.content ?? '').split(/[\r\n]+/)[0], NOTE_LINE_MAX)
  if (!line) return null
  return {
    id: `note:${note.id}`,
    label: '上次记的那句',
    text: `上次我记下的那句我还想着：${line}`,
    draft: true,
    why: WHY.note,
  }
}

/**
 * 空对话那一屏的话题候选，最多 4 条。
 * 优先级：到日子（或已过期）的「她惦记的事」→ 其它「她惦记的事」→ 在读的那本书 → 最近一条手记。
 * 「她惦记的事」是她回想时记下来的：不写信就不再提（与对话里那条口径一致），只留书与手记。
 */
export async function listOpeners(userId, now = new Date()) {
  const [followUps, books, notes] = await Promise.all([
    readOrNone('followups', async () => {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { letterFreqDays: true } })
      if (!user?.letterFreqDays) return []
      return followUpService.listFollowUps(userId, now)
    }),
    readOrNone('books', () => readingService.listBooks(userId)),
    readOrNone('notes', () => readingService.listRecentNotes(userId, { limit: 1 })),
  ])

  const today = followUpService.todayKey(now)
  const due = (item) => new Date(item.askOn ?? 0).getTime() <= today
  // 书架按 updatedAt 倒序来：第一条在读的就是最近翻过的那本
  const candidates = [
    ...followUps.filter(due).map(followUpOpener),
    ...followUps.filter((item) => !due(item)).map(followUpOpener),
    bookOpener(books.find((book) => book?.status === 'reading')),
    noteOpener(notes[0]),
  ].filter(Boolean)

  const seen = new Set()
  const openers = []
  for (const opener of candidates) {
    if (seen.has(opener.id)) continue
    seen.add(opener.id)
    openers.push(opener)
    if (openers.length === MAX_OPENERS) break
  }
  return openers
}
