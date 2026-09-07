import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./agentService.js', () => ({ registerWorkTool: vi.fn() }))
vi.mock('./skillService.js', () => ({ scanSkills: vi.fn(), listSkillSummaries: vi.fn(() => []) }))
vi.mock('./pluginService.js', () => ({ loadPlugins: vi.fn(async () => []) }))
vi.mock('./mcpService.js', () => ({ connectServers: vi.fn(async () => []) }))
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { registerWorkTool } from './agentService.js'
import { listSkillSummaries, scanSkills } from './skillService.js'
import { loadPlugins } from './pluginService.js'
import { connectServers } from './mcpService.js'
import logger from '../utils/logger.js'
import { initWorkExtensions } from './workExtensionService.js'

describe('initWorkExtensions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listSkillSummaries.mockReturnValue([])
    loadPlugins.mockResolvedValue([])
    connectServers.mockResolvedValue([])
  })

  it('三路依次执行：技能扫描、插件加载、MCP 连接共享同一注册口', async () => {
    listSkillSummaries.mockReturnValue([{ name: 'a', description: 'b' }])
    await initWorkExtensions()
    expect(scanSkills).toHaveBeenCalledOnce()
    expect(loadPlugins).toHaveBeenCalledWith(registerWorkTool)
    expect(connectServers).toHaveBeenCalledWith(registerWorkTool)
    expect(logger.info).toHaveBeenCalledWith('工作模式扩展初始化完成', { skills: 1 })
  })

  it('技能扫描抛错不影响插件与 MCP 两路', async () => {
    scanSkills.mockImplementation(() => { throw new Error('目录不可读') })
    await initWorkExtensions()
    expect(logger.error).toHaveBeenCalledWith('技能扫描失败', { error: '目录不可读' })
    expect(loadPlugins).toHaveBeenCalledOnce()
    expect(connectServers).toHaveBeenCalledOnce()
  })

  it('插件加载 reject 不影响 MCP 一路', async () => {
    loadPlugins.mockRejectedValue(new Error('插件目录爆炸'))
    await initWorkExtensions()
    expect(logger.error).toHaveBeenCalledWith('插件加载失败', { error: '插件目录爆炸' })
    expect(connectServers).toHaveBeenCalledOnce()
  })

  it('MCP 连接 reject 不抛出，初始化正常收尾', async () => {
    connectServers.mockRejectedValue(new Error('全部 server 不可达'))
    await expect(initWorkExtensions()).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith('MCP 连接失败', { error: '全部 server 不可达' })
    expect(logger.info).toHaveBeenCalledWith('工作模式扩展初始化完成', { skills: 0 })
  })
})
