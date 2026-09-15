import { WORK_MODE_PREAMBLE, buildToolSystemPrompt, buildNativeTools, executeToolCallOnce } from './agentService.js'
import { parseCompleteToolCall } from './toolProtocol.js'
import { closeWorkBrowser } from './workBrowserTools.js'

const MAX_TOOL_ROUNDS = 3
const MAX_WORK_TOOL_ROUNDS = 12

/** JSON 与 SSE 共用的单轮工具状态；实例不跨用户或请求共享。 */
export function createAgentTurn({ userId, conversationId, mode = 'chat', history = [], systemMessages = [], signal, authorizeExternal, currentText, attachments = [], durable = null }) {
  const scene = mode === 'work' ? 'work' : 'chat'
  const tools = buildNativeTools(scene, durable?.allowedTools)
  const prompt = buildToolSystemPrompt(scene, new Date(), tools.length > 0, durable?.allowedTools)
  const saved = durable?.snapshot
  const executedCalls = new Map(saved?.executedCalls || [])
  let rounds = saved?.rounds || 0
  let stalledRounds = saved?.stalledRounds || 0
  const workspace = { artifacts: saved?.artifacts || [], attachments, signal }
  const snapshot = async () => ({
    rounds, stalledRounds, history: turn.history, toolRuns: turn.toolRuns, artifacts: workspace.artifacts,
    executedCalls: await Promise.all([...executedCalls].map(async ([key, value]) => [key, await value])),
  })
  const turn = {
    scene,
    tools,
    history: [...(saved?.history || history)],
    extraSystem: [
      ...systemMessages.filter(Boolean),
      { role: 'system', content: scene === 'work' ? `${WORK_MODE_PREAMBLE}\n${prompt}` : prompt },
    ],
    toolRuns: [...(saved?.toolRuns || [])],
    artifacts: workspace.artifacts,
    close: () => closeWorkBrowser(workspace),
    get forcedFinal() { return rounds >= (scene === 'work' ? MAX_WORK_TOOL_ROUNDS : MAX_TOOL_ROUNDS) || stalledRounds >= 2 },
    get promptInHistory() { return rounds > 0 && currentText !== undefined },
    async execute(call, assistantText) {
      signal?.throwIfAborted()
      await durable?.assertActive()
      if (durable) await durable.saveCheckpoint(await snapshot(), call.name)
      signal?.throwIfAborted()
      const run = durable?.allowedTools && !durable.allowedTools.includes(call.name)
        ? { tool: call.name, ok: false, summary: '后台任务不执行记录修改', feedback: '此后台任务只允许研究、计算和生成文件。需要增删改用户记录时，请交还给用户在对话中操作，不得声称已执行。' }
        : await executeToolCallOnce(userId, call, executedCalls, scene, { signal, authorizeExternal, conversationId, workspace, requestAction: durable?.requestAction, requestMediaAction: durable?.requestMediaAction })
      signal?.throwIfAborted()
      rounds += 1
      stalledRounds = !run.ok || run.deduplicated ? stalledRounds + 1 : 0
      const result = { tool: run.tool, ok: run.ok, summary: run.summary, ...(run.artifact ? { artifact: run.artifact } : {}),
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
        turn.history.push({ role: 'user', content: '（系统提示：工具调用已达上限，请直接用正常语气回复用户，不要再输出工具 JSON。）' })
      }
      if (durable) await durable.saveCheckpoint(await snapshot(), null)
      signal?.throwIfAborted()
      return result
    },
  }
  return turn
}

/** pi 式统一事件循环；模型适配器负责协议和过滤，循环只管理轮次与工具。 */
async function* runLoop({ turn, generate, fallback, signal }) {
  for (;;) {
    if (signal?.aborted) return
    let completion = null
    let call = null
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
    if (!call) {
      if (completion && !signal?.aborted) yield { ...completion, type: 'done', toolRuns: turn.toolRuns, artifacts: turn.artifacts }
      return
    }
    const step = turn.toolRuns.length
    if (turn.scene === 'work') yield { type: 'tool_progress', step, status: 'running', tool: call.name }
    if (signal?.aborted) return
    // eslint-disable-next-line no-await-in-loop
    const result = await turn.execute(call, completion?.content ?? JSON.stringify({ tool: call.name, args: call.args }))
    if (signal?.aborted) return
    if (turn.scene === 'work') yield { type: 'tool_progress', step, status: result.ok ? 'completed' : 'failed', ...result }
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
