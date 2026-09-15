/**
 * 「她的信」接口：既有信件只读；新来信仅返回模拟预览，不读取周记录或自动落库。
 * 原有纯函数保留作为历史模板的校验工具，不被当前生成或列表入口调用。
 */
import prisma from '../prisma/client.js'
import { findOwned } from '../utils/dbHelpers.js'
import { WORK_CLOUD_EXECUTION } from './workCloudService.js'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_QUOTED_ITEMS = 3
const MAX_QUOTED_EDGES = 2
const RELATION_LABELS = { similar: '相似', related: '相关', contradicts: '冲突' }
const MOOD_LABELS = { happy: '开心', neutral: '平静', sad: '难过', angry: '生气', anxious: '焦虑' }
const HEAVY_MOODS = ['sad', 'angry', 'anxious']
const UPCOMING_DAYS = 14

const localDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

/** 本地周（周一起）的起始日，按 UTC 零点表示（同日记/经期存储契约）。 */
export function localWeekStartUtc(now = new Date()) {
  const dayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const weekday = (now.getDay() + 6) % 7 // 周一 = 0
  return new Date(dayUtc - weekday * DAY_MS)
}

const quoteList = (items) => items.map((item) => `「${item}」`).join('')

/** 收集本周数据快照（导出供测试与生成复用）：聊天与记忆、日记心情、读书笔记、做完的安排。 */
export async function collectWeekStats(userId, weekStartUtc, now = new Date()) {
  const doneThisWeek = { userId, status: 'done', updatedAt: { gte: weekStartUtc } }
  const [
    messageCount,
    newMemories,
    memoryCount,
    promotedCount,
    canonicalEdges,
    edgeCount,
    diaryEntries,
    readingNoteCount,
    doneTasks,
    doneTaskCount,
    upcomingTask,
  ] = await Promise.all([
    prisma.message.count({ where: { conversation: { userId }, role: 'user', createdAt: { gte: weekStartUtc } } }),
    prisma.memory.findMany({
      where: { userId, createdAt: { gte: weekStartUtc } },
      orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
      take: MAX_QUOTED_ITEMS,
      select: { content: true },
    }),
    prisma.memory.count({ where: { userId, createdAt: { gte: weekStartUtc } } }),
    prisma.derivedInsight.count({
      where: { userId, status: { in: ['promoted', 'resolved'] }, updatedAt: { gte: weekStartUtc } },
    }),
    prisma.memoryEdge.findMany({
      where: { userId, status: 'canonical', updatedAt: { gte: weekStartUtc } },
      orderBy: { updatedAt: 'desc' },
      take: MAX_QUOTED_EDGES,
      select: { fromMemoryId: true, toMemoryId: true, relation: true },
    }),
    prisma.memoryEdge.count({ where: { userId, status: 'canonical', updatedAt: { gte: weekStartUtc } } }),
    prisma.diaryEntry.findMany({ where: { userId, day: { gte: weekStartUtc } }, select: { mood: true } }),
    prisma.readingNote.count({ where: { userId, createdAt: { gte: weekStartUtc } } }),
    prisma.scheduledReminder.findMany({
      where: doneThisWeek,
      orderBy: { updatedAt: 'desc' },
      take: MAX_QUOTED_ITEMS,
      select: { content: true },
    }),
    prisma.scheduledReminder.count({ where: doneThisWeek }),
    // 往前看：两周内最近的一个日子（交给她执行的任务不算）
    prisma.scheduledReminder.findFirst({
      where: {
        userId, status: 'active', instruction: null, freq: { in: ['once', 'yearly'] },
        nextFireAt: { gte: now, lte: new Date(now.getTime() + UPCOMING_DAYS * DAY_MS) },
      },
      orderBy: { nextFireAt: 'asc' },
      select: { content: true, nextFireAt: true },
    }),
  ])

  const edgeMemoryIds = [...new Set(canonicalEdges.flatMap((edge) => [edge.fromMemoryId, edge.toMemoryId]))]
  const edgeMemories = edgeMemoryIds.length > 0
    ? await prisma.memory.findMany({ where: { id: { in: edgeMemoryIds } }, select: { id: true, content: true } })
    : []
  const contentById = new Map(edgeMemories.map((memory) => [memory.id, memory.content]))
  const edges = canonicalEdges
    .filter((edge) => contentById.has(edge.fromMemoryId) && contentById.has(edge.toMemoryId))
    .map((edge) => ({
      from: contentById.get(edge.fromMemoryId),
      to: contentById.get(edge.toMemoryId),
      relation: edge.relation,
    }))

  const moodCounts = {}
  for (const entry of diaryEntries) {
    moodCounts[entry.mood] = (moodCounts[entry.mood] || 0) + 1
  }

  return {
    messageCount,
    memoryCount,
    memoryContents: newMemories.map((memory) => memory.content),
    promotedCount,
    edgeCount,
    edges,
    moodCounts,
    diaryDays: diaryEntries.length,
    readingNoteCount,
    doneTaskCount,
    doneTaskContents: doneTasks.map((task) => task.content),
    upcomingTask,
  }
}

/** 沉默周判定：本周无任何可写的事。 */
export function isQuietWeek(stats) {
  return stats.messageCount === 0
    && stats.memoryCount === 0
    && stats.diaryDays === 0
    && stats.readingNoteCount === 0
    && stats.doneTaskCount === 0
}

/** 纯函数组信：只写有数据支撑的段落。 */
export function composeLetter({ nickname, stats, now = new Date() }) {
  const paragraphs = [nickname?.trim() ? `${nickname.trim()}，见信好。` : '见信好。']

  const chatAndMemory = []
  chatAndMemory.push(stats.messageCount > 0 ? `这周你们聊了 ${stats.messageCount} 轮` : '这周你们没怎么聊，没关系，我一直在')
  if (stats.memoryCount > 0) {
    const quoted = quoteList(stats.memoryContents)
    chatAndMemory.push(`新记下了 ${stats.memoryCount} 件事：${quoted}${stats.memoryCount > MAX_QUOTED_ITEMS ? '，等等' : ''}`)
  }
  if (stats.promotedCount > 0) {
    chatAndMemory.push(`待确认里有 ${stats.promotedCount} 条理解被你定了下来`)
  }
  if (stats.edgeCount > 0 && stats.edges.length > 0) {
    const pairs = stats.edges
      .map((edge) => `「${edge.from}」—${RELATION_LABELS[edge.relation] || edge.relation}→「${edge.to}」`)
      .join('，')
    chatAndMemory.push(`你还确认了 ${stats.edgeCount} 条关系：${pairs}`)
  }
  paragraphs.push(chatAndMemory.join('；') + '。')

  const life = []
  if (stats.doneTaskCount > 0) {
    const quoted = quoteList(stats.doneTaskContents)
    life.push(`这周做完了 ${stats.doneTaskCount} 件安排：${quoted}${stats.doneTaskCount > MAX_QUOTED_ITEMS ? '，等等' : ''}`)
  }
  if (stats.readingNoteCount > 0) {
    life.push(`读书记了 ${stats.readingNoteCount} 条笔记`)
  }
  if (life.length > 0) paragraphs.push(life.join('；') + '。')

  const moodParts = Object.entries(stats.moodCounts)
    .filter(([, count]) => count > 0)
    .map(([mood, count]) => `${MOOD_LABELS[mood] || mood} ${count} 天`)
  if (moodParts.length > 0) {
    let moodLine = `心情上：${moodParts.join('、')}`
    if (HEAVY_MOODS.some((mood) => stats.moodCounts[mood] > 0)) {
      moodLine += '。不太好的时候，想说的时候我都在'
    }
    paragraphs.push(moodLine + '。')
  }

  if (stats.upcomingTask) {
    const days = Math.max(0, Math.round((localDay(new Date(stats.upcomingTask.nextFireAt)) - localDay(now)) / DAY_MS))
    paragraphs.push(`往前看：「${stats.upcomingTask.content}」${days === 0 ? '就是今天' : `还有 ${days} 天`}，稳稳推进就好。`)
  }

  paragraphs.push('—— 你的姐妹')
  return paragraphs.join('\n\n')
}

/** 云端尚未接入：只提供明确标注的接口示例，信箱不产生新记录。 */
// eslint-disable-next-line require-await -- 保持未来云端适配器的 Promise 契约。
export async function generateWeeklyLetter(userId, options = {}) {
  void userId; void options
  return {
    letter: null, created: false, reason: 'cloud_mock',
    preview: { content: '【模拟来信】见信好。这里将整理这一周值得回看的小事。云端尚未接入，这封示例没有读取你的记录，也不会存入信箱。' },
    execution: { ...WORK_CLOUD_EXECUTION },
  }
}

/** 仅读取本人既有来信（新到旧），GET 不生成或写入。 */
export function listLetters(userId) {
  return prisma.letter.findMany({
    where: { userId },
    orderBy: { weekStart: 'desc' },
  })
}

/** 读取一封来信（非本人抛 404）。 */
export async function getLetter(userId, id) {
  return findOwned('letter', id, userId, '信件')
}
