/**
 * 图生 3D 外部服务接入点。供应商由项目所有者后续选定并填入：
 * 配置：IMAGE_TO_3D_API_URL / IMAGE_TO_3D_API_KEY（apps/api/.env）。
 * 契约：generateModel 入参 { buffer, mime }（用户上传的衣服图），返回 { modelBuffer }（GLB 二进制）。
 * 任务式供应商（提交→轮询→下载）的异步编排接入时在衣柜路由前加状态机，不在本次范围。
 */
import { HttpError } from '../utils/dbHelpers.js'

export function isConfigured(env = process.env) {
  return Boolean(env.IMAGE_TO_3D_API_URL)
}

export async function generateModel({ buffer, mime }, env = process.env) {
  if (!isConfigured(env)) {
    throw Object.assign(new HttpError('3D 生成服务还没接好，开放后第一时间告诉你', 503), { code: 'IMAGE_TO_3D_NOT_CONFIGURED' })
  }
  // TODO(external-api)：POST buffer 至 env.IMAGE_TO_3D_API_URL（Authorization: Bearer env.IMAGE_TO_3D_API_KEY），
  // 取回 GLB 二进制作为 modelBuffer 返回；mime 用于决定上传 Content-Type。
  void buffer; void mime
  throw Object.assign(new HttpError('3D 生成服务还没接好，开放后第一时间告诉你', 503), { code: 'IMAGE_TO_3D_NOT_CONFIGURED' })
}
