/**
 * 模块操作技能注册表：一个数据模块一个技能（与「情绪与关系梳理」「身体呵护」同一范式）。
 *
 * 技能对象契约（每个 services/<name>Skill.js 导出一个常量）：
 *   {
 *     id: 'notes',                // = src/skills/ 下目录名
 *     title: '手记',               // 系统块头行 '[Amie 内置技能：手记 v1]'
 *     tools: { <toolName>: { description, run(userId, args) → { summary, result },
 *                            needsConfirm?(userId, args) → false | string,  // string = 待确认的动作描述
 *                            signatureOf?() } },
 *     toolParameters: { <toolName>: <JSON schema 对象> },
 *     buildContext(text, history = [], scene = 'chat'),   // 与 emotionReflectionSkill 同签名
 *   }
 * needsConfirm 命中时不执行 run，由执行通道返回 pending 提案、等用户在聊天内确认卡点头；
 * 确认后走同一个 run，不建第二执行通道。
 */
import { NOTES_SKILL } from './notesSkill.js'
import { READING_SKILL } from './readingSkill.js'
import { CALENDAR_SKILL } from './calendarSkill.js'
import { PERIOD_SKILL } from './periodSkill.js'
import { COLLECTION_SKILL } from './collectionSkill.js'
import { MEMORY_SKILL } from './memorySkill.js'
import { LETTER_SKILL } from './letterSkill.js'

export const MODULE_SKILLS = [NOTES_SKILL, READING_SKILL, CALENDAR_SKILL, PERIOD_SKILL, COLLECTION_SKILL, MEMORY_SKILL, LETTER_SKILL]

/** 话题命中时的操作口径注入（0 条命中返回 []）；跨模块硬规则另有 TASK_GUIDE 常驻兜底。 */
export function buildModuleSkillContexts(text, history = [], scene = 'chat') {
  return MODULE_SKILLS.flatMap((skill) => skill.buildContext(text, history, scene))
}

/** 七个技能的工具合并成扁平注册表（name → tool 对象）。 */
export function moduleSkillTools() {
  return Object.assign({}, ...MODULE_SKILLS.map((skill) => skill.tools))
}

/** 七个技能的参数结构合并（name → JSON schema）。 */
export function moduleSkillParameters() {
  return Object.assign({}, ...MODULE_SKILLS.map((skill) => skill.toolParameters))
}
