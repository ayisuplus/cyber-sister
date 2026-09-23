import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  switchPersona: vi.fn(),
  getExternalLlmConsent: vi.fn(),
  updateExternalLlmConsent: vi.fn(),
  PERSONAS: ['toxic', 'gentle', 'rational', 'energetic', 'sister', 'cool'],
}))

const assetService = vi.hoisted(() => ({
  saveAsset: vi.fn(),
  readAsset: vi.fn(),
  deleteAsset: vi.fn(),
}))

const exportService = vi.hoisted(() => ({
  buildUserExport: vi.fn(),
}))

vi.mock('../services/userService.js', () => service)
vi.mock('../services/userAssetService.js', () => assetService)
vi.mock('../services/exportService.js', () => exportService)
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import userRoutes from './user.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', userRoutes)

const httpError = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code })

beforeEach(() => vi.clearAllMocks())


describe('数据导出路由', () => {
  it('GET /export 返回导出包并带下载头', async () => {
    exportService.buildUserExport.mockResolvedValue({ version: 1, product: 'Amie cyber-sister', user: { nickname: '小赛' }, memories: [] })

    const response = await request(app).get('/export')

    expect(response.status).toBe(200)
    expect(response.headers['content-disposition']).toContain('attachment')
    expect(response.headers['content-disposition']).toContain('cyber-sister-export-')
    expect(response.body).toMatchObject({ version: 1, user: { nickname: '小赛' } })
    expect(exportService.buildUserExport).toHaveBeenCalledWith('user-1')
  })

  it('service 抛错时兜底 500 与固定文案', async () => {
    exportService.buildUserExport.mockRejectedValue(new Error('db down'))

    const response = await request(app).get('/export')

    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: '导出用户数据失败' })
  })
})
describe('资料路由', () => {
  it('获取资料成功，HttpError 透传状态码，未知错误兜底 500', async () => {
    service.getProfile.mockResolvedValue({ id: 'user-1', nickname: '姐妹' })
    const ok = await request(app).get('/profile')
    expect(ok.status).toBe(200)
    expect(ok.body.nickname).toBe('姐妹')

    service.getProfile.mockRejectedValue(httpError('用户不存在', 404))
    const missing = await request(app).get('/profile')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '用户不存在' })

    service.getProfile.mockRejectedValue(new Error('db down'))
    const fail = await request(app).get('/profile')
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '获取用户信息失败' })
  })

  it('更新资料成功与失败路径', async () => {
    service.updateProfile.mockResolvedValue({ id: 'user-1', nickname: '新昵称' })
    const ok = await request(app).put('/profile').send({ nickname: '新昵称' })
    expect(ok.status).toBe(200)
    expect(service.updateProfile).toHaveBeenCalledWith('user-1', { nickname: '新昵称' })

    service.updateProfile.mockRejectedValue(httpError('昵称不能超过50个字符', 400))
    const bad = await request(app).put('/profile').send({ nickname: 'x'.repeat(51) })
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: '昵称不能超过50个字符' })
  })
})

describe('人格路由', () => {
  it('非法人格在参数校验层被拦截', async () => {
    const response = await request(app).put('/persona').send({ persona: 'wild' })
    expect(response.status).toBe(400)
    expect(response.body.error).toBe('参数验证失败')
    expect(service.switchPersona).not.toHaveBeenCalled()
  })

  it('合法人格切换成功，service 错误透传', async () => {
    service.switchPersona.mockResolvedValue({ persona: 'gentle' })
    const ok = await request(app).put('/persona').send({ persona: 'gentle' })
    expect(ok.status).toBe(200)
    expect(service.switchPersona).toHaveBeenCalledWith('user-1', 'gentle')

    service.switchPersona.mockRejectedValue(new Error('db down'))
    const fail = await request(app).put('/persona').send({ persona: 'gentle' })
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '切换人格失败' })
  })
})

describe('角色扮演已取消', () => {
  it.each(['put', 'delete'])('%s /roleplay 不再提供', async (method) => {
    const response = await request(app)[method]('/roleplay').send({ name: '同桌的你', setting: '爱吐槽' })
    expect(response.status).toBe(404)
  })
})

describe('外部模型同意路由', () => {
  it('查询同意状态', async () => {
    service.getExternalLlmConsent.mockResolvedValue({ accepted: null, version: 'v1', updatedAt: null })
    const ok = await request(app).get('/external-llm-consent')
    expect(ok.status).toBe(200)
    expect(ok.body.accepted).toBeNull()

    service.getExternalLlmConsent.mockRejectedValue(new Error('db down'))
    expect((await request(app).get('/external-llm-consent')).status).toBe(500)
  })

  it('更新同意状态，带 code 的错误原样透传', async () => {
    service.updateExternalLlmConsent.mockResolvedValue({ accepted: true, version: 'v1' })
    const ok = await request(app).put('/external-llm-consent').send({ accepted: true })
    expect(ok.status).toBe(200)
    expect(service.updateExternalLlmConsent).toHaveBeenCalledWith('user-1', true)

    service.updateExternalLlmConsent.mockRejectedValue(httpError('accepted必须是布尔值', 400, 'INVALID_CONSENT'))
    const bad = await request(app).put('/external-llm-consent').send({ accepted: 'yes' })
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: 'accepted必须是布尔值', code: 'INVALID_CONSENT' })
  })
})

describe('形象资产路由', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])

  it('PUT avatar：落盘并把 avatarUrl 写回用户资料', async () => {
    assetService.saveAsset.mockResolvedValue({ url: '/api/user/assets/avatar?v=1' })
    service.updateProfile.mockResolvedValue({ id: 'user-1' })

    const response = await request(app).put('/assets/avatar').attach('file', png, 'a.png')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ url: '/api/user/assets/avatar?v=1' })
    expect(assetService.saveAsset).toHaveBeenCalledWith('user-1', 'avatar', {
      buffer: expect.any(Buffer),
      mime: 'image/png',
    })
    expect(service.updateProfile).toHaveBeenCalledWith('user-1', { avatarUrl: '/api/user/assets/avatar?v=1' })
  })

  it('PUT bg-home：背景槽位不触碰用户资料', async () => {
    assetService.saveAsset.mockResolvedValue({ url: '/api/user/assets/bg-home?v=2' })

    const response = await request(app).put('/assets/bg-home').attach('file', png, 'bg.png')

    expect(response.status).toBe(200)
    expect(assetService.saveAsset).toHaveBeenCalledWith('user-1', 'bg-home', expect.any(Object))
    expect(service.updateProfile).not.toHaveBeenCalled()
  })

  it('PUT 非法槽位 / 无文件 / 超限 / 类型不符均 400', async () => {
    assetService.saveAsset.mockRejectedValue(httpError('不支持的形象槽位', 400))
    const badSlot = await request(app).put('/assets/banner').attach('file', png, 'a.png')
    expect(badSlot.status).toBe(400)
    expect(badSlot.body).toEqual({ error: '不支持的形象槽位' })

    const noFile = await request(app).put('/assets/avatar')
    expect(noFile.status).toBe(400)
    expect(noFile.body).toEqual({ error: '请选择图片' })

    const oversized = await request(app).put('/assets/avatar')
      .attach('file', Buffer.alloc(9 * 1024 * 1024), 'big.png')
    expect(oversized.status).toBe(400)
    expect(oversized.body).toEqual({ error: '图片不能超过 8MB' })

    const gif = await request(app).put('/assets/avatar')
      .attach('file', Buffer.from([0x47, 0x49, 0x46]), { filename: 'a.gif', contentType: 'image/gif' })
    expect(gif.status).toBe(400)
    expect(gif.body).toEqual({ error: '仅支持 JPEG/PNG/WebP 图片' })
  })

  it('GET 未设置 → 404；已设置 → 200 带图片字节与 no-store', async () => {
    assetService.readAsset.mockRejectedValue(httpError('未设置', 404))
    const missing = await request(app).get('/assets/bg-home')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '未设置' })

    assetService.readAsset.mockResolvedValue({ buffer: png, mime: 'image/png' })
    const ok = await request(app).get('/assets/bg-home')
    expect(ok.status).toBe(200)
    expect(ok.headers['content-type']).toBe('image/png')
    expect(ok.headers['cache-control']).toBe('no-store')
    expect(Buffer.compare(ok.body, png)).toBe(0)
  })

  it('DELETE avatar：清槽位并同步清空 avatarUrl', async () => {
    assetService.deleteAsset.mockResolvedValue(undefined)
    service.updateProfile.mockResolvedValue({ id: 'user-1', avatarUrl: null })

    const response = await request(app).delete('/assets/avatar')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true })
    expect(assetService.deleteAsset).toHaveBeenCalledWith('user-1', 'avatar')
    expect(service.updateProfile).toHaveBeenCalledWith('user-1', { avatarUrl: null })
  })

  it('DELETE 背景槽位不同步用户资料', async () => {
    assetService.deleteAsset.mockResolvedValue(undefined)

    const response = await request(app).delete('/assets/bg-chat')

    expect(response.status).toBe(200)
    expect(service.updateProfile).not.toHaveBeenCalled()
  })
})
