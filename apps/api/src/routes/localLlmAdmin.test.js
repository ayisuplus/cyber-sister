import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  detectLocalLlm: vi.fn(),
  getStoredLocalConfig: vi.fn(),
  probeLocalLlm: vi.fn(),
  saveLocalLlmConfig: vi.fn(),
  serializeLocalConfig: vi.fn(),
}))

vi.mock('../services/localLlmConfigService.js', () => service)

import localLlmAdminRoutes from './localLlmAdmin.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'admin-1' }
  next()
})
app.use('/', localLlmAdminRoutes)

const codedError = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code })

beforeEach(() => vi.clearAllMocks())

describe('POST /detect', () => {
  it('preset 合法时返回检测结果', async () => {
    service.detectLocalLlm.mockResolvedValue({ preset: 'host', state: 'ready', models: ['m1'] })
    const response = await request(app).post('/detect').send({ preset: 'host' })
    expect(response.status).toBe(200)
    expect(response.body.state).toBe('ready')
    expect(service.detectLocalLlm).toHaveBeenCalledWith('host')
  })

  it('请求体必须是且仅是 preset 一个字段', async () => {
    for (const body of [{}, { preset: 'host', extra: 1 }, { baseUrl: 'http://x' }]) {
      const response = await request(app).post('/detect').send(body)
      expect(response.status).toBe(400)
      expect(response.body.code).toBe('INVALID_LOCAL_LLM_PRESET')
    }
    expect(service.detectLocalLlm).not.toHaveBeenCalled()
  })

  it('service 抛出带 code 的错误时透传状态码', async () => {
    service.detectLocalLlm.mockRejectedValue(codedError('preset 必须是 host 或 development', 400, 'INVALID_LOCAL_LLM_PRESET'))
    const response = await request(app).post('/detect').send({ preset: 'alien' })
    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: 'preset 必须是 host 或 development', code: 'INVALID_LOCAL_LLM_PRESET' })
  })

  it('未知错误兜底 500 与固定文案', async () => {
    service.detectLocalLlm.mockRejectedValue(new Error('network down'))
    const response = await request(app).post('/detect').send({ preset: 'host' })
    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: '检测 llama.cpp 失败' })
  })
})

describe('POST /test', () => {
  it('只允许 baseUrl、model、apiKey 三个字段', async () => {
    const bad = await request(app).post('/test').send({ baseUrl: 'http://x', evil: true })
    expect(bad.status).toBe(400)
    expect(bad.body.code).toBe('INVALID_LOCAL_LLM_CONFIG')
    expect(service.probeLocalLlm).not.toHaveBeenCalled()
  })

  it('探测成功返回结果，失败透传错误', async () => {
    service.probeLocalLlm.mockResolvedValue({ state: 'ready', model: 'm1', models: ['m1'] })
    const ok = await request(app).post('/test').send({ baseUrl: 'http://llama:8080/v1', model: 'm1' })
    expect(ok.status).toBe(200)
    expect(ok.body.state).toBe('ready')

    service.probeLocalLlm.mockRejectedValue(codedError('无法连接 llama.cpp', 502, 'LOCAL_LLM_PROBE_FAILED'))
    const fail = await request(app).post('/test').send({ baseUrl: 'http://llama:8080/v1' })
    expect(fail.status).toBe(502)
    expect(fail.body.code).toBe('LOCAL_LLM_PROBE_FAILED')
  })
})

describe('GET /config', () => {
  it('返回序列化后的配置，异常兜底 500', async () => {
    service.getStoredLocalConfig.mockResolvedValue({ enabled: true, baseUrl: 'http://x/v1' })
    service.serializeLocalConfig.mockReturnValue({ enabled: true, baseUrl: 'http://x/v1', apiKeyConfigured: false })
    const ok = await request(app).get('/config')
    expect(ok.status).toBe(200)
    expect(ok.body.enabled).toBe(true)

    service.getStoredLocalConfig.mockRejectedValue(new Error('db down'))
    const fail = await request(app).get('/config')
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '获取 llama.cpp 配置失败' })
  })
})

describe('PUT /config', () => {
  it('请求体含白名单外字段时被 400 拦截', async () => {
    const bad = await request(app).put('/config').send({ enabled: true, evil: 'x' })
    expect(bad.status).toBe(400)
    expect(bad.body.code).toBe('INVALID_LOCAL_LLM_CONFIG')
    expect(service.saveLocalLlmConfig).not.toHaveBeenCalled()

    // 数组与 null 请求体同样不合法
    const arrayBody = await request(app).put('/config').send([1, 2])
    expect(arrayBody.status).toBe(400)
  })

  it('保存配置成功与错误透传', async () => {
    const payload = { enabled: true, baseUrl: 'http://llama:8080/v1', model: 'm1' }
    service.saveLocalLlmConfig.mockResolvedValue({ ...payload, revision: 2 })
    const ok = await request(app).put('/config').send(payload)
    expect(ok.status).toBe(200)
    expect(service.saveLocalLlmConfig).toHaveBeenCalledWith('admin-1', payload)

    service.saveLocalLlmConfig.mockRejectedValue(codedError('llama.cpp 正在加载模型，请稍后再保存', 409, 'LOCAL_LLM_LOADING'))
    const loading = await request(app).put('/config').send(payload)
    expect(loading.status).toBe(409)
    expect(loading.body).toEqual({ error: 'llama.cpp 正在加载模型，请稍后再保存', code: 'LOCAL_LLM_LOADING' })
  })
})
