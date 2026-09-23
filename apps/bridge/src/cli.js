#!/usr/bin/env node
/**
 * Amie 本机助手命令行。
 *   amie-bridge pair <连接码> --server <Amie 网址> --folder <授权文件夹> [--name <这台电脑的名字>]
 *   amie-bridge run [--folder <授权文件夹>]
 * 配对信息保存在用户目录下的 .amie-bridge.json（仅本人可读）；换文件夹时用 run --folder 覆盖。
 */
import { chmod, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import path from 'node:path'
import { normalizeServer, pair, runBridge } from './client.js'

const CONFIG_PATH = path.join(homedir(), '.amie-bridge.json')

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = { _: [] }
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (arg.startsWith('--')) options[arg.slice(2)] = rest[++index]
    else options._.push(arg)
  }
  return { command, options }
}

async function authorizedFolder(folder) {
  if (!folder) throw new Error('请用 --folder 指定一个授权文件夹，Amie 只能碰这个文件夹里的东西')
  const absolute = path.resolve(folder)
  const info = await stat(absolute).catch(() => null)
  if (!info?.isDirectory()) throw new Error(`找不到文件夹：${absolute}`)
  return absolute
}

async function loadConfig() {
  try { return JSON.parse(await readFile(CONFIG_PATH, 'utf8')) } catch { return null }
}

async function saveConfig(config) {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })
  await chmod(CONFIG_PATH, 0o600).catch(() => {})
}

async function run(config) {
  console.log(`已连上 ${config.server}（${config.name}）。`)
  console.log(`Amie 只能在「${config.folder}」里看目录、读文本文件、新建文件；不会覆盖、删除或运行任何东西。`)
  console.log('她读到的文件内容会和聊天一样交给云端模型处理。按 Ctrl+C 断开。')
  const controller = new AbortController()
  process.once('SIGINT', () => { controller.abort(); console.log('\n已断开。') })
  await runBridge({ server: config.server, token: config.token, folder: config.folder, signal: controller.signal })
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2))
  if (command === 'pair') {
    const code = options._[0]
    if (!code || !options.server) throw new Error('用法：amie-bridge pair <连接码> --server <Amie 网址> --folder <授权文件夹>')
    const server = normalizeServer(options.server)
    const folder = await authorizedFolder(options.folder)
    const name = options.name || hostname()
    const claimed = await pair({ server, code, name })
    const config = { server, token: claimed.token, folder, name: claimed.name }
    await saveConfig(config)
    return run(config)
  }
  if (command === 'run') {
    const saved = await loadConfig()
    if (!saved?.token) throw new Error('这台电脑还没有配对：先在 Amie 的「设置 → 连接你的电脑」里生成连接码，再运行 amie-bridge pair')
    const config = { ...saved, folder: await authorizedFolder(options.folder || saved.folder) }
    if (config.folder !== saved.folder) await saveConfig(config)
    return run(config)
  }
  console.log('用法：\n  amie-bridge pair <连接码> --server <Amie 网址> --folder <授权文件夹> [--name <这台电脑的名字>]\n  amie-bridge run [--folder <授权文件夹>]')
  return undefined
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
