// 人格 ID 清单的权威来源是 packages/llm-gateway/src/personas.js 的 VALID_PERSONA_IDS。
// web 不直接 import 网关包：会把服务端系统提示词打进客户端 bundle，且需给
// cyber-sister-client 新增运行时依赖；两侧漂移由 personas.test.js 的守卫测试拦截。
// 界面只提供 3 种说话方式；其余 ID 仍然有效，只为选过它们的老用户保留名称。
export const PERSONAS = [
  { id: 'toxic', name: '毒舌互怼' },
  { id: 'gentle', name: '温柔姐姐' },
  { id: 'rational', name: '理性军师' },
  { id: 'energetic', name: '元气炸弹' },
  { id: 'sister', name: '知心姐姐' },
  { id: 'cool', name: '安静' },
]

export const SPEAKING_STYLES = [
  { id: 'gentle', label: '温柔', description: '包容、耐心，慢慢听你说' },
  { id: 'toxic', label: '直爽', description: '有话直说，护短，也会骂醒你' },
  { id: 'cool', label: '安静', description: '话少、冷静，关键时刻靠得住' },
]

export const DEFAULT_PERSONA_ID = 'gentle'

export const getPersona = (id) =>
  PERSONAS.find(persona => persona.id === id)
  || PERSONAS.find(persona => persona.id === DEFAULT_PERSONA_ID)
