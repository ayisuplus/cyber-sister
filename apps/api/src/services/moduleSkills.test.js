import { describe, expect, it } from 'vitest'
import { MODULE_SKILLS, buildModuleSkillContexts, moduleSkillTools, moduleSkillParameters } from './moduleSkills.js'

const ALL_TOOL_NAMES = [
  'add_diary', 'diary_status', 'list_diary', 'delete_diary',
  'log_reading', 'list_books', 'list_reading_notes', 'update_book', 'delete_reading_note',
  'add_task', 'list_tasks', 'update_task', 'delete_task', 'day_review',
  'record_period', 'period_status', 'update_period_record', 'delete_period_record',
  'list_collection', 'add_collection_item', 'update_collection_item', 'delete_collection_item',
  'list_memories', 'update_memory', 'delete_memory',
  'list_letters', 'set_letter_freq',
]

describe('moduleSkills 注册表', () => {
  it('七个模块技能一个不少，id 与目录名一致', () => {
    expect(MODULE_SKILLS.map((skill) => skill.id)).toEqual(['notes', 'reading', 'calendar', 'period', 'collection', 'memory', 'letter'])
    for (const skill of MODULE_SKILLS) {
      expect(skill.title).toBeTruthy()
      expect(typeof skill.buildContext).toBe('function')
    }
  })

  it('工具与参数结构一一对应，覆盖全部模块操作工具', () => {
    const tools = moduleSkillTools()
    const parameters = moduleSkillParameters()
    expect(Object.keys(tools).sort()).toEqual([...ALL_TOOL_NAMES].sort())
    expect(Object.keys(parameters).sort()).toEqual([...ALL_TOOL_NAMES].sort())
    for (const name of ALL_TOOL_NAMES) {
      expect(tools[name].description).toContain(`"tool":"${name}"`)
      expect(typeof tools[name].run).toBe('function')
      expect(parameters[name]).toMatchObject({ type: 'object' })
    }
  })

  it('跨模块话题注入对应技能的操作口径，无关话题什么都不注入', () => {
    const blocks = buildModuleSkillContexts('看看手记和书架')
    expect(blocks).toHaveLength(2)
    expect(blocks.map((block) => block.content.split(']')[0])).toEqual(['[Amie 内置技能：手记 v1', '[Amie 内置技能：读书 v1'])
    expect(buildModuleSkillContexts('推荐一部电影')).toEqual([])
  })
})
