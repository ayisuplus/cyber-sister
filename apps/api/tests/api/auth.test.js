/**
 * Auth API 集成测试
 * 测试登录/注册/Token刷新/退出端到端流程
 */
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'

// Mock Redis 初始化（避免连接尝试 + 超时）
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    connect: vi.fn().mockRejectedValue(new Error('Redis not available in test')),
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
    quit: vi.fn().mockResolvedValue('OK'),
  })),
}))

import app from '../../src/app.js'

// Mock Prisma client
vi.mock('../../src/prisma/client.js', () => {
  const users = new Map()
  return {
    default: {
      user: {
        findUnique: async ({ where }) => users.get(where.phone) || null,
        create: async ({ data }) => {
          const user = { id: `test-${Date.now()}`, ...data, isVip: false, avatarUrl: null, vipExpireAt: null, createdAt: new Date(), updatedAt: new Date() }
          users.set(data.phone, user)
          return user
        },
      },
      refreshToken: {
        create: async () => ({ id: 'test-rt' }),
        findFirst: async () => null,
        update: async () => ({}),
        updateMany: async () => ({}),
      },
      $disconnect: async () => {},
    },
  }
})

// Mock Redis (not available in test)
vi.mock('../../src/utils/redis.js', () => ({
  cacheGet: async () => 0,
  cacheSet: async () => {},
  cacheDel: async () => {},
  cacheDelPattern: async () => {},
  cacheIncr: async () => 0,
  isRedisAvailable: () => false,
  closeRedis: async () => {},
}))

// Mock UsageTracker (avoids setInterval in test)
vi.mock('../../src/utils/usageTracker.js', () => ({
  default: {
    start: () => ({ minutes: 0, shouldRemind: false }),
    heartbeat: () => ({ minutes: 0, shouldRemind: false }),
    end: () => ({ minutes: 0, shouldRemind: false }),
    getStatus: () => ({ minutes: 0, shouldRemind: false, isActive: false }),
    destroy: () => {},
  },
}))

describe('Auth API', () => {
  const testPhone = '13800138000'

  describe('POST /api/auth/login', () => {
    it('应该用 Mock 验证码登录成功', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ phone: testPhone, code: '888888' })

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('token')
      expect(res.body).toHaveProperty('user')
      expect(res.body.user.phone).toBe(testPhone)
      expect(res.body.user.persona).toBe('toxic')
    })

    it('错误验证码应返回 400', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ phone: testPhone, code: '000000' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('验证码错误')
    })

    it('缺少手机号应返回 400', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ phone: '', code: '888888' })

      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/auth/send-code', () => {
    it('应返回验证码发送成功（开发环境）', async () => {
      const res = await request(app)
        .post('/api/auth/send-code')
        .send({ phone: testPhone })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })

  describe('POST /api/auth/refresh', () => {
    it('缺少 refreshToken 应返回 400', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({})

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('缺少refreshToken')
    })
  })

  describe('GET /api/health', () => {
    it('应返回健康状态', async () => {
      const res = await request(app).get('/api/health')

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('ok')
      expect(res.body).toHaveProperty('version')
      expect(res.body).toHaveProperty('llm')
    })
  })

  describe('GET /api/user/profile (未登录)', () => {
    it('未登录应返回 401', async () => {
      const res = await request(app).get('/api/user/profile')

      expect(res.status).toBe(401)
    })
  })
})
