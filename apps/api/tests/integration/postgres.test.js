import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip
const apiRoot = fileURLToPath(new URL('../../', import.meta.url))
const migrateScript = fileURLToPath(new URL('../../src/prisma/migrateDeploy.js', import.meta.url))
const seedScript = fileURLToPath(new URL('../../prisma/seed.js', import.meta.url))
const databaseName = `cyber_sister_test_${process.pid}_${Date.now()}`
const seedPhone = '19900000000'
let admin
let prisma
let isolatedDatabaseUrl

function childEnvironment(databaseUrl) {
  return {
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'internal',
    DATABASE_URL: databaseUrl,
    INTERNAL_TEST_PHONES: seedPhone,
    DATABASE_PASSWORD_FILE: '',
    JWT_SECRET_FILE: '',
    JWT_REFRESH_SECRET_FILE: '',
    INTERNAL_TEST_CODE_FILE: '',
    INTERNAL_TEST_PHONES_FILE: '',
    GATEWAY_QWEN_API_KEY_FILE: '',
  }
}

function runNodeScript(script, databaseUrl) {
  const result = spawnSync(process.execPath, [script], {
    cwd: apiRoot,
    env: childEnvironment(databaseUrl),
    stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error(`PostgreSQL fixture command failed with exit ${result.status}`)
}

describeWithPostgres('real PostgreSQL migration contract', () => {
  beforeAll(async () => {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) throw new Error('Unsafe test database name')
    const target = new URL(testDatabaseUrl)
    target.pathname = `/${databaseName}`
    isolatedDatabaseUrl = target.toString()

    admin = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } })
    await admin.$queryRaw`SELECT 1`
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)
    runNodeScript(migrateScript, isolatedDatabaseUrl)
    runNodeScript(seedScript, isolatedDatabaseUrl)

    prisma = new PrismaClient({ datasources: { db: { url: isolatedDatabaseUrl } } })
    await prisma.$queryRaw`SELECT 1`
  })

  afterAll(async () => {
    await prisma?.$disconnect()
    if (admin && isolatedDatabaseUrl) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    }
    await admin?.$disconnect()
  })

  it('deploys the baseline migration into an empty database and seeds an allowlisted tester', async () => {
    const migrations = await prisma.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`
    expect(migrations.length).toBeGreaterThan(0)
    expect(await prisma.user.count({ where: { phone: seedPhone } })).toBe(1)
  })

  it('persists consent, message source, explicit memory and singleton local-model config', async () => {
    const phone = `199${String(Date.now()).slice(-8)}`
    let userId
    try {
      const created = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            phone,
            persona: 'rational',
            externalLlmConsent: true,
            externalLlmConsentVersion: 'cloud-primary-v1',
            externalLlmConsentUpdatedAt: new Date(),
          },
        })
        const conversation = await tx.conversation.create({
          data: {
            userId: user.id,
            messages: {
              create: [
                { role: 'user', content: 'PostgreSQL 集成测试输入' },
                { role: 'assistant', content: '本地模板', source: 'local_template' },
              ],
            },
          },
          include: { messages: true },
        })
        const memory = await tx.memory.create({
          data: {
            userId: user.id,
            type: 'semantic',
            content: '显式测试记忆',
            importance: 7,
            tags: JSON.stringify(['集成测试']),
          },
        })
        const llmConfig = await tx.llmRuntimeConfig.upsert({
          where: { id: 'local' },
          create: {
            id: 'local',
            provider: 'llamacpp',
            baseUrl: 'http://llama:8080/v1',
            model: 'integration-model',
            updatedByUserId: user.id,
          },
          update: {
            baseUrl: 'http://llama:8080/v1',
            model: 'integration-model',
            revision: { increment: 1 },
            updatedByUserId: user.id,
          },
        })
        return { user, conversation, memory, llmConfig }
      })
      userId = created.user.id

      expect(created.user).toMatchObject({
        persona: 'rational',
        externalLlmConsent: true,
        externalLlmConsentVersion: 'cloud-primary-v1',
      })
      expect(created.conversation.messages).toHaveLength(2)
      expect(created.conversation.messages[1]).toMatchObject({ source: 'local_template' })
      expect(created.memory).toMatchObject({ type: 'semantic', importance: 7 })
      expect(created.llmConfig).toMatchObject({
        id: 'local',
        provider: 'llamacpp',
        model: 'integration-model',
      })
    } finally {
      if (userId) {
        await prisma.llmRuntimeConfig.deleteMany({ where: { updatedByUserId: userId } })
        await prisma.user.delete({ where: { id: userId } })
      }
    }

    expect(await prisma.conversation.count({ where: { userId } })).toBe(0)
    expect(await prisma.memory.count({ where: { userId } })).toBe(0)
  })
})
