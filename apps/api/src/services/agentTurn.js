import { buildToolSystemPrompt, buildNativeTools, executeToolCallOnce } from './agentService.js'
import { emit } from './extensionRuntime.js'
import { parseCompleteToolCall } from './toolProtocol.js'
import { closeWorkBrowser } from './workBrowserTools.js'
import { isLocalWorkRuntime } from '../config/distribution.js'
import { isUserBridgeOnline } from './bridgeBroker.js'

const MAX_TOOL_ROUNDS = 12
// 只是倾诉的一轮：不给工具目录，只留一句诚实规则
const CHAT_ONLY_PROMPT = '这一轮是聊天：不要调用工具，也不要说你做了、记下或设置了什么。'
const CHAT_ONLY_FEEDBACK = '（系统提示：这一轮没有开放工具，没有执行任何操作。请直接用正常语气回复她，不要再输出工具调用。）'

/**
 * JSON 与 SSE 共用的单轮工具状态；实例不跨用户或请求共享。
 * 只有一种对话：模型场景恒为 chat（保留她的说话方式）；本地运行时才有工具、进度事件与更大的上下文预算（agent）。
 * offerTools=false：这一轮只是倾诉，不给工具目录；模型硬要调用也不执行、不留记录。
 */
export function createAgentTurn({ userId, conversationId, history = [], systemMessages = [], signal, authorizeExternal, currentText, attachments = [], durable = null, offerTools = true }) {
  const agent = isLocalWorkRuntime()
  // 用户电脑上的本机助手此刻在线，才把它能做的事放进这一轮的工具目录
  const bridge = offerTools && isUserBridgeOnline(userId)
  const tools = offerTools ? buildNativeTools(durable?.allowedTools, { bridge }) : []
  const prompt = offerTools ? buildToolSystemPrompt(new Date(), tools.length > 0, durable?.allowedTools, { bridge }) : CHAT_ONLY_PROMPT
  const saved = durable?.snapshot
  const executedCalls = new Map(saved?.executedCalls || [])
  let rounds = saved?.rounds || 0
  let stalledRounds = saved?.stalledRounds || 0
  // tool_call/扩展 execute 的 terminate：这个动作之后不再接受工具调用，收个尾就结束
  let terminated = false
  const workspace = { artifacts: saved?.artifacts || [], attachments, signal }
  const snapshot = async () => ({
    rounds, stalledRounds, history: turn.history, toolRuns: turn.toolRuns, artifacts: workspace.artifacts,
    executedCalls: await Promise.all([...executedCalls].map(async ([key, value]) => [key, await value])),
  })
  const turn = {
    scene: 'chat',
    agent,
    userId,
    conversationId,
    offersTools: offerTools,
    tools,
    history: [...(saved?.history || history)],
    extraSystem: [
      ...systemMessages.filter(Boolean),
      { role: 'system', content: prompt },
    ],
    toolRuns: [...(saved?.toolRuns || [])],
    artifacts: workspace.artifacts,
    close: () => closeWorkBrowser(workspace),
    get forcedFinal() { return terminated || rounds >= MAX_TOOL_ROUNDS || stalledRounds >= 2 },
    get promptInHistory() { return rounds > 0 && currentText !== undefined },
    // turn_end { continue: true } 的续轮：把这轮问答并入历史再生成一次（轮数照计，防 continue 死循环）
    continueFrom(assistantText) {
      rounds += 1
      turn.history = [
        ...turn.history,
        ...(rounds === 1 && currentText !== undefined ? [{ role: 'user', content: currentText }] : []),
        { role: 'assistant', content: assistantText },
      ]
    },
    async execute(call, assistantText) {
      signal?.throwIfAborted()
      if (!offerTools) return declineTool(call, assistantText)
      await durable?.assertActive()
      if (durable) await durable.saveCheckpoint(await snapshot(), call.name)
      signal?.throwIfAborted()
      const run = durable?.allowedTools && !durable.allowedTools.includes(call.name)
        ? { tool: call.name, ok: false, summary: '后台任务不执行记录修改', feedback: '此后台任务只允许研究、计算和生成文件。需要增删改用户记录时，请交还给用户在对话中操作，不得声称已执行。' }
        : await executeToolCallOnce(userId, call, executedCalls, { signal, authorizeExternal, conversationId, workspace, requestAction: durable?.requestAction, requestMediaAction: durable?.requestMediaAction })
      signal?.throwIfAborted()
      rounds += 1
      stalledRounds = !run.ok || run.deduplicated ? stalledRounds + 1 : 0
      if (run.terminate) terminated = true
      const result = { tool: run.tool, ok: run.ok, summary: run.summary,
        // 待确认提案带上 args 一起落库：确认端点凭 (messageId, index) 就能执行
        ...(run.pending ? { pending: true, args: run.args } : {}), ...(run.artifact ? { artifact: run.artifact } : {}),
        ...(run.artifacts ? { artifacts: run.artifacts } : {}), ...(run.plan ? { plan: run.plan } : {}), ...(run.sources ? { sources: run.sources } : {}) }
      if (!run.deduplicated) turn.toolRuns.push(result)
      // 保留供应商兼容的 user 角色回喂，工具结果紧跟产生它的助手消息。
      turn.history = [
        ...turn.history,
        ...(rounds === 1 && currentText !== undefined ? [{ role: 'user', content: currentText }] : []),
        { role: 'assistant', content: assistantText },
        { role: 'user', content: run.feedback },
      ]
      if (turn.forcedFinal) {
        turn.history.push({ role: 'user', content: run.terminate ? '（系统提示：这个动作到此为止，请直接用正常语气回复用户，不要再输出工具 JSON。）' : '（系统提示：工具调用已达上限，请直接用正常语气回复用户，不要再输出工具 JSON。）' })
      }
      if (durable) await durable.saveCheckpoint(await snapshot(), null)
      signal?.throwIfAborted()
      return result
    },
  }
  // 倾诉的一轮里模型仍输出了工具调用：不执行、不进 toolRuns，回喂一句让她直接回复；连着两次就走兜底
  function declineTool(call, assistantText) {
    rounds += 1
    stalledRounds += 1
    turn.history = [
      ...turn.history,
      ...(rounds === 1 && currentText !== undefined ? [{ role: 'user', content: currentText }] : []),
      { role: 'assistant', content: assistantText },
      { role: 'user', content: CHAT_ONLY_FEEDBACK },
    ]
    return { tool: call.name, ok: false, summary: '这一轮不办事', declined: true }
  }
  return turn
}

/** pi 式统一事件循环；模型适配器负责协议和过滤，循环只管理轮次与工具。 */
async function* runLoop({ turn, generate, fallback, signal }) {
  const hookCtx = { userId: turn.userId, conversationId: turn.conversationId, signal }
  await emit('agent_start', { userId: turn.userId, conversationId: turn.conversationId }, hookCtx)
  let turnIndex = 0
  try {
    for (;;) {
      if (signal?.aborted) return
      let completion = null
      let call = null
      // eslint-disable-next-line no-await-in-loop -- 生命周期事件按轮次顺序广播
      await emit('turn_start', { turnIndex }, hookCtx)
      // 每轮必须等待上一轮完整结束；中断/错误是终态，不能处理迟到工具或 done。
      // eslint-disable-next-line no-await-in-loop
      for await (const event of generate(turn)) {
        if (signal?.aborted) return
        if (event.type === 'toolcall') { call = event; break }
        if (event.type === 'done') {
          completion = event
          call = parseCompleteToolCall(event.content)
          break
        }
        yield event
        if (event.type === 'error') return
      }
      if (signal?.aborted) return
      if (call && turn.forcedFinal) {
        completion = fallback()
        yield { type: 'replace', content: completion.content, source: completion.source }
        call = null
      }
      const toolResults = []
      if (call) {
        const step = turn.toolRuns.length
        // 倾诉的一轮不显示任何办事进度
        const showProgress = turn.agent && turn.offersTools !== false
        if (showProgress) yield { type: 'tool_progress', step, status: 'running', tool: call.name }
        if (signal?.aborted) return
        // eslint-disable-next-line no-await-in-loop
        toolResults.push(await turn.execute(call, completion?.content ?? JSON.stringify({ tool: call.name, args: call.args })))
        if (signal?.aborted) return
        if (showProgress) yield { type: 'tool_progress', step, status: toolResults[0].ok ? 'completed' : 'failed', ...toolResults[0] }
      }
      const assistantText = completion?.content ?? (call ? JSON.stringify({ tool: call.name, args: call.args }) : '')
      // eslint-disable-next-line no-await-in-loop
      const turnEnd = await emit('turn_end', { turnIndex, message: { role: 'assistant', content: assistantText }, toolResults }, hookCtx)
      turnIndex += 1
      if (call) continue
      // 无工具调用也想续写：任一 handler 返回 { continue: true } 再跑一轮生成，轮数上限不变
      if (turnEnd?.continue && turnIndex < MAX_TOOL_ROUNDS && !signal?.aborted) {
        turn.continueFrom(assistantText)
        continue
      }
      if (completion && !signal?.aborted) yield { ...completion, type: 'done', toolRuns: turn.toolRuns, artifacts: turn.artifacts }
      return
    }
  } finally {
    await emit('agent_end', { turnCount: turnIndex, toolRuns: turn.toolRuns }, hookCtx)
  }
}

export async function* runAgentLoop(options) {
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await options.turn.close?.()
  }
  try {
    for await (const event of runLoop(options)) {
      if (event.type === 'done' || event.type === 'error') await close()
      if (options.signal?.aborted) return
      yield event
    }
  } finally { await close() }
}
