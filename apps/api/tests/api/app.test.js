import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'

const state = vi.hoisted(() => ({
  disconnect: vi.fn(),
  trackerDestroy: vi.fn(),
}))

vi.mock('../../src/prisma/client.js', () => ({
  default: {
    $queryRaw: async () => [{ '?column?': 1 }],
    $disconnect: state.disconnect,
  },
}))

vi.mock('../../src/utils/usageTracker.js', () => ({
  default: {
    start: () => ({ minutes: 0, shouldRemind: false }),
    heartbeat: () => ({ minutes: 0, shouldRemind: false }),
    end: () => ({ minutes: 0, shouldRemind: false }),
    getStatus: () => ({ minutes: 0, shouldRemind: false, isActive: false }),
    destroy: state.trackerDestroy,
  },
}))

import app from '../../src/app.js'
import { generateToken } from '../../src/middleware/auth.js'

describe('应用级行为', () => {
  it('未知接口返回 404 与固定文案', async () => {
    const response = await request(app).get('/api/no-such-endpoint')
    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: '接口不存在' })
  })

  it('内测环境的天气假数据路由保持未开放 409，其余工具箱路由已挂载', async () => {
    const token = generateToken({ userId: 'user-1' })
    const weather = await request(app)
      .get('/api/tools/weather')
      .set('Authorization', `Bearer ${token}`)
    expect(weather.status).toBe(409)
    expect(weather.body).toEqual({ error: '该功能未在内测中开放', code: 'FEATURE_NOT_AVAILABLE' })
    // 工具箱其余路由不再被 409 拦截（未认证请求应走到鉴权 401 而非功能关闭）。
    const unauthenticated = await request(app).get('/api/tools/todos')
    expect(unauthenticated.status).toBe(401)
  })

  it(' malformed JSON 请求体由全局错误处理器返回 400', async () => {
    const token = generateToken({ userId: 'user-1' })
    const response = await request(app)
      .post('/api/chat/conversations')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{broken json')
    expect(response.status).toBe(400)
    expect(response.body.error).toBeDefined()
  })

  it('SIGTERM 触发优雅关闭：断开数据库并销毁计时器，且只执行一次', async () => {
    process.emit('SIGTERM')
    await vi.waitFor(() => {
      expect(state.disconnect).toHaveBeenCalledTimes(1)
      expect(state.trackerDestroy).toHaveBeenCalledTimes(1)
    })

    // 幂等：第二次信号不再重复关闭
    process.emit('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(state.disconnect).toHaveBeenCalledTimes(1)
  })
})
