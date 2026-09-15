import { randomUUID } from 'node:crypto'
import { WORK_CLOUD_EXECUTION } from './workCloudService.js'

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const invalid = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })

function validateImage({ buffer, mime }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw invalid('请选择图片')
  if (buffer.length > MAX_IMAGE_BYTES) throw invalid('图片不能超过 8MB', 413)
  // 文件签名必须与声明的类型一致；不把客户端 MIME 当成图片证明。
  const detected = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? 'image/png'
    : buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
      ? 'image/jpeg'
      : buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
        ? 'image/webp' : null
  if (!detected || detected !== mime) throw invalid('图片内容与格式不符，请选择 PNG、JPEG 或 WebP 图片')
}

// 后续供应商适配器只接收已校验的图片与领域参数。当前固定模拟，无环境开关、模型调用或文件保存。
function mockResult(result) {
  return { requestId: randomUUID(), source: 'cloud_mock', execution: { ...WORK_CLOUD_EXECUTION }, result }
}

export function previewMakeup({ buffer, mime, params }) {
  validateImage({ buffer, mime })
  const keys = ['smooth', 'whiten', 'slim', 'eye']
  if (!params || Array.isArray(params) || typeof params !== 'object' || Object.keys(params).length !== keys.length
    || keys.some(key => !Number.isInteger(params[key]) || params[key] < 0 || params[key] > 100)) {
    throw invalid('美颜参数必须包含磨皮、美白、瘦脸、大眼四个 0–100 的整数')
  }
  return mockResult({ kind: 'image', imageUrl: null, params: Object.fromEntries(keys.map(key => [key, params[key]])),
    message: '模拟校验已完成，尚未连接云端服务，未生成或保存图片。' })
}

export function previewWardrobe({ buffer, mime, name = '' }) {
  validateImage({ buffer, mime })
  if (typeof name !== 'string' || name.trim().length > 30) throw invalid('单品名字不能超过 30 个字')
  return mockResult({ kind: 'model', modelUrl: null, name: name.trim() || '未命名单品',
    message: '模拟校验已完成，尚未连接云端服务，未生成模型，也未添加到衣柜。' })
}
