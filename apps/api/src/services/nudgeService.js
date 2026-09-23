/**
 * 她主动说的话，只有对话这一个出口。
 *
 * 四处来源合成一条时间线：到点的安排提醒、她惦记的事（写信开着时）、「她来想你」的关心、她的来信。
 * 没有推送通道——用户打开对话时才拉取；每条都说得清为什么会出现，也都能一句「知道了」收起。
 * 她主动说的（惦记的事 → 关心 → 信）一天至多三条，已经问过、点过的也占位；你自己定的到点提醒不算在内。
 * 任何一处出问题都不该让对话打不开：单个来源失败就当这次没有，记一条日志。
 */
import { ackDelivery, listDueReminders, listTodaysDeliveries } from './reminderService.js'
import { dismissTouchpoint, listTodaysCare } from './careService.js'
import { findLatestLetter, generateDueLetter } from './letterService.js'
import { listAskedToday, listDueFollowUps, markFollowUpAsked } from './followUpService.js'
import { HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'

const FREQ_LABELS = { once: '一次', daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' }
const MAX_UNPROMPTED_PER_DAY = 3

// task 可以是 promise，也可以是返回 promise 的函数（函数里同步抛出的错误也兜得住）
const settled = async (label, userId, task, fallback) => {
  try {
    return await (typeof task === 'function' ? task() : task)
  } catch (error) {
    logger.warn('她想说的话有一处没取到', { userId, source: label, error: error.message })
    return fallback
  }
}

function reminderNudge(delivery) {
  const reminder = delivery.reminder ?? {}
  const when = FREQ_LABELS[reminder.freq] ? `${FREQ_LABELS[reminder.freq]} ${reminder.time ?? ''}`.trim() : ''
  return {
    id: `reminder:${delivery.id}`,
    kind: 'reminder',
    content: reminder.content ?? '到点啦',
    reason: reminder.instruction ? `你交给她的事${when ? `（${when}）` : ''}` : `你在日历上定的${when ? `（${when}）` : ''}`,
    detail: delivery.result ?? null,
  }
}

const careNudge = (card) => ({
  id: `care:${card.key}`,
  kind: 'care',
  content: card.title ? `${card.title}\n${card.body}` : card.body,
  reason: card.reason,
  action: card.action ?? null,
})

// 她惦记的事：你之前提过的日子到了，她问一句（只在写信开着时，由 followUpService 判断）
const followUpNudge = (followUp) => ({
  id: `followup:${followUp.id}`,
  kind: 'followup',
  content: followUp.ask,
  reason: `你之前说过：${followUp.about}`,
})

const letterNudge = (letter) => ({
  id: `letter:${letter.id}`,
  kind: 'letter',
  letterId: letter.id,
  content: letter.content,
  // 建议原样带出，聊天里的来信便签可以就地「同意采纳/带去对话/不用」
  suggestions: letter.suggestions ?? [],
  reason: '她写给你的信',
})

/**
 * 她今天主动说的那几条：按「惦记的事 → 关心 → 信」排好，只取前三条。
 * shown=true 的是今天已经说过、你也收起了的——仍然占一个位置，不让后面的补上来。
 */
function todaysUnprompted({ askedFollowUps = [], dueFollowUps = [], care = [], letter = null }) {
  return [
    ...askedFollowUps.map((followUp) => ({ shown: true, nudge: followUpNudge(followUp) })),
    ...dueFollowUps.map((followUp) => ({ shown: false, nudge: followUpNudge(followUp) })),
    ...care.map((card) => ({ shown: card.dismissed === true, nudge: careNudge(card) })),
    ...(letter ? [{ shown: Boolean(letter.readAt), nudge: letterNudge(letter) }] : []),
  ].slice(0, MAX_UNPROMPTED_PER_DAY)
}

/** 她现在想说的话（到点提醒在前，其后是她主动说的，一天至多三条）。 */
export async function listNudges(userId, now = new Date()) {
  const [deliveries, dueFollowUps, askedFollowUps, care] = await Promise.all([
    settled('reminders', userId, listDueReminders(userId, now), []),
    settled('followup', userId, () => listDueFollowUps(userId, now), []),
    settled('followup', userId, () => listAskedToday(userId, now), []),
    settled('care', userId, () => listTodaysCare(userId), []),
  ])
  // 她的来信：到日子才写（沉默期不写），然后取最新那封，没读过才说
  await settled('letter', userId, generateDueLetter(userId, { now }), null)
  const letter = await settled('letter', userId, findLatestLetter(userId), null)

  return [
    // 云端执行未接入的任务保持待处理，不在这里出现
    ...deliveries.filter((delivery) => delivery.status === 'pending' && (!delivery.reminder?.instruction || delivery.result != null)).map(reminderNudge),
    ...todaysUnprompted({ askedFollowUps, dueFollowUps, care, letter }).filter((slot) => !slot.shown).map((slot) => slot.nudge),
  ]
}

/**
 * 她今天在对话末尾主动说过的话（含已点「知道了」的）和最新那封信——给她自己的上下文用：
 * 你回一句「好的」，她知道你在回哪句。只读：不建投递、不生成信。
 */
export async function describeRecentNudges(userId, now = new Date()) {
  const [deliveries, dueFollowUps, askedFollowUps, care, letter] = await Promise.all([
    settled('reminders', userId, () => listTodaysDeliveries(userId, now), []),
    settled('followup', userId, () => listDueFollowUps(userId, now), []),
    settled('followup', userId, () => listAskedToday(userId, now), []),
    settled('care', userId, () => listTodaysCare(userId), []),
    settled('letter', userId, () => findLatestLetter(userId), null),
  ])
  return [
    ...deliveries.map((delivery) => ({ kind: 'reminder', content: delivery.reminder?.content ?? '到点啦' })),
    // 与对话末尾同一个口径：一天至多三条
    ...todaysUnprompted({ askedFollowUps, dueFollowUps, care, letter }).map(({ nudge }) => ({ kind: nudge.kind, content: nudge.content })),
  ]
}

/** 「知道了」或「先不看」：按来源交回各自的领域服务。 */
export async function ackNudge(userId, nudgeId, action = 'shown') {
  const raw = String(nudgeId ?? '')
  const separator = raw.indexOf(':')
  const kind = separator === -1 ? '' : raw.slice(0, separator)
  const reference = raw.slice(separator + 1)
  if (!reference) throw new HttpError('这条不存在', 404)
  if (kind === 'reminder') {
    await ackDelivery(reference, userId, action === 'dismissed' ? 'dismissed' : 'shown')
    return { success: true }
  }
  if (kind === 'care') {
    await dismissTouchpoint(userId, reference)
    return { success: true }
  }
  if (kind === 'letter') {
    // 信的「知道了」只收起这张便签，不写读过：读没读由看信页记（条件仍成立时下次打开还会出现）
    return { success: true }
  }
  if (kind === 'followup') return markFollowUpAsked(userId, reference)
  throw new HttpError('这条不存在', 404)
}
