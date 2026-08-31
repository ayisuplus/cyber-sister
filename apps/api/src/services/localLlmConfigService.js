import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import { URL } from 'node:url'

export const LOCAL_LLM_CONFIG_ID = 'local'
export const LOCAL_LLM_PROVIDER = 'llamacpp'

const PRESETS = Object.freeze({
  host: 'http://host.docker.internal:8080/v1',
  development: 'http://127.0.0.1:8080/v1',
})
const MAX_PROBE_RESPONSE_BYTES = 256 * 1024
const DEFAULT_PROBE_TIMEOUT_MS = 3000
const DEFAULT_CHAT_PROBE_TIMEOUT_MS = 30000

function configError(code, message, statusCode = 400) {
  const error = new HttpError(message, statusCode)
  error.code = code
  return error
}

function probeError() {
  return configError('LOCAL_LLM_PROBE_FAILED', '无法连接 llama.cpp，请检查服务、地址和模型', 502)
}

function getProbeTimeoutMs() {
  const parsed = Number(process.env.LOCAL_LLM_PROBE_TIMEOUT_MS)
  if (!Number.isFinite(parsed) || parsed < 500) return DEFAULT_PROBE_TIMEOUT_MS
  return Math.min(parsed, 10000)
}

function getChatProbeTimeoutMs() {
  const parsed = Number(process.env.LOCAL_LLM_CHAT_PROBE_TIMEOUT_MS)
  if (!Number.isFinite(parsed) || parsed < 5000) return DEFAULT_CHAT_PROBE_TIMEOUT_MS
  return Math.min(parsed, 60000)
}

export function getAllowedLocalOrigins(env = process.env) {
  return new Set((env.LOCAL_LLM_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => new URL(value).origin))
}

/**
 * 只接受 origin 或 origin/v1，并将存储值规范化为 origin/v1。
 * 允许列表按精确 origin 匹配，不做子域、前缀或重定向匹配。
 */
export function normalizeAndAuthorizeBaseUrl(rawBaseUrl, env = process.env) {
  if (typeof rawBaseUrl !== 'string' || !rawBaseUrl.trim()) {
    throw configError('INVALID_LOCAL_LLM_CONFIG', 'baseUrl 不能为空')
  }

  let url
  try {
    url = new URL(rawBaseUrl.trim())
  } catch {
    throw configError('INVALID_LOCAL_LLM_CONFIG', 'baseUrl 必须是有效 URL')
  }

  if (!['http:', 'https:'].includes(url.protocol)
    || url.username || url.password || url.search || url.hash
    || !['/', '/v1', '/v1/'].includes(url.pathname)) {
    throw configError(
      'INVALID_LOCAL_LLM_CONFIG',
      'baseUrl 只能是不含凭据、参数或片段的 HTTP(S) origin 或 origin/v1',
    )
  }

  if (!getAllowedLocalOrigins(env).has(url.origin)) {
    throw configError('LOCAL_LLM_ORIGIN_NOT_ALLOWED', '该 llama.cpp origin 不在服务器允许列表中')
  }

  return `${url.origin}/v1`
}

function validateModel(model) {
  if (typeof model !== 'string' || !model.trim() || model.trim().length > 200) {
    throw configError('INVALID_LOCAL_LLM_CONFIG', 'model 必须是 1 到 200 个字符')
  }
  if (/\p{Cc}/u.test(model)) {
    throw configError('INVALID_LOCAL_LLM_CONFIG', 'model 不得包含控制字符')
  }
  return model.trim()
}

export function assertNoLocalApiKey(input = {}) {
  if (input.apiKey !== undefined && input.apiKey !== null && input.apiKey !== '') {
    throw configError('LOCAL_LLM_API_KEY_NOT_SUPPORTED', '当前版本不支持在页面中保存本地模型 API Key')
  }
  if (input.apiKeyAction !== undefined && !['keep', 'clear'].includes(input.apiKeyAction)) {
    throw configError('LOCAL_LLM_API_KEY_NOT_SUPPORTED', '当前版本不支持写入本地模型 API Key')
  }
}

async function fetchWithTimeout(url, init = {}, timeoutMs = getProbeTimeoutMs()) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.headers || {}),
      },
    })
  } finally {
    clearTimeout(timer)
  }
}

async function readJson(response) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROBE_RESPONSE_BYTES) throw probeError()
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_PROBE_RESPONSE_BYTES) throw probeError()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw probeError()
  }
}

function endpoint(baseUrl, path) {
  return `${baseUrl}/${path}`
}

async function fetchModels(baseUrl) {
  let response
  try {
    response = await fetchWithTimeout(endpoint(baseUrl, 'models'))
  } catch {
    throw probeError()
  }
  if (!response.ok) throw probeError()
  const body = await readJson(response)
  const models = [...new Set((Array.isArray(body?.data) ? body.data : [])
    .map((entry) => entry?.id)
    .filter((id) => typeof id === 'string'
      && id.trim()
      && id.trim().length <= 200
      && !/\p{Cc}/u.test(id))
    .map((id) => id.trim()))]
    .slice(0, 100)
  if (models.length === 0) throw probeError()
  return models
}

async function runChatProbe(baseUrl, model) {
  let response
  try {
    response = await fetchWithTimeout(endpoint(baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '请只回复：连接正常' }],
        temperature: 0,
        max_tokens: 12,
        stream: false,
      }),
    }, getChatProbeTimeoutMs())
  } catch {
    throw probeError()
  }
  if (!response.ok) throw probeError()
  const body = await readJson(response)
  if (typeof body?.choices?.[0]?.message?.content !== 'string'
    || !body.choices[0].message.content.trim()) {
    throw probeError()
  }
}

export async function probeLocalLlm(rawInput) {
  assertNoLocalApiKey(rawInput)
  const baseUrl = normalizeAndAuthorizeBaseUrl(rawInput?.baseUrl)

  let healthResponse
  try {
    healthResponse = await fetchWithTimeout(endpoint(baseUrl, 'health'))
  } catch {
    throw probeError()
  }
  if (healthResponse.status === 503) {
    return {
      baseUrl,
      models: [],
      model: null,
      state: 'loading',
      apiKeyConfigured: false,
    }
  }
  if (!healthResponse.ok) throw probeError()
  await readJson(healthResponse)

  const models = await fetchModels(baseUrl)
  const model = rawInput?.model === undefined || rawInput.model === null || rawInput.model === ''
    ? models[0]
    : validateModel(rawInput.model)
  if (!models.includes(model)) {
    throw configError('LOCAL_LLM_MODEL_NOT_FOUND', '所选模型未在 llama.cpp /v1/models 中找到')
  }
  await runChatProbe(baseUrl, model)

  return {
    baseUrl,
    models,
    model,
    state: 'ready',
    apiKeyConfigured: false,
  }
}

export async function detectLocalLlm(preset) {
  if (!Object.hasOwn(PRESETS, preset)) {
    throw configError('INVALID_LOCAL_LLM_PRESET', 'preset 必须是 host 或 development')
  }
  const result = await probeLocalLlm({ baseUrl: PRESETS[preset] })
  return { preset, ...result }
}

export function getStoredLocalConfig() {
  return prisma.llmRuntimeConfig.findUnique({ where: { id: LOCAL_LLM_CONFIG_ID } })
}

export function serializeLocalConfig(config) {
  if (!config) {
    return {
      enabled: false,
      baseUrl: null,
      model: null,
      revision: 0,
      lastVerifiedAt: null,
      apiKeyConfigured: false,
    }
  }
  return {
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    model: config.model,
    revision: config.revision,
    lastVerifiedAt: config.lastVerifiedAt,
    apiKeyConfigured: false,
  }
}

export async function saveLocalLlmConfig(userId, input) {
  assertNoLocalApiKey(input)
  if (typeof input?.enabled !== 'boolean') {
    throw configError('INVALID_LOCAL_LLM_CONFIG', 'enabled 必须是布尔值')
  }
  const baseUrl = normalizeAndAuthorizeBaseUrl(input.baseUrl)
  const model = validateModel(input.model)
  const verified = input.enabled ? await probeLocalLlm({ baseUrl, model }) : null
  if (input.enabled && verified.state !== 'ready') {
    throw configError('LOCAL_LLM_LOADING', 'llama.cpp 正在加载模型，请稍后再保存', 409)
  }
  const now = new Date()

  const saved = await prisma.llmRuntimeConfig.upsert({
    where: { id: LOCAL_LLM_CONFIG_ID },
    create: {
      id: LOCAL_LLM_CONFIG_ID,
      provider: LOCAL_LLM_PROVIDER,
      baseUrl,
      model,
      enabled: input.enabled,
      revision: 1,
      lastVerifiedAt: verified ? now : null,
      updatedByUserId: userId,
    },
    update: {
      provider: LOCAL_LLM_PROVIDER,
      baseUrl,
      model,
      enabled: input.enabled,
      revision: { increment: 1 },
      ...(verified ? { lastVerifiedAt: now } : {}),
      updatedByUserId: userId,
    },
  })
  return serializeLocalConfig(saved)
}

export async function checkLocalLlmState(config) {
  if (!config?.enabled) return config ? 'unavailable' : 'not_configured'
  try {
    const authorizedBaseUrl = normalizeAndAuthorizeBaseUrl(config.baseUrl)
    const response = await fetchWithTimeout(endpoint(authorizedBaseUrl, 'health'))
    if (response.ok) return 'ready'
    if (response.status === 503) return 'loading'
    return 'unavailable'
  } catch {
    return 'unavailable'
  }
}

export function isQwenConfigured(env = process.env) {
  return Boolean(env.GATEWAY_QWEN_BASE_URL && env.GATEWAY_QWEN_MODEL && env.GATEWAY_QWEN_API_KEY)
}
