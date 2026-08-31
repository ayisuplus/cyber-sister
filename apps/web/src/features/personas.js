// 人格元数据单一来源：ChatHeader 展示徽章、ProfilePage 展示切换卡片，各取所需字段。
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
]

export const DEFAULT_PERSONA_ID = 'toxic'

export const getPersona = (id) =>
  PERSONAS.find(persona => persona.id === id)
  || PERSONAS.find(persona => persona.id === DEFAULT_PERSONA_ID)
