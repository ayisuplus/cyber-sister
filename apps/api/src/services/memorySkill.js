/**
 * 「记忆」（她记得的你）操作技能：查列表、改与删（都须确认）。
 * 不提供 create_memory：记忆只能由用户经「帮我记住」确认卡创建，不变式保持。
 */
import { skillSection } from './skillCatalog.js'
import { listMemories, getMemory, updateMemory, deleteMemory } from './memoryService.js'
import { nativeObject, nativeString } from '../utils/toolSchema.js'

const core = skillSection('memory', '核心行为')

export const MEMORY_SKILL = {
  id: 'memory',
  title: '记忆',
  tools: {
    list_memories: {
      description: '{"tool":"list_memories","args":{}} 看「她记得的你」：她记着的事实列表（只读）',
      run: async (userId) => {
        const { data, total } = await listMemories(userId, { page: 1, limit: 20 })
        return {
          summary: `她记着 ${total} 条`,
          result: { total, items: data.map(({ id, type, content, importance, tags, pinned }) => ({ id, type, content, importance, tags, pinned })) },
        }
      },
    },
    update_memory: {
      needsConfirm: async (userId, args) => {
        const current = await getMemory(userId, String(args.id || ''))
        return { action: '把这条记忆改成新的说法', args: { ...args, expectedRevision: current.revision } }
      },
      description: '{"tool":"update_memory","args":{"id":"记忆 id","content":"新内容"}} 改一条记忆（需要用户确认；版本冲突会报错，不自动覆盖）',
      run: async (userId, args) => {
        const updated = await updateMemory(userId, String(args.id || ''), { content: args.content, expectedRevision: args.expectedRevision })
        return { summary: '已改好这条记忆', result: { id: updated.id, content: updated.content, revision: updated.revision } }
      },
    },
    delete_memory: {
      needsConfirm: () => '删掉这条记忆',
      description: '{"tool":"delete_memory","args":{"id":"记忆 id"}} 删掉一条记忆（需要用户确认）',
      run: async (userId, args) => {
        await deleteMemory(userId, String(args.id || ''))
        return { summary: '已删掉这条记忆', result: { id: String(args.id || '') } }
      },
    },
  },
  toolParameters: {
    list_memories: nativeObject({}),
    update_memory: nativeObject({ id: nativeString, content: nativeString }, ['id', 'content']),
    delete_memory: nativeObject({ id: nativeString }, ['id']),
  },
  buildContext(text, _history = [], scene = 'chat') {
    if (scene !== 'chat' || typeof text !== 'string') return []
    if (!/记忆|她记得|改记忆|删记忆/.test(text)) return []
    return [{ role: 'system', content: `[Amie 内置技能：记忆 v1]\n${core}` }]
  },
}
