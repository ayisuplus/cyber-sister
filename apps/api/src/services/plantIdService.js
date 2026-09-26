/**
 * 花草图鉴的「认一认」（路线图 C26）：一张照片发给聊天那个视觉模型，一次拿回候选与她的讲解。
 * 照片不落盘：去掉拍摄信息后只在这一次请求里用。要 v4 云端同意；场景用 chat，讲解就是她平时的说话方式。
 * 拿回来之后在本机名录与毒性库里核一遍（见 plantReference.js），核对不出本机、不花钱。
 */
import prisma from '../prisma/client.js'
import { cloudAuthorization } from './consents.js'
import { assertCloudCallable, crossesRedLine, getGateway, imagePart, redactSensitiveText } from './llmService.js'
import { extractJsonObject } from './letterService.js'
import {
  applyPlantSafety, IDENTIFY_ASK, normalizeIdentification, PLANT_ID_PROMPT, PLANT_ID_PROMPT_VERSION,
} from './plantIdentification.js'
import { groundIdentification, loadPlantReference } from './plantReference.js'
import { HttpError } from '../utils/dbHelpers.js'
import { stripJpegMetadata } from '../utils/jpegMetadata.js'
import { MAX_PHOTO_BYTES } from '../utils/photoStore.js'
import logger from '../utils/logger.js'

const IDENTIFY_TIMEOUT_MS = 45_000
const IDENTIFY_MAX_TOKENS = 900
const IDENTIFY_TEMPERATURE = 0.3

const withCode = (message, status, code) => Object.assign(new HttpError(message, status), { code })

/** 解析模型的回答：形状校验 → 红线与「能吃能入药」兜底 → 带上提示词版本与模型名。认不出形状返回 null。 */
export function readIdentification(content, model) {
  const parsed = normalizeIdentification(extractJsonObject(content))
  if (!parsed) return null
  const unsafe = (text) => crossesRedLine(redactSensitiveText(text))
  return { ...applyPlantSafety(parsed, { unsafe }), promptVersion: PLANT_ID_PROMPT_VERSION, identifiedBy: model ?? null }
}

/**
 * @param {string} userId
 * @param {{ photo?: Array<{ buffer: Buffer }> }} files multipart 里的 photo（手机上压缩好的 JPEG）
 * @param {{ requestId?: string, signal?: AbortSignal }} [options]
 */
export async function identifyPlant(userId, files = {}, { requestId, signal } = {}) {
  const photo = files.photo?.[0]?.buffer
  if (!photo) throw new HttpError('先拍一张或选一张照片', 400)
  if (photo.length > MAX_PHOTO_BYTES) throw new HttpError('这张照片太大了，请换一张', 400)
  const image = { mime: 'image/jpeg', buffer: stripJpegMetadata(photo) }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { persona: true, externalLlmConsent: true, externalLlmConsentVersion: true },
  })
  const { allowExternal, authorizeExternal } = cloudAuthorization(userId, user)
  assertCloudCallable(allowExternal)

  const gateway = await getGateway()
  const result = await gateway.complete({
    scene: 'chat',
    persona: user?.persona,
    requestId,
    systemAppend: [{ role: 'system', content: PLANT_ID_PROMPT }],
    messages: [{ role: 'user', content: [{ type: 'text', text: IDENTIFY_ASK }, imagePart(image)] }],
    allowExternal,
    authorizeExternal,
    timeoutMs: IDENTIFY_TIMEOUT_MS,
    maxTokens: IDENTIFY_MAX_TOKENS,
    temperature: IDENTIFY_TEMPERATURE,
    signal,
  })
  if (!result?.content) throw withCode('这会儿没认出来，过一会儿再试试', 503, 'LLM_UNAVAILABLE')

  const identification = readIdentification(result.content, result.model)
  // 只记形状，不记内容
  logger.info('认了一株花草', { userId, requestId, model: result.model, ok: Boolean(identification), isPlant: identification?.isPlant, candidates: identification?.candidates.length })
  if (!identification) throw withCode('她这次没说清楚，再认一次吧', 502, 'PLANT_ID_UNREADABLE')
  // 本机名录与毒性库再核一遍（路线图 C27）：不改她的候选与讲解，只挂上 reference
  return groundIdentification(identification, loadPlantReference())
}
