import { readFileSync } from 'node:fs'
import { randomInt } from 'node:crypto'
import { HttpError } from '../utils/dbHelpers.js'

const manifest = JSON.parse(readFileSync(new URL('../../../../deploy/runninghub/workflows.json', import.meta.url), 'utf8'))
export const RUNNINGHUB_CREATE_URL = 'https://www.runninghub.cn/task/openapi/create'
const HOST = 'https://www.runninghub.cn'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const OUTPUT_HOSTS = new Set(['rh-images.xiaoyaoyou.com', 'rh-images-1252422369.cos.ap-beijing.myqcloud.com'])
const fail = message => new HttpError(message, 400)
export const isRunningHubEnabled = () => process.env.RUNNINGHUB_ENABLED === 'true' && Boolean(process.env.RUNNINGHUB_API_KEY?.trim())

export function prepareImageRequest({ workflow, prompt, imageId, seed = randomInt(0, 2 ** 32) } = {}) {
  const definition = manifest.workflows.find(item => item.key === workflow)
  if (!definition || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 1200
    || !Number.isSafeInteger(seed) || seed < 0 || seed > 2 ** 32 - 1) throw fail('请选择已接入的工作流，提示词限 1200 字，种子为 0–4294967295 的整数')
  if (workflow === 'reference-edit' ? typeof imageId !== 'string' || !imageId : imageId !== undefined) throw fail('参考图编辑必须选择一个会话图片 id；文字生图不接收参考图')
  const values = { prompt: prompt.trim(), seed, ...(workflow === 'text-to-image' ? { width: 1024, height: 1024 } : {}) }
  const payload = { workflowId: definition.workflowId,
    nodeInfoList: Object.entries(values).map(([key, fieldValue]) => ({ ...definition.inputs[key], fieldValue })),
    ...(workflow === 'reference-edit' ? { instanceType: 'plus' } : {}), addMetadata: true }
  return { definition, payload, imageId }
}

async function authorize(context) {
  context.signal?.throwIfAborted()
  if (!isRunningHubEnabled()) throw fail('RunningHub 尚未配置，请管理员设置服务端 API Key 并启用')
  if (!context.authorizeExternal || !await context.authorizeExternal()) throw fail('请先在设置中同意云端处理')
  context.signal?.throwIfAborted()
}

async function boundedBody(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw fail('RunningHub 返回内容超过大小限制') }
  const chunks = []
  let size = 0
  for await (const chunk of response.body || []) {
    size += chunk.length
    if (size > limit) throw fail('RunningHub 返回内容超过大小限制')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function api(path, payload, context, form = false) {
  await authorize(context)
  const key = process.env.RUNNINGHUB_API_KEY.trim()
  const signal = AbortSignal.any([...(context.signal ? [context.signal] : []), AbortSignal.timeout(60000)])
  try {
    // No retries: even a failed connection may have reached the paid submission endpoint.
    const response = await fetch(`${HOST}${path}`, { method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${key}`, ...(!form ? { 'Content-Type': 'application/json' } : {}) },
      body: form ? payload : JSON.stringify(payload) })
    if (!response.ok) { await response.body?.cancel(); throw fail('RunningHub 请求未成功，请核对 API 权限和余额；提交结果不明时不要重复生图') }
    const result = JSON.parse((await boundedBody(response, 512 * 1024)).toString('utf8'))
    context.signal?.throwIfAborted()
    return result
  } catch (error) {
    context.signal?.throwIfAborted()
    if (error instanceof HttpError) throw error
    throw fail('RunningHub 暂时无法连接或返回无效响应；请查询原任务，不要重复生图')
  }
}

export async function uploadRunningHubImage(buffer, format, context) {
  await authorize(context)
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_IMAGE_BYTES || !['png', 'jpg'].includes(format)) throw fail('参考图仅支持不超过 5 MB 的 PNG/JPG')
  const form = new FormData()
  form.append('apiKey', process.env.RUNNINGHUB_API_KEY.trim())
  form.append('fileType', 'input')
  form.append('file', new Blob([buffer], { type: format === 'png' ? 'image/png' : 'image/jpeg' }), `reference.${format}`)
  const result = await api('/task/openapi/upload', form, context, true)
  const name = result?.data?.fileName
  if (result?.code !== 0 || typeof name !== 'string' || !/^[\w./-]{1,240}$/.test(name) || name.includes('..')) throw fail('参考图上传失败，请核对 RunningHub 服务')
  return name
}

export async function submitRunningHubImage(payload, context) {
  const result = await api('/task/openapi/create', { ...payload, apiKey: process.env.RUNNINGHUB_API_KEY?.trim() }, context)
  const id = result?.data?.taskId
  if (result?.code !== 0 || typeof id !== 'string' || !/^\d{1,40}$/.test(id)) throw fail('未取得有效云端任务编号，请先在 RunningHub 账单核对，不要重复提交')
  return id
}

export async function queryRunningHubImage(taskId, context) {
  if (typeof taskId !== 'string' || !/^\d{1,40}$/.test(taskId)) throw fail('云端任务编号无效')
  const result = await api('/openapi/v2/query', { taskId }, context)
  if (result?.taskId !== taskId || !['QUEUED', 'RUNNING', 'SUCCESS', 'FAILED'].includes(result?.status)) throw fail('云端任务状态无法核实，请稍后查询原任务')
  const usage = {}
  for (const key of ['consumeMoney', 'thirdPartyConsumeMoney', 'consumeCoins', 'taskCostTime']) {
    const value = result.usage?.[key]
    if (value !== null && value !== undefined && /^(?:\d{1,15})(?:\.\d{1,8})?$/.test(String(value))) usage[key] = String(value)
  }
  if (result.status !== 'SUCCESS') return { status: result.status, usage }
  if (!Array.isArray(result.results) || result.results.length !== 1 || result.results[0]?.outputType !== 'png') throw fail('工作流返回了非预期图片结果，请核对原任务')
  return { status: 'SUCCESS', usage, url: result.results[0].url }
}

export async function downloadRunningHubImage(value, context) {
  let url
  try { url = new URL(value) } catch { throw fail('图片下载地址无效') }
  if (url.protocol !== 'https:' || !OUTPUT_HOSTS.has(url.hostname) || url.port || url.username || url.password) throw fail('图片下载地址不在已验证的 RunningHub 存储域名中')
  await authorize(context)
  try {
    const signal = AbortSignal.any([...(context.signal ? [context.signal] : []), AbortSignal.timeout(60000)])
    const response = await fetch(url.href, { redirect: 'error', signal })
    if (!response.ok) { await response.body?.cancel(); throw fail('图片下载失败，可稍后查询原任务重取') }
    const buffer = await boundedBody(response, MAX_IMAGE_BYTES)
    context.signal?.throwIfAborted()
    if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw fail('云端结果不是有效 PNG 图片')
    return buffer
  } catch (error) {
    context.signal?.throwIfAborted()
    if (error instanceof HttpError) throw error
    throw fail('图片下载失败，可稍后查询原任务重取')
  }
}
