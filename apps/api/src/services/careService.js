/**
 * 主动关怀触点服务（「她来想你」，PRD V5.0 §5.3.3 的 in-app 落地）。
 *
 * - 内测没有通知投递通道：触点只在打开 App 时拉取可见（工具箱/聊天主页），绝不做假推送。
 * - 每条触点都由真实数据驱动（生日/经期/安排/日记心情），附「为什么看到这条」、可跳转到
 *   对应入口、可按日忽略（次日条件仍成立会再来，与提醒语义一致）。
 * - 只发有用的（PRD §5.3.3）：不做「早安/在吗/想你了」式无意义内容，不做情感绑架；
 *   每天最多 3 条：先按优先级取当天前 3 张，再滤掉点过的，第 4 张不会补上来；设置页有真实总开关（users.care_enabled）。
 * - 用她当前的说话方式写（voice.js）；经期只在经期记录的单独同意还在时才读。
 * - 安排只看带日子的（一次性、每年）：每天/每周的例行由铃铛到点提醒，不再重复成卡片；
 *   交给她执行的任务（有指令）是她的事，也不打扰。
 * - 全部本地确定性计算，不调用云端模型；日志不记触点内容。
 */
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import { localTodayUtc, toUtcDayString } from '../utils/dayHelpers.js'
import logger from '../utils/logger.js'
import { voiceOf } from './voice.js'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_TOUCHPOINTS = 3
const SOON_DAYS = 3
// 过了预计的日子还没新记录：晚 1 到 7 天各说一次，再往后不天天追着问
const LATE_DAYS = 7
const HEAVY_MOODS = new Set(['sad', 'angry', 'anxious'])
const MAX_KEY_LENGTH = 200

const addDays = (utcDay, days) => new Date(utcDay.getTime() + days * DAY_MS)
const daysUntil = (utcDay, todayUtc) => Math.round((utcDay - todayUtc) / DAY_MS)
const cnDate = (date) => `${date.getMonth() + 1}月${date.getDate()}日`
const localDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
// 安排的 nextFireAt 是绝对时刻，按本地日历日计「还有几天」
const localDaysUntil = (date, now) => Math.round((localDay(new Date(date)) - localDay(now)) / DAY_MS)

/**
 * 纯函数触点求值：输入已查好的数据快照，输出按优先级升序的触点数组。
 * priority 越小越靠前；同一天同一实体键稳定（忽略幂等）。
 * tasks：进行中、带日子（once/yearly）、无指令的安排，按 nextFireAt 升序。
 */
export function buildTouchpoints({ user, tasks = [], latestPeriod, yesterdayDiary, todayUtc, now }) {
  const day = toUtcDayString(todayUtc)
  const voice = voiceOf(user.persona)
  const cards = []
  const push = (priority, kind, ref, card) => {
    cards.push({ key: `${kind}:${ref}:${day}`, kind, priority, ...card })
  }

  // 生日：资料里的出生日期（只取月日，按本地日历比较）
  if (user.birthDate instanceof Date && !Number.isNaN(user.birthDate.getTime())) {
    const birth = user.birthDate
    const monthDay = `${birth.getUTCMonth() + 1}-${birth.getUTCDate()}`
    const todayMd = `${now.getMonth() + 1}-${now.getDate()}`
    const tomorrowMd = `${addDays(now, 1).getMonth() + 1}-${addDays(now, 1).getDate()}`
    if (monthDay === todayMd) {
      push(0, 'birthday', 'profile', {
        title: '今天是你生日',
        body: voice.birthdayToday,
        reason: '你在资料里填的生日',
        action: { to: '/chat', label: '去找她聊聊' },
      })
    } else if (monthDay === tomorrowMd) {
      push(1, 'birthday', 'profile', {
        title: '明天是你生日',
        body: voice.birthdayTomorrow,
        reason: '你在资料里填的生日',
        action: { to: '/chat', label: '去找她聊聊' },
      })
    }
  }

  // 经期预测：最近一次记录 + 周期天数。未来 0~3 天提前说；过了日子还没记，晚 1~7 天也说，不悄悄消失
  if (latestPeriod) pushPeriodCard(push, latestPeriod, todayUtc, voice)

  // 安排：今天的聚成一条；1~3 天内的各一条「还有 N 天」
  const today = tasks.filter((task) => localDaysUntil(task.nextFireAt, now) === 0)
  if (today.length > 0) {
    push(20, 'task-today', 'all', {
      title: today.length === 1 ? `今天：「${today[0].content}」` : `今天有 ${today.length} 件事`,
      body: today.length === 1 ? voice.taskToday : voice.taskTodayMany(today[0].content),
      reason: '你在日历上记的今天',
      action: { to: '/tools/calendar', label: '看看日历' },
    })
  }
  for (const task of tasks) {
    const until = localDaysUntil(task.nextFireAt, now)
    if (until < 1 || until > SOON_DAYS) continue
    push(20 + until, 'task-soon', task.id, {
      title: `「${task.content}」还有 ${until} 天`,
      body: voice.taskSoon,
      reason: '你在日历上记的日子',
      action: { to: '/tools/calendar', label: '看看日历' },
    })
  }

  // 日记心情：昨天的心情偏沉重
  if (yesterdayDiary && HEAVY_MOODS.has(yesterdayDiary.mood)) {
    push(70, 'mood', 'diary', {
      title: '昨天你好像不太好',
      body: voice.moodYesterday,
      reason: '你昨天日记里的心情',
      action: { to: '/tools/notes?tab=diary', label: '写写今天' },
    })
  }

  return cards.sort((a, b) => a.priority - b.priority)
}

function pushPeriodCard(push, latestPeriod, todayUtc, voice) {
  const nextUtc = addDays(new Date(Date.UTC(
    latestPeriod.startDate.getUTCFullYear(),
    latestPeriod.startDate.getUTCMonth(),
    latestPeriod.startDate.getUTCDate(),
  )), latestPeriod.cycleDays)
  const until = daysUntil(nextUtc, todayUtc)
  const basis = `按上次 ${cnDate(latestPeriod.startDate)}、周期 ${latestPeriod.cycleDays} 天估的`
  const action = { to: '/tools/calendar', label: '看看日历' }
  if (until >= 0 && until <= SOON_DAYS) {
    push(10, 'period', latestPeriod.id, {
      title: until === 0 ? '大姨妈可能今天到' : `预计 ${until} 天后来大姨妈`,
      body: voice.periodSoon,
      reason: `${basis}，前后浮动一两天很正常`,
      action,
    })
  } else if (until < 0 && -until <= LATE_DAYS) {
    push(10, 'period-late', latestPeriod.id, {
      title: `比预计晚了 ${-until} 天`,
      body: voice.periodLate,
      reason: `${basis}，还没有新的记录`,
      action,
    })
  }
}

/** 今天她想说的关心（按优先级排好，不管有没有被点过「知道了」）；关掉「她来想你」就没有。 */
async function todaysTouchpoints(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { birthDate: true, careEnabled: true, persona: true, periodConsentAt: true },
  })
  if (!user?.careEnabled) return null

  const todayUtc = localTodayUtc()
  const now = new Date()
  const windowStart = localDay(now)
  const windowEnd = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() + SOON_DAYS + 1)
  const [tasks, latestPeriod, yesterdayDiary, dismissals] = await Promise.all([
    prisma.scheduledReminder.findMany({
      where: {
        userId, status: 'active', instruction: null, freq: { in: ['once', 'yearly'] },
        nextFireAt: { gte: windowStart, lt: windowEnd },
      },
      orderBy: { nextFireAt: 'asc' },
      select: { id: true, content: true, nextFireAt: true },
    }),
    // 撤回经期记录同意后她不再读取经期（日历上的承诺）
    user.periodConsentAt
      ? prisma.periodRecord.findFirst({
        where: { userId },
        orderBy: { startDate: 'desc' },
        select: { id: true, startDate: true, cycleDays: true },
      })
      : null,
    prisma.diaryEntry.findFirst({
      where: { userId, day: addDays(todayUtc, -1) },
      select: { mood: true },
    }),
    prisma.careDismissal.findMany({ where: { userId }, select: { key: true } }),
  ])

  return { cards: buildTouchpoints({ user, tasks, latestPeriod, yesterdayDiary, todayUtc, now }), dismissals }
}

/**
 * 今天她想说的关心：按优先级取当天前 3 张，每张标明你点没点过「知道了」（dismissed）。
 * 先取再滤，点掉一张不会让第 4 张补上来；点过的也算她今天说过，给她自己的上下文用。
 */
export async function listTodaysCare(userId) {
  const { cards = [], dismissals = [] } = await todaysTouchpoints(userId) ?? {}
  const dismissed = new Set(dismissals.map((entry) => entry.key))
  return cards
    .slice(0, MAX_TOUCHPOINTS)
    .map(({ priority: _priority, ...card }) => ({ ...card, dismissed: dismissed.has(card.key) }))
}

/** 按日忽略一条触点（同日同键幂等）。 */
export async function dismissTouchpoint(userId, key) {
  if (typeof key !== 'string' || key.trim().length === 0 || key.trim().length > MAX_KEY_LENGTH) {
    throw new HttpError('触点键不合法', 400)
  }
  await prisma.careDismissal.upsert({
    where: { userId_key: { userId, key: key.trim() } },
    create: { userId, key: key.trim() },
    update: {},
  })
  logger.info('忽略关怀触点', { userId })
  return { dismissed: true }
}
