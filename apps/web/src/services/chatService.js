import api, { getPersistedToken, refreshAccessToken, API_BASE_URL } from './api'

// SSE 为纯 data 帧编码（无 event: 行），帧间以空行分隔；
// `: ping` 注释心跳帧与空行必须忽略。
const STREAM_FRAME_SEPARATOR = /\r?\n\r?\n/

const emitStreamFrame = (frame, onEvent) => {
  const dataLines = []
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(':')) return // 注释/心跳帧，整帧忽略
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
  }
  if (dataLines.length === 0) return
  let event
  try {
    event = JSON.parse(dataLines.join('\n'))
  } catch {
    return // 坏帧跳过，继续解析后续帧
  }
  onEvent(event)
}

const readEventStream = (body, onEvent) => {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const pump = () => reader.read().then(({ done, value }) => {
    if (done) {
      buffer += decoder.decode()
      // 收尾：flush 剩余缓冲（可能是无结束空行的最后一帧）
      for (const frame of buffer.split(STREAM_FRAME_SEPARATOR)) emitStreamFrame(frame, onEvent)
      return undefined
    }
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split(STREAM_FRAME_SEPARATOR)
    buffer = frames.pop() // 末段是不完整帧，留到下次拼接
    for (const frame of frames) emitStreamFrame(frame, onEvent)
    return pump()
  })

  return pump()
}

const extractErrorCode = (body) => {
  if (!body) return undefined
  if (body.code) return body.code
  if (typeof body.error === 'string') return body.error
  return body.error?.code
}

// 非 2xx：沿用 JSON 端点错误体 {error, code?}，以带 code 的 Error reject
const toHttpError = async (response) => {
  let body = null
  try {
    body = await response.json()
  } catch {
    // 非 JSON 错误体，只保留状态码
  }
  const message = typeof body?.error === 'string' ? body.error : `请求失败（${response.status}）`
  /** @type {Error & { code?: string, status?: number }} */
  const error = new Error(message)
  const code = extractErrorCode(body)
  if (code) error.code = code
  error.status = response.status
  return error
}

const postMessageStream = (conversationId, content, signal, image) => {
  /** @type {Record<string, string>} */
  const headers = {}
  const token = getPersistedToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let body
  if (image) {
    // multipart：浏览器自带 boundary，绝不手设 Content-Type；FormData 可原样重放（401 重试复用同一 body）
    body = new FormData()
    body.append('content', content)
    body.append('image', image, 'photo.jpg')
  } else {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify({ content })
  }
  return fetch(`${API_BASE_URL}/chat/conversations/${conversationId}/messages/stream`, {
    method: 'POST',
    credentials: 'include', // 携带 httpOnly cookie（refresh token）
    signal,
    headers,
    body,
  })
}

export const chatService = {
  getConversations: async () => {
    const response = await api.get('/chat/conversations')
    return response.data
  },

  createConversation: async (mode = 'chat') => {
    const response = await api.post('/chat/conversations', { mode })
    return response.data
  },

  getConversation: async (conversationId) => {
    const response = await api.get(`/chat/conversations/${conversationId}`)
    return response.data
  },

  // SSE 流式发送（原生 fetch，需要 ReadableStream，不走 axios）。
  // onEvent 逐事件收到 {event: 'delta'|'replace'|'done'|'blocked'|'error', ...payload}。
  /** @param {string} conversationId @param {string} content @param {{ signal?: AbortSignal, onEvent?: (event: any) => void, image?: Blob | null }} [options] */
  streamMessage: async (conversationId, content, { signal, onEvent, image = null } = {}) => {
    let response = await postMessageStream(conversationId, content, signal, image)

    if (response.status === 401) {
      // 首个业务事件前的 401：共享刷新后原样重试一次。
      // 刷新失败时 refreshAccessToken 内部已执行既有退出语义（清登录态跳登录页）。
      await refreshAccessToken()
      response = await postMessageStream(conversationId, content, signal, image)
      if (response.status === 401) {
        // 重试仍是 401：不再刷新，沿用既有退出语义清除登录态
        localStorage.removeItem('cyber-sister-auth')
        /** @type {Error & { code?: string, status?: number }} */
        const error = new Error('登录状态已失效，请重新登录')
        error.code = 'UNAUTHORIZED'
        error.status = 401
        throw error
      }
    }

    if (!response.ok) throw await toHttpError(response)

    await readEventStream(response.body, onEvent)
  },

  deleteConversation: async (conversationId) => {
    const response = await api.delete(`/chat/conversations/${conversationId}`)
    return response.data
  },
}
