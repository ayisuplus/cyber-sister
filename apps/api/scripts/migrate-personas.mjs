// 人设库的数据迁移：把每个用户的旧说话方式枚举（users.persona）建成一张 Persona 卡，users.persona 回写成新 id。
// 用法：pnpm db:migrate:personas -- --dry-run   先只计算条数；去掉 --dry-run 才写入。
// 幂等：users.persona 已经指向该用户自己的 Persona 时跳过，可重复执行。须在 db:migrate:deploy 之后运行。
import 'dotenv/config'

import { loadRuntimeSecrets } from '../src/config/runtime.js'

loadRuntimeSecrets()
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is unavailable')

const { legacyPersonaCard, DEFAULT_PERSONA_CARD } = await import('../src/services/personaStudio.js')
const { default: prisma } = await import('../src/prisma/client.js')

const dryRun = process.argv.includes('--dry-run')
const summary = { users: 0, migrated: 0, skipped: 0, failed: 0 }

try {
  const users = await prisma.user.findMany({ select: { id: true, persona: true }, orderBy: { createdAt: 'asc' } })
  for (const user of users) {
    summary.users += 1
    try {
      // 已迁过：users.persona 指向她自己的一张 Persona
      const current = await prisma.persona.findFirst({ where: { id: user.persona, userId: user.id } })
      if (current) {
        summary.skipped += 1
        continue
      }
      const card = legacyPersonaCard(user.persona) || legacyPersonaCard('gentle') || DEFAULT_PERSONA_CARD
      if (!dryRun) {
        await prisma.$transaction(async (tx) => {
          const persona = await tx.persona.create({ data: { userId: user.id, name: card.name, card } })
          await tx.user.update({ where: { id: user.id }, data: { persona: persona.id } })
        })
      }
      summary.migrated += 1
    } catch {
      summary.failed += 1
    }
  }
  // 只输出计数，不输出任何用户内容
  console.log(JSON.stringify(summary))
  if (summary.failed > 0) process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
