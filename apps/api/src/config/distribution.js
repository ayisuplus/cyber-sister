import { HttpError } from '../utils/dbHelpers.js'

// Server configuration only; never trust a browser's claimed client type.
export const isLocalWorkRuntime = (env = process.env) => env.APP_DISTRIBUTION === 'local' && env.BIND_ADDRESS === '127.0.0.1'
export function requireLocalWorkRuntime() {
  if (!isLocalWorkRuntime()) throw Object.assign(new HttpError('网页版仅支持聊天，这项功能需使用本地客户端', 403), { code: 'LOCAL_CLIENT_REQUIRED' })
}
export function localWorkOnly(_req, res, next) {
  if (!isLocalWorkRuntime()) return res.status(403).json({ error: '网页版仅支持聊天，这项功能需使用本地客户端', code: 'LOCAL_CLIENT_REQUIRED' })
  return next()
}
