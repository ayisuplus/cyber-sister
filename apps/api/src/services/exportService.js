/**
 * 用户数据导出服务：GET /api/export 的执行体。
 *
 * 「你的记忆归你」的可携带实现：单 JSON 包，含人格/角色扮演/显式记忆/
 * 对话与消息/日记/手帐打卡/日程/倒数日/经期/提醒/阅读/自习/工作台派生理解/记忆关系边/每周来信/妆容预设/衣柜单品元数据，全部限当前用户。
 * 不导出：refresh token（凭据，绝不外发）、危机日志（安全运维数据，非用户内容）、
 * 头像/背景等二进制资产（v1 边界，见用户手册）。
 * 日志只记 userId 与包内各节条目数，不记内容。
 */
import prisma from '../prisma/client.js'
import logger from '../utils/logger.js'

export const EXPORT_VERSION = 1

const iso = (date) => (date instanceof Date ? date.toISOString() : date)

function parseTags(tags) {
  if (Array.isArray(tags)) return tags
  if (typeof tags !== 'string' || !tags.trim()) return []
  try {
    const parsed = JSON.parse(tags)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return tags.split(/[,，、]/).filter(Boolean)
  }
}

export async function buildUserExport(userId) {
  const [
    user,
    memories,
    conversations,
    todos,
    countdowns,
    periodRecords,
    reminders,
    diaryEntries,
    habits,
    books,
    studySessions,
    derivedInsights,
    makeupPresets,
    wardrobeItems,
    memoryEdges,
    letters,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        nickname: true,
        persona: true,
        roleName: true,
        roleSetting: true,
        birthDate: true,
        externalLlmConsent: true,
        externalLlmConsentVersion: true,
        createdAt: true,
      },
    }),
    prisma.memory.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { type: true, content: true, importance: true, tags: true, origin: true, createdAt: true },
    }),
    prisma.conversation.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        title: true,
        mode: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { role: true, content: true, emotion: true, source: true, importance: true, toolRuns: true, imageExt: true, createdAt: true },
        },
      },
    }),
    prisma.todo.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { content: true, dueDate: true, dueTime: true, isDone: true, createdAt: true },
    }),
    prisma.countdown.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { title: true, targetDate: true, createdAt: true },
    }),
    prisma.periodRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { startDate: true, endDate: true, cycleDays: true, createdAt: true },
    }),
    prisma.reminder.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { type: true, time: true, isActive: true },
    }),
    prisma.diaryEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { day: true, mood: true, content: true, aiComment: true, aiCommentSource: true, createdAt: true, updatedAt: true },
    }),
    prisma.habit.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        name: true,
        icon: true,
        createdAt: true,
        checkins: { orderBy: { day: 'asc' }, select: { day: true, createdAt: true } },
      },
    }),
    prisma.book.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        title: true,
        author: true,
        status: true,
        createdAt: true,
        notes: { orderBy: { createdAt: 'asc' }, select: { content: true, aiComment: true, createdAt: true } },
      },
    }),
    prisma.studySession.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { subject: true, plannedMinutes: true, actualMinutes: true, note: true, aiComment: true, aiCommentSource: true, startedAt: true, createdAt: true },
    }),
    prisma.derivedInsight.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { kind: true, content: true, evidence: true, confidence: true, status: true, resolution: true, createdAt: true },
    }),
    prisma.makeupPreset.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { name: true, smooth: true, whiten: true, slim: true, eye: true, createdAt: true, updatedAt: true },
    }),
    prisma.wardrobeItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { name: true, createdAt: true },
    }),
    prisma.memoryEdge.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        relation: true,
        confidence: true,
        status: true,
        createdAt: true,
        fromMemory: { select: { content: true } },
        toMemory: { select: { content: true } },
      },
    }),
    prisma.letter.findMany({
      where: { userId },
      orderBy: { weekStart: 'asc' },
      select: { weekStart: true, content: true, createdAt: true },
    }),
  ])

  const bundle = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    product: 'Amie cyber-sister',
    user: user
      ? {
          nickname: user.nickname,
          persona: user.persona,
          roleName: user.roleName,
          roleSetting: user.roleSetting,
          birthDate: iso(user.birthDate),
          externalLlmConsent: user.externalLlmConsent,
          externalLlmConsentVersion: user.externalLlmConsentVersion,
          createdAt: iso(user.createdAt),
        }
      : null,
    memories: memories.map((m) => ({
      type: m.type,
      content: m.content,
      importance: m.importance,
      tags: parseTags(m.tags),
      origin: m.origin,
      createdAt: iso(m.createdAt),
    })),
    conversations: conversations.map((c) => ({
      title: c.title,
      mode: c.mode,
      createdAt: iso(c.createdAt),
      updatedAt: iso(c.updatedAt),
      messages: c.messages.map((m) => ({
        role: m.role,
        content: m.content,
        emotion: m.emotion,
        source: m.source,
        importance: m.importance,
        toolRuns: m.toolRuns ?? null,
        hasImage: Boolean(m.imageExt),
        createdAt: iso(m.createdAt),
      })),
    })),
    todos: todos.map((t) => ({
      content: t.content,
      dueDate: iso(t.dueDate),
      dueTime: t.dueTime,
      isDone: t.isDone,
      createdAt: iso(t.createdAt),
    })),
    countdowns: countdowns.map((c) => ({ title: c.title, targetDate: iso(c.targetDate), createdAt: iso(c.createdAt) })),
    periodRecords: periodRecords.map((p) => ({
      startDate: iso(p.startDate),
      endDate: iso(p.endDate),
      cycleDays: p.cycleDays,
      createdAt: iso(p.createdAt),
    })),
    reminders: reminders.map((r) => ({ type: r.type, time: r.time, isActive: r.isActive })),
    diaryEntries: diaryEntries.map((d) => ({
      day: iso(d.day),
      mood: d.mood,
      content: d.content,
      aiComment: d.aiComment,
      aiCommentSource: d.aiCommentSource,
      createdAt: iso(d.createdAt),
      updatedAt: iso(d.updatedAt),
    })),
    habits: habits.map((h) => ({
      name: h.name,
      icon: h.icon,
      createdAt: iso(h.createdAt),
      checkins: h.checkins.map((c) => ({ day: iso(c.day), createdAt: iso(c.createdAt) })),
    })),
    books: books.map((b) => ({
      title: b.title,
      author: b.author,
      status: b.status,
      createdAt: iso(b.createdAt),
      notes: b.notes.map((n) => ({ content: n.content, aiComment: n.aiComment, createdAt: iso(n.createdAt) })),
    })),
    studySessions: studySessions.map((s) => ({
      subject: s.subject,
      plannedMinutes: s.plannedMinutes,
      actualMinutes: s.actualMinutes,
      note: s.note,
      aiComment: s.aiComment,
      aiCommentSource: s.aiCommentSource,
      startedAt: iso(s.startedAt),
      createdAt: iso(s.createdAt),
    })),
    makeupPresets: makeupPresets.map((p) => ({
      name: p.name,
      smooth: p.smooth,
      whiten: p.whiten,
      slim: p.slim,
      eye: p.eye,
      createdAt: iso(p.createdAt),
      updatedAt: iso(p.updatedAt),
    })),
    // 衣柜只导出单品元数据：照片与 GLB 属 v1 二进制资产边界（同头像/背景），不落导出包
    wardrobeItems: wardrobeItems.map((w) => ({ name: w.name, createdAt: iso(w.createdAt) })),
    derivedInsights: derivedInsights.map((d) => ({
      kind: d.kind,
      content: d.content,
      evidence: parseTags(d.evidence),
      confidence: d.confidence,
      status: d.status,
      resolution: d.resolution ?? null,
      createdAt: iso(d.createdAt),
    })),
    // 关系边按内容引用导出（id 不可携带）；derived/dismissed 草稿一并如实导出，状态字段自证
    memoryEdges: memoryEdges.map((e) => ({
      from: e.fromMemory.content,
      to: e.toMemory.content,
      relation: e.relation,
      confidence: e.confidence,
      status: e.status,
      createdAt: iso(e.createdAt),
    })),
    letters: letters.map((l) => ({ weekStart: iso(l.weekStart), content: l.content, createdAt: iso(l.createdAt) })),
  }

  logger.info('用户数据导出', {
    userId,
    memories: bundle.memories.length,
    conversations: bundle.conversations.length,
    messages: bundle.conversations.reduce((sum, c) => sum + c.messages.length, 0),
    todos: bundle.todos.length,
    diaryEntries: bundle.diaryEntries.length,
    habits: bundle.habits.length,
    books: bundle.books.length,
    makeupPresets: bundle.makeupPresets.length,
    wardrobeItems: bundle.wardrobeItems.length,
    studySessions: bundle.studySessions.length,
    derivedInsights: bundle.derivedInsights.length,
    memoryEdges: bundle.memoryEdges.length,
    letters: bundle.letters.length,
  })
  return bundle
}
