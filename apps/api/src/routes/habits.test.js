import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  listHabitsWithStatus: vi.fn(),
  createHabit: vi.fn(),
  updateHabit: vi.fn(),
  archiveHabit: vi.fn(),
  toggleCheckin: vi.fn(),
  generateCheer: vi.fn(),
}))

vi.mock('../services/habitService.js', () => service)
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import habitsRoutes from './habits.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  req.requestId = 'req-test'
  next()
})
app.use('/', habitsRoutes)

beforeEach(() => vi.clearAllMocks())

describe('手帐习惯路由', () => {
  it('返回习惯状态列表', async () => {
    service.listHabitsWithStatus.mockResolvedValue([{ id: 'h1', name: '喝水', checkedToday: true, streak: 2 }])
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({ name: '喝水', streak: 2 })
    expect(service.listHabitsWithStatus).toHaveBeenCalledWith('user-1')
  })

  it('创建、更新、归档习惯', async () => {
    service.createHabit.mockResolvedValue({ id: 'h1', name: '喝水', icon: 'droplet' })
    expect((await request(app).post('/').send({ name: '喝水', icon: 'droplet' })).status).toBe(200)
    expect(service.createHabit).toHaveBeenCalledWith('user-1', { name: '喝水', icon: 'droplet' })

    service.updateHabit.mockResolvedValue({ id: 'h1', name: '多喝水' })
    expect((await request(app).patch('/h1').send({ name: '多喝水' })).status).toBe(200)

    service.archiveHabit.mockResolvedValue(undefined)
    expect((await request(app).delete('/h1')).status).toBe(200)
  })

  it('校验失败透传 400', async () => {
    service.createHabit.mockRejectedValue(Object.assign(new Error('图标不在可选范围内'), { statusCode: 400 }))
    const bad = await request(app).post('/').send({ name: '喝水', icon: 'rocket' })
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: '图标不在可选范围内' })
  })

  it('切换打卡返回 checked 与日期', async () => {
    service.toggleCheckin.mockResolvedValue({ checked: true, day: '2026-09-04' })
    const res = await request(app).post('/h1/checkin').send({})
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ checked: true, day: '2026-09-04' })
    expect(service.toggleCheckin).toHaveBeenCalledWith('user-1', 'h1', undefined)
  })

  it('生成鼓励返回结果，模型失败透传 503 与 code', async () => {
    service.generateCheer.mockResolvedValue({ cheer: '稳', source: 'qwen' })
    const ok = await request(app).post('/cheer')
    expect(ok.status).toBe(200)
    expect(ok.body.cheer).toBe('稳')
    expect(service.generateCheer).toHaveBeenCalledWith('user-1', 'req-test')

    service.generateCheer.mockRejectedValue(Object.assign(new Error('本地模型暂时不可用，请稍后重试'), { statusCode: 503, code: 'LOCAL_LLM_UNAVAILABLE' }))
    const unavailable = await request(app).post('/cheer')
    expect(unavailable.status).toBe(503)
    expect(unavailable.body).toEqual({ error: '本地模型暂时不可用，请稍后重试', code: 'LOCAL_LLM_UNAVAILABLE' })
  })
})
