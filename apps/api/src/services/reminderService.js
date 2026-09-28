/**
 * 定时任务服务（用户可见名「安排」）：日程、倒数日、提醒、习惯与自习都由它表达。
 * 「nextFireAt 落库 + 惰性投递」：创建/编辑时预计算下次触发时刻；
 * 到点由对话页便签（/api/chat/nudges）与睡眠卡（/api/reminders/sleep）的轮询触发幂等投递（同 letters 的读取时生成模式）。
 * 无后台 worker、无服务器推送；早安闹钟的铃声与系统通知由开着的网页自己发（路线图 C28）。
 *
 * 睡眠卡的晚安提醒与早安闹钟也是「安排」，用 kind 区分（每人各至多一条）：
 * 日程列表、聊天工具只看 plain；这两条只在睡眠卡里改，到点当场推进到下一次，不等她确认。
 */
import prisma from '../prisma/client.js'
import { findOwned, HttpError } from '../utils/dbHelpers.js'
import { toLocalDayString as toLocalDateString } from '../utils/dayHelpers.js'
import { occursOn } from 'schedule-logic'
import { SLEEP_KINDS, SLEEP_LABELS } from './sleepLines.js'

const MAX_CONTENT_LENGTH = 200
const MAX_INSTRUCTION_LENGTH = 500
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const FREQS = ['once', 'daily', 'weekly', 'monthly', 'yearly']
// 带锚点日期的频率：once 在该日触发一次，yearly 每年同月同日触发（生日、纪念日）
const DATED_FREQS = ['once', 'yearly']
const STATUSES = ['active', 'paused', 'done']
const PLAIN = { kind: 'plain' }
const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
// 早安便签响后留多久：过了上午就不再叫「早安」
const WAKE_FRESH_MS = 4 * HOUR_MS
// 晚安便签留到几点（本地时间次日凌晨）
const BEDTIME_FRESH_UNTIL_HOUR = 5

// ============ 校验 ============

function validateContent(content) {
  if (typeof content !== 'string' || !content.trim() || content.trim().length > MAX_CONTENT_LENGTH) {
    throw new HttpError(`提醒内容必须为1到${MAX_CONTENT_LENGTH}个字符`, 400)
  }
  return content.trim()
}

function validateTime(time) {
  if (typeof time !== 'string' || !TIME_PATTERN.test(time)) {
    throw new HttpError('提醒时间必须是 HH:mm 格式', 400)
  }
  return time
}

function validateDate(date) {
  if (typeof date !== 'string' || !DATE_PATTERN.test(date) || Number.isNaN(new Date(date).getTime())) {
    throw new HttpError('日期必须是 yyyy-MM-dd 格式', 400)
  }
  return date
}

function validateWeekdays(weekdays) {
  if (!Array.isArray(weekdays) || weekdays.length === 0
    || weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new HttpError('每周提醒需要至少一个 0-6 的星期数（0 为周日）', 400)
  }
  return [...new Set(weekdays)].sort()
}

function validateMonthDay(monthDay) {
  if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) {
    throw new HttpError('每月提醒的日期必须是 1-31 的整数', 400)
  }
  return monthDay
}

// 任务指令：可选；非空字符串且 ≤500 字。null/空串一律归一化为 null（= 纯提醒）
function validateInstruction(instruction) {
  if (instruction === undefined || instruction === null || instruction === '') return null
  if (typeof instruction !== 'string' || !instruction.trim() || instruction.trim().length > MAX_INSTRUCTION_LENGTH) {
    throw new HttpError(`任务指令必须为1到${MAX_INSTRUCTION_LENGTH}个字符`, 400)
  }
  return instruction.trim()
}

// ============ 下次触发时刻（纯函数，本地时间语义） ============

function localAt(date, time) {
  const [h, m] = time.split(':').map(Number)
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0, 0)
  return d
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

/**
 * 计算 after 之后的下一次触发时刻。
 * once 返回 fireAt 本身（已过时刻表示立即到期）。
 */
export function computeNextFire({ freq, time, fireAt, weekdays = [], monthDay = null }, after = new Date()) {
  if (freq === 'once') {
    return fireAt instanceof Date ? fireAt : new Date(fireAt)
  }
  if (freq === 'daily') {
    let candidate = localAt(after, time)
    if (candidate <= after) candidate = localAt(new Date(after.getFullYear(), after.getMonth(), after.getDate() + 1), time)
    return candidate
  }
  if (freq === 'weekly') {
    for (let offset = 0; offset <= 7; offset++) {
      const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + offset)
      if (!weekdays.includes(day.getDay())) continue
      const candidate = localAt(day, time)
      if (candidate > after) return candidate
    }
  }
  if (freq === 'monthly') {
    for (let offset = 0; offset <= 13; offset++) {
      const base = new Date(after.getFullYear(), after.getMonth() + offset, 1)
      const day = Math.min(monthDay, daysInMonth(base.getFullYear(), base.getMonth()))
      const candidate = localAt(new Date(base.getFullYear(), base.getMonth(), day), time)
      if (candidate > after) return candidate
    }
  }
  if (freq === 'yearly') {
    // 锚点取 fireAt 的月日；2 月 29 日在平年夹紧到 28 日
    const anchor = fireAt instanceof Date ? fireAt : new Date(fireAt)
    for (let offset = 0; offset <= 1; offset++) {
      const year = after.getFullYear() + offset
      const day = Math.min(anchor.getDate(), daysInMonth(year, anchor.getMonth()))
      const candidate = localAt(new Date(year, anchor.getMonth(), day), time)
      if (candidate > after) return candidate
    }
  }
  throw new HttpError(`不支持的提醒频率：${freq}`, 400)
}

// ============ CRUD ============

function buildFields(args) {
  const freq = args.freq ?? 'once'
  if (!FREQS.includes(freq)) throw new HttpError(`提醒频率必须是 ${FREQS.join('/')}`, 400)

  const fields = { content: validateContent(args.content), freq, weekdays: [], monthDay: null, fireAt: null, time: null, instruction: validateInstruction(args.instruction) }

  if (DATED_FREQS.includes(freq)) {
    const time = validateTime(args.time)
    const date = validateDate(args.date)
    const [y, mo, d] = date.split('-').map(Number)
    const [h, mi] = time.split(':').map(Number)
    fields.fireAt = new Date(y, mo - 1, d, h, mi, 0, 0)
    fields.time = time
  } else {
    fields.time = validateTime(args.time)
    if (freq === 'weekly') fields.weekdays = validateWeekdays(args.weekdays)
    if (freq === 'monthly') fields.monthDay = validateMonthDay(args.monthDay)
  }
  fields.nextFireAt = computeNextFire(fields)
  return fields
}

// 校验并组装一条安排的调度字段（含 nextFireAt）；迁移脚本复用，保证与接口同一套规则
export const buildTaskFields = buildFields

/** database 可传事务（来信建议的采纳与回写建议同一个事务）。 */
export function createScheduledReminder(userId, args, database = prisma) {
  const fields = buildFields(args)
  return database.scheduledReminder.create({ data: { userId, ...fields } })
}

/** 日程里的事（不含睡眠卡的两条）。 */
export function listScheduledReminders(userId) {
  return prisma.scheduledReminder.findMany({
    where: { userId, ...PLAIN },
    orderBy: { nextFireAt: 'asc' },
  })
}

/**
 * 某个本地日历日会发生的事（day_review 用）：调度判定复用 packages/schedule-logic 的 occursOn，
 * 与日历页同一份判定，不另写一套。occursOn 只认 active，暂停与已完成的自然不命中。
 */
export async function listScheduledRemindersOn(userId, day) {
  const rows = await listScheduledReminders(userId)
  return rows.filter((row) => occursOn(row, day))
}

// 聊天每次只取一页；默认活动安排，避免旧的已完成记录挡住当前安排。
export async function queryScheduledReminders(userId, { status = 'active', offset = 0 } = {}) {
  if (![...STATUSES, 'all'].includes(status)) throw new HttpError('状态只能是 active、paused、done 或 all', 400)
  if (!Number.isInteger(offset) || offset < 0 || offset > 2147483647) throw new HttpError('offset 必须是有效的非负整数', 400)
  const pageSize = 20
  const rows = await prisma.scheduledReminder.findMany({
    where: { userId, ...PLAIN, ...(status === 'all' ? {} : { status }) },
    orderBy: [{ nextFireAt: 'asc' }, { id: 'asc' }],
    skip: offset,
    take: pageSize + 1,
  })
  const hasMore = rows.length > pageSize
  return { items: rows.slice(0, pageSize), status, hasMore, nextOffset: hasMore ? offset + pageSize : null }
}

// 睡眠卡的两条不走日程的改删（聊天工具与日程列表都拿不到它们，这里再兜一道）
async function findOwnedPlain(id, userId) {
  const current = await findOwned('scheduledReminder', id, userId, '提醒')
  if (SLEEP_KINDS.includes(current.kind)) throw new HttpError('闹钟和晚安提醒在日程页的睡眠卡里改', 400)
  return current
}

export async function updateScheduledReminder(id, userId, args) {
  await findOwnedPlain(id, userId)
  const updateData = {}
  if (args.content !== undefined) updateData.content = validateContent(args.content)
  if (args.instruction !== undefined) updateData.instruction = validateInstruction(args.instruction)
  if (args.status !== undefined) {
    // done：手动完成（一次性安排提前做完，或不再需要的循环安排）
    if (!STATUSES.includes(args.status)) throw new HttpError('状态只能是 active、paused 或 done', 400)
    updateData.status = args.status
  }
  // 时间相关字段任一变化则整体重建并重算 nextFireAt
  if (args.freq !== undefined || args.time !== undefined || args.date !== undefined
    || args.weekdays !== undefined || args.monthDay !== undefined) {
    const current = await findOwned('scheduledReminder', id, userId, '提醒')
    const fields = buildFields({
      content: current.content,
      freq: args.freq ?? current.freq,
      time: args.time ?? current.time,
      // 只改时间时沿用原日期，不要求重传
      date: args.date ?? (current.fireAt ? toLocalDateString(new Date(current.fireAt)) : undefined),
      weekdays: args.weekdays ?? current.weekdays,
      monthDay: args.monthDay ?? current.monthDay,
    })
    delete fields.content
    delete fields.instruction
    Object.assign(updateData, fields)
    // 改期让已完成的安排重新生效；同时显式传了状态则以显式状态为准
    if (current.status === 'done' && args.status === undefined) updateData.status = 'active'
  }
  return prisma.scheduledReminder.update({ where: { id }, data: updateData })
}

export async function deleteScheduledReminder(id, userId) {
  await findOwnedPlain(id, userId)
  return prisma.scheduledReminder.delete({ where: { id } })
}

// ============ 睡眠卡：晚安提醒与早安闹钟 ============

function toSleepSetting(row) {
  if (!row) return null
  return {
    id: row.id,
    enabled: row.status === 'active',
    time: row.time,
    weekdays: row.freq === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : [...(row.weekdays ?? [])],
    nextFireAt: row.nextFireAt,
  }
}

async function readSleepRoutine(db, userId) {
  const rows = await db.scheduledReminder.findMany({
    where: { userId, kind: { in: SLEEP_KINDS } },
    orderBy: { createdAt: 'asc' },
  })
  return {
    bedtime: toSleepSetting(rows.find((row) => row.kind === 'bedtime')),
    wake: toSleepSetting(rows.find((row) => row.kind === 'wake')),
  }
}

/** 睡眠卡：{ bedtime, wake }，没设过的是 null。 */
export function getSleepRoutine(userId) {
  return readSleepRoutine(prisma, userId)
}

// 七天全选存成每天，否则存成每周；关掉存成暂停，时间留着
function sleepFields(kind, input) {
  if (typeof input !== 'object' || input === null || typeof input.enabled !== 'boolean') {
    throw new HttpError(`${SLEEP_LABELS[kind]}需要 enabled、time 和 weekdays`, 400)
  }
  const weekdays = validateWeekdays(input.weekdays)
  const fields = buildFields({
    content: SLEEP_LABELS[kind],
    freq: weekdays.length === 7 ? 'daily' : 'weekly',
    time: input.time,
    weekdays,
  })
  return { ...fields, kind, status: input.enabled ? 'active' : 'paused' }
}

/**
 * 保存睡眠卡：{ bedtime?, wake? }，每项 { enabled, time, weekdays }。有就改、没有就建，每人各至多一条。
 * 改过的那一类，还没收起的旧便签一并收起（时间都换了，旧的那张不该再出现）。
 */
export async function saveSleepRoutine(userId, input = {}) {
  const prepared = SLEEP_KINDS
    .filter((kind) => input?.[kind] !== undefined)
    .map((kind) => [kind, sleepFields(kind, input[kind])])
  if (prepared.length === 0) throw new HttpError('没有要保存的睡眠设置', 400)
  const routine = await prisma.$transaction(async (db) => {
    // 锁住这个人：两次保存同时到达也只会各有一条
    await db.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`
    await Promise.all(prepared.map(([kind, fields]) => saveSleepKind(db, userId, kind, fields)))
    return readSleepRoutine(db, userId)
  })
  return routine
}

async function saveSleepKind(db, userId, kind, fields) {
  const existing = await db.scheduledReminder.findFirst({ where: { userId, kind } })
  if (!existing) return db.scheduledReminder.create({ data: { userId, ...fields } })
  await db.scheduledReminder.update({ where: { id: existing.id }, data: fields })
  return db.reminderDelivery.updateMany({ where: { reminderId: existing.id, status: 'pending' }, data: { status: 'dismissed' } })
}

/**
 * 睡眠便签还算不算数：早安响后 4 小时内；晚安到次日凌晨 5 点（凌晨定的就到当天 5 点）。
 * 过了就不再出现——下午打开对话，不该还看见「早安」。
 */
export function sleepDeliveryFresh(kind, fireAt, now = new Date()) {
  const fire = new Date(fireAt)
  if (kind === 'wake') return now - fire < WAKE_FRESH_MS
  if (kind === 'bedtime') {
    const until = new Date(fire.getFullYear(), fire.getMonth(), fire.getDate(), BEDTIME_FRESH_UNTIL_HOUR)
    if (until <= fire) until.setDate(until.getDate() + 1)
    return now < until
  }
  return true
}

/** 不晚于 now 的最近一次触发：错过了好几天，也只认最近这一次。 */
export function latestFireAtOrBefore(reminder, now) {
  let fire = computeNextFire(reminder, new Date(now.getTime() - 8 * DAY_MS))
  if (fire > now) return null
  for (let next = computeNextFire(reminder, fire); next <= now; next = computeNextFire(reminder, fire)) fire = next
  return fire
}

// ============ 到点投递（幂等） ============

/**
 * 拉到点未投递的提醒：对每条 active 且 nextFireAt <= now 的提醒幂等 upsert 投递实例，
 * 返回 pending 投递（含提醒内容）。不推进 nextFireAt——由 ack 驱动。
 */
/** 今天已经到点的提醒（点没点「知道了」都算）。只读：不建投递，给她自己的上下文用。 */
export function listTodaysDeliveries(userId, now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return prisma.reminderDelivery.findMany({
    where: { reminder: { userId }, fireAt: { gte: startOfToday, lte: now } },
    include: { reminder: { select: { content: true, kind: true } } },
    orderBy: { fireAt: 'asc' },
    take: 5,
  })
}

// 并发或重复轮询撞唯一键：投递已存在，静默复用（letters 同款幂等模式）
function createDelivery(reminderId, fireAt) {
  return prisma.reminderDelivery.create({ data: { reminderId, fireAt } }).catch((err) => {
    if (err?.code !== 'P2002') throw err
  })
}

/**
 * 睡眠卡的两条到点：只给最近这一次建投递（还算数才建），并当场推进到下一次。
 * 推进不等她点「起来了」——哪天早上没点，第二天照样要响。条件更新防并发重复推进。
 */
async function deliverSleep(reminder, now) {
  const fireAt = latestFireAtOrBefore(reminder, now) ?? reminder.nextFireAt
  if (sleepDeliveryFresh(reminder.kind, fireAt, now)) await createDelivery(reminder.id, fireAt)
  await prisma.scheduledReminder.updateMany({
    where: { id: reminder.id, userId: reminder.userId, status: 'active', nextFireAt: reminder.nextFireAt, updatedAt: reminder.updatedAt },
    data: { nextFireAt: computeNextFire(reminder, fireAt > now ? fireAt : now) },
  })
}

/**
 * kinds 缺省为全部（对话页便签）；睡眠卡只传睡眠两类。
 * 睡眠便签过了时候就不再返回（投递留着，只是不再出现）。
 */
export async function listDueReminders(userId, now = new Date(), { kinds } = {}) {
  const kindFilter = kinds ? { kind: { in: kinds } } : {}
  const due = await prisma.scheduledReminder.findMany({
    where: { userId, status: 'active', nextFireAt: { lte: now }, ...kindFilter },
  })
  await Promise.all(due.map((reminder) => (SLEEP_KINDS.includes(reminder.kind)
    ? deliverSleep(reminder, now)
    : createDelivery(reminder.id, reminder.nextFireAt))))
  const pending = await prisma.reminderDelivery.findMany({
    where: {
      status: 'pending', reminder: { userId, ...kindFilter },
      // 已结束的安排不再提示，包含结束前已创建/晚到的投递；完成任务的既有产出仍可读取。
      OR: [{ reminder: { status: { not: 'done' } } }, { result: { not: null } }],
    },
    include: { reminder: { select: { id: true, content: true, freq: true, time: true, weekdays: true, instruction: true, kind: true } } },
    orderBy: { fireAt: 'asc' },
  })
  return pending.filter((delivery) => !SLEEP_KINDS.includes(delivery.reminder?.kind) || sleepDeliveryFresh(delivery.reminder.kind, delivery.fireAt, now))
}

// 调度推进：一次性置 done，循环类算下一次（执行或确认后共用）
async function advanceSchedule(db, reminder, fireAt) {
  // 旧投递、已暂停或已编辑的调度不可被晚到的执行/确认覆盖。
  if (reminder.status !== 'active' || reminder.nextFireAt.getTime() !== fireAt.getTime()) return
  await db.scheduledReminder.updateMany({
    where: { id: reminder.id, userId: reminder.userId, status: 'active', nextFireAt: fireAt, updatedAt: reminder.updatedAt },
    data: reminder.freq === 'once'
      ? { status: 'done' }
      : { nextFireAt: computeNextFire(reminder, fireAt) },
  })
}

async function findOwnedDelivery(db, deliveryId, userId) {
  const delivery = await db.reminderDelivery.findUnique({
    where: { id: deliveryId },
    include: { reminder: true },
  })
  if (!delivery || delivery.reminder.userId !== userId) throw new HttpError('提醒投递不存在', 404)
  return delivery
}

/** 持久领取：并发轮询只能有一个执行者；崩溃留下 running，禁止自动重试未知副作用。 */
export function claimTaskDelivery(deliveryId, userId) {
  return prisma.$transaction(async (db) => {
    const delivery = await findOwnedDelivery(db, deliveryId, userId)
    if (!delivery.reminder.instruction || delivery.status !== 'pending' || delivery.result != null) return null
    const claimed = await db.reminderDelivery.updateMany({
      where: {
        id: deliveryId, status: 'pending', result: null,
        reminder: {
          userId, status: 'active', nextFireAt: delivery.fireAt,
          updatedAt: delivery.reminder.updatedAt,
        },
      },
      data: { status: 'running' },
    })
    return claimed.count === 1 ? { ...delivery, status: 'running' } : null
  })
}

function finishTaskDelivery(deliveryId, userId, data) {
  return prisma.$transaction(async (db) => {
    const delivery = await findOwnedDelivery(db, deliveryId, userId)
    const updated = await db.reminderDelivery.updateMany({
      where: { id: deliveryId, status: 'running', reminder: { userId } },
      data,
    })
    if (updated.count === 1) await advanceSchedule(db, delivery.reminder, delivery.fireAt)
    return findOwnedDelivery(db, deliveryId, userId)
  })
}

/**
 * 定时任务执行成功：产出写入投递（保持 pending 等用户在铃铛里看到），调度立即推进。
 * 推进不依赖用户确认，避免未读时反复执行同一批任务。
 */
export function completeTaskDelivery(deliveryId, userId, result) {
  return finishTaskDelivery(deliveryId, userId, { status: 'pending', result: String(result ?? '').slice(0, 4000) })
}

/** 定时任务执行失败：标记 failed 并推进调度，不做无限重试。 */
export function failTaskDelivery(deliveryId, userId) {
  return finishTaskDelivery(deliveryId, userId, { status: 'failed' })
}

/**
 * 确认投递：标记 shown/dismissed；一次性提醒置 done，循环提醒推进 nextFireAt。
 */
export async function ackDelivery(deliveryId, userId, action) {
  if (!['shown', 'dismissed'].includes(action)) throw new HttpError('操作只能是 shown 或 dismissed', 400)
  return prisma.$transaction(async (db) => {
    const delivery = await findOwnedDelivery(db, deliveryId, userId)
    if (delivery.status === 'running') throw new HttpError('任务正在执行，请稍后确认', 409)
    if (delivery.status === 'pending' && delivery.reminder.instruction && delivery.result == null) {
      throw new HttpError('任务尚未执行，暂时不能确认', 409)
    }
    const updated = await db.reminderDelivery.updateMany({
      where: {
        id: deliveryId, status: 'pending', reminder: { userId },
        OR: [{ result: { not: null } }, { reminder: { instruction: null } }],
      },
      data: { status: action },
    })
    if (updated.count === 1) await advanceSchedule(db, delivery.reminder, delivery.fireAt)
    const current = await findOwnedDelivery(db, deliveryId, userId)
    if (current.status === 'running') throw new HttpError('任务正在执行，请稍后确认', 409)
    if (current.status === 'pending' && current.reminder.instruction && current.result == null) {
      throw new HttpError('任务尚未执行，暂时不能确认', 409)
    }
    return current
  })
}
