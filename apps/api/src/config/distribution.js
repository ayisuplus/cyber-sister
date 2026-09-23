import { HttpError } from '../utils/dbHelpers.js'

// 本机能力的唯一判断：API 是否跑在用户自己的电脑上（显式 local 且只绑定回环地址）。
// 只看服务端配置，从不相信浏览器声称的客户端类型。其余功能不分 Web / 本地。
export const isLocalWorkRuntime = (env = process.env) => env.APP_DISTRIBUTION === 'local' && env.BIND_ADDRESS === '127.0.0.1'
const LOCAL_ONLY_MESSAGE = '这项能力需要在你自己的电脑上运行，现在没有连接'

export function requireLocalWorkRuntime() {
  if (!isLocalWorkRuntime()) throw Object.assign(new HttpError(LOCAL_ONLY_MESSAGE, 403), { code: 'LOCAL_CLIENT_REQUIRED' })
}
export function localWorkOnly(_req, res, next) {
  if (!isLocalWorkRuntime()) return res.status(403).json({ error: LOCAL_ONLY_MESSAGE, code: 'LOCAL_CLIENT_REQUIRED' })
  return next()
}
