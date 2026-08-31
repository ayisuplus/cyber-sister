import { HttpError } from '../utils/dbHelpers.js'

export const IMAGE_GEN_SCENES = Object.freeze(['makeup', 'fitting'])
export const IMAGE_GEN_NOT_CONFIGURED = 'IMAGE_GEN_NOT_CONFIGURED'
export const IMAGE_GEN_NOT_IMPLEMENTED = 'IMAGE_GEN_NOT_IMPLEMENTED'

/**
 * 生图能力状态。本期能力恒不可用（available: false），只报告配置接缝状态：
 * - configured: IMAGE_GEN_BASE_URL / IMAGE_GEN_MODEL / IMAGE_GEN_API_KEY_FILE 三件套是否配齐；
 *   只读取配置键名，绝不读取 API Key 文件内容。
 * - reason: 未配齐 → IMAGE_GEN_NOT_CONFIGURED；已配齐 → IMAGE_GEN_NOT_IMPLEMENTED
 *   （配置就绪但外部生图 API 调用尚未实现）。
 */
export function getImageGenStatus(env = process.env) {
  const configured = Boolean(
    env.IMAGE_GEN_BASE_URL && env.IMAGE_GEN_MODEL && env.IMAGE_GEN_API_KEY_FILE,
  )
  return {
    available: false,
    configured,
    reason: configured ? IMAGE_GEN_NOT_IMPLEMENTED : IMAGE_GEN_NOT_CONFIGURED,
  }
}

/**
 * 生图调用接缝（本期恒 503）。
 * - 配置读取已就绪：见 getImageGenStatus（IMAGE_GEN_BASE_URL / IMAGE_GEN_MODEL /
 *   IMAGE_GEN_API_KEY_FILE）。
 * - 外部 HTTP 调用待实现：后续在此按 scene/itemId 组装提示词，向 IMAGE_GEN_BASE_URL
 *   发起请求，API Key 从 IMAGE_GEN_API_KEY_FILE 指向的文件按需读取。
 * @param {{ scene: 'makeup'|'fitting', itemId: string, note?: string }} _payload
 */
export function requestGeneration(_payload) {
  const error = new HttpError('生图能力接入中，暂未开放', 503)
  error.code = IMAGE_GEN_NOT_CONFIGURED
  throw error
}
