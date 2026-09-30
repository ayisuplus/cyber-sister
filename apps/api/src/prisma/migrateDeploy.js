import 'dotenv/config'

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, URL } from 'node:url'
import { loadRuntimeSecrets } from '../config/runtime.js'

loadRuntimeSecrets()
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is unavailable')

const require = createRequire(import.meta.url)
const prismaCli = require.resolve('prisma/build/index.js')
const schema = fileURLToPath(new URL('./schema.prisma', import.meta.url))
const personaMigration = fileURLToPath(new URL('../../scripts/migrate-personas.mjs', import.meta.url))

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env: process.env, stdio: 'inherit' })
    child.once('error', () => {
      console.error('Failed to start database migration')
      resolve(1)
    })
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
}

const schemaExit = await run([prismaCli, 'migrate', 'deploy', '--schema', schema])
// 回填失败时阻止启动；不能只完成 schema 升级就让旧用户进入空的人设库。
process.exitCode = schemaExit || await run([personaMigration])
