import { HttpError } from '../utils/dbHelpers.js'

// 仅用于接口联调；当前没有真实供应商实现，也不读取任何云端配置。
export const WORK_CLOUD_EXECUTION = Object.freeze({ mode: 'mock', cloudConnected: false, persisted: false })

export function isWorkCloudConnected() {
  return false
}

export function assertWorkCloudConnected() {
  throw Object.assign(new HttpError('云端接口尚未接入，当前仅提供模拟预览', 503), {
    code: 'WORK_CLOUD_NOT_CONNECTED',
  })
}
