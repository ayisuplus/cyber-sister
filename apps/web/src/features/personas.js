// 人格元数据单一来源：ChatHeader 展示徽章、ProfilePage 展示切换卡片，各取所需字段。
// 人格 ID 清单的权威来源是 packages/llm-gateway/src/personas.js 的 VALID_PERSONA_IDS。
// web 不直接 import 网关包：会把服务端系统提示词打进客户端 bundle，且需给
// cyber-sister-client 新增运行时依赖；两侧漂移由 personas.test.js 的守卫测试拦截。
export const PERSONAS = [
  {
    id: 'toxic',
    name: '毒舌互怼',
    emoji: '😏',
    chatTag: '毒舌·护短·嘴硬心软',
    profileTag: '护短·嘴硬心软',
    chatBadgeClass: 'bg-pastel-blush text-action-primary',
    color: 'border-action-primary',
    surface: 'bg-pastel-blush',
  },
  {
    id: 'gentle',
    name: '温柔姐姐',
    emoji: '🥰',
    chatTag: '包容·耐心·讲道理',
    profileTag: '包容·耐心',
    chatBadgeClass: 'bg-pastel-mist text-status-info',
    color: 'border-status-info',
    surface: 'bg-pastel-mist',
  },
  {
    id: 'rational',
    name: '理性军师',
    emoji: '🧭',
    chatTag: '清晰·务实·有边界',
    profileTag: '清晰·有边界',
    chatBadgeClass: 'bg-pastel-sprout text-status-local',
    color: 'border-status-local',
    surface: 'bg-pastel-sprout',
  },
  {
    id: 'energetic',
    name: '元气炸弹',
    emoji: '⚡',
    chatTag: '热情·捧场·行动力',
    profileTag: '热情·捧场',
    chatBadgeClass: 'bg-pastel-apricot text-action-primary',
    color: 'border-action-primary',
    surface: 'bg-pastel-apricot',
  },
  {
    id: 'sister',
    name: '知心姐姐',
    emoji: '🤗',
    chatTag: '共情·念叨·靠得住',
    profileTag: '共情·靠得住',
    chatBadgeClass: 'bg-pastel-mist text-status-info',
    color: 'border-status-info',
    surface: 'bg-pastel-mist',
  },
  {
    id: 'cool',
    name: '高冷靠谱',
    emoji: '🧊',
    chatTag: '话少·冷静·关键时刻靠谱',
    profileTag: '话少·靠谱',
    chatBadgeClass: 'bg-pastel-sprout text-status-local',
    color: 'border-status-local',
    surface: 'bg-pastel-sprout',
  },
]

export const DEFAULT_PERSONA_ID = 'toxic'

export const getPersona = (id) =>
  PERSONAS.find(persona => persona.id === id)
  || PERSONAS.find(persona => persona.id === DEFAULT_PERSONA_ID)
