/**
 * 自定义模型供应商（2026-09-22）：实例管理员在应用里配置多家 OpenAI 兼容服务，
 * 网关按 priority 依次切换，不再绑死单一家厂商的环境变量槽。
 *
 * 约定：
 * - 协议只有 OpenAI 兼容 chat completions（DeepSeek、DashScope 兼容模式、Moonshot、
 *   智谱、硅基流动、火山方舟、自建 vLLM / Ollama 都走这一个协议）；
 * - key 只以 AES-256-GCM 密文入库（api_key_encrypted），主密钥来自只读文件
 *   MODEL_CONFIG_KEY_FILE（64 位十六进制 = 32 字节）；主密钥缺失或格式不对一律明确报错，
 *   绝不静默降级成明文或不加密；
 * - 读接口只回 hasKey，明文 key 只在本进程内存里交给网关装配，不进响应、不进日志；
 * - base_url 三项校验：必须 https（只有本机运行时允许 http://127.0.0.1）、不得内嵌凭据、
 *   不得指向内网/回环/链路本地地址；真发请求前再按 DNS 解析结果查一次（防 SSRF）。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { lookup as dnsLookup } from 'node:dns/promises'
import ipaddr from 'ipaddr.js'
import { safeProviderFetch } from '@cyber-sister/llm-gateway/safe-fetch'
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import { isLocalWorkRuntime } from '../config/distribution.js'
import logger from '../utils/logger.js'

export const SCENES = ['chat', 'explain', 'work']
export const MAX_PROVIDERS = 8
export const MAX_NAME = 40
export const MAX_MODEL = 120
export const MAX_BASE_URL = 2048
export const MAX_API_KEY = 512
// 试一下是最小请求（max_tokens=1），超时留得比正式聊天短
export const TEST_TIMEOUT_MS = 30_000

const MASTER_KEY_PATTERN = /^[0-9a-fA-F]{64}$/
const CIPHER = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_VERSION = 'v1'
const LOCAL_LOOPBACK = '127.0.0.1'

const text = (value) => (typeof value === 'string' ? value.trim() : '')

/**
 * 主密钥只从只读文件读，且必须是 32 字节的十六进制。缺了就明确报错：
 * 没有主密钥时既不能存也不能读 key，宁可让配置写不进去，也不静默降级。
 */
export function loadMasterKey(env = process.env) {
  const path = text(env.MODEL_CONFIG_KEY_FILE)
  if (!path) throw new HttpError('没有配置模型主密钥文件（MODEL_CONFIG_KEY_FILE），无法保存密钥', 503)
  let raw
  try {
    raw = readFileSync(path, 'utf8').trim()
  } catch {
    throw new HttpError('模型主密钥文件读不到，请检查 MODEL_CONFIG_KEY_FILE', 503)
  }
  if (!MASTER_KEY_PATTERN.test(raw)) throw new HttpError('模型主密钥必须是 64 位十六进制（32 字节）', 503)
  return Buffer.from(raw, 'hex')
}

/** AES-256-GCM：v1:<iv>:<tag>:<密文>，每段都是 base64url。 */
export function encryptApiKey(plain, env = process.env) {
  const key = text(plain)
  if (!key) return null
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(CIPHER, loadMasterKey(env), iv)
  const encrypted = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()])
  return [KEY_VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join(':')
}

/** 解不开就是配置或数据出了问题（换过主密钥、密文被改），抛出可读的错误，不返回空串。 */
export function decryptApiKey(payload, env = process.env) {
  if (!payload) return ''
  const [version, iv, tag, data] = String(payload).split(':')
  if (version !== KEY_VERSION || !iv || !tag || !data) throw new HttpError('密钥密文格式不对，请重新保存一次', 503)
  const key = loadMasterKey(env)
  try {
    const decipher = createDecipheriv(CIPHER, key, Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    throw new HttpError('密钥解不开（主密钥换过或被改动），请重新保存一次密钥', 503)
  }
}

/** 名字层面先挡一遍本机与内网：解析结果在真正发请求前再挡一遍。 */
function assertPublicHostName(host) {
  if (host === 'localhost' || /\.(?:_?local|localhost|internal|localdomain)$/i.test(host)) {
    throw new HttpError('接口地址不能指向本机或内网', 400)
  }
  if (ipaddr.isValid(host) && ipaddr.process(host).range() !== 'unicast') {
    throw new HttpError('接口地址不能指向本机或内网', 400)
  }
}

/**
 * 接口地址三项校验：https（本机运行时例外允许 http://127.0.0.1）、不得内嵌凭据、
 * 不得指向内网/回环/链路本地地址。返回规范化后的地址（去掉末尾斜杠与片段）。
 */
export function validateBaseUrl(value, env = process.env) {
  const raw = text(value)
  if (!raw) throw new HttpError('接口地址必填', 400)
  if (raw.length > MAX_BASE_URL) throw new HttpError('接口地址太长', 400)
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new HttpError('接口地址必须是完整的 URL（含 https://）', 400)
  }
  if (url.username || url.password) throw new HttpError('接口地址里不能写账号密码', 400)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  // 本机白盒运行时（APP_DISTRIBUTION=local 且只绑回环）允许自建端点的明文回环地址
  const localEndpoint = isLocalWorkRuntime(env) && host === LOCAL_LOOPBACK
  if (url.protocol !== 'https:' && !(localEndpoint && url.protocol === 'http:')) {
    throw new HttpError('接口地址必须用 https（只有本机运行时允许 http://127.0.0.1）', 400)
  }
  if (!localEndpoint) assertPublicHostName(host)
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

/** 网关侧的供应商槽名：只由 id 推出，稳定、不会因显示名重名而互相覆盖。 */
export const gatewayProviderName = (id) => `mp${String(id).replace(/[^a-z0-9]/gi, '').toLowerCase()}`

export const parseScenes = (value) => String(value || '').split(',').map((scene) => scene.trim()).filter(Boolean)
const serializeScenes = (scenes) => scenes.join(',')

function checkName(value) {
  const name = text(value)
  if (!name) throw new HttpError('显示名必填', 400)
  if (name.length > MAX_NAME) throw new HttpError(`显示名最多 ${MAX_NAME} 个字`, 400)
  return name
}

function checkModel(value) {
  const model = text(value)
  if (!model) throw new HttpError('模型名必填', 400)
  if (model.length > MAX_MODEL) throw new HttpError(`模型名最多 ${MAX_MODEL} 个字`, 400)
  return model
}

function checkScenes(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',')
  const scenes = [...new Set(list.map((scene) => text(scene)).filter(Boolean))]
  if (scenes.length === 0) throw new HttpError('至少要选一个用途', 400)
  if (scenes.some((scene) => !SCENES.includes(scene))) throw new HttpError('用途只能是 chat / explain / work', 400)
  return scenes
}

function checkEnabled(value) {
  if (typeof value !== 'boolean') throw new HttpError('启用状态只能是 true 或 false', 400)
  return value
}

/** apiKey 只在传了非空字符串时写入；传 '' 或 null 表示清掉（自建端点常常不需要 key）。 */
function checkApiKey(value, env) {
  const key = text(value)
  if (!key) return null
  if (key.length > MAX_API_KEY) throw new HttpError('密钥太长', 400)
  return encryptApiKey(key, env)
}

/** 给接口看的形状：只有 hasKey，永远没有密文与明文。 */
function toClient(row) {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    model: row.model,
    scenes: parseScenes(row.scenes),
    priority: row.priority,
    enabled: row.enabled,
    hasKey: Boolean(row.apiKeyEncrypted),
    updatedBy: row.updatedBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** 审计只记谁动了哪一家，绝不记 key 与地址之外的细节；logger 的键白名单也挡一层。 */
function audit(userId, action, row) {
  logger.info('模型供应商配置变更', { action, userId, provider: row.name })
}

/** 列表按优先级排，管理界面直接照这个顺序显示。 */
export async function listProviders() {
  const rows = await prisma.modelProvider.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] })
  return rows.map(toClient)
}

export async function createProvider(userId, fields = {}, env = process.env) {
  const count = await prisma.modelProvider.count()
  if (count >= MAX_PROVIDERS) throw new HttpError(`最多配 ${MAX_PROVIDERS} 家供应商`, 400)
  const last = await prisma.modelProvider.findFirst({ orderBy: { priority: 'desc' }, select: { priority: true } })
  const row = await prisma.modelProvider.create({
    data: {
      name: checkName(fields.name),
      baseUrl: validateBaseUrl(fields.baseUrl, env),
      model: checkModel(fields.model),
      scenes: serializeScenes(fields.scenes === undefined ? ['chat'] : checkScenes(fields.scenes)),
      priority: (last?.priority ?? 0) + 1,
      enabled: fields.enabled === undefined ? true : checkEnabled(fields.enabled),
      apiKeyEncrypted: checkApiKey(fields.apiKey, env),
      updatedBy: userId,
    },
  })
  audit(userId, 'model_provider.create', row)
  return toClient(row)
}

/** 只改传了的字段；apiKey 没传就不动，传空串或 null 就是清掉。 */
export async function updateProvider(userId, id, fields = {}, env = process.env) {
  const existing = await prisma.modelProvider.findUnique({ where: { id } })
  if (!existing) throw new HttpError('没有这个供应商', 404)
  const data = { updatedBy: userId }
  if (fields.name !== undefined) data.name = checkName(fields.name)
  if (fields.baseUrl !== undefined) data.baseUrl = validateBaseUrl(fields.baseUrl, env)
  if (fields.model !== undefined) data.model = checkModel(fields.model)
  if (fields.scenes !== undefined) data.scenes = serializeScenes(checkScenes(fields.scenes))
  if (fields.enabled !== undefined) data.enabled = checkEnabled(fields.enabled)
  if (fields.apiKey !== undefined) data.apiKeyEncrypted = checkApiKey(fields.apiKey, env)
  if (Object.keys(data).length === 1) throw new HttpError('没有要改的内容', 400)
  const row = await prisma.modelProvider.update({ where: { id }, data })
  audit(userId, 'model_provider.update', row)
  return toClient(row)
}

export async function deleteProvider(userId, id) {
  const existing = await prisma.modelProvider.findUnique({ where: { id } })
  if (!existing) throw new HttpError('没有这个供应商', 404)
  await prisma.modelProvider.delete({ where: { id } })
  audit(userId, 'model_provider.delete', existing)
}

/** 排序：按传入的 id 顺序把 priority 重写成 1..n，必须正好覆盖现有的全部供应商。 */
export async function reorderProviders(userId, ids) {
  const order = (Array.isArray(ids) ? ids : []).map((id) => text(id)).filter(Boolean)
  const rows = await prisma.modelProvider.findMany({ select: { id: true, name: true } })
  if (order.length !== rows.length || new Set(order).size !== rows.length || rows.some((row) => !order.includes(row.id))) {
    throw new HttpError('排序要用现在全部供应商的 id，一个都不能少', 400)
  }
  await prisma.$transaction(order.map((id, index) => prisma.modelProvider.update({ where: { id }, data: { priority: index + 1, updatedBy: userId } })))
  const byId = new Map(rows.map((row) => [row.id, row]))
  logger.info('模型供应商排序变更', { action: 'model_provider.reorder', userId, provider: byId.get(order[0])?.name })
  return listProviders()
}

/** 真发请求前的第二道闸：按 DNS 解析结果拒绝内网/回环/链路本地。 */
async function assertPublicHost(baseUrl, env, lookupImpl) {
  const url = new URL(baseUrl)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isLocalWorkRuntime(env) && host === LOCAL_LOOPBACK) return
  let records
  try {
    records = await lookupImpl(host, { all: true, verbatim: true })
  } catch {
    throw new HttpError('接口地址解析不了，请核对域名', 400)
  }
  if (!records.length || records.some(({ address }) => !ipaddr.isValid(address) || ipaddr.process(address).range() !== 'unicast')) {
    throw new HttpError('接口地址解析到本机或内网，拒绝连接', 400)
  }
}

const connectFailure = (error) => (error?.name === 'TimeoutError' || error?.name === 'AbortError'
  ? new HttpError(`试一下超时了（${TEST_TIMEOUT_MS / 1000} 秒）`, 502)
  : new HttpError('连不上这个接口地址', 502))

/** 发一次最小请求；连不上与超时都换成稳定原因，不把底层错误原样抛给界面。 */
async function requestCompletion(baseUrl, { model, apiKey, fetchImpl }) {
  try {
    return await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: '你好' }], max_tokens: 1, stream: false }),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    })
  } catch (error) {
    throw connectFailure(error)
  }
}

/** 上游返回的检查：不回显正文，失败只给稳定原因。 */
async function readCompletion(response, row, latencyMs) {
  if (!response.ok) {
    await response.body?.cancel?.().catch(() => {})
    logger.warn('模型供应商试一下被拒', { action: 'model_provider.test', provider: row.name, result: `http_${response.status}`, latencyMs })
    throw new HttpError(`接口返回 ${response.status}，请核对地址、模型名与密钥`, 502)
  }
  const body = await response.json().catch(() => null)
  if (!body || !Array.isArray(body.choices)) {
    logger.warn('模型供应商试一下返回非兼容格式', { action: 'model_provider.test', provider: row.name, result: 'unexpected_body', latencyMs })
    throw new HttpError('返回内容不是 OpenAI 兼容的 chat completions 格式', 502)
  }
  return body
}

/**
 * 试一下：发一次最小的真实请求（max_tokens=1）。这会真的花一点点钱，
 * 界面上必须写明。上游正文不回显，失败只给稳定原因（连不上 / 超时 / 状态码 / 格式不对）。
 */
export async function testProvider(id, { env = process.env, fetchImpl, lookupImpl = dnsLookup } = {}) {
  const row = await prisma.modelProvider.findUnique({ where: { id } })
  if (!row) throw new HttpError('没有这个供应商', 404)
  // 存在库里的地址也重跑一遍校验：规则改过之后，老行不一定还合规
  const baseUrl = validateBaseUrl(row.baseUrl, env)
  const apiKey = decryptApiKey(row.apiKeyEncrypted, env)
  await assertPublicHost(baseUrl, env, lookupImpl)
  const startedAt = Date.now()
  let response
  try {
    const requestFetch = fetchImpl || ((url, options) => safeProviderFetch(url, options, {
      allowLoopback: isLocalWorkRuntime(env) && new URL(baseUrl).hostname === LOCAL_LOOPBACK,
    }))
    response = await requestCompletion(baseUrl, { model: row.model, apiKey, fetchImpl: requestFetch })
  } catch (error) {
    logger.warn('模型供应商试一下失败', { action: 'model_provider.test', provider: row.name, result: 'connect_failed' })
    throw error
  }
  const latencyMs = Date.now() - startedAt
  const body = await readCompletion(response, row, latencyMs)
  logger.info('模型供应商试一下成功', { action: 'model_provider.test', provider: row.name, model: row.model, latencyMs, outcome: 'ok' })
  const reply = body.choices[0]?.message?.content
  return { ok: true, latencyMs, model: row.model, reply: typeof reply === 'string' ? reply.slice(0, 200) : null }
}

/**
 * 给网关装配用的：启用的供应商按优先级升序，含解出来的明文 key。
 * 明文只活在这个数组里（llmService 的进程内快照），不落库、不进接口、不进日志。
 * 任何一行解不开都直接抛出：宁可让云端整体不可用并由管理员看见原因，也不静默少一家人。
 */
export async function listProvidersForGateway(env = process.env) {
  const rows = await prisma.modelProvider.findMany({
    where: { enabled: true },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  })
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    model: row.model,
    apiKey: decryptApiKey(row.apiKeyEncrypted, env),
    scenes: parseScenes(row.scenes),
    priority: row.priority,
  }))
}
