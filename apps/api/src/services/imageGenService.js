/**
 * 生图能力服务（本地 ComfyUI 适配层）。
 *
 * 隐私合同：照片只在 浏览器 → 本机 API → 本机 ComfyUI 之间流转，
 * 全程驻留内存，绝不写盘、绝不进日志、绝不送往任何外部服务或主模型。
 *
 * 配置（env）：
 * - IMAGE_GEN_PROVIDER：默认 'comfy'；'external' 保留旧的外部 API 接缝（恒不可用）。
 * - IMAGE_GEN_BASE_URL：本机 ComfyUI 地址，如 http://127.0.0.1:8188。
 * - IMAGE_GEN_MODEL：工作流标识，'epicrealism-inpaint' | 'kolors-vton'（后者为留缝，v1 恒不可用）。
 * - IMAGE_GEN_API_KEY_FILE：仅 external 模式参与配置检查，本地模式不读取。
 */
import { HttpError } from '../utils/dbHelpers.js'
import { generateExplanationWithModel, redactSensitiveText } from './llmService.js'
import { FITTING_ITEMS, MAKEUP_LOOKS } from './virtualStudioCatalogs.js'
import logger from '../utils/logger.js'

export const IMAGE_GEN_SCENES = Object.freeze(['makeup', 'fitting'])
export const IMAGE_GEN_NOT_CONFIGURED = 'IMAGE_GEN_NOT_CONFIGURED'
export const IMAGE_GEN_NOT_IMPLEMENTED = 'IMAGE_GEN_NOT_IMPLEMENTED'
export const IMAGE_GEN_UNAVAILABLE = 'IMAGE_GEN_UNAVAILABLE'

// IMAGE_GEN_MODEL 的合法工作流标识
const COMFY_MODELS = Object.freeze(['epicrealism-inpaint', 'kolors-vton'])

export const EPICREALISM_CKPT = 'XL-epicrealismXL_vxviLastfameRealism.safetensors'
const SAM3_CKPT = 'sam3.1_multiplex_fp16.safetensors'
const SAM3_DETECT_NODE = 'SAM3_Detect'
const KOLORS_VTON_NODE = 'KolorsVirtualTryOn'

const STATUS_TIMEOUT_MS = 3000
const COMFY_CALL_TIMEOUT_MS = 15000
const VIEW_TIMEOUT_MS = 30000
const DEFAULT_POLL_INTERVAL_MS = 500
const DEFAULT_GENERATION_TIMEOUT_MS = 120_000

// 场景参数：SAM3 蒙版文本与去噪强度（蒙版 inpaint 版 / 全图 i2i 退化版）。
// 蒙版版必须高去噪：VAEEncodeForInpaint 会把蒙版区域灰填后再加噪，低去噪会留下灰斑（实机验证所得）。
const SCENE_PARAMS = Object.freeze({
  makeup: { noun: '妆容', maskText: 'face skin', maskDenoise: 0.8, i2iDenoise: 0.35 },
  fitting: { noun: '单品', maskText: 'shirt clothing upper body', maskDenoise: 0.75, i2iDenoise: 0.75 },
})

export const NEGATIVE_PROMPT = 'low quality, blurry, deformed, extra fingers, watermark, text'

export function unavailable(message = '本地生图服务暂不可用，请稍后重试') {
  const error = new HttpError(message, 503)
  error.code = IMAGE_GEN_UNAVAILABLE
  return error
}

function notConfigured() {
  const error = new HttpError('生图能力接入中，暂未开放', 503)
  error.code = IMAGE_GEN_NOT_CONFIGURED
  return error
}

// IMAGE_GEN_BASE_URL 只来自部署环境（不接受页面输入），这里只做协议与格式校验
export function comfyBaseUrl(env) {
  const raw = env.IMAGE_GEN_BASE_URL
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return raw.replace(/\/+$/, '')
  } catch {
    return null
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ComfyUI 网络异常统一翻译为 503 IMAGE_GEN_UNAVAILABLE（不含提示词、照片等敏感内容）
async function comfyFetch(url, options) {
  try {
    return await fetch(url, options)
  } catch {
    throw unavailable()
  }
}

export async function isComfyOnline(baseUrl) {
  const response = await comfyFetch(`${baseUrl}/system_stats`, {
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  })
  return response.ok
}

async function hasComfyNode(baseUrl, nodeName) {
  const response = await comfyFetch(`${baseUrl}/object_info/${nodeName}`, {
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  })
  return response.ok
}

/**
 * 生图能力状态。
 * - external：保留旧接缝，恒 available:false（configured 看三件套是否配齐）。
 * - comfy：BASE_URL + MODEL 配齐且取值合法 → configured；再探测 ComfyUI 在线性：
 *   通 → available:true, reason:null；不通 → available:false, reason:IMAGE_GEN_UNAVAILABLE。
 *   kolors-vton 还需 KolorsVirtualTryOn 节点存在，否则同样不可用。
 */
export async function getImageGenStatus(env = process.env) {
  const provider = env.IMAGE_GEN_PROVIDER || 'comfy'

  if (provider === 'external') {
    const configured = Boolean(
      env.IMAGE_GEN_BASE_URL && env.IMAGE_GEN_MODEL && env.IMAGE_GEN_API_KEY_FILE,
    )
    return {
      available: false,
      configured,
      provider,
      reason: configured ? IMAGE_GEN_NOT_IMPLEMENTED : IMAGE_GEN_NOT_CONFIGURED,
    }
  }

  const baseUrl = comfyBaseUrl(env)
  const configured = Boolean(baseUrl && env.IMAGE_GEN_MODEL && COMFY_MODELS.includes(env.IMAGE_GEN_MODEL))
  if (!configured) {
    return { available: false, configured: false, provider, reason: IMAGE_GEN_NOT_CONFIGURED }
  }

  try {
    if (!(await isComfyOnline(baseUrl))) {
      return { available: false, configured: true, provider, reason: IMAGE_GEN_UNAVAILABLE }
    }
    if (env.IMAGE_GEN_MODEL === 'kolors-vton' && !(await hasComfyNode(baseUrl, KOLORS_VTON_NODE))) {
      return { available: false, configured: true, provider, reason: IMAGE_GEN_UNAVAILABLE }
    }
    return { available: true, configured: true, provider, reason: null }
  } catch {
    return { available: false, configured: true, provider, reason: IMAGE_GEN_UNAVAILABLE }
  }
}

function findCatalogItem(scene, itemId) {
  const catalog = scene === 'makeup' ? MAKEUP_LOOKS : FITTING_ITEMS
  const item = catalog.find((entry) => entry.id === itemId)
  if (!item) {
    throw new HttpError(`未知的${SCENE_PARAMS[scene].noun}`, 400)
  }
  return item
}

/**
 * 组装生图提示词：默认请主模型把中文描述 + 用户备注改写成英文提示词；
 * 主模型任何失败都退化为目录描述直拼的确定性模板（诚实降级，不报错）。
 * 照片绝不送给主模型；note 先经统一脱敏。
 */
export async function buildPromptForItem(scene, itemId, note, requestId) {
  const item = findCatalogItem(scene, itemId)
  const sceneText = scene === 'makeup'
    ? '虚拟化妆间：对用户自拍的面部区域上妆'
    : '虚拟试衣间：把用户照片里对应区域的服装替换为目标单品'
  const safeNote = note ? redactSensitiveText(note).trim().slice(0, 200) : ''
  const instruction = [
    '把下面的中文描述改写成一条用于本地写实图像生成模型的英文提示词。',
    '规则：只输出英文提示词正文（不要解释、不要引号、不要前后缀）；不超过 120 个英文单词；',
    '只描述需要改变的妆容或服装区域，必须保留人物身份、姿势、构图与背景；不要输出任何人脸身份改写指令。',
    `场景：${sceneText}`,
    `名称：${item.name}`,
    `描述：${item.description}`,
    safeNote ? `用户备注：${safeNote}` : null,
  ].filter(Boolean).join('\n')

  try {
    const result = await generateExplanationWithModel(instruction, requestId)
    const text = String(result?.content || '').replace(/\s+/g, ' ').trim().slice(0, 600)
    if (text) return text
  } catch {
    // 主模型未配置/不可用 → 走确定性回退
  }
  return `${item.description}, soft natural look, photorealistic, preserve face identity, same pose, same background`
}

function sanitizeFileName(name) {
  const cleaned = String(name || '')
    .replace(/[^\w.-]+/g, '_')
    .slice(-64)
  return cleaned || 'photo.png'
}

// 上传照片到本机 ComfyUI 输入目录（FormData，仅内存 buffer）
async function uploadPhoto(baseUrl, { photoBuffer, photoName, photoMime }) {
  const form = new FormData()
  form.append(
    'image',
    new Blob([photoBuffer], { type: photoMime || 'image/png' }),
    sanitizeFileName(photoName),
  )
  const response = await comfyFetch(`${baseUrl}/upload/image`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(COMFY_CALL_TIMEOUT_MS),
  })
  if (!response.ok) throw unavailable('本地生图服务接收照片失败')
  const data = await response.json()
  if (!data?.name) throw unavailable('本地生图服务接收照片失败')
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name
}

// epicrealism-inpaint：SAM3.1 文本分割出蒙版做局部 inpaint；无 SAM3 节点时退化为全图 i2i
function buildEpicrealismWorkflow({ imageRef, prompt, scene, withSamMask }) {
  const params = SCENE_PARAMS[scene]
  const nodes = {
    ckpt: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: EPICREALISM_CKPT } },
    image: { class_type: 'LoadImage', inputs: { image: imageRef } },
    positive: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['ckpt', 1] } },
    negative: { class_type: 'CLIPTextEncode', inputs: { text: NEGATIVE_PROMPT, clip: ['ckpt', 1] } },
  }
  if (withSamMask) {
    nodes.samCkpt = { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: SAM3_CKPT } }
    nodes.samText = { class_type: 'CLIPTextEncode', inputs: { text: params.maskText, clip: ['samCkpt', 1] } }
    nodes.mask = {
      class_type: SAM3_DETECT_NODE,
      inputs: {
        model: ['samCkpt', 0],
        image: ['image', 0],
        conditioning: ['samText', 0],
        threshold: 0.5,
        refine_iterations: 2,
        individual_masks: false,
      },
    }
    nodes.encode = {
      class_type: 'VAEEncodeForInpaint',
      inputs: { pixels: ['image', 0], vae: ['ckpt', 2], mask: ['mask', 0], grow_mask_by: 8 },
    }
  } else {
    nodes.encode = { class_type: 'VAEEncode', inputs: { pixels: ['image', 0], vae: ['ckpt', 2] } }
  }
  nodes.sample = {
    class_type: 'KSampler',
    inputs: {
      model: ['ckpt', 0],
      positive: ['positive', 0],
      negative: ['negative', 0],
      latent_image: ['encode', 0],
      seed: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
      steps: 24,
      cfg: 6.5,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
      denoise: withSamMask ? params.maskDenoise : params.i2iDenoise,
    },
  }
  nodes.decode = { class_type: 'VAEDecode', inputs: { samples: ['sample', 0], vae: ['ckpt', 2] } }
  nodes.save = { class_type: 'SaveImage', inputs: { images: ['decode', 0], filename_prefix: 'cyber-sister-virtual' } }
  return nodes
}

export async function submitPrompt(baseUrl, workflow) {
  const response = await comfyFetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
    signal: AbortSignal.timeout(COMFY_CALL_TIMEOUT_MS),
  })
  if (!response.ok) throw unavailable('本地生图服务拒绝了生成请求')
  const data = await response.json()
  if (!data?.prompt_id) throw unavailable('本地生图服务拒绝了生成请求')
  return data.prompt_id
}
function pickOutputImage(outputs) {
  for (const nodeOutput of Object.values(outputs || {})) {
    const image = (nodeOutput?.images || []).find((entry) => entry?.type === 'output' && entry.filename)
    if (image) return image
  }
  return null
}

export async function waitForOutputImage(baseUrl, promptId, { pollIntervalMs, timeoutMs }) {
  const deadline = Date.now() + timeoutMs
  // 轮询本质串行：每一拍依赖上一拍的历史结果，不能并行
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const response = await comfyFetch(`${baseUrl}/history/${promptId}`, {
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    })
    if (response.ok) {
      // eslint-disable-next-line no-await-in-loop
      const entry = (await response.json())?.[promptId]
      if (entry) {
        if (entry.status?.status_str === 'error') throw unavailable('本地生图执行失败：照片可能无法识别，请换一张照片重试')
        const image = pickOutputImage(entry.outputs)
        if (image) return image
        if (entry.status?.completed) throw unavailable('本地生图没有产出图片')
      }
    }
    if (Date.now() >= deadline) throw unavailable('本地生图超时，请重试')
    // eslint-disable-next-line no-await-in-loop
    await sleep(pollIntervalMs)
  }
}

export async function fetchImageDataUrl(baseUrl, image) {
  const params = new URLSearchParams({ filename: image.filename, type: image.type || 'output' })
  if (image.subfolder) params.set('subfolder', image.subfolder)
  const response = await comfyFetch(`${baseUrl}/view?${params}`, {
    signal: AbortSignal.timeout(VIEW_TIMEOUT_MS),
  })
  if (!response.ok) throw unavailable('本地生图结果读取失败')
  const mime = (response.headers.get('content-type') || 'image/png').split(';')[0]
  const buffer = Buffer.from(await response.arrayBuffer())
  return `data:${mime};base64,${buffer.toString('base64')}`
}

/**
 * 生图调用：上传照片 → 提交工作流 → 轮询历史 → 取回结果图（base64 data URL）。
 * 照片只经内存流转；ComfyUI 不在线/超时/无输出统一 503 IMAGE_GEN_UNAVAILABLE。
 * @param {{ scene: 'makeup'|'fitting', itemId: string, note?: string,
 *   photoBuffer: Buffer, photoName?: string, photoMime?: string }} payload
 */
export async function requestGeneration(
  { scene, itemId, note, photoBuffer, photoName, photoMime },
  requestId,
  { env = process.env, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, timeoutMs = DEFAULT_GENERATION_TIMEOUT_MS } = {},
) {
  const provider = env.IMAGE_GEN_PROVIDER || 'comfy'
  if (provider !== 'comfy') throw notConfigured()

  const baseUrl = comfyBaseUrl(env)
  if (!baseUrl || !COMFY_MODELS.includes(env.IMAGE_GEN_MODEL)) throw notConfigured()

  if (!photoBuffer || photoBuffer.length === 0) throw new HttpError('请先上传照片', 400)

  // v1 留缝：Kolors 真试穿需要本机 VTON 节点与单品图输入，两者皆无 → 诚实不可用
  if (env.IMAGE_GEN_MODEL === 'kolors-vton') {
    throw unavailable('本地虚拟试穿节点未接入，请改用 epicrealism-inpaint')
  }

  const startedAt = Date.now()
  const promptText = await buildPromptForItem(scene, itemId, note, requestId)
  const imageRef = await uploadPhoto(baseUrl, { photoBuffer, photoName, photoMime })

  // 模板构建时探测 SAM3 节点存在性：有 → 蒙版 inpaint；无 → 全图 i2i（精度略降）
  const withSamMask = await hasComfyNode(baseUrl, SAM3_DETECT_NODE)
  const workflow = buildEpicrealismWorkflow({ imageRef, prompt: promptText, scene, withSamMask })
  const promptId = await submitPrompt(baseUrl, workflow)
  const outputImage = await waitForOutputImage(baseUrl, promptId, { pollIntervalMs, timeoutMs })
  const imageDataUrl = await fetchImageDataUrl(baseUrl, outputImage)

  // 日志约束（API 文档 §十二）：只记 requestId/scene/provider/model/延迟/结果，不记提示词正文与照片
  logger.info('虚拟房间生图完成', {
    requestId,
    scene,
    provider: 'comfy',
    model: env.IMAGE_GEN_MODEL,
    latencyMs: Date.now() - startedAt,
    result: 'success',
  })
  return { imageDataUrl, scene, itemId, provider: 'comfy' }
}
