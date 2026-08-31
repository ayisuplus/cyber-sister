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
const child = spawn(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schema], {
  env: process.env,
  stdio: 'inherit',
})

child.once('error', () => {
  console.error('Failed to start Prisma migrate deploy')
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
