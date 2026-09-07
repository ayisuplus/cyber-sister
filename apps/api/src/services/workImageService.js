/**
 * 工作模式文生图服务：generate_image 工具的执行体。
 *
 * 复用 imageGenService 的本机 ComfyUI 适配原语（在线探测/提交/轮询/取图），
 * 区别只在工作流：这里是零输入图的 SDXL txt2img，checkpoint 与虚拟房间同一份默认。
 * 产出图落盘到 data/work-images/<userId>/<uuid>.png，经鉴权路由按用户隔离读取。
 * 日志只记 requestId/userId/延迟/结果，不记画面描述正文。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'
import {
  EPICREALISM_CKPT,
  NEGATIVE_PROMPT,
  comfyBaseUrl,
  fetchImageDataUrl,
  isComfyOnline,
  submitPrompt,
  unavailable,
  waitForOutputImage,
} from './imageGenService.js'

const MAX_PROMPT_CHARS = 500
const IMAGE_WIDTH = 1024
const IMAGE_HEIGHT = 1024
const SAMPLER_STEPS = 25
const SAMPLER_CFG = 6.5
const IMAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/

const sanitizeUserSegment = (userId) => String(userId ?? '').replace(/[^a-zA-Z0-9-]/g, '_')

function imageRootDir(env) {
  return env.WORK_IMAGE_DIR
    || fileURLToPath(new URL('../../data/work-images', import.meta.url))
}

/** 生成图读取路径解析：文件名形态非法或越出用户目录一律 null（路由映射为 404）。 */
export function resolveWorkImagePath(userId, imageName, env = process.env) {
  if (!IMAGE_ID_PATTERN.test(String(imageName ?? ''))) return null
  const userDir = join(imageRootDir(env), sanitizeUserSegment(userId))
  const filePath = normalize(join(userDir, imageName))
  if (dirname(filePath) !== normalize(userDir)) return null
  return filePath
}

export async function readWorkImage(userId, imageName, env = process.env) {
  const filePath = resolveWorkImagePath(userId, imageName, env)
  if (!filePath) throw new HttpError('图片不存在', 404)
  try {
    return await readFile(filePath)
  } catch {
    throw new HttpError('图片不存在', 404)
  }
}

/** SDXL txt2img 工作流：CheckpointLoader → 正负 CLIPTextEncode → EmptyLatent → KSampler → VAEDecode → SaveImage。 */
function buildTxt2ImgWorkflow(prompt, ckptName) {
  return {
    3: {
      class_type: 'KSampler',
      inputs: {
        seed: Math.floor(Math.random() * 2 ** 32),
        steps: SAMPLER_STEPS,
        cfg: SAMPLER_CFG,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckptName } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT, batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: NEGATIVE_PROMPT, clip: ['4', 1] } },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'cyber_sister_work', images: ['8', 0] } },
  }
}

/**
 * 文生图：校验描述 → ComfyUI 在线探测 → 提交工作流 → 轮询取图 → 落盘。
 * 未配置 IMAGE_GEN_BASE_URL / ComfyUI 离线 / 执行失败统一 503（错误文案不含描述正文）。
 * @returns {Promise<{ imageId: string }>}
 */
export async function generateWorkImage(
  userId,
  prompt,
  requestId,
  { env = process.env, pollIntervalMs, timeoutMs } = {},
) {
  const text = typeof prompt === 'string' ? prompt.trim() : ''
  if (!text || text.length > MAX_PROMPT_CHARS) throw new HttpError('画面描述无效', 400)

  const baseUrl = comfyBaseUrl(env)
  if (!baseUrl) throw unavailable('生图能力未配置本机 ComfyUI 地址')
  if (!(await isComfyOnline(baseUrl).catch(() => false))) throw unavailable()

  const startedAt = Date.now()
  const workflow = buildTxt2ImgWorkflow(text, env.WORK_IMAGE_CKPT || EPICREALISM_CKPT)
  const promptId = await submitPrompt(baseUrl, workflow)
  const outputImage = await waitForOutputImage(baseUrl, promptId, { pollIntervalMs, timeoutMs })
  const dataUrl = await fetchImageDataUrl(baseUrl, outputImage)
  const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')

  const imageId = `${randomUUID()}.png`
  const userDir = join(imageRootDir(env), sanitizeUserSegment(userId))
  await mkdir(userDir, { recursive: true })
  await writeFile(join(userDir, imageId), buffer)

  logger.info('工作模式生图完成', {
    requestId,
    userId,
    latencyMs: Date.now() - startedAt,
    result: 'success',
  })
  return { imageId }
}
