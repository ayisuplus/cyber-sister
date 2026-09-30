// 人设库的数据迁移：把每个用户的旧说话方式枚举（users.persona）建成一张 Persona 卡，users.persona 回写成新 id。
// 用法：pnpm db:migrate:personas -- --dry-run   先只计算条数；去掉 --dry-run 才写入。
// 幂等：users.persona 已经指向该用户自己的 Persona 时跳过。db:migrate:deploy 自动调用本脚本。
import 'dotenv/config'

import { loadRuntimeSecrets } from '../src/config/runtime.js'

loadRuntimeSecrets()
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is unavailable')

const { migrateLegacyPersonas } = await import('../src/services/personaStudio.js')
const { default: prisma } = await import('../src/prisma/client.js')

const dryRun = process.argv.includes('--dry-run')
try {
  const summary = await migrateLegacyPersonas({ database: prisma, dryRun })
  // 只输出计数，不输出任何用户内容
  console.log(JSON.stringify(summary))
  if (summary.failed > 0) process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
