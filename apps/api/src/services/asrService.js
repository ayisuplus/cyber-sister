/**
 * 语音转文字服务：/api/asr 端点的执行体。
 * 转发本机 FunASR sidecar（tools/asr-server，模型 iic/SenseVoiceSmall 来自 ModelScope）。
 * 照 imageGenService 的诚实不可用范式：未配置/离线/异常一律如实 503，不伪造转写结果；
 * sidecar 的 400（音频格式校验失败）原文透传给调用方。
 */
import { HttpError } from '../utils/dbHelpers.js'

const STATUS_TIMEOUT_MS = 3000
const TRANSCRIBE_TIMEOUT_MS = 30_000

export function unavailable(message = '语音转文字暂不可用，请稍后重试') {
  const error = new HttpError(message, 503)
  error.code = 'ASR_UNAVAILABLE'
  return error
}

function notConfigured() {
  const error = new HttpError('语音转文字接入中，暂未开放', 503)
  error.code = 'ASR_NOT_CONFIGURED'
  return error
}

// ASR_BASE_URL 只来自部署环境（不接受页面输入），这里只做协议与格式校验
export function asrBaseUrl(env) {
  const raw = env.ASR_BASE_URL
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return raw.replace(/\/+$/, '')
  } catch {
    return null
  }
}

// sidecar 网络异常统一翻译为 503 ASR_UNAVAILABLE（不含音频内容等敏感信息）
async function asrFetch(url, options) {
  try {
    return await fetch(url, options)
  } catch {
    throw unavailable()
  }
}

export async function isAsrOnline(baseUrl) {
  const response = await asrFetch(`${baseUrl}/health`, {
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  })
  return response.ok
}

/** 语音转文字状态三态：未配置 → configured:false；已配置再探测在线性 → available/reason。 */
export async function getAsrStatus(env = process.env) {
  const baseUrl = asrBaseUrl(env)
  if (!baseUrl) return { available: false, configured: false, reason: 'ASR_NOT_CONFIGURED' }
  try {
    if (!(await isAsrOnline(baseUrl))) {
      return { available: false, configured: true, reason: 'ASR_UNAVAILABLE' }
    }
    return { available: true, configured: true, reason: null }
  } catch {
    return { available: false, configured: true, reason: 'ASR_UNAVAILABLE' }
  }
}

/** 转发音频到 sidecar 转写：400 原文透传（格式校验失败），其余非 ok/形状异常 → 503。 */
export async function transcribeAudio({ audioBuffer, audioName, audioMime }, env = process.env) {
  const baseUrl = asrBaseUrl(env)
  if (!baseUrl) throw notConfigured()
  const form = new FormData()
  form.append(
    'file',
    new Blob([audioBuffer], { type: audioMime || 'audio/wav' }),
    audioName || 'voice.wav',
  )
  const response = await asrFetch(`${baseUrl}/transcribe`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 400 && typeof data?.error === 'string') throw new HttpError(data.error, 400)
    throw unavailable('语音转文字服务处理音频失败')
  }
  if (typeof data?.text !== 'string') throw unavailable('语音转文字服务返回异常')
  return { text: data.text }
}
