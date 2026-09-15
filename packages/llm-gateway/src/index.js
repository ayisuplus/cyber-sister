/**
 * Amie统一 LLM 网关。
 *
 * 契约（消费方：apps/api/src/services/llmService.js）：
 *   const gateway = await createGateway(env, { logger })
 *   const result = await gateway.complete({
 *     scene,            // 'chat' | 'explain'（对应 GATEWAY_SCENE_<scene> 路由）
 *     requestId,        // 仅用于日志关联
 *     persona,          // chat 场景可选：toxic | gentle | rational
 *     messages,         // [{ role: 'user'|'assistant', content }]
 *     systemAppend,     // 追加的 system 消息（如记忆上下文），置于人格提示词之后
 *     allowExternal,    // 用户级开关：本次请求是否允许使用外部模型
 *     authorizeExternal,// 服务端门控：async () => boolean，每次外部调用前重新读取
 *     timeoutMs, maxTokens, temperature,
 *   })
 *   // 成功 → { content, provider, model, scope: 'local'|'external' }
 *   // 失败 → null（由调用方决定降级策略）
 *
 * 流式契约（消费方：apps/api 的分句安全 SSE 路由）：
 *   const events = gateway.stream({ ...同 complete 参数, signal })
 *   // async iterable，依次产出：
 *   //   { type: 'delta', text }                      增量文本块
 *   //   { type: 'done', provider, model, scope }     正常结束（最终供应商来源）
 *   //   { type: 'error', reason }                   失败结束；reason 为固定代码
 *   //     （'invalid_request' | 'all_providers_failed' | 'upstream_error'），绝不含对话内容
 *   // 失败语义与 complete 一致：不抛出，以 error 事件收尾（complete 失败返回 null）。
 *   // 调用方 abort signal → 迭代安静结束（无 done/error 事件）。
 *   // 不变量：一旦已产出任何 delta，禁止重试与切换供应商，上游异常直接以
 *   // { type:'error', reason:'upstream_error' } 结束流；授权回退只发生在首个内容块之前。
 *
 * 环境变量（由 llmService.buildGatewayEnv 构造）：
 *   GATEWAY_PROVIDERS=llamacpp,qwen          启用的供应商
 *   GATEWAY_<NAME>_BASE_URL / _MODEL / _API_KEY
 *   GATEWAY_<NAME>_SCOPE=local|external      供应商作用域
 *   GATEWAY_<NAME>_SCENES=chat,explain       供应商承接的场景
 *   GATEWAY_<NAME>_PRIORITY=1                优先级（数字小者优先）
 *   GATEWAY_SCENE_chat=llamacpp,qwen         场景路由顺序（本地优先）
 *
 * 约束：
 * - complete 非流式（stream:false），stream 流式（stream:true）；供应商失败最多重试 1 次，外部每次尝试均重新授权。
 * - 外部供应商仅在 allowExternal 且 authorizeExternal() === true 时调用，且每次调用前重新授权。
 * - 日志只记 requestId/scene/provider/model/attempt/latencyMs/result，绝不记录消息内容与密钥。
 */
import { getPersonaSystemPrompt } from './personas.js'

/* global AbortSignal, TextDecoder */
// 推理模型（dots 等）多轮工具回路下单轮可能超过 90s，留足余量
const DEFAULT_TIMEOUT_MS = 180_000
const LOCAL_MAX_ATTEMPTS = 2
// dots 等预览端点偶发超时/断流，多给一次重试机会
const EXTERNAL_MAX_ATTEMPTS = 2

function parseProviderConfig(env, name) {
  const key = name.toUpperCase()
  const baseUrl = env[`GATEWAY_${key}_BASE_URL`]
  const model = env[`GATEWAY_${key}_MODEL`]
  if (!baseUrl || !model) return null
  return {
    name,
    baseUrl: String(baseUrl).replace(/\/+$/, ''),
    model,
    apiKey: env[`GATEWAY_${key}_API_KEY`] || '',
    scope: env[`GATEWAY_${key}_SCOPE`] === 'external' ? 'external' : 'local',
    scenes: String(env[`GATEWAY_${key}_SCENES`] || '')
      .split(',').map((s) => s.trim()).filter(Boolean),
    priority: Number.parseInt(env[`GATEWAY_${key}_PRIORITY`] || '99', 10) || 99,
  }
}

function buildRequestMessages({ scene, persona, messages, systemAppend }) {
  const systemMessages = []
  if (scene === 'chat') {
    systemMessages.push({ role: 'system', content: getPersonaSystemPrompt(persona) })
  }
  if (Array.isArray(systemAppend)) {
    for (const item of systemAppend) {
      if (item?.role === 'system' && typeof item.content === 'string' && item.content.trim()) {
        systemMessages.push({ role: 'system', content: item.content })
      }
    }
  }
  return [...systemMessages, ...messages]
}

async function callOpenAiCompatible(provider, payload, timeoutMs, signal) {
  const headers = { 'content-type': 'application/json' }
  if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`
  // OpenAI 兼容约定：baseUrl 已含 /v1（与 llama.cpp、DashScope、OpenAI SDK 一致）
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  })
  if (!response.ok) {
    const error = new Error(`provider http ${response.status}`)
    error.status = response.status
    throw error
  }
  const data = await response.json()
  if (payload.tools?.length && data?.choices?.[0]?.message?.tool_calls?.length) {
    const call = nativeToolCall(data.choices[0].message.tool_calls, data.choices[0].finish_reason)
    return JSON.stringify({ tool: call.name, args: call.args })
  }
  const content = data?.choices?.[0]?.message?.content
  return typeof content === 'string' && content.trim() ? content.trim() : null
}

const SSE_FRAME_SEPARATOR = /\r\n\r\n|\n\n/

function nativeToolCall(calls, finishReason) {
  const malformed = { name: '__malformed__', args: {} }
  if (calls.length !== 1 || finishReason !== 'tool_calls') return malformed
  const fn = calls[0]?.function
  if (typeof fn?.name !== 'string' || !fn.name || fn.name.length > 128 || typeof fn.arguments !== 'string' || fn.arguments.length > 256000) return malformed
  try {
    const args = JSON.parse(fn.arguments)
    return args && typeof args === 'object' && !Array.isArray(args) ? { name: fn.name, args } : malformed
  } catch { return malformed }
}

function parseSseFrame(frame) {
  // 一帧内允许多行 data:，按 SSE 规范以 \n 拼接。
  const dataLines = []
  for (const line of frame.split(/\r\n|\n/)) {
    if (line.startsWith('data:')) {
      dataLines.push(line.startsWith('data: ') ? line.slice(6) : line.slice(5))
    }
  }
  if (dataLines.length === 0) return null
  const data = dataLines.join('\n')
  if (data === '[DONE]') return { done: true }
  let parsed
  try {
    parsed = JSON.parse(data)
  } catch {
    throw new Error('provider stream malformed frame')
  }
  const choice = parsed?.choices?.[0]
  return choice ? { text: typeof choice.delta?.content === 'string' ? choice.delta.content : '', toolCalls: choice.delta?.tool_calls, finishReason: choice.finish_reason } : null
}

/**
 * 以 OpenAI 兼容 SSE 协议流式调用供应商，产出 content delta 字符串。
 * 正常以 data:[DONE] 收尾；未收到 [DONE] 即断流视为上游异常（throw）。
 * 调用方 signal 触发时中断 fetch 并抛 AbortError。
 */
async function* streamOpenAiCompatible(provider, payload, timeoutMs, signal) {
  const headers = { 'content-type': 'application/json' }
  if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  })
  if (!response.ok) {
    const error = new Error(`provider http ${response.status}`)
    error.status = response.status
    throw error
  }
  if (!response.body) throw new Error('provider empty stream')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let sawDone = false
  const calls = new Map()
  let finishReason
  const collectNative = (event) => {
    if (event?.finishReason) finishReason = event.finishReason
    if (!payload.tools?.length || !Array.isArray(event?.toolCalls)) return false
    for (const part of event.toolCalls) {
      if (!Number.isSafeInteger(part.index) || part.index < 0 || part.index > 7) throw new Error('provider invalid tool index')
      const call = calls.get(part.index) || { function: { name: '', arguments: '' } }
      if (typeof part.function?.name === 'string') call.function.name += part.function.name
      if (typeof part.function?.arguments === 'string') call.function.arguments += part.function.arguments
      if (call.function.name.length > 128 || call.function.arguments.length > 256000) throw new Error('provider tool output too large')
      calls.set(part.index, call)
    }
    return event.toolCalls.length > 0
  }
  try {
    for (;;) {
      // SSE 分片只能串行读取，禁用 no-await-in-loop 是刻意的。
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > 1024 * 1024) throw new Error('provider stream frame too large')
      for (;;) {
        const match = SSE_FRAME_SEPARATOR.exec(buffer)
        if (!match) break
        // 未完整的尾帧留在 buffer，等待后续分片。
        const event = parseSseFrame(buffer.slice(0, match.index))
        buffer = buffer.slice(match.index + match[0].length)
        if (event?.done) {
          sawDone = true
          if (calls.size) yield { type: 'toolcall', ...nativeToolCall([...calls.values()], finishReason) }
          return
        }
        if (collectNative(event)) yield { type: 'tool_pending' }
        if (event?.text) yield { type: 'delta', text: event.text }
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) {
      const event = parseSseFrame(buffer)
      if (event?.done) {
        sawDone = true
        if (calls.size) yield { type: 'toolcall', ...nativeToolCall([...calls.values()], finishReason) }
      } else {
        if (collectNative(event)) yield { type: 'tool_pending' }
        if (event?.text) yield { type: 'delta', text: event.text }
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  if (!sawDone) throw new Error('provider stream ended without [DONE]')
}

function noopLogger() {
  return { info() {}, warn() {}, error() {} }
}

/**
 * @param {object} env 进程环境（通常由 llmService.buildGatewayEnv 构造）
 * @param {{ logger?: object }} [options]
 */
export async function createGateway(env = process.env, { logger } = {}) {
  const log = logger || noopLogger()
  const enabledNames = String(env.GATEWAY_PROVIDERS || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  const providers = new Map()
  for (const name of enabledNames) {
    const config = parseProviderConfig(env, name)
    if (config) providers.set(name, config)
  }

  function routeForScene(scene) {
    const route = String(env[`GATEWAY_SCENE_${scene}`] || enabledNames.join(','))
      .split(',').map((s) => s.trim()).filter(Boolean)
    return route
      .map((name) => providers.get(name))
      .filter((p) => p && (p.scenes.length === 0 || p.scenes.includes(scene)))
      .sort((a, b) => a.priority - b.priority)
  }

  async function isExternalCallAuthorized(request) {
    if (!request.allowExternal) return false
    if (typeof request.authorizeExternal !== 'function') return false
    try {
      // 每次外部调用前重新读取授权，不缓存。
      return (await request.authorizeExternal()) === true
    } catch {
      return false
    }
  }

  async function complete(request) {
    const {
      scene,
      requestId,
      persona,
      messages = [],
      systemAppend = [],
      timeoutMs = DEFAULT_TIMEOUT_MS,
      maxTokens,
      temperature,
      signal,
    } = request || {}
    if (!scene || !Array.isArray(messages) || messages.length === 0) return null

    const candidates = routeForScene(scene)
    const finalMessages = buildRequestMessages({ scene, persona, messages, systemAppend })

    for (const provider of candidates) {
      const maxAttempts = provider.scope === 'external' ? EXTERNAL_MAX_ATTEMPTS : LOCAL_MAX_ATTEMPTS
      const payload = { model: provider.model, messages: finalMessages, stream: false }
      if (request.tools?.length) Object.assign(payload, { tools: request.tools, tool_choice: 'auto', parallel_tool_calls: false })
      if (Number.isFinite(maxTokens)) payload.max_tokens = maxTokens
      if (Number.isFinite(temperature)) payload.temperature = temperature

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (signal?.aborted) return null
        // 每次 HTTP 尝试前读取授权，重试不能复用上一次同意。
        // eslint-disable-next-line no-await-in-loop
        if (provider.scope === 'external' && !(await isExternalCallAuthorized(request))) break
        if (signal?.aborted) return null
        const startedAt = Date.now()
        try {
          // 失败重试必须串行等待上一次结果。
          // eslint-disable-next-line no-await-in-loop
          const content = await callOpenAiCompatible(provider, payload, timeoutMs, signal)
          if (signal?.aborted) return null
          const latencyMs = Date.now() - startedAt
          if (content) {
            log.info({
              requestId, scene, provider: provider.name, model: provider.model,
              attempt, latencyMs, result: 'ok',
            }, 'llm gateway completion')
            return { content, provider: provider.name, model: provider.model, scope: provider.scope }
          }
          log.warn({
            requestId, scene, provider: provider.name, model: provider.model,
            attempt, latencyMs, result: 'empty',
          }, 'llm gateway empty completion')
        } catch (error) {
          if (signal?.aborted) return null
          const latencyMs = Date.now() - startedAt
          const status = error?.status
          log.warn({
            requestId, scene, provider: provider.name, model: provider.model,
            attempt, latencyMs, result: status ? `http_${status}` : 'error',
          }, 'llm gateway attempt failed')
          // 4xx 属于确定性失败，重试无意义。
          if (status && status >= 400 && status < 500) break
        }
      }
    }
    return null
  }

  /**
   * 流式版本：与 complete 同参，附加 signal（AbortSignal，取消时安静结束迭代）。
   * 产出 { type:'delta', text } / { type:'done', provider, model, scope } /
   * { type:'error', reason }（reason 为固定代码，绝不含对话内容）。
   * 失败不抛出，与 complete 失败返回 null 的语义一致。
   */
  async function* stream(request) {
    const {
      scene,
      requestId,
      persona,
      messages = [],
      systemAppend = [],
      timeoutMs = DEFAULT_TIMEOUT_MS,
      maxTokens,
      temperature,
      signal,
    } = request || {}
    if (!scene || !Array.isArray(messages) || messages.length === 0) {
      yield { type: 'error', reason: 'invalid_request' }
      return
    }
    if (signal?.aborted) return

    const candidates = routeForScene(scene)
    const finalMessages = buildRequestMessages({ scene, persona, messages, systemAppend })

    // 不变量：一旦已产出任何 delta，禁止重试与切换供应商；
    // 此后任何上游异常都直接以 error 事件结束流。
    let emitted = false

    for (const provider of candidates) {
      if (emitted) break
      const maxAttempts = provider.scope === 'external' ? EXTERNAL_MAX_ATTEMPTS : LOCAL_MAX_ATTEMPTS
      const payload = { model: provider.model, messages: finalMessages, stream: true }
      if (request.tools?.length) Object.assign(payload, { tools: request.tools, tool_choice: 'auto', parallel_tool_calls: false })
      if (Number.isFinite(maxTokens)) payload.max_tokens = maxTokens
      if (Number.isFinite(temperature)) payload.temperature = temperature

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (emitted) break
        if (signal?.aborted) return
        // eslint-disable-next-line no-await-in-loop
        if (provider.scope === 'external' && !(await isExternalCallAuthorized(request))) break
        if (signal?.aborted) return
        const startedAt = Date.now()
        let produced = 0
        try {
          // 失败重试必须串行等待上一次流结束。
          // eslint-disable-next-line no-await-in-loop
          for await (const event of streamOpenAiCompatible(provider, payload, timeoutMs, signal)) {
            if (signal?.aborted) return
            emitted = true
            if (event.type === 'tool_pending') continue
            produced += 1
            yield event
          }
          if (signal?.aborted) return
          const latencyMs = Date.now() - startedAt
          if (produced === 0) {
            // 空流与 complete 的空回复同语义：未产出内容，允许重试/换供应商。
            log.warn({
              requestId, scene, provider: provider.name, model: provider.model,
              attempt, latencyMs, result: 'empty',
            }, 'llm gateway empty stream')
            continue
          }
          log.info({
            requestId, scene, provider: provider.name, model: provider.model,
            attempt, latencyMs, result: 'ok',
          }, 'llm gateway stream completed')
          yield { type: 'done', provider: provider.name, model: provider.model, scope: provider.scope }
          return
        } catch (error) {
          const latencyMs = Date.now() - startedAt
          if (signal?.aborted) {
            log.info({
              requestId, scene, provider: provider.name, model: provider.model,
              attempt, latencyMs, result: 'aborted',
            }, 'llm gateway stream aborted')
            return
          }
          const status = error?.status
          log.warn({
            requestId, scene, provider: provider.name, model: provider.model,
            attempt, latencyMs, result: status ? `http_${status}` : 'error',
          }, 'llm gateway stream attempt failed')
          if (emitted) {
            // 已产出内容，不得重试或切换供应商，原样结束流。
            yield { type: 'error', reason: 'upstream_error' }
            return
          }
          // 4xx 属于确定性失败，重试无意义。
          if (status && status >= 400 && status < 500) break
        }
      }
    }
    if (!signal?.aborted) yield { type: 'error', reason: 'all_providers_failed' }
  }

  return { complete, stream }
}

export { getPersonaSystemPrompt } from './personas.js'
