/**
 * 本机终端命令服务（工作模式 bash_run 工具的执行体）。
 *
 * 安全边界：
 * - 仅当 BASH_ENABLED='true' 时可用，否则一律 503。
 * - 默认 30 秒超时即终止；stdout/stderr 截断回传；非零退出码不算异常，如实回传由模型解释。
 * - 日志只记 userId 与退出码，绝不记录命令全文与输出内容。
 */
import { exec } from 'node:child_process'
import { homedir } from 'node:os'
import { HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_OUTPUT_CHARS = 4000
const MAX_BUFFER_BYTES = 8 * 1024 * 1024

const isEnabled = (env) => env.BASH_ENABLED === 'true'

function clipOutput(text) {
  const str = String(text ?? '')
  return str.length > MAX_OUTPUT_CHARS ? `${str.slice(0, MAX_OUTPUT_CHARS)}\n…(输出过长已截断)` : str
}

/**
 * 执行一条 shell 命令（cmd.exe /c 或 sh -c 由 exec 按平台选择，cwd 固定为用户主目录）。
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number, timedOut: boolean }>}
 */
export async function runBash(userId, command, { env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!isEnabled(env)) throw new HttpError('本机终端未启用', 503)
  const cmd = String(command ?? '').trim()
  if (!cmd) throw new HttpError('命令不能为空', 400)

  const result = await new Promise((resolve) => {
    exec(cmd, { cwd: homedir(), timeout: timeoutMs, maxBuffer: MAX_BUFFER_BYTES, windowsHide: true }, (error, stdout, stderr) => {
      if (!error) {
        return resolve({ stdout: clipOutput(stdout), stderr: clipOutput(stderr), exitCode: 0, timedOut: false })
      }
      const timedOut = error.killed === true || error.signal === 'SIGTERM'
      const exitCode = typeof error.code === 'number' ? error.code : -1
      resolve({ stdout: clipOutput(stdout), stderr: clipOutput(stderr), exitCode, timedOut })
    })
  })

  logger.info('本机终端命令执行', { userId, action: 'bash_run', result: result.exitCode })
  return result
}
