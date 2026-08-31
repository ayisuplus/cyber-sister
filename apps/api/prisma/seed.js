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

  for (const phone of phones) {
    await prisma.user.upsert({
      where: { phone },
      update: {},
      create: {
        phone,
        nickname: '内测用户',
        persona: 'toxic',
        isVip: false,
      },
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
