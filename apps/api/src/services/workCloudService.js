import { HttpError } from '../utils/dbHelpers.js'

// 仅用于接口联调；当前没有真实供应商实现，也不读取任何云端配置。
export const WORK_CLOUD_EXECUTION = Object.freeze({ mode: 'mock', cloudConnected: false, persisted: false })

const COMMENT_PREVIEWS = Object.freeze({
  diary: '【模拟回应】今天先把感受写下来，给自己留一点整理心情的空间。这是接口示例，尚未由云端生成。',
  reading: '【模拟读书回应】可以记下最触动你的一句话，留待下次接着想。这是接口示例，尚未由云端阅读你的笔记。',
})

export function isWorkCloudConnected() {
  return false
}

export function assertWorkCloudConnected() {
  throw Object.assign(new HttpError('工作模式云端接口尚未接入，当前仅提供模拟预览', 503), {
    code: 'WORK_CLOUD_NOT_CONNECTED',
  })
}

// eslint-disable-next-line require-await -- 模拟与未来供应商共用异步接口契约。
export async function generateWorkComment(kind, context = {}) {
  if (!Object.hasOwn(COMMENT_PREVIEWS, kind)) throw new HttpError('不支持的工作回应类型', 400)
  // 保留结构化上下文入参；模拟实现不读取、发送或保存用户内容。
  void context
  return { content: COMMENT_PREVIEWS[kind], source: 'cloud_mock', execution: { ...WORK_CLOUD_EXECUTION } }
}
