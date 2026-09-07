/**
 * 工作模式扩展编排器：技能扫描 + 插件加载 + MCP 连接的单向装配。
 *
 * agentService 不 import plugin/mcp service（它们需要 registerWorkTool，
 * 直接互 import 会成环）；本模块单向依赖三方，单路失败不拖累其余。
 */
import { registerWorkTool } from './agentService.js'
import { scanSkills, listSkillSummaries } from './skillService.js'
import { loadPlugins } from './pluginService.js'
import { connectServers } from './mcpService.js'
import logger from '../utils/logger.js'

/** 工作模式扩展初始化：技能扫描 + 插件加载 + MCP 连接；单路失败不拖累其余。 */
export async function initWorkExtensions() {
  try { scanSkills() } catch (error) { logger.error('技能扫描失败', { error: error.message }) }
  try { await loadPlugins(registerWorkTool) } catch (error) { logger.error('插件加载失败', { error: error.message }) }
  try { await connectServers(registerWorkTool) } catch (error) { logger.error('MCP 连接失败', { error: error.message }) }
  logger.info('工作模式扩展初始化完成', { skills: listSkillSummaries().length })
}
