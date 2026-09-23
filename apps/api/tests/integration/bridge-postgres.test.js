import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const connection = vi.hoisted(() => ({ client: null }))
vi.mock('../../src/prisma/client.js', () => ({ default: new Proxy({}, {
  get: (_, key) => typeof connection.client?.[key] === 'function' ? connection.client[key].bind(connection.client) : connection.client?.[key],
}) }))
import { authenticateBridge, claimPairing, createPairing, listBridges, revokeBridge } from '../../src/services/bridgeService.js'

const withDatabase = process.env.TEST_DATABASE_URL ? describe : describe.skip
const databaseName = `cyber_sister_bridge_test_${Date.now()}`
let admin
let db
let user

withDatabase('local bridge pairing on isolated PostgreSQL', () => {
  beforeAll(async () => {
    if (!/^cyber_sister_bridge_test_\d+$/.test(databaseName)) throw new Error('Unsafe database name')
    admin = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } })
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)
    const url = new URL(process.env.TEST_DATABASE_URL)
    url.pathname = `/${databaseName}`
    const result = spawnSync(process.execPath, ['src/prisma/migrateDeploy.js'], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'development', DATABASE_URL: url.href, DATABASE_PASSWORD_FILE: '' },
    })
    if (result.status !== 0) throw new Error(`Migration failed: ${result.stdout}\n${result.stderr}`)
    db = new PrismaClient({ datasources: { db: { url: url.href } } })
    connection.client = db
  }, 60000)

  beforeEach(async () => {
    await db.user.deleteMany()
    user = await db.user.create({ data: { phone: '19900000003' } })
  })
  afterAll(async () => {
    await db?.$disconnect()
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.$disconnect()
    }
  })

  it('a code is claimed exactly once under concurrent claims, and only hashes are stored', async () => {
    const { code } = await createPairing(user.id)
    const results = await Promise.allSettled(Array.from({ length: 4 }, (_, index) => claimPairing({ code, name: `电脑${index}` })))
    const claimed = results.filter((result) => result.status === 'fulfilled')
    expect(claimed).toHaveLength(1)
    const { token, bridgeId } = claimed[0].value

    const row = await db.localBridge.findUnique({ where: { id: bridgeId } })
    expect(row.pairingCodeHash).toBeNull()
    expect(JSON.stringify(row)).not.toContain(token)
    expect(await authenticateBridge(token)).toMatchObject({ id: bridgeId, userId: user.id })
    expect(await listBridges(user.id)).toMatchObject([{ id: bridgeId, online: false }])
  })

  it('an expired code does not work, and a disconnected computer loses its token', async () => {
    const { code } = await createPairing(user.id, new Date(Date.now() - 11 * 60 * 1000))
    await expect(claimPairing({ code })).rejects.toMatchObject({ statusCode: 400 })

    const fresh = await createPairing(user.id)
    const { token, bridgeId } = await claimPairing({ code: fresh.code })
    await expect(revokeBridge('someone-else', bridgeId)).rejects.toMatchObject({ statusCode: 404 })
    await revokeBridge(user.id, bridgeId)
    expect(await authenticateBridge(token)).toBeNull()
    expect(await listBridges(user.id)).toEqual([])
  })
})
