import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  count: vi.fn(),
  deleteMany: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
}))
const broker = vi.hoisted(() => ({ disconnectBridge: vi.fn(), isBridgeConnected: vi.fn() }))

vi.mock('../prisma/client.js', () => ({ default: { localBridge: db } }))
vi.mock('./bridgeBroker.js', () => broker)
vi.mock('../utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { authenticateBridge, claimPairing, createPairing, hashSecret, listBridges, revokeBridge, touchBridge } from './bridgeService.js'

const NOW = new Date('2026-09-19T10:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  db.count.mockResolvedValue(0)
  db.deleteMany.mockResolvedValue({ count: 0 })
  db.create.mockResolvedValue({})
  db.updateMany.mockResolvedValue({ count: 1 })
})

describe('本机助手配对', () => {
  it('生成 8 位一次性连接码，只存哈希，10 分钟过期，并清掉旧的未用连接码', async () => {
    const { code, expiresAt } = await createPairing('user-1', NOW)

    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    expect(expiresAt).toEqual(new Date('2026-09-19T10:10:00.000Z'))
    expect(db.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', tokenHash: null, revokedAt: null } })
    expect(db.create).toHaveBeenCalledWith({ data: { userId: 'user-1', pairingCodeHash: hashSecret(code), pairingExpiresAt: expiresAt } })
    expect(JSON.stringify(db.create.mock.calls)).not.toContain(code)
  })

  it('最多连接 3 台电脑', async () => {
    db.count.mockResolvedValue(3)
    await expect(createPairing('user-1', NOW)).rejects.toMatchObject({ statusCode: 409 })
    expect(db.create).not.toHaveBeenCalled()
  })

  it('用连接码换令牌：条件更新保证只换一次，令牌同样只存哈希', async () => {
    db.findUnique.mockImplementation(({ where }) => Promise.resolve({ id: 'bridge-1', userId: 'user-1', name: '书房电脑', tokenHash: where.tokenHash }))

    const claimed = await claimPairing({ code: 'abcd-2345', name: '  书房电脑  ' }, NOW)

    expect(claimed).toMatchObject({ bridgeId: 'bridge-1', name: '书房电脑' })
    expect(claimed.token.length).toBeGreaterThanOrEqual(40)
    const [{ where, data }] = db.updateMany.mock.calls[0]
    expect(where).toEqual({ pairingCodeHash: hashSecret('ABCD2345'), tokenHash: null, revokedAt: null, pairingExpiresAt: { gt: NOW } })
    expect(data).toEqual({ tokenHash: hashSecret(claimed.token), pairingCodeHash: null, pairingExpiresAt: null, name: '书房电脑', lastSeenAt: NOW })
  })

  it('连接码不对、过期或已被用过时拒绝', async () => {
    await expect(claimPairing({ code: 'short' }, NOW)).rejects.toMatchObject({ statusCode: 400 })
    expect(db.updateMany).not.toHaveBeenCalled()
    db.updateMany.mockResolvedValue({ count: 0 })
    await expect(claimPairing({ code: 'ABCD2345' }, NOW)).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('重新生成') })
  })
})

describe('本机助手管理与身份', () => {
  it('只列出已连接、未断开的电脑，并带上是否在线', async () => {
    db.findMany.mockResolvedValue([{ id: 'b1', name: '书房电脑' }, { id: 'b2', name: '笔记本' }])
    broker.isBridgeConnected.mockImplementation((id) => id === 'b1')

    expect(await listBridges('user-1')).toEqual([{ id: 'b1', name: '书房电脑', online: true }, { id: 'b2', name: '笔记本', online: false }])
    expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1', revokedAt: null, tokenHash: { not: null } } }))
  })

  it('断开只作用于自己的电脑：清掉令牌并结束在途任务', async () => {
    expect(await revokeBridge('user-1', 'b1')).toEqual({ success: true })
    expect(db.updateMany).toHaveBeenCalledWith({ where: { id: 'b1', userId: 'user-1', revokedAt: null, tokenHash: { not: null } }, data: { revokedAt: expect.any(Date), tokenHash: null } })
    expect(broker.disconnectBridge).toHaveBeenCalledWith('b1')

    db.updateMany.mockResolvedValue({ count: 0 })
    await expect(revokeBridge('user-2', 'b1')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('令牌按哈希查找，太短的令牌不查库', async () => {
    db.findFirst.mockResolvedValue({ id: 'b1', userId: 'user-1' })
    const token = 'x'.repeat(43)
    expect(await authenticateBridge(token)).toEqual({ id: 'b1', userId: 'user-1' })
    expect(db.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: hashSecret(token), revokedAt: null } }))
    db.findFirst.mockClear()
    expect(await authenticateBridge('short')).toBeNull()
    expect(db.findFirst).not.toHaveBeenCalled()
  })

  it('「上次在线」最多一分钟写一次', async () => {
    await touchBridge({ id: 'b1', lastSeenAt: new Date(NOW.getTime() - 30_000) }, NOW)
    expect(db.updateMany).not.toHaveBeenCalled()
    await touchBridge({ id: 'b1', lastSeenAt: new Date(NOW.getTime() - 61_000) }, NOW)
    expect(db.updateMany).toHaveBeenCalledWith({ where: { id: 'b1', revokedAt: null }, data: { lastSeenAt: NOW } })
  })
})
