/**
 * 她惦记的事：她回想时从聊天里记下的、过几天该问问你的事（「周三答辩」→「答辩怎么样了？」）。
 *
 * - 是她的组织层（inferences，kind=followup），不是记忆：依据必须是你说过的原话（她自己说的不算）。
 * - 只在写信开着时产生、也只在那时出现；你能在「她猜的」里看到、删掉（路线图 C23）。
 * - 到了日子你来的时候，她在对话末尾问一句；你不来她就等着，不推送。三天后还没问就不再出现。
 * - 哪天问（askOn）是北京时间的日历日，UTC 零点存储（同日记的契约）。
 * 这里保留原来的接口，存取都交给 memory/inferenceService.js。
 */
import prisma from '../prisma/client.js'
import {
  FOLLOW_UP_WINDOW_DAYS, listAskedFollowUpsToday, listDueFollowUpInferences, listFollowUpInferences,
  markFollowUpAskedInference, saveInferences, todayKey,
} from './memory/inferenceService.js'

export { FOLLOW_UP_WINDOW_DAYS, todayKey }
export const MAX_FOLLOW_UPS_PER_DREAM = 2
export const FOLLOW_UP_LEAD_DAYS = 30

/**
 * 存下回想提出的惦记的事：同一天、同一件事已经记过（包括你删掉的）就不重复；每次最多 2 条。
 * @param {{ about: string, ask: string, askOn: Date, basis?: object[] }[]} items 已经校验、过滤过的
 */
export function saveFollowUps(userId, items = [], { producedBy = 'reflection', database = prisma } = {}) {
  const incoming = items.slice(0, MAX_FOLLOW_UPS_PER_DREAM).map((item) => ({
    kind: 'followup',
    content: item.ask,
    payload: { about: item.about, ask: item.ask },
    basis: item.basis ?? [],
    dueOn: item.askOn,
    expiresAt: new Date(item.askOn.getTime() + FOLLOW_UP_WINDOW_DAYS * 24 * 60 * 60 * 1000),
  }))
  if (!incoming.length) return Promise.resolve({ created: 0, skipped: 0 })
  return saveInferences(userId, incoming, { producedBy, database })
}

/** 「她」页与开场话题用的：还在惦记的（没问过、没过期）。 */
export const listFollowUps = (userId, now = new Date()) => listFollowUpInferences(userId, now)

/** 到了日子、写信开着：她在对话末尾问一句。askOn 当天起三天内。 */
export async function listDueFollowUps(userId, now = new Date()) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { letterFreqDays: true } })
  if (!user?.letterFreqDays) return []
  return listDueFollowUpInferences(userId, now)
}

/** 今天已经问过的：给她自己的上下文用，好让她接得上你的回答。 */
export const listAskedToday = (userId, now = new Date()) => listAskedFollowUpsToday(userId, now)

/** 点了「知道了」：这件事问过了。 */
export const markFollowUpAsked = (userId, id) => markFollowUpAskedInference(userId, id)
