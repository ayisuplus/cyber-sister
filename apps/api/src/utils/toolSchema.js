/**
 * 工具参数结构（JSON Schema 子集）的共用小构件。
 * agentService（基础/本机/桥接工具）与各模块技能共用，避免技能模块反向依赖 agentService。
 */
export const nativeObject = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
export const nativeString = { type: 'string' }
export const offsetParameter = { type: 'integer', minimum: 0 }
