/* global TextEncoder, ReadableStream, Response, DOMException */
/**
 * llm-gateway 流式方法（gateway.stream）直接回归。
 * 覆盖：跨分片 SSE、[DONE]、首块前回退、首块后禁止切换、
 * AbortSignal 取消、中途异常结束、外部供应商授权门。
 * 用 stub 的 globalThis.fetch 模拟上游，不发起真实网络请求。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGateway } from './index.js'

const LOCAL_ENV = {
  GATEWAY_PROVIDERS: 'llamacpp',
  GATEWAY_LLAMACPP_BASE_URL: 'http://local.test',
  GATEWAY_LLAMACPP_MODEL: 'local-model',
  GATEWAY_LLAMACPP_SCOPE: 'local',
}

const DUAL_ENV = {
  GATEWAY_PROVIDERS: 'llamacpp,qwen',
  GATEWAY_LLAMACPP_BASE_URL: 'http://local.test',
  GATEWAY_LLAMACPP_MODEL: 'local-model',
  GATEWAY_LLAMACPP_SCOPE: 'local',
  GATEWAY_QWEN_BASE_URL: 'http://cloud.test',
  GATEWAY_QWEN_MODEL: 'cloud-model',
  GATEWAY_QWEN_SCOPE: 'external',
  GATEWAY_QWEN_API_KEY: 'test-secret-key',
}

function baseRequest(extra = {}) {
  return {
    scene: 'chat',
    requestId: 'req-test',
    messages: [{ role: 'user', content: '用户秘密消息内容' }],
    ...extra,
  }
}

function sseBytes(text) {
  return new TextEncoder().encode(text)
}

function sseChunk(text) {
  return `data: ${text}\n\n`
}

function sseJson(content) {
  return JSON.stringify({ choices: [{ delta: { content } }] })
}

function okStreamResponse(chunks) {
  const queue = [...chunks]
  const body = new ReadableStream({
    pull(controller) {
      const next = queue.shift()
      if (next === undefined) {
        controller.close()
      } else {
        controller.enqueue(typeof next === 'string' ? sseBytes(next) : next)
      }
    },
  })
  return new Response(body, { status: 200 })
}

function errorStreamResponse(chunks, streamError) {
  const queue = [...chunks]
  const body = new ReadableStream({
    pull(controller) {
      const next = queue.shift()
      if (next === undefined) {
        controller.error(streamError)
      } else {
        controller.enqueue(typeof next === 'string' ? sseBytes(next) : next)
      }
    },
  })
  return new Response(body, { status: 200 })
}

function httpErrorResponse(status) {
  return new Response('upstream error', { status })
}

/** 用 stub fetch 跑一次 stream 并收集全部事件与 fetch 调用记录。 */
async function runStream(t, fetchImpl, env, request, { logger } = {}) {
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return fetchImpl(url, init)
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  const gateway = await createGateway(env, { logger })
  const events = []
  for await (const event of gateway.stream(request)) {
    events.push(event)
  }
  return { events, calls }
}

test('跨分片 SSE 与帧内多行 data 拼接，产出 delta 并以 done 收尾', async (t) => {
  // 把完整 SSE 字节流在任意字节边界（含多字节字符内部）切开，
  // 并覆盖一帧内多行 data: 的拼接。
  const frame1 = sseChunk(sseJson('你好'))
  // 一帧内三行 data:，按规范以 \n 拼接后须是合法 JSON。
  const frame2 = 'data: {"choices":[{"delta":' + '\n' + 'data: {"content":"世界"}}' + '\n' + 'data: ]}' + '\n\n'
  const full = frame1 + frame2 + 'data: [DONE]\n\n' + sseChunk(sseJson('不应出现'))
  const bytes = sseBytes(full)
  const parts = []
  for (let offset = 0; offset < bytes.length; offset += 7) {
    parts.push(bytes.slice(offset, offset + 7))
  }

  const payloads = []
  const { events, calls } = await runStream(
    t,
    (_url, init) => {
      payloads.push(JSON.parse(init.body))
      return okStreamResponse(parts)
    },
    LOCAL_ENV,
    baseRequest(),
  )

  assert.equal(calls.length, 1)
  // fetch init 必须显式 POST：缺省会退化为 GET 并在真实运行时报 “GET/HEAD cannot have body”
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(payloads[0].stream, true)
  const deltas = events.filter((e) => e.type === 'delta').map((e) => e.text)
  assert.deepEqual(deltas, ['你好', '世界'])
  const last = events.at(-1)
  assert.deepEqual(last, {
    type: 'done',
    provider: 'llamacpp',
    model: 'local-model',
    scope: 'local',
  })
})

test('[DONE] 之后的多余分片被忽略且迭代结束', async (t) => {
  const { events } = await runStream(
    t,
    () => okStreamResponse([sseChunk(sseJson('早')), 'data: [DONE]\n\n', sseChunk(sseJson('晚'))]),
    LOCAL_ENV,
    baseRequest(),
  )
  assert.deepEqual(
    events.map((e) => e.type),
    ['delta', 'done'],
  )
  assert.equal(events[0].text, '早')
})

test('本地供应商失败按既有语义重试 2 次，首块前可回退到已授权外部供应商', async (t) => {
  let authorizeCalls = 0
  const { events, calls } = await runStream(
    t,
    (url) => {
      if (url.startsWith('http://local.test')) {
        return httpErrorResponse(500)
      }
      return okStreamResponse([sseChunk(sseJson('云端')), 'data: [DONE]\n\n'])
    },
    DUAL_ENV,
    baseRequest({
      allowExternal: true,
      authorizeExternal: async () => {
        authorizeCalls += 1
        return true
      },
    }),
  )

  const localCalls = calls.filter((c) => c.url.startsWith('http://local.test'))
  const cloudCalls = calls.filter((c) => c.url.startsWith('http://cloud.test'))
  assert.equal(localCalls.length, 2, '本地供应商须按 complete 语义重试 2 次')
  assert.equal(cloudCalls.length, 1)
  assert.equal(authorizeCalls, 1, '每次外部调用前重新授权')
  assert.deepEqual(
    events.map((e) => e.type),
    ['delta', 'done'],
  )
  assert.equal(events.at(-1).provider, 'qwen')
  assert.equal(events.at(-1).scope, 'external')
})

test('已产出 delta 后上游异常：禁止切换供应商，直接以 error 结束流', async (t) => {
  const { events, calls } = await runStream(
    t,
    (url) => {
      if (url.startsWith('http://local.test')) {
        return errorStreamResponse([sseChunk(sseJson('半截话'))], new Error('connection reset'))
      }
      return okStreamResponse([sseChunk(sseJson('云端')), 'data: [DONE]\n\n'])
    },
    DUAL_ENV,
    baseRequest({ allowExternal: true, authorizeExternal: async () => true }),
  )

  assert.equal(calls.length, 1, '首块后不得重试本地供应商')
  assert.ok(
    calls.every((c) => c.url.startsWith('http://local.test')),
    '首块后不得切换到外部供应商',
  )
  assert.deepEqual(events, [
    { type: 'delta', text: '半截话' },
    { type: 'error', reason: 'upstream_error' },
  ])
})

test('连接中断未收到 [DONE]：首块已产出时禁止重试，直接以 error 结束', async (t) => {
  const { events } = await runStream(
    t,
    () => okStreamResponse([sseChunk(sseJson('断流前的内容'))]),
    LOCAL_ENV,
    baseRequest(),
  )
  // 首块已产出后断流：本地供应商不得重试，直接 error。
  assert.deepEqual(events, [
    { type: 'delta', text: '断流前的内容' },
    { type: 'error', reason: 'upstream_error' },
  ])
})

test('连接中断未收到 [DONE] 且未产出任何内容：按既有语义重试并成功', async (t) => {
  let attempt = 0
  const { events, calls } = await runStream(
    t,
    () => {
      attempt += 1
      if (attempt === 1) {
        // 第一次：流正常打开但无内容即断流（无 [DONE]）。
        return okStreamResponse([])
      }
      return okStreamResponse([sseChunk(sseJson('重试成功')), 'data: [DONE]\n\n'])
    },
    LOCAL_ENV,
    baseRequest(),
  )
  assert.equal(calls.length, 2, '首块前断流允许本地供应商重试')
  assert.deepEqual(
    events.map((e) => e.type),
    ['delta', 'done'],
  )
  assert.equal(events[0].text, '重试成功')
})

test('AbortSignal 取消：中断 fetch 并安静结束迭代（无 done/error 事件）', async (t) => {
  const abort = new AbortController()
  const originalFetch = globalThis.fetch
  let observedSignal = null
  globalThis.fetch = (_url, init) => {
    observedSignal = init.signal
    // 永不结束的流，只能靠 signal 中断（模拟 undici 把 abort 传导到 body）。
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(sseBytes(sseChunk(sseJson('先说一句'))))
        init.signal.addEventListener('abort', () => {
          controller.error(new DOMException('This operation was aborted', 'AbortError'))
        })
      },
    })
    return Promise.resolve(new Response(body, { status: 200 }))
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const gateway = await createGateway(LOCAL_ENV)
  const events = []
  for await (const event of gateway.stream(baseRequest({ signal: abort.signal }))) {
    events.push(event)
    abort.abort()
  }

  assert.deepEqual(events, [{ type: 'delta', text: '先说一句' }])
  assert.equal(observedSignal.aborted, true, '取消须传导到上游 fetch')
})

test('外部供应商授权门：allowExternal 关闭时绝不调用外部供应商', async (t) => {
  let authorizeCalls = 0
  const { events, calls } = await runStream(
    t,
    (url) => (url.startsWith('http://local.test') ? httpErrorResponse(500) : okStreamResponse(['data: [DONE]\n\n'])),
    DUAL_ENV,
    baseRequest({
      allowExternal: false,
      authorizeExternal: async () => {
        authorizeCalls += 1
        return true
      },
    }),
  )
  assert.ok(
    calls.every((c) => c.url.startsWith('http://local.test')),
    'allowExternal=false 时不得请求外部供应商',
  )
  assert.equal(authorizeCalls, 0)
  assert.deepEqual(events, [{ type: 'error', reason: 'all_providers_failed' }])
})

test('外部供应商授权门：authorizeExternal 拒绝时跳过外部供应商', async (t) => {
  let authorizeCalls = 0
  const { events, calls } = await runStream(
    t,
    (url) => (url.startsWith('http://local.test') ? httpErrorResponse(500) : okStreamResponse(['data: [DONE]\n\n'])),
    DUAL_ENV,
    baseRequest({
      allowExternal: true,
      authorizeExternal: async () => {
        authorizeCalls += 1
        return false
      },
    }),
  )
  assert.ok(calls.every((c) => c.url.startsWith('http://local.test')))
  assert.equal(authorizeCalls, 1)
  assert.deepEqual(events, [{ type: 'error', reason: 'all_providers_failed' }])
})

test('无效请求：不发起任何上游调用，以 invalid_request 结束', async (t) => {
  const { events, calls } = await runStream(
    t,
    () => okStreamResponse(['data: [DONE]\n\n']),
    LOCAL_ENV,
    baseRequest({ messages: [] }),
  )
  assert.equal(calls.length, 0)
  assert.deepEqual(events, [{ type: 'error', reason: 'invalid_request' }])
})

test('日志只含固定字段，不泄露消息内容与密钥', async (t) => {
  const records = []
  const logger = {
    info: (obj, msg) => records.push({ obj, msg }),
    warn: (obj, msg) => records.push({ obj, msg }),
    error: (obj, msg) => records.push({ obj, msg }),
  }
  await runStream(
    t,
    () => okStreamResponse([sseChunk(sseJson('模型回复内容')), 'data: [DONE]\n\n']),
    DUAL_ENV,
    baseRequest({ allowExternal: true, authorizeExternal: async () => true }),
    { logger },
  )
  assert.ok(records.length > 0)
  const serialized = JSON.stringify(records)
  assert.ok(!serialized.includes('用户秘密消息内容'), '日志不得包含消息内容')
  assert.ok(!serialized.includes('模型回复内容'), '日志不得包含模型输出')
  assert.ok(!serialized.includes('test-secret-key'), '日志不得包含密钥')
  for (const { obj } of records) {
    assert.deepEqual(
      Object.keys(obj).sort(),
      ['attempt', 'latencyMs', 'model', 'provider', 'requestId', 'result', 'scene'],
    )
  }
})

test('work 场景不注入人格提示词，chat 场景注入', async (t) => {
  const payloads = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    payloads.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: '好的' } }] }), { status: 200 })
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const gateway = await createGateway(LOCAL_ENV)
  await gateway.complete(baseRequest({ scene: 'work', persona: 'toxic' }))
  await gateway.complete(baseRequest({ scene: 'chat', persona: 'toxic' }))

  const hasPersonaSystem = (payload) => payload.messages.some(
    (m) => m.role === 'system' && m.content.includes('赛博姐妹'),
  )
  assert.equal(hasPersonaSystem(payloads[0]), false)
  assert.equal(hasPersonaSystem(payloads[1]), true)
})
