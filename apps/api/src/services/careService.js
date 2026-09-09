/**
 * 主动关怀触点服务（「她来想你」，PRD V5.0 §5.3.3 的 in-app 落地）。
 *
 * - 内测没有通知投递通道：触点只在打开 App 时拉取可见（工具箱/聊天主页），绝不做假推送。
 * - 每条触点都由真实数据驱动（生日/经期/倒数日/日程/手帐/自习/日记心情），附「为什么
 *   看到这条」、可跳转到对应工具、可按日忽略（次日条件仍成立会再来，与提醒语义一致）。
 * - 只发有用的（PRD §5.3.3）：不做「早安/在吗/想你了」式无意义内容，不做情感绑架；
 *   每次最多 3 条按优先级出队；设置页有真实总开关（users.care_enabled）。
 * - 全部本地确定性计算，不调用云端模型；日志不记触点内容。
 */
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import { listHabitsWithStatus } from './habitService.js'
import { getSummary as getStudySummary } from './studyService.js'
import { localTodayUtc, toUtcDayString } from '../utils/dayHelpers.js'
import logger from '../utils/logger.js'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_TOUCHPOINTS = 3
const HEAVY_MOODS = new Set(['sad', 'angry', 'anxious'])
const MAX_KEY_LENGTH = 200

const addDays = (utcDay, days) => new Date(utcDay.getTime() + days * DAY_MS)
const daysUntil = (utcDay, todayUtc) => Math.round((utcDay - todayUtc) / DAY_MS)
const cnDate = (date) => `${date.getMonth() + 1}月${date.getDate()}日`

/**
 * 纯函数触点求值：输入已查好的数据快照，输出按优先级升序的触点数组。
 * priority 越小越靠前；同一天同一实体键稳定（忽略幂等）。
 */
export function buildTouchpoints({ user, todos, countdowns, latestPeriod, habits, study, yesterdayDiary, todayUtc, now }) {
  const day = toUtcDayString(todayUtc)
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
        body: '生日快乐。新的一岁，愿你被温柔以待——今晚想吃什么都行，今天我站你。',
        reason: '你在资料里填的生日',
        action: { to: '/chat', label: '去找她聊聊' },
      })
    } else if (monthDay === tomorrowMd) {
      push(1, 'birthday', 'profile', {
        title: '明天是你生日',
        body: '先想好愿望，明天我第一个说生日快乐。',
        reason: '你在资料里填的生日',
        action: { to: '/chat', label: '去找她聊聊' },
      })
    }
  }

  // 经期预测：最近一次记录 + 周期天数，未来 0~3 天
  if (latestPeriod) {
    const nextUtc = addDays(new Date(Date.UTC(
      latestPeriod.startDate.getUTCFullYear(),
      latestPeriod.startDate.getUTCMonth(),
      latestPeriod.startDate.getUTCDate(),
    )), latestPeriod.cycleDays)
    const until = daysUntil(nextUtc, todayUtc)
    if (until >= 0 && until <= 3) {
      push(10, 'period', latestPeriod.id, {
        title: until === 0 ? '大姨妈可能今天到' : `预计 ${until} 天后来大姨妈`,
        body: '包里备着点，注意保暖，别吃冰的。不舒服随时跟我说。',
        reason: `按上次 ${cnDate(latestPeriod.startDate)}、周期 ${latestPeriod.cycleDays} 天估的，前后浮动一两天很正常`,
        action: { to: '/tools/period', label: '看看经期日历' },
      })
    }
  }

  // 倒数日：未来 0~3 天
  for (const countdown of countdowns) {
    const until = daysUntil(countdown.targetDate, todayUtc)
    if (until < 0 || until > 3) continue
    push(20 + until, 'countdown', countdown.id, {
      title: until === 0 ? `就是今天：「${countdown.title}」` : `「${countdown.title}」还有 ${until} 天`,
      body: until === 0 ? '加油，你准备得够久了，稳的。' : '时间刚刚好，今天顺手推进一点。',
      reason: '你在倒数日里记的日子',
      action: { to: '/tools/countdown', label: '看看倒数日' },
    })
  }

  // 日程：逾期未完成的最早一条 + 今天到期的计数
  const overdue = todos.filter((todo) => todo.dueDate && todo.dueDate < todayUtc)
    .sort((a, b) => a.dueDate - b.dueDate)
  if (overdue.length > 0) {
    const oldest = overdue[0]
    push(30, 'todo-overdue', oldest.id, {
      title: `有件事拖了 ${daysUntil(todayUtc, oldest.dueDate)} 天`,
      body: `「${oldest.content}」一直挂着。今天了掉它，或者干脆跟它说再见，都算数。`,
      reason: '日程里最久的未完成事项',
      action: { to: '/tools/todo', label: '去清理日程' },
    })
  }
  const dueToday = todos.filter((todo) => todo.dueDate && todo.dueDate.getTime() === todayUtc.getTime())
  if (dueToday.length > 0) {
    push(40, 'todo-today', 'all', {
      title: `今天有 ${dueToday.length} 件事到期`,
      body: `先捡最重要的那件：「${dueToday[0].content}」。`,
      reason: '日程今天的安排',
      action: { to: '/tools/todo', label: '看看日程' },
    })
  }

  // 手帐：连续 3 天以上且今天还没打卡的习惯
  for (const habit of habits) {
    if (habit.streak < 3 || habit.checkedToday) continue
    push(50, 'habit', habit.id, {
      title: `「${habit.name}」今天还没打卡`,
      body: `已经连续 ${habit.streak} 天了，别断在这儿——就现在，十秒钟的事。`,
      reason: '手帐连续打卡统计',
      action: { to: '/tools/handbook', label: '去打卡' },
    })
  }

  // 自习：连续 3 天以上且今天 0 分钟
  if (study.streak >= 3 && study.todayMinutes === 0) {
    push(60, 'study', 'streak', {
      title: '自习今天还没开始',
      body: `已经连续 ${study.streak} 天了，来 10 分钟也算数。`,
      reason: '自习连续统计',
      action: { to: '/tools/study', label: '开始自习' },
    })
  }

  // 日记心情：昨天的心情偏沉重
  if (yesterdayDiary && HEAVY_MOODS.has(yesterdayDiary.mood)) {
    push(70, 'mood', 'diary', {
      title: '昨天你好像不太好',
      body: '我看了眼昨天的心情。今天我在，想说说随时来找我。',
      reason: '你昨天日记里的心情',
      action: { to: '/tools/diary', label: '写写今天' },
    })
  }

  return cards.sort((a, b) => a.priority - b.priority)
}

/** 拉取当前触点：忽略（按日）过滤后取前 3 条；总开关关闭或用户不存在时为空。 */
export async function listTouchpoints(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { birthDate: true, careEnabled: true },
  })
  if (!user?.careEnabled) return []

  const todayUtc = localTodayUtc()
  const now = new Date()
  const [todos, countdowns, latestPeriod, habits, study, yesterdayDiary, dismissals] = await Promise.all([
    prisma.todo.findMany({
      where: { userId, isDone: false, dueDate: { not: null } },
      orderBy: { dueDate: 'asc' },
      select: { id: true, content: true, dueDate: true },
    }),
    prisma.countdown.findMany({
      where: { userId, targetDate: { gte: todayUtc, lte: addDays(todayUtc, 3) } },
      orderBy: { targetDate: 'asc' },
      select: { id: true, title: true, targetDate: true },
    }),
    prisma.periodRecord.findFirst({
      where: { userId },
      orderBy: { startDate: 'desc' },
      select: { id: true, startDate: true, cycleDays: true },
    }),
    listHabitsWithStatus(userId),
    getStudySummary(userId),
    prisma.diaryEntry.findFirst({
      where: { userId, day: addDays(todayUtc, -1) },
      select: { mood: true },
    }),
    prisma.careDismissal.findMany({ where: { userId }, select: { key: true } }),
  ])

  const dismissed = new Set(dismissals.map((entry) => entry.key))
  return buildTouchpoints({ user, todos, countdowns, latestPeriod, habits, study, yesterdayDiary, todayUtc, now })
    .filter((card) => !dismissed.has(card.key))
    .slice(0, MAX_TOUCHPOINTS)
    .map(({ priority: _priority, ...card }) => card)
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
