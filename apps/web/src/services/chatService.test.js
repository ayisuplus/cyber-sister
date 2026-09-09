import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  getPersistedToken: vi.fn(),
  refreshAccessToken: vi.fn(),
  API_BASE_URL: '/api',
}))

import api, { getPersistedToken, refreshAccessToken } from './api'
import { chatService } from './chatService'

describe('chatService', () => {
  it('lists and creates conversations', async () => {
    api.get.mockResolvedValue({ data: [{ id: 'c1' }] })
    api.post.mockResolvedValue({ data: { id: 'c2' } })

    const list = await chatService.getConversations()
    const created = await chatService.createConversation()

    expect(api.get).toHaveBeenCalledWith('/chat/conversations')
    expect(list).toEqual([{ id: 'c1' }])
    expect(api.post).toHaveBeenCalledWith('/chat/conversations', { mode: 'chat' })
    expect(created).toEqual({ id: 'c2' })
  })

  it('loads a single conversation with its messages', async () => {
    api.get.mockResolvedValue({ data: { id: 'c1', messages: [{ id: 'm1' }] } })

    const result = await chatService.getConversation('c1')

    expect(api.get).toHaveBeenCalledWith('/chat/conversations/c1')
    expect(result.messages).toEqual([{ id: 'm1' }])
  })

  it('deletes a conversation by id', async () => {
    api.delete.mockResolvedValue({ data: {} })

    await chatService.deleteConversation('c1')

    expect(api.delete).toHaveBeenCalledWith('/chat/conversations/c1')
  })
})

describe('chatService.streamMessage', () => {
  const fetchMock = vi.fn()

  const sseResponse = (chunks, status = 200) => {
    const encoder = new TextEncoder()
    return {
      ok: status >= 200 && status < 300,
      status,
      body: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
          controller.close()
        },
      }),
      json: vi.fn(),
    }
  }

  const collectEvents = async (conversationId = 'c1', content = '你好', options = {}) => {
    const events = []
    await chatService.streamMessage(conversationId, content, {
      ...options,
      onEvent: (event) => events.push(event),
    })
    return events
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    getPersistedToken.mockReset()
    refreshAccessToken.mockReset()
    getPersistedToken.mockReturnValue('access-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts to the stream endpoint with bearer token, credentials and JSON body', async () => {
    fetchMock.mockResolvedValue(sseResponse(['data: {"event":"done","status":"ok"}\n\n']))

    await collectEvents('c1', '你好')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/chat/conversations/c1/messages/stream')
    expect(options.method).toBe('POST')
    expect(options.credentials).toBe('include')
    expect(options.headers.Authorization).toBe('Bearer access-token')
    expect(options.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(options.body)).toEqual({ content: '你好' })
  })

  it('sends anonymously when no token is persisted', async () => {
    getPersistedToken.mockReturnValue(null)
    fetchMock.mockResolvedValue(sseResponse(['data: {"event":"done","status":"ok"}\n\n']))

    await collectEvents()

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()
  })

  it('image 非空时改发 FormData，不设 JSON Content-Type，401 重试复用同一 FormData', async () => {
    const image = new Blob(['fake-jpeg'], { type: 'image/jpeg' })
    fetchMock.mockResolvedValue(sseResponse(['data: {"event":"done","status":"ok"}\n\n']))

    await collectEvents('c1', '', { image })

    const [, options] = fetchMock.mock.calls[0]
    expect(options.body).toBeInstanceOf(FormData)
    expect(options.body.get('content')).toBe('')
    expect(options.body.get('image')).toBeInstanceOf(Blob)
    expect(options.headers['Content-Type']).toBeUndefined()
    expect(options.headers.Authorization).toBe('Bearer access-token')

    // 401：刷新后重试仍带图片 FormData
    fetchMock
      .mockResolvedValueOnce(sseResponse([], 401))
      .mockResolvedValueOnce(sseResponse(['data: {"event":"done","status":"ok"}\n\n']))
    await collectEvents('c1', '看图', { image })
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    const [, retryOptions] = fetchMock.mock.calls[2]
    expect(retryOptions.body).toBeInstanceOf(FormData)
    expect(retryOptions.body.get('content')).toBe('看图')
    expect(retryOptions.body.get('image')).toBeInstanceOf(Blob)
  })

  it('parses data frames split across chunks, ignoring heartbeat comments, blank lines and broken frames', async () => {
    fetchMock.mockResolvedValue(sseResponse([
      'data: {"event":"delta","text":"你',
      '好"}\n\n: ping\n\n\ndata: {"event":"delta","text":"！"}\n\ndata: {broken json\n\ndata: {"event":"done","status":"ok"}\n\n',
    ]))

    const events = await collectEvents()

    expect(events).toEqual([
      { event: 'delta', text: '你好' },
      { event: 'delta', text: '！' },
      { event: 'done', status: 'ok' },
    ])
  })

  it('refreshes once and retries the original request on a 401 before the first business event', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 401, json: vi.fn() })
      .mockResolvedValueOnce(sseResponse(['data: {"event":"done","status":"ok"}\n\n']))
    getPersistedToken.mockReturnValueOnce('expired-token').mockReturnValue('fresh-token')
    refreshAccessToken.mockResolvedValue('fresh-token')

    const events = await collectEvents()

    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer expired-token')
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-token')
    expect(events).toEqual([{ event: 'done', status: 'ok' }])
  })

  it('never refreshes twice: a second 401 clears the persisted session and rejects', async () => {
    localStorage.setItem('cyber-sister-auth', JSON.stringify({ state: { token: 'fresh-token' } }))
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: vi.fn() })
    refreshAccessToken.mockResolvedValue('fresh-token')

    await expect(collectEvents()).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 })

    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('cyber-sister-auth')).toBeNull()
  })

  it('propagates a refresh failure without issuing the retry', async () => {
    const refreshFailure = new Error('refresh rejected')
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: vi.fn() })
    refreshAccessToken.mockRejectedValue(refreshFailure)

    await expect(collectEvents()).rejects.toBe(refreshFailure)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects non-401 failures with the error body code attached', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue({ error: '本地模型不可用', code: 'LLM_UNAVAILABLE' }),
    })

    await expect(collectEvents()).rejects.toMatchObject({
      message: '本地模型不可用',
      code: 'LLM_UNAVAILABLE',
      status: 503,
    })
    expect(refreshAccessToken).not.toHaveBeenCalled()
  })

  it('passes the abort signal to fetch and propagates abort errors', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    fetchMock.mockImplementation((url, options) => {
      expect(options.signal).toBe(controller.signal)
      return Promise.reject(abortError)
    })

    const events = []
    await expect(
      chatService.streamMessage('c1', '你好', { signal: controller.signal, onEvent: (event) => events.push(event) })
    ).rejects.toBe(abortError)
    expect(events).toEqual([])
  })
})
