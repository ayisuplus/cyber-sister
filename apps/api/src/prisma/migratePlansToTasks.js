// 功能收拢的数据迁移：把日程/倒数日/习惯/旧提醒转成「安排」（定时任务）。
// 用法：pnpm db:migrate:plans -- --dry-run   先只计算条数；去掉 --dry-run 才写入。
// 按用户幂等（users.plans_migrated_at），可重复执行；旧表只停用、不删除。须在 db:migrate:deploy 之后运行。
import 'dotenv/config'

import { loadRuntimeSecrets } from '../config/runtime.js'

loadRuntimeSecrets()
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is unavailable')

const { migrateAllUsers } = await import('../services/planMigrationService.js')
const { default: prisma } = await import('./client.js')

const dryRun = process.argv.includes('--dry-run')
try {
  const summary = await migrateAllUsers({ dryRun })
  // 只输出计数，不输出任何用户内容
  console.log(JSON.stringify(summary))
  if (summary.failed > 0) process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
