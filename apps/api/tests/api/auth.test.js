import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'
import request from 'supertest'
import { Prisma } from '@prisma/client'

const state = vi.hoisted(() => ({
  users: new Map(),
  refreshTokens: [],
  nextUserId: 1,
  databaseReady: true,
  failRefreshUpdate: false,
  crisisWrites: 0,
  simulateCreateRace: false,
}))

vi.mock('../../src/prisma/client.js', () => {
  const client = {
    user: {
      findUnique: async ({ where }) => {
        if (where.phone) return state.users.get(where.phone) || null
        return [...state.users.values()].find((user) => user.id === where.id) || null
      },
      create: async ({ data }) => {
        if (state.simulateCreateRace) {
          // 模拟并发注册：另一个请求已抢先创建同手机号用户
          const raced = {
            id: `user-${state.nextUserId++}`,
            ...data,
            isVip: false,
            avatarUrl: null,
            vipExpireAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
          state.users.set(data.phone, raced)
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '5.18.0',
          })
        }
        const user = {
          id: `user-${state.nextUserId++}`,
          ...data,
          isVip: false,
          avatarUrl: null,
          vipExpireAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        state.users.set(data.phone, user)
        return user
      },
    },
    refreshToken: {
      create: async ({ data }) => {
        const row = { id: `refresh-${state.refreshTokens.length + 1}`, revoked: false, ...data }
        state.refreshTokens.push(row)
        return row
      },
      updateMany: async ({ where, data }) => {
        if (state.failRefreshUpdate) throw new Error('database unavailable')
        let count = 0
        for (const row of state.refreshTokens) {
          const matches = (!where.tokenHash || row.tokenHash === where.tokenHash)
            && (!where.userId || row.userId === where.userId)
            && (where.revoked === undefined || row.revoked === where.revoked)
            && (!where.expiresAt?.gt || row.expiresAt > where.expiresAt.gt)
          if (matches) {
            Object.assign(row, data)
            count += 1
          }
        }
        return { count }
      },
    },
    crisisLog: {
      create: async () => {
        state.crisisWrites += 1
        return { id: `crisis-${state.crisisWrites}` }
      },
    },
    $queryRaw: async () => {
      if (!state.databaseReady) throw new Error('database unavailable')
      return [{ '?column?': 1 }]
    },
    $disconnect: async () => {},
  }
  client.$transaction = async (callback) => callback(client)
  return { default: client }
})

vi.mock('../../src/utils/usageTracker.js', () => ({
  default: {
    start: () => ({ minutes: 0, shouldRemind: false }),
    heartbeat: () => ({ minutes: 0, shouldRemind: false }),
    end: () => ({ minutes: 0, shouldRemind: false }),
    getStatus: () => ({ minutes: 0, shouldRemind: false, isActive: false }),
    destroy: () => {},
  },
}))

import app from '../../src/app.js'
import { generateRefreshToken } from '../../src/middleware/auth.js'
import { loginAttempts, sweepLoginAttempts } from '../../src/routes/auth.js'

describe('Auth API', () => {
  const allowedPhone = '13800138000'

  beforeEach(() => {
    state.users.clear()
    state.refreshTokens.length = 0
    state.nextUserId = 1
    state.databaseReady = true
    state.failRefreshUpdate = false
    state.crisisWrites = 0
    state.simulateCreateRace = false
    loginAttempts.clear()
  })

  it('白名单手机号可使用固定内测码登录', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ phone: allowedPhone, code: '888888' })

    expect(res.status).toBe(200)
    expect(res.body.token).toBeTypeOf('string')
    expect(res.body.user).toMatchObject({ phone: allowedPhone, persona: 'toxic' })
    expect(res.headers['set-cookie'][0]).toContain('HttpOnly')
    expect(res.headers['set-cookie'][0]).toContain('Secure')
    expect(state.refreshTokens).toHaveLength(1)
    expect(state.refreshTokens[0].tokenHash).not.toContain(res.headers['set-cookie'][0].split('=')[1])
  })

  it('错误验证码与非白名单手机号返回相同的通用错误', async () => {
    const wrongCode = await request(app)
      .post('/api/auth/login')
      .send({ phone: allowedPhone, code: '000000' })
    const notAllowed = await request(app)
      .post('/api/auth/login')
      .send({ phone: '13700137000', code: '888888' })

    expect(wrongCode.status).toBe(401)
    expect(notAllowed.status).toBe(401)
    expect(wrongCode.body).toEqual(notAllowed.body)
  })

  it('不再提供伪发送验证码接口', async () => {
    const res = await request(app)
      .post('/api/auth/send-code')
      .send({ phone: allowedPhone })

    expect(res.status).toBe(404)
  })

  it('refresh token 只能使用一次并原子轮换', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ phone: allowedPhone, code: '888888' })
    const originalCookie = login.headers['set-cookie'][0].split(';')[0]

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', originalCookie)
    const replayed = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', originalCookie)

    expect(refreshed.status).toBe(200)
    expect(refreshed.body.token).toBeTypeOf('string')
    expect(refreshed.headers['set-cookie'][0]).toContain('refreshToken=')
    expect(replayed.status).toBe(401)
    expect(replayed.headers['set-cookie'][0]).toContain('refreshToken=;')
    expect(state.refreshTokens.filter((token) => token.revoked)).toHaveLength(1)
  })

  it('无效 refresh token 返回 401 并清除 cookie', async () => {
    const response = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'refreshToken=not-a-token')

    expect(response.status).toBe(401)
    expect(response.headers['set-cookie'][0]).toContain('refreshToken=;')
  })

  it('数据库故障时 refresh 返回可重试 503 且保留 cookie', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ phone: allowedPhone, code: '888888' })
    const cookie = login.headers['set-cookie'][0].split(';')[0]
    state.failRefreshUpdate = true

    const response = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookie)

    expect(response.status).toBe(503)
    expect(response.body.code).toBe('REFRESH_UNAVAILABLE')
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(state.refreshTokens[0].revoked).toBe(false)

    state.failRefreshUpdate = false
    const retried = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookie)
    expect(retried.status).toBe(200)
  })

  it('logout 精确撤销当前 refresh token 且保持幂等', async () => {
    const firstLogin = await request(app)
      .post('/api/auth/login')
      .send({ phone: allowedPhone, code: '888888' })
    const secondLogin = await request(app)
      .post('/api/auth/login')
      .send({ phone: allowedPhone, code: '888888' })
    const firstCookie = firstLogin.headers['set-cookie'][0].split(';')[0]

    const loggedOut = await request(app).post('/api/auth/logout').set('Cookie', firstCookie)
    const repeated = await request(app).post('/api/auth/logout').set('Cookie', firstCookie)

    expect(loggedOut.status).toBe(200)
    expect(repeated.status).toBe(200)
    expect(state.refreshTokens.filter((token) => token.revoked)).toHaveLength(1)
    expect(state.refreshTokens).toHaveLength(2)
    expect(secondLogin.status).toBe(200)
  })

  it('refresh token 无法撤销时 logout 不伪报成功', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ phone: allowedPhone, code: '888888' })
    const cookie = login.headers['set-cookie'][0].split(';')[0]
    state.failRefreshUpdate = true

    const loggedOut = await request(app).post('/api/auth/logout').set('Cookie', cookie)

    expect(loggedOut.status).toBe(503)
    expect(loggedOut.body.code).toBe('LOGOUT_UNAVAILABLE')
    expect(state.refreshTokens[0].revoked).toBe(false)
    expect(loggedOut.headers['set-cookie']).toBeUndefined()
  })

  it('live 与 ready 探针分别检查进程和依赖配置', async () => {
    const live = await request(app).get('/api/health/live')
    const ready = await request(app).get('/api/health/ready')

    expect(live.status).toBe(200)
    expect(live.body.status).toBe('ok')
    expect(ready.status).toBe(200)
    expect(ready.body).toMatchObject({
      status: 'ready',
      checks: { database: 'ok' },
    })
  })

  it('数据库不可用时 ready 返回 503，模型配置不影响平台就绪', async () => {
    state.databaseReady = false
    const databaseDown = await request(app).get('/api/health/ready')

    state.databaseReady = true
    const originalApiKey = process.env.GATEWAY_QWEN_API_KEY
    let qwenMissing
    try {
      delete process.env.GATEWAY_QWEN_API_KEY
      qwenMissing = await request(app).get('/api/health/ready')
    } finally {
      process.env.GATEWAY_QWEN_API_KEY = originalApiKey
    }

    expect(databaseDown.status).toBe(503)
    expect(databaseDown.body.checks.database).toBe('unavailable')
    expect(qwenMissing.status).toBe(200)
    expect(qwenMissing.body.checks).toEqual({ database: 'ok' })
  })

  it('受保护接口仍要求 access token', async () => {
    const res = await request(app).get('/api/user/profile')
    expect(res.status).toBe(401)
  })

  it('内测不挂载旧危机上报接口且不会写入 CrisisLog', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ phone: allowedPhone, code: '888888' })

    const response = await request(app)
      .post('/api/compliance/crisis')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ triggerMsg: '绕过聊天事务', level: 'high' })

    expect(response.status).toBe(404)
    expect(state.crisisWrites).toBe(0)
  })

  it('登录失败按手机号限流', async () => {
    const phone = '13900139000'
    let response
    for (let attempt = 0; attempt < 5; attempt += 1) {
      response = await request(app)
        .post('/api/auth/login')
        .send({ phone, code: '000000' })
    }

    expect(response.status).toBe(429)
    const locked = await request(app)
      .post('/api/auth/login')
      .send({ phone, code: '888888' })
    expect(locked.status).toBe(429)
  })

  it('轮换来源 IP 不能绕过共享验证码的爆破锁定', async () => {
    const phone = '13900139000'
    // app 开启 trust proxy，X-Forwarded-For 决定 req.ip
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', `10.0.0.${attempt + 1}`)
        .send({ phone, code: '000000' })
      // 第 5 次失败即达到上限，返回 429
      expect(res.status).toBe(attempt < 4 ? 401 : 429)
    }

    const fromNewIp = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '192.168.1.100')
      .send({ phone, code: '000000' })
    expect(fromNewIp.status).toBe(429)

    const correctCode = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '192.168.1.101')
      .send({ phone, code: '888888' })
    expect(correctCode.status).toBe(429)
  })

  it('并发注册竞态下唯一约束冲突回读后正常签发 token', async () => {
    state.simulateCreateRace = true

    const res = await request(app)
      .post('/api/auth/login')
      .send({ phone: allowedPhone, code: '888888' })

    expect(res.status).toBe(200)
    expect(res.body.token).toBeTypeOf('string')
    expect(res.body.user.phone).toBe(allowedPhone)
    expect(state.users.has(allowedPhone)).toBe(true)
  })

  it('手机号被移出白名单后 refresh 视同无效并撤销该用户全部会话', async () => {
    const removedPhone = '13700137000'
    state.users.set(removedPhone, {
      id: 'user-removed',
      phone: removedPhone,
      nickname: '已移除',
      persona: 'toxic',
      isVip: false,
      avatarUrl: null,
    })
    const rawToken = generateRefreshToken({ userId: 'user-removed', jti: 'removed-1' })
    const otherToken = generateRefreshToken({ userId: 'user-removed', jti: 'removed-2' })
    const hashOf = (token) => crypto.createHash('sha256').update(token).digest('hex')
    for (const token of [rawToken, otherToken]) {
      state.refreshTokens.push({
        id: `refresh-${state.refreshTokens.length + 1}`,
        userId: 'user-removed',
        tokenHash: hashOf(token),
        revoked: false,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
    }

    const response = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `refreshToken=${rawToken}`)

    expect(response.status).toBe(401)
    expect(response.headers['set-cookie'][0]).toContain('refreshToken=;')
    const userTokens = state.refreshTokens.filter((token) => token.userId === 'user-removed')
    expect(userTokens).toHaveLength(2)
    expect(userTokens.every((token) => token.revoked)).toBe(true)
  })

  it('登录尝试计数表超上限时清扫过期项，保留活跃锁定', async () => {
    const now = Date.now()
    for (let i = 0; i < 10001; i += 1) {
      loginAttempts.set(`stale-${i}`, {
        failures: 1,
        windowEndsAt: now - 1000,
        lockedUntil: null,
      })
    }
    loginAttempts.set('locked-user', {
      failures: 5,
      windowEndsAt: now + 60 * 1000,
      lockedUntil: now + 30 * 60 * 1000,
    })

    await request(app)
      .post('/api/auth/login')
      .send({ phone: '13900139000', code: '000000' })

    // 插入后触发清扫：10001 条过期项被移除，活跃锁定与本次失败保留
    expect(loginAttempts.size).toBe(2)
    expect(loginAttempts.has('locked-user')).toBe(true)

    // 清扫函数本身不删除未过期或仍锁定的记录
    sweepLoginAttempts(now)
    expect(loginAttempts.has('locked-user')).toBe(true)
  })
})
