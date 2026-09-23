/**
 * 用户数据导出服务：GET /api/export 的执行体。
 *
 * 「你的记忆归你」的可携带实现：单 JSON 包，含说话方式/显式记忆/对话与消息/日记/安排（含到点记录）/
 * 经期/阅读/工作台派生理解/记忆关系边/每周来信/妆容预设/衣柜单品元数据，全部限当前用户。
 * 已停用功能的历史照旧导出：角色扮演设定、日程、倒数日、旧提醒开关、手帐打卡、自习记录。
 * 不导出：refresh token（凭据，绝不外发）、危机日志（安全运维数据，非用户内容）、
 * 头像/背景等二进制资产（v1 边界，见用户手册）。
 * 日志只记 userId 与包内各节条目数，不记内容。
 */
import prisma from '../prisma/client.js'
import logger from '../utils/logger.js'
import { exportMemoryBundle } from './memoryTransferService.js'
import { WORK_ACTION_FIELDS } from './workActionService.js'

export const EXPORT_VERSION = 2

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
    collectionItems,
    memoryEdges,
    letters,
    workTasks,
    scheduledTasks,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        nickname: true,
        persona: true,
        roleName: true,
        roleSetting: true,
        companionState: true,
        companionRevision: true,
        birthDate: true,
        externalLlmConsent: true,
        externalLlmConsentVersion: true,
        periodConsentAt: true,
        periodToneAt: true,
        createdAt: true,
      },
    }),
    prisma.memory.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { type: true, content: true, importance: true, tags: true, origin: true, pinned: true, createdAt: true },
    }),
    prisma.conversation.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        title: true,
        mode: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { role: true, content: true, emotion: true, source: true, importance: true, toolRuns: true, companionExperience: true, imageExt: true, createdAt: true, workArtifacts: { select: { id: true, title: true, format: true, content: true, encoding: true, origin: true, sizeBytes: true, createdAt: true } } },
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
        format: true,
        totalPages: true,
        currentPage: true,
        percent: true,
        locator: true,
        createdAt: true,
        notes: { orderBy: { createdAt: 'asc' }, select: { content: true, page: true, quote: true, locator: true, aiComment: true, createdAt: true } },
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
    prisma.collectionItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { shelf: true, category: true, name: true, note: true, status: true, link: true, imageExt: true, createdAt: true, updatedAt: true },
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
      orderBy: { periodStart: 'asc' },
      select: { periodStart: true, freqDays: true, content: true, createdAt: true },
    }),
    prisma.workTask.findMany({
      where: { userId }, orderBy: { createdAt: 'asc' },
      select: { content: true, status: true, attachments: true, progress: true, errorCode: true, createdAt: true, completedAt: true,
        actions: { select: WORK_ACTION_FIELDS, orderBy: { createdAt: 'asc' } } },
    }),
    prisma.scheduledReminder.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        content: true, instruction: true, freq: true, time: true, fireAt: true, weekdays: true, monthDay: true,
        nextFireAt: true, status: true, createdAt: true, updatedAt: true,
        deliveries: { orderBy: { fireAt: 'asc' }, select: { fireAt: true, status: true, result: true, createdAt: true } },
      },
    }),
  ])

  const bundle = {
    version: EXPORT_VERSION,
    memoryBundle: await exportMemoryBundle(userId),
    exportedAt: new Date().toISOString(),
    product: 'Amie cyber-sister',
    companion: { revision: user?.companionRevision ?? 0, state: user?.companionState ?? null },
    // 导出用户提交及上传正文，不导出执行租约、幂等标识或模型检查点；导入不会重启任务。
    workTasks: workTasks.map((task) => ({ ...task, createdAt: iso(task.createdAt), completedAt: iso(task.completedAt) })),
    user: user
      ? {
          nickname: user.nickname,
          persona: user.persona,
          roleName: user.roleName,
          roleSetting: user.roleSetting,
          birthDate: iso(user.birthDate),
          externalLlmConsent: user.externalLlmConsent,
          externalLlmConsentVersion: user.externalLlmConsentVersion,
          // 经期的两项单独同意：记录，以及聊天时让她顾及周期
          periodConsentAt: iso(user.periodConsentAt),
          periodToneAt: iso(user.periodToneAt),
          createdAt: iso(user.createdAt),
        }
      : null,
    memories: memories.map((m) => ({
      type: m.type,
      content: m.content,
      importance: m.importance,
      tags: parseTags(m.tags),
      origin: m.origin,
      pinned: m.pinned === true,
      createdAt: iso(m.createdAt),
    })),
    conversations: conversations.map((c) => ({
      title: c.title,
      mode: c.mode,
      createdAt: iso(c.createdAt),
      updatedAt: iso(c.updatedAt),
      archivedAt: iso(c.archivedAt ?? null),
      messages: c.messages.map((m) => ({
        role: m.role,
        content: m.content,
        emotion: m.emotion,
        source: m.source,
        importance: m.importance,
        toolRuns: m.toolRuns ?? null,
        companionExperience: m.companionExperience ?? null,
        workArtifacts: (m.workArtifacts || []).map((artifact) => ({ ...artifact, createdAt: iso(artifact.createdAt) })),
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
    // 安排：调度字段原样导出（fireAt/nextFireAt 为绝对时刻），到点记录含她执行任务的产出
    scheduledTasks: scheduledTasks.map((t) => ({
      content: t.content,
      instruction: t.instruction ?? null,
      freq: t.freq,
      time: t.time,
      fireAt: iso(t.fireAt ?? null),
      weekdays: t.weekdays ?? [],
      monthDay: t.monthDay ?? null,
      nextFireAt: iso(t.nextFireAt),
      status: t.status,
      createdAt: iso(t.createdAt),
      updatedAt: iso(t.updatedAt),
      deliveries: (t.deliveries || []).map((d) => ({ fireAt: iso(d.fireAt), status: d.status, result: d.result ?? null, createdAt: iso(d.createdAt) })),
    })),
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
    // 书本身存在用户自己的浏览器里，导不出来；这里带走的是书目、进度与笔记
    books: books.map((b) => ({
      title: b.title,
      author: b.author,
      status: b.status,
      format: b.format,
      totalPages: b.totalPages,
      currentPage: b.currentPage,
      percent: b.percent,
      locator: b.locator,
      createdAt: iso(b.createdAt),
      notes: b.notes.map((n) => ({ content: n.content, page: n.page, quote: n.quote, locator: n.locator, aiComment: n.aiComment, createdAt: iso(n.createdAt) })),
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
    // 装扮里的收藏：照片同属二进制资产边界，只记有没有照片
    collection: collectionItems.map((item) => ({
      shelf: item.shelf,
      category: item.category ?? null,
      name: item.name,
      note: item.note ?? null,
      status: item.status,
      link: item.link ?? null,
      hasPhoto: Boolean(item.imageExt),
      createdAt: iso(item.createdAt),
      updatedAt: iso(item.updatedAt),
    })),
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
    letters: letters.map((l) => ({ periodStart: iso(l.periodStart), freqDays: l.freqDays, content: l.content, createdAt: iso(l.createdAt) })),
  }

  logger.info('用户数据导出', {
    userId,
    memories: bundle.memories.length,
    conversations: bundle.conversations.length,
    messages: bundle.conversations.reduce((sum, c) => sum + c.messages.length, 0),
    todos: bundle.todos.length,
    scheduledTasks: bundle.scheduledTasks.length,
    diaryEntries: bundle.diaryEntries.length,
    habits: bundle.habits.length,
    books: bundle.books.length,
    makeupPresets: bundle.makeupPresets.length,
    wardrobeItems: bundle.wardrobeItems.length,
    collection: bundle.collection.length,
    studySessions: bundle.studySessions.length,
    derivedInsights: bundle.derivedInsights.length,
    memoryEdges: bundle.memoryEdges.length,
    letters: bundle.letters.length,
  })
  return bundle
}
