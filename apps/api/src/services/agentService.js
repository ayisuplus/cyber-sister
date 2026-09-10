/**
 * 智能体工具服务：聊天内工具调用的注册表、协议解析与执行。
 *
 * 参考 pi-agent-core 的 agent loop 设计（模型 → 工具调用 → 结果反馈 → 模型），
 * 但按本产品安全模型收敛：
 * - 工具域只覆盖产品自身能力（日程/倒数日/经期/提醒/日记/手帐/阅读/自习/搜索/计算），
 *   全部经既有领域服务的校验与归属约束作用于当前用户，不执行任意代码、不驱动浏览器、
 *   不在服务器执行 shell、不做服务器侧生图。
 * - 协议为模型无关的 JSON 动作格式（整段回复即一个 JSON 对象）。
 * - 记忆不开放给工具：显式记忆只能经「帮我记住」由用户确认后落库。
 */
import {
  listTodos, createTodo, updateTodo, deleteTodo,
  listCountdowns, createCountdown, deleteCountdown,
  listPeriodRecords, createPeriodRecord,
  listReminders, updateReminder,
} from './toolService.js'
import {
  createScheduledReminder, listScheduledReminders, deleteScheduledReminder,
} from './reminderService.js'
import { upsertEntry, getEntry, MOOD_LABELS } from './diaryService.js'
import { listHabitsWithStatus, findHabitByName, setCheckin } from './habitService.js'
import { logReading } from './readingService.js'
import { recordSession } from './studyService.js'
import { evaluateExpression, convertUnit } from './calcService.js'
import { HttpError } from '../utils/dbHelpers.js'
import { searchWeb } from './searchService.js'
import logger from '../utils/logger.js'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_LIST_ITEMS = 20
const TOOLCALL_PARSE_CAP = 4096
const MAX_SUMMARY_LENGTH = 60

const REMINDER_TYPE_LABELS = { water: '喝水', sleep: '睡觉', period: '经期' }

const localCalendarDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

function toDateOnly(date) {
  if (!date) return null
  const d = date instanceof Date ? date : new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function clip(text, max = MAX_SUMMARY_LENGTH) {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max)}…` : value
}


/** 工具注册表：name → { description(进提示词), run(userId, args) → { summary, result } } */
const CHAT_TOOLS = {
  add_todo: {
    description: '{"tool":"add_todo","args":{"content":"日程内容","dueDate":"可选 yyyy-MM-dd","dueTime":"可选 HH:mm（需先有日期）"}}',
    run: async (userId, args) => {
      const todo = await createTodo(userId, { content: args.content, dueDate: args.dueDate, dueTime: args.dueTime })
      return { summary: `已添加日程「${clip(todo.content, 20)}」`, result: { id: todo.id, content: todo.content, dueDate: toDateOnly(todo.dueDate), dueTime: todo.dueTime } }
    },
  },
  list_todos: {
    description: '{"tool":"list_todos","args":{}} 查看日程（含 id、日期与时间）',
    run: async (userId) => {
      const todos = (await listTodos(userId)).slice(0, MAX_LIST_ITEMS)
      return {
        summary: `已查询${todos.length}条日程`,
        result: todos.map((t) => ({ id: t.id, content: t.content, dueDate: toDateOnly(t.dueDate), dueTime: t.dueTime, isDone: t.isDone })),
      }
    },
  },
  complete_todo: {
    description: '{"tool":"complete_todo","args":{"id":"待办id","isDone":"可选，默认true"}}',
    run: async (userId, args) => {
      const todo = await updateTodo(userId, String(args.id || ''), { isDone: args.isDone !== false })
      return { summary: todo.isDone ? '已标记待办完成' : '已标记待办未完成', result: { id: todo.id, isDone: todo.isDone } }
    },
  },
  delete_todo: {
    description: '{"tool":"delete_todo","args":{"id":"待办id"}}',
    run: async (userId, args) => {
      await deleteTodo(userId, String(args.id || ''))
      return { summary: '已删除待办', result: { id: String(args.id || '') } }
    },
  },
  add_countdown: {
    description: '{"tool":"add_countdown","args":{"title":"名称","targetDate":"yyyy-MM-dd"}}',
    run: async (userId, args) => {
      const countdown = await createCountdown(userId, { title: args.title, targetDate: args.targetDate })
      return { summary: `已添加倒数日「${clip(countdown.title, 20)}」`, result: { id: countdown.id, title: countdown.title, targetDate: toDateOnly(countdown.targetDate) } }
    },
  },
  list_countdowns: {
    description: '{"tool":"list_countdowns","args":{}} 查看倒数日（含 id）',
    run: async (userId) => {
      const countdowns = (await listCountdowns(userId)).slice(0, MAX_LIST_ITEMS)
      const today = localCalendarDay(new Date())
      return {
        summary: `已查询${countdowns.length}个倒数日`,
        result: countdowns.map((c) => ({
          id: c.id,
          title: c.title,
          targetDate: toDateOnly(c.targetDate),
          daysLeft: Math.round((localCalendarDay(new Date(c.targetDate)) - today) / DAY_MS),
        })),
      }
    },
  },
  delete_countdown: {
    description: '{"tool":"delete_countdown","args":{"id":"倒数日id"}}',
    run: async (userId, args) => {
      await deleteCountdown(userId, String(args.id || ''))
      return { summary: '已删除倒数日', result: { id: String(args.id || '') } }
    },
  },
  record_period: {
    description: '{"tool":"record_period","args":{"startDate":"yyyy-MM-dd","endDate":"可选","cycleDays":"可选 20-45"}}',
    run: async (userId, args) => {
      const record = await createPeriodRecord(userId, { startDate: args.startDate, endDate: args.endDate, cycleDays: args.cycleDays })
      return { summary: `已记录经期 ${toDateOnly(record.startDate)}`, result: { id: record.id, startDate: toDateOnly(record.startDate), cycleDays: record.cycleDays } }
    },
  },
  period_status: {
    description: '{"tool":"period_status","args":{}} 经期状态与下次预测',
    run: async (userId) => {
      const records = await listPeriodRecords(userId)
      const latest = records[0]
      if (!latest) return { summary: '暂无经期记录', result: { records: 0 } }
      const next = localCalendarDay(new Date(latest.startDate))
      next.setDate(next.getDate() + latest.cycleDays)
      const daysUntil = Math.max(0, Math.round((next - localCalendarDay(new Date())) / DAY_MS))
      return {
        summary: `预计 ${daysUntil} 天后下次经期`,
        result: { lastStartDate: toDateOnly(latest.startDate), cycleDays: latest.cycleDays, nextDate: toDateOnly(next), daysUntil },
      }
    },
  },
  list_reminders: {
    description: '{"tool":"list_reminders","args":{}} 查看提醒（含 id、时间与开关）',
    run: async (userId) => {
      const reminders = await listReminders(userId)
      return {
        summary: `已查询${reminders.length}条提醒设置`,
        result: reminders.map((r) => ({ id: r.id, type: r.type, time: r.time, isActive: r.isActive })),
      }
    },
  },
  add_scheduled_reminder: {
    description: '{"tool":"add_scheduled_reminder","args":{"content":"提醒内容","freq":"once|daily|weekly|monthly，默认 once","time":"HH:mm","date":"freq=once 必填 yyyy-MM-dd","weekdays":"freq=weekly 必填 [0-6]，0 为周日","monthDay":"freq=monthly 必填 1-31"}} 创建自定义定时提醒（任意内容，到点应用内通知）',
    run: async (userId, args) => {
      const reminder = await createScheduledReminder(userId, args)
      return {
        summary: `已设提醒「${clip(reminder.content, 20)}」`,
        result: { id: reminder.id, freq: reminder.freq, nextFireAt: reminder.nextFireAt },
      }
    },
  },
  list_scheduled_reminders: {
    description: '{"tool":"list_scheduled_reminders","args":{}} 查看自定义定时提醒（含 id、内容、频率、下次触发时间、状态）',
    run: async (userId) => {
      const reminders = await listScheduledReminders(userId)
      return {
        summary: `已查询${reminders.length}条自定义提醒`,
        result: reminders.map((r) => ({
          id: r.id, content: r.content, freq: r.freq, time: r.time,
          weekdays: r.weekdays, monthDay: r.monthDay, nextFireAt: r.nextFireAt, status: r.status,
        })),
      }
    },
  },
  delete_scheduled_reminder: {
    description: '{"tool":"delete_scheduled_reminder","args":{"id":"提醒 id"}} 删除自定义定时提醒',
    run: async (userId, args) => {
      await deleteScheduledReminder(args.id, userId)
      return { summary: '已删除提醒', result: { id: args.id } }
    },
  },
  set_reminder: {
    description: '{"tool":"set_reminder","args":{"type":"water|sleep|period","time":"可选 HH:mm","isActive":"可选 boolean"}}',
    run: async (userId, args) => {
      if (!Object.hasOwn(REMINDER_TYPE_LABELS, args.type)) {
        const error = new Error('提醒类型必须是 water / sleep / period')
        error.statusCode = 400
        throw error
      }
      const reminders = await listReminders(userId)
      const target = reminders.find((r) => r.type === args.type)
      if (!target) {
        const error = new Error('没有找到对应类型的提醒')
        error.statusCode = 404
        throw error
      }
      const updates = {}
      if (args.time !== undefined) updates.time = args.time
      if (args.isActive !== undefined) updates.isActive = Boolean(args.isActive)
      const reminder = await updateReminder(userId, target.id, updates)
      const label = REMINDER_TYPE_LABELS[reminder.type]
      const summary = `${reminder.isActive ? '已开启' : '已关闭'}${label}提醒（${reminder.time}）`
      return { summary, result: { id: reminder.id, type: reminder.type, time: reminder.time, isActive: reminder.isActive } }
    },
  },
  add_diary: {
    // 按天幂等：同一天重复写在同一回路中去重（upsert 本身也是按天唯一）
    signatureOf: () => toDateOnly(new Date()),
    description: '{"tool":"add_diary","args":{"content":"日记内容","mood":"可选 happy|neutral|sad|angry|anxious"}} 写今天的日记',
    run: async (userId, args) => {
      const day = toDateOnly(new Date())
      const entry = await upsertEntry(userId, day, {
        content: args.content,
        mood: typeof args.mood === 'string' ? args.mood : 'neutral',
      })
      return { summary: `已记下今天的日记（${MOOD_LABELS[entry.mood]}）`, result: { day: entry.day, mood: entry.mood } }
    },
  },
  diary_status: {
    description: '{"tool":"diary_status","args":{}} 查看今天是否已写日记',
    run: async (userId) => {
      const day = toDateOnly(new Date())
      try {
        const entry = await getEntry(userId, day)
        return {
          summary: `今天已写日记（${MOOD_LABELS[entry.mood]}）`,
          result: { written: true, day, mood: entry.mood },
        }
      } catch {
        return { summary: '今天还没写日记', result: { written: false, day } }
      }
    },
  },
  check_habit: {
    description: '{"tool":"check_habit","args":{"name":"习惯名称（须与列表完全一致）"}} 给今天的某个习惯打卡',
    run: async (userId, args) => {
      const habit = await findHabitByName(userId, args.name)
      const day = toDateOnly(new Date())
      const status = await listHabitsWithStatus(userId)
      const current = status.find((h) => h.id === habit.id)
      if (current?.checkedToday) {
        return { summary: `「${habit.name}」今天已经打过卡了`, result: { id: habit.id, name: habit.name, checked: true, day } }
      }
      await setCheckin(userId, habit.id, day, true)
      return { summary: `已打卡「${habit.name}」`, result: { id: habit.id, name: habit.name, checked: true, day } }
    },
  },
  habit_status: {
    description: '{"tool":"habit_status","args":{}} 查看习惯列表、连续天数与今日打卡状态',
    run: async (userId) => {
      const status = await listHabitsWithStatus(userId)
      const done = status.filter((h) => h.checkedToday).length
      return {
        summary: `已查询${status.length}个习惯（今天完成 ${done} 个）`,
        result: status.map((h) => ({ name: h.name, streak: h.streak, checkedToday: h.checkedToday })),
      }
    },
  },
  log_reading: {
    description: '{"tool":"log_reading","args":{"book":"书名","page":"可选 读到第几页","note":"可选 一句话感想"}} 记录阅读进度或感想；书不在书架会自动放入（在读）',
    run: async (userId, args) => {
      const result = await logReading(userId, { title: args.book, page: args.page, note: args.note })
      return { summary: `已记下《${clip(result.title, 12)}》的阅读`, result: { bookId: result.bookId, title: result.title, currentPage: result.currentPage } }
    },
  },
  log_study: {
    description: '{"tool":"log_study","args":{"minutes":"专注分钟数 1-240","subject":"可选 科目","note":"可选 一句话收获"}} 记录一次自习/学习',
    run: async (userId, args) => {
      const session = await recordSession(userId, { plannedMinutes: args.minutes, actualMinutes: args.minutes, subject: args.subject, note: args.note })
      return { summary: `已记下 ${session.actualMinutes} 分钟自习`, result: { id: session.id, actualMinutes: session.actualMinutes, subject: session.subject } }
    },
  },
  web_search: {
    description: '{"tool":"web_search","args":{"query":"搜索关键词"}} 联网搜索最新信息（用户明确要求查新闻/资料/实时信息时使用，返回标题/链接/摘要）',
    run: async (userId, args) => {
      const search = await searchWeb(userId, args.query)
      return {
        summary: search.results.length > 0 ? `已搜索到${search.results.length}条结果` : '没找到相关结果',
        result: search,
      }
    },
  },
}

/** 工作模式人格无关的效率助手前言：语气与能力边界说明，置于工具目录之前。 */
export const WORK_MODE_PREAMBLE = '当前是工作模式：你是用户的效率助手。语气直接、结论先行、少寒暄；不涉及恋爱陪伴话题。你可以：操作日程（增查完删）；联网搜索最新信息；做计算与单位换算；起草、总结、改写、翻译文本（直接输出正文，不要声称保存到了任何地方）。做计划与目标管理：用户要做计划或定目标时，先给出结构化拆解（目标→阶段→带日期的行动项），用户确认后用日程工具逐项落到日程；用户问起进度时先查日程再回答。工具不可用时诚实说明。'

// 工作模式工具注册表：日程四件与 CHAT_TOOLS 共享同一 run 实现（描述改「日程」口径），
// 计算换算与浏览器工具为工作模式独有。
const WORK_TOOLS = {
  add_todo: {
    description: '{"tool":"add_todo","args":{"content":"日程内容","dueDate":"可选 yyyy-MM-dd","dueTime":"可选 HH:mm（需先有日期）"}}',
    run: CHAT_TOOLS.add_todo.run,
  },
  list_todos: {
    description: '{"tool":"list_todos","args":{}} 查看日程（含 id、日期与时间）',
    run: CHAT_TOOLS.list_todos.run,
  },
  complete_todo: {
    description: '{"tool":"complete_todo","args":{"id":"日程id","isDone":"可选，默认true"}}',
    run: CHAT_TOOLS.complete_todo.run,
  },
  delete_todo: {
    description: '{"tool":"delete_todo","args":{"id":"日程id"}}',
    run: CHAT_TOOLS.delete_todo.run,
  },
  calc_convert: {
    description: '{"tool":"calc_convert","args":{"expression":"可选 算式如 (3+5)*2 或 1.5*8","value":"可选 数值","from":"可选 单位","to":"可选 单位"}} 计算或单位换算（长度/重量/温度）',
    run: async (_userId, args) => {
      if (args.expression !== undefined && args.expression !== null && String(args.expression).trim() !== '') {
        const value = evaluateExpression(String(args.expression))
        return { summary: `已算出 ${clip(value, 20)}`, result: { value } }
      }
      if (args.value === undefined || args.from === undefined || args.to === undefined) {
        throw new HttpError('换算需要 value、from、to 三个参数', 400)
      }
      const from = String(args.from).trim()
      const to = String(args.to).trim()
      const value = convertUnit(Number(args.value), from, to)
      return { summary: clip(`已换算 ${args.value} ${from} = ${value} ${to}`), result: { value } }
    },
  },
  web_search: {
    description: CHAT_TOOLS.web_search.description,
    run: CHAT_TOOLS.web_search.run,
  },
}

const TOOLS_BY_MODE = { chat: CHAT_TOOLS, work: WORK_TOOLS }

// 流式前缀门按并集识别工具 JSON：跨模式调用也要拦截下来交给模式门回喂，
// 避免把工具 JSON 原文推给用户。
const ALL_TOOL_NAMES = new Set([...Object.keys(CHAT_TOOLS), ...Object.keys(WORK_TOOLS)])


/** 生成工具使用系统提示（含当天日期，供相对日期解析）。 */
export function buildToolSystemPrompt(mode = 'chat', today = new Date()) {
  const catalog = Object.values(TOOLS_BY_MODE[mode] || CHAT_TOOLS).map((t) => t.description).join('\n')
  return [
    '你可以使用工具帮用户办事（仅当用户明确要求做这些事时使用；普通聊天、情绪陪伴绝对不要用）。',
    catalog,
    '规则：',
    '- 调用工具时，整个回复只能是一个 JSON 对象（不要输出任何其它文字、不要用代码块包裹）。',
    '- 工具执行结果会以 system 消息反馈给你，然后你用人格语气正常回复用户，不要复述 JSON 或工具细节。',
    '- 不要编造工具执行结果；失败时结果里会写明原因，你可以据此向用户解释或修正后重试。',
    '- 不要只在口头上声称已经记下/设置/删除：没有调用工具就等于没有执行。',
    '- 一次只调用一个工具；需要多个时分多轮进行。',
    `- 涉及今天/明天/下周等相对日期时，今天是 ${toDateOnly(today)}（本地日历日）。`,
  ].join('\n')
}

/** 字符串感知的括号配平：返回首个完整 JSON 对象的结束索引（不含），未配平返回 -1。 */
function balancedJsonEnd(text) {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
      if (depth < 0) return -1
    }
  }
  return -1
}

/**
 * 流式前缀分类：判定累计文本是工具调用还是自然语言。
 * 返回 'natural' | 'pending' | { name, args }。
 * 协议要求工具回复以 { 开头且整段为单个 JSON 对象，因此首个非空白字符即可分流。
 */
export function classifyToolPrefix(text) {
  const trimmed = text.replace(/^\s+/, '')
  // 空白-only 分片（推理模型常见：先吐换行/空格）必须保持待定，否则会误判自然语言放行工具 JSON
  if (!trimmed) return 'pending'
  if (!trimmed.startsWith('{')) return 'natural'
  const end = balancedJsonEnd(trimmed)
  if (end === -1) {
    return trimmed.length >= TOOLCALL_PARSE_CAP ? 'natural' : 'pending'
  }
  try {
    const parsed = JSON.parse(trimmed.slice(0, end + 1))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && typeof parsed.tool === 'string' && ALL_TOOL_NAMES.has(parsed.tool)) {
      const args = parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args) ? parsed.args : {}
      return { name: parsed.tool, args }
    }
    return 'natural'
  } catch {
    return 'natural'
  }
}

/** 非流式整段解析：回复整体为单个工具调用 JSON 时返回 { name, args }，否则 null。 */
export function parseCompleteToolCall(content) {
  if (typeof content !== 'string') return null
  const trimmed = content.trim()
  if (!trimmed.startsWith('{')) return null
  const verdict = classifyToolPrefix(trimmed)
  return verdict === 'natural' || verdict === 'pending' ? null : verdict
}

/**
 * 执行一次工具调用。成功/失败都返回统一形状，绝不抛出（错误反馈给模型重试）：
 * { tool, ok, summary, feedback } — summary 用于界面动作标签，feedback 为回喂模型的 system 文本。
 */
export async function executeToolCall(userId, { name, args }, mode = 'chat') {
  const catalog = TOOLS_BY_MODE[mode] || CHAT_TOOLS
  const tool = catalog[name]
  if (!tool) {
    // 模式门：工具存在于其它模式的注册表时给出模式不可用反馈，真正未知的名字维持原语义
    if (Object.hasOwn(CHAT_TOOLS, name) || Object.hasOwn(WORK_TOOLS, name)) {
      return {
        tool: name,
        ok: false,
        summary: '当前模式不支持该操作',
        feedback: `工具执行结果：{"tool":${JSON.stringify(name)},"ok":false,"error":"该工具在此模式不可用，直接用文字回复用户"}`,
      }
    }
    return {
      tool: name,
      ok: false,
      summary: '未知工具',
      feedback: `工具执行结果：{"tool":${JSON.stringify(name)},"ok":false,"error":"未知工具，请直接回复用户"}`,
    }
  }
  try {
    const { summary, result } = await tool.run(userId, args || {})
    return {
      tool: name,
      ok: true,
      summary,
      feedback: `工具执行结果：${JSON.stringify({ tool: name, ok: true, result })}（已完成，请直接用人格语气回复用户，不要再次调用同一工具。）`,
    }
  } catch (error) {
    const reason = error?.statusCode === 400 || error?.statusCode === 404
      ? error.message
      : '工具暂时不可用'
    return {
      tool: name,
      ok: false,
      summary: reason,
      feedback: `工具执行结果：${JSON.stringify({ tool: name, ok: false, error: reason })}`,
    }
  }
}

/**
 * 回路级去重执行：同一签名（工具名+参数）在同一轮对话回路中只真正执行一次。
 * 模型重复调用同一操作时不再落副作用，回喂“已执行”提示引导它直接回复。
 */
export async function executeToolCallOnce(userId, { name, args }, executedSignatures, mode = 'chat') {
  const catalog = TOOLS_BY_MODE[mode] || CHAT_TOOLS
  const signature = `${name}:${catalog[name]?.signatureOf ? catalog[name].signatureOf(args ?? {}) : JSON.stringify(args ?? {})}`
  if (executedSignatures.has(signature)) {
    return {
      tool: name,
      ok: true,
      summary: '该操作刚才已执行',
      deduplicated: true,
      feedback: `工具执行结果：${JSON.stringify({ tool: name, ok: true, deduplicated: true })}（同一操作刚才已成功执行，请勿重复调用，直接回复用户。）`,
    }
  }
  executedSignatures.add(signature)
  return executeToolCall(userId, { name, args }, mode)
}
