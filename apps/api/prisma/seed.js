import 'dotenv/config'
import { loadRuntimeSecrets } from '../src/config/runtime.js'

loadRuntimeSecrets()
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()

function internalPhones() {
  return (process.env.INTERNAL_TEST_PHONES || '')
    .split(',')
    .map((phone) => phone.trim())
    .filter((phone) => /^1\d{10}$/.test(phone))
}

async function main() {
  if (process.env.APP_ENV !== 'internal') {
    throw new Error('The allowlisted tester seed is only available when APP_ENV=internal')
  }
  const phones = internalPhones()
  if (phones.length === 0) {
    throw new Error('INTERNAL_TEST_PHONES must contain at least one valid phone number')
  }
  const { DEFAULT_PERSONA_CARD } = await import('../src/services/personaStudio.js')

  for (const phone of phones) {
    if (await prisma.user.findUnique({ where: { phone } })) continue
    // 初始「她」与注册同款（人设库，2026-09-29）：users.persona 从建号起就指向一张 Persona 卡
    await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { phone, nickname: '内测用户', isVip: false } })
      const persona = await tx.persona.create({
        data: { userId: created.id, name: DEFAULT_PERSONA_CARD.name, card: DEFAULT_PERSONA_CARD },
      })
      await tx.user.update({ where: { id: created.id }, data: { persona: persona.id } })
    })
  }

  console.info(`Seeded ${phones.length} allowlisted internal tester account(s)`)
}

main()
  .catch((error) => {
    console.error('Database seed failed:', error instanceof Error ? error.message : 'unknown error')
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
