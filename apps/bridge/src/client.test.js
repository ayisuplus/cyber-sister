import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { normalizeServer, pair, runBridge } from './client.js'

let folder

before(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'amie-bridge-client-'))
  await writeFile(path.join(folder, 'a.md'), '你好')
})
after(() => rm(folder, { recursive: true, force: true }))

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

describe('本机助手客户端', () => {
  it('只接受 https，本机调试可用 localhost', () => {
    assert.equal(normalizeServer('https://amie.example.com/path'), 'https://amie.example.com')
    assert.equal(normalizeServer('http://localhost:5173'), 'http://localhost:5173')
    assert.throws(() => normalizeServer('http://amie.example.com'), /https/)
    assert.throws(() => normalizeServer('不是网址'), /网址/)
  })

  it('用连接码换令牌，失败时带回服务端原因', async () => {
    const calls = []
    const fetchImpl = async (url, init) => { calls.push([url, JSON.parse(init.body)]); return json(200, { token: 't', bridgeId: 'b1', name: '书房电脑' }) }
    assert.deepEqual(await pair({ server: 'https://amie.example.com', code: 'ABCD2345', name: '书房电脑', fetchImpl }), { token: 't', bridgeId: 'b1', name: '书房电脑' })
    assert.deepEqual(calls, [['https://amie.example.com/api/bridge/claim', { code: 'ABCD2345', name: '书房电脑' }]])
    await assert.rejects(pair({ server: 'https://amie.example.com', code: 'x', fetchImpl: async () => json(400, { error: '连接码无效或已过期' }) }), /连接码无效/)
  })

  it('取到任务就在授权文件夹里执行并交回结果；令牌失效时停下来提示重新配对', async () => {
    const posted = []
    const logs = []
    const responses = [
      json(204, null),
      json(200, { job: { id: 'job-1', tool: 'read', args: { path: 'a.md' } } }),
      json(200, { job: { id: 'job-2', tool: 'read', args: { path: '../outside.md' } } }),
      json(401, { error: '失效' }),
    ]
    const fetchImpl = async (url, init = {}) => {
      if (url.endsWith('/result')) { posted.push([url, JSON.parse(init.body), init.headers.Authorization]); return json(200, { ok: true }) }
      assert.equal(init.headers.Authorization, 'Bridge token-1')
      return responses.shift()
    }

    await assert.rejects(runBridge({ server: 'https://amie.example.com', token: 'token-1', folder, fetchImpl, log: (line) => logs.push(line) }), /重新生成连接码/)

    assert.deepEqual(posted[0], ['https://amie.example.com/api/bridge/jobs/job-1/result', { ok: true, result: { content: '你好', hasMore: false, nextOffset: null } }, 'Bridge token-1'])
    assert.equal(posted[1][1].ok, false)
    assert.match(posted[1][1].error, /授权文件夹以外/)
    assert.deepEqual(logs, ['Amie 在读 「a.md」', 'Amie 在读 「../outside.md」：没做成，不能访问授权文件夹以外的地方'])
  })

  it('网络出错时退避重试，中止后退出', async () => {
    const controller = new AbortController()
    const waits = []
    let attempts = 0
    const fetchImpl = async () => {
      attempts += 1
      if (attempts === 3) controller.abort()
      throw new Error('ECONNRESET')
    }
    await runBridge({ server: 'https://amie.example.com', token: 't', folder, fetchImpl, log: () => {}, signal: controller.signal, sleep: async (ms) => { waits.push(ms) } })
    assert.deepEqual(waits, [1000, 2000])
  })
})
