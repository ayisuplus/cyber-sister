import { beforeEach, describe, expect, it, vi } from 'vitest'

const findUnique = vi.hoisted(() => vi.fn())
vi.mock('../prisma/client.js', () => ({
  default: { user: { findUnique } },
}))

import { instanceAdminMiddleware } from './instanceAdmin.js'

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

describe('安装实例管理员权限', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.INSTANCE_ADMIN_PHONES = '13800138000'
    process.env.INTERNAL_TEST_PHONES = '13800138000,13900139000'
  })

  it('只允许同时属于管理员和白名单的数据库用户', async () => {
    const next = vi.fn()
    findUnique.mockResolvedValue({ phone: '13800138000' })
    await instanceAdminMiddleware({ user: { userId: 'admin' } }, response(), next)
    expect(next).toHaveBeenCalledOnce()

    findUnique.mockResolvedValue({ phone: '13900139000' })
    const res = response()
    await instanceAdminMiddleware({ user: { userId: 'tester' } }, res, next)
    expect(res.statusCode).toBe(403)
    expect(res.body.code).toBe('INSTANCE_ADMIN_REQUIRED')
  })
})
