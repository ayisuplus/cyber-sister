import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PERSONA_CARD, createPersona, migrateLegacyPersonas, removePersona } from '../../src/services/personaStudio.js'
import { switchPersona } from '../../src/services/userService.js'

const describeWithPostgres = process.env.TEST_DATABASE_URL ? describe : describe.skip
const apiRoot = fileURLToPath(new URL('../../', import.meta.url))
const migrateScript = fileURLToPath(new URL('../../src/prisma/migrateDeploy.js', import.meta.url))
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js')
const databaseName = `persona_test_${process.pid}_${Date.now()}`
let admin
let database
let databaseUrl

function run(args) {
  return spawnSync(process.execPath, args, {
    cwd: apiRoot,
    env: {
      ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test', APP_ENV: 'internal',
      DATABASE_PASSWORD_FILE: '', JWT_SECRET_FILE: '', JWT_REFRESH_SECRET_FILE: '',
      INTERNAL_TEST_CODE_FILE: '', INTERNAL_TEST_PHONES_FILE: '', GATEWAY_QWEN_API_KEY_FILE: '',
    },
    encoding: 'utf8', timeout: 30000,
  })
}

async function expectValidActive(userId) {
  const user = await database.user.findUnique({ where: { id: userId } })
  expect(await database.persona.findFirst({ where: { id: user.persona, userId } })).not.toBeNull()
}

describeWithPostgres('人设升级与并发不变量（真实 PostgreSQL）', () => {
  beforeAll(async () => {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) throw new Error('Unsafe test database name')
    const url = new URL(process.env.TEST_DATABASE_URL)
    url.pathname = `/${databaseName}`
    databaseUrl = url.toString()
    admin = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } })
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)
    // 先仅建 schema，模拟旧升级入口留下的 users.persona 枚举。
    const migrated = run([prismaCli, 'migrate', 'deploy', '--schema', 'src/prisma/schema.prisma'])
    expect(migrated.status, migrated.stderr).toBe(0)
    database = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  }, 40000)

  beforeEach(async () => { await database.user.deleteMany() })

  afterAll(async () => {
    await database?.$disconnect()
    if (admin) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    await admin?.$disconnect()
  })

  it('正常升级自动保留六种旧底色，未知值兜底；重复升级不建重复卡', async () => {
    const ids = ['toxic', 'gentle', 'rational', 'energetic', 'sister', 'cool', 'unknown']
    const tones = ['toxic', 'gentle', 'gentle', 'gentle', 'gentle', 'cool', 'gentle']
    await database.user.createMany({ data: ids.map((persona, i) => ({ phone: `1990000010${i}`, persona })) })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = run([migrateScript])
      expect(result.status, result.stderr).toBe(0)
      expect(await database.persona.count()).toBe(ids.length)
    }
    const users = await database.user.findMany({ orderBy: { phone: 'asc' } })
    for (const [index, user] of users.entries()) {
      const persona = await database.persona.findFirst({ where: { id: user.persona, userId: user.id } })
      expect(persona.card.tone).toBe(tones[index])
      expect(persona.card.immersion).toBe('medium')
    }
  }, 60000)

  it('dry-run 不写数据；并发回填只建一张，已有自定义卡原样保留', async () => {
    const legacy = await database.user.create({ data: { phone: '19900000201', persona: 'toxic' } })
    const custom = await database.user.create({ data: { phone: '19900000202' } })
    const card = { ...DEFAULT_PERSONA_CARD, name: '自定义', immersion: 'high' }
    const existing = await createPersona(custom.id, card, database)
    expect(await migrateLegacyPersonas({ database, dryRun: true })).toMatchObject({ migrated: 1, skipped: 1, failed: 0 })
    expect((await database.user.findUnique({ where: { id: legacy.id } })).persona).toBe('toxic')
    expect(await database.persona.count()).toBe(1)
    const summaries = await Promise.all([migrateLegacyPersonas({ database }), migrateLegacyPersonas({ database })])
    expect(summaries.reduce((total, result) => total + result.migrated, 0)).toBe(1)
    expect(summaries.every((result) => result.failed === 0)).toBe(true)
    expect(await database.persona.count()).toBe(2)
    expect((await database.persona.findUnique({ where: { id: existing.id } })).card).toEqual(card)
    await expectValidActive(legacy.id)
  })

  it('回填失败使正常升级非零退出，事务不留下半张卡或失效指针', async () => {
    const user = await database.user.create({ data: { phone: '19900000301', persona: 'toxic' } })
    await database.$executeRawUnsafe(`ALTER TABLE personas ADD CONSTRAINT test_reject_legacy CHECK (name <> '毒舌互怼')`)
    try {
      const result = run([migrateScript])
      expect(result.status).not.toBe(0)
      expect(result.stdout).toContain('"failed":1')
      expect(result.stdout + result.stderr).not.toContain(user.phone)
      expect(await database.persona.count()).toBe(0)
      expect((await database.user.findUnique({ where: { id: user.id } })).persona).toBe('toxic')
    } finally {
      await database.$executeRawUnsafe('ALTER TABLE personas DROP CONSTRAINT test_reject_legacy')
    }
  }, 40000)

  it('同时删除两张只成功一个，最后一张与当前指针都保留', async () => {
    const user = await database.user.create({ data: { phone: '19900000401' } })
    const first = await createPersona(user.id, DEFAULT_PERSONA_CARD, database)
    const second = await createPersona(user.id, { ...DEFAULT_PERSONA_CARD, name: '另一个' }, database)
    const results = await Promise.allSettled([
      removePersona(user.id, first.id, database), removePersona(user.id, second.id, database),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected').reason.message).toBe('至少留一个她')
    expect(await database.persona.count({ where: { userId: user.id } })).toBe(1)
    await expectValidActive(user.id)
  })

  it('切换与删除交错不产生悬空指针，也不能切换到其他用户的卡', async () => {
    const user = await database.user.create({ data: { phone: '19900000501' } })
    const other = await database.user.create({ data: { phone: '19900000502' } })
    const first = await createPersona(user.id, DEFAULT_PERSONA_CARD, database)
    await createPersona(user.id, { ...DEFAULT_PERSONA_CARD, name: '留着' }, database)
    const foreign = await createPersona(other.id, DEFAULT_PERSONA_CARD, database)
    const results = await Promise.allSettled([
      switchPersona(user.id, first.id, database), removePersona(user.id, first.id, database),
    ])
    expect(results[1].status).toBe('fulfilled')
    if (results[0].status === 'rejected') expect(results[0].reason.message).toBe('没有这个她')
    await expect(switchPersona(user.id, foreign.id, database)).rejects.toThrow('没有这个她')
    await expectValidActive(user.id)
  })
})
