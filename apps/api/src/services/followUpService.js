/**
 * 她惦记的事：做梦时从聊天里记下的、过几天该问问你的事（「周三答辩」→「答辩怎么样了？」）。
 *
 * - 只在写信开着时产生、也只在那时出现；不需要你确认，她写信时会带上。
 * - 到了日子你来的时候，她在对话末尾问一句；你不来她就等着，不推送。三天后还没问就不再出现。
 * - askOn 是北京时间的日历日，UTC 零点存储（同日记的契约）。
 */
import prisma from '../prisma/client.js'
import { findOwned } from '../utils/dbHelpers.js'
import { localClock } from './contextBlocks.js'

const DAY_MS = 24 * 60 * 60 * 1000
export const FOLLOW_UP_WINDOW_DAYS = 3
export const MAX_FOLLOW_UPS_PER_DREAM = 2
export const FOLLOW_UP_LEAD_DAYS = 30

const normalize = (text) => String(text ?? '').normalize('NFKC').trim().replace(/\s+/g, '').toLowerCase()

/** 北京时间「今天」的 UTC 零点。 */
export const todayKey = (now = new Date()) => localClock(now).dayKey

/**
 * 存下做梦提出的待跟进：同一天、同一件事已经在惦记就不重复记；每次最多 2 条。
 * @param {{ about: string, ask: string, askOn: Date }[]} items 已经校验、过滤过的
 */
export async function saveFollowUps(userId, items = []) {
  const incoming = items.slice(0, MAX_FOLLOW_UPS_PER_DREAM)
  if (!incoming.length) return { created: 0, skipped: 0 }
  const existing = await prisma.followUp.findMany({
    where: { userId, status: 'active' },
    select: { about: true, askOn: true },
  })
  const seen = new Set(existing.map((item) => `${item.askOn.getTime()}|${normalize(item.about)}`))
  const data = []
  for (const item of incoming) {
    const key = `${item.askOn.getTime()}|${normalize(item.about)}`
    if (seen.has(key)) continue
    seen.add(key)
    data.push({ userId, about: item.about, ask: item.ask, askOn: item.askOn })
  }
  if (data.length) await prisma.followUp.createMany({ data })
  return { created: data.length, skipped: incoming.length - data.length }
}

/** 「她」页列的：还在惦记的（没问过、没过期）。 */
export function listFollowUps(userId, now = new Date()) {
  return prisma.followUp.findMany({
    where: { userId, status: 'active', askOn: { gte: new Date(todayKey(now) - (FOLLOW_UP_WINDOW_DAYS - 1) * DAY_MS) } },
    orderBy: { askOn: 'asc' },
    select: { id: true, about: true, ask: true, askOn: true, createdAt: true },
  })
}

/** 到了日子、写信开着：她在对话末尾问一句。askOn 当天起三天内。 */
export async function listDueFollowUps(userId, now = new Date()) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { letterFreqDays: true } })
  if (!user?.letterFreqDays) return []
  const today = todayKey(now)
  return prisma.followUp.findMany({
    where: {
      userId,
      status: 'active',
      askOn: { lte: new Date(today), gte: new Date(today - (FOLLOW_UP_WINDOW_DAYS - 1) * DAY_MS) },
    },
    orderBy: { askOn: 'asc' },
    select: { id: true, about: true, ask: true, askOn: true },
  })
}

/** 今天已经问过的：给她自己的上下文用，好让她接得上你的回答。 */
export function listAskedToday(userId, now = new Date()) {
  return prisma.followUp.findMany({
    where: { userId, status: 'asked', updatedAt: { gte: new Date(todayKey(now) - 8 * 60 * 60 * 1000) } },
    select: { ask: true },
  })
}

/** 点了「知道了」：这件事问过了。 */
export async function markFollowUpAsked(userId, id) {
  const followUp = await findOwned('followUp', id, userId, '这件事')
  await prisma.followUp.update({ where: { id: followUp.id }, data: { status: 'asked' } })
  return { success: true }
}
