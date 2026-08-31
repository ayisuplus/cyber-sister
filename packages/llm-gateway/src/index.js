/**
 * 赛博姐妹统一 LLM 网关。
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
 * 环境变量（由 llmService.buildGatewayEnv 构造）：
 *   GATEWAY_PROVIDERS=llamacpp,qwen          启用的供应商
 *   GATEWAY_<NAME>_BASE_URL / _MODEL / _API_KEY
 *   GATEWAY_<NAME>_SCOPE=local|external      供应商作用域
 *   GATEWAY_<NAME>_SCENES=chat,explain       供应商承接的场景
 *   GATEWAY_<NAME>_PRIORITY=1                优先级（数字小者优先）
 *   GATEWAY_SCENE_chat=llamacpp,qwen         场景路由顺序（本地优先）
 *
 * 约束：
 * - 非流式（stream:false）；本地供应商失败重试 1 次，外部供应商不重试。
 * - 外部供应商仅在 allowExternal 且 authorizeExternal() === true 时调用，且每次调用前重新授权。
 * - 日志只记 requestId/scene/provider/model/attempt/latencyMs/result，绝不记录消息内容与密钥。
 */
import { getPersonaSystemPrompt } from './personas.js'

const DEFAULT_TIMEOUT_MS = 90_000
const LOCAL_MAX_ATTEMPTS = 2
const EXTERNAL_MAX_ATTEMPTS = 1

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

async function callOpenAiCompatible(provider, payload, timeoutMs) {
  const headers = { 'content-type': 'application/json' }
  if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`
  const response = await fetch(`${provider.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    const error = new Error(`provider http ${response.status}`)
    error.status = response.status
    throw error
  }
  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  return typeof content === 'string' && content.trim() ? content.trim() : null
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
    } = request || {}
    if (!scene || !Array.isArray(messages) || messages.length === 0) return null

    const candidates = routeForScene(scene)
    const finalMessages = buildRequestMessages({ scene, persona, messages, systemAppend })

    for (const provider of candidates) {
      if (provider.scope === 'external' && !(await isExternalCallAuthorized(request))) {
        continue
      }
      const maxAttempts = provider.scope === 'external' ? EXTERNAL_MAX_ATTEMPTS : LOCAL_MAX_ATTEMPTS
      const payload = { model: provider.model, messages: finalMessages, stream: false }
      if (Number.isFinite(maxTokens)) payload.max_tokens = maxTokens
      if (Number.isFinite(temperature)) payload.temperature = temperature

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const startedAt = Date.now()
        try {
          const content = await callOpenAiCompatible(provider, payload, timeoutMs)
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

  return { complete }
}

export { getPersonaSystemPrompt } from './personas.js'
