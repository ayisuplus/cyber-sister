/**
 * 工作模式插件服务：plugins/ 目录 JS 模块的加载、校验与注册。
 *
 * 插件合同：默认导出 { name, description, run } —— name 匹配
 * ^[a-z][a-z0-9_]{1,30}$；description 以 {"tool":"<name>" 开头（进工具目录）；
 * run(userId, args) 返回 { summary, result }。插件在本机执行任意代码，
 * 与 bash_run 同级信任；默认关闭，PLUGINS_ENABLED=true 显式开启。
 * 插件文件变更需重启 API 生效。
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import logger from '../utils/logger.js'

const NAME_PATTERN = /^[a-z][a-z0-9_]{1,30}$/

const isPluginsEnabled = () => process.env.PLUGINS_ENABLED === 'true'

const pluginsDir = () => process.env.PLUGINS_DIR
  || fileURLToPath(new URL('../../data/plugins', import.meta.url))

/** 校验插件默认导出，不合法时返回原因字符串，合法返回 null。 */
function validatePlugin(mod) {
  if (!mod || typeof mod !== 'object') return '默认导出不是对象'
  if (!NAME_PATTERN.test(String(mod.name ?? ''))) return 'name 非法'
  if (typeof mod.description !== 'string' || !mod.description.startsWith(`{"tool":"${mod.name}"`)) {
    return 'description 缺失或未以工具 JSON 开头'
  }
  if (typeof mod.run !== 'function') return 'run 缺失'
  return null
}

/**
 * 加载目录下全部插件并经 register(name, tool) 注册。
 * 单个插件失败 warn 跳过；返回加载成功的 name 数组。
 */
export async function loadPlugins(register) {
  if (!isPluginsEnabled()) return []
  const dir = pluginsDir()
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn('插件目录读取失败', { error: error.message })
    return []
  }
  const loaded = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue
    try {
      // 插件逐个串行加载：单文件失败隔离，注册顺序与目录顺序一致
      // eslint-disable-next-line no-await-in-loop
      const mod = (await import(pathToFileURL(join(dir, entry.name)).href)).default
      const invalid = validatePlugin(mod)
      if (invalid) {
        logger.warn('插件校验失败，跳过', { file: entry.name, reason: invalid })
        continue
      }
      const { name, description, run } = mod
      // 兜底返回形状：summary/result 缺省补齐；插件抛错原样上抛，由执行层统一兜底
      register(name, {
        description,
        run: async (userId, args) => {
          const outcome = await run(userId, args)
          return {
            summary: outcome?.summary ?? `已执行「${name}」`,
            result: outcome?.result ?? null,
          }
        },
      })
      loaded.push(name)
    } catch (error) {
      logger.warn('插件加载失败，跳过', { file: entry.name, error: error.message })
    }
  }
  return loaded
}
