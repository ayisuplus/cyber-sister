import { BookHeart, CalendarDays, HeartHandshake, Palette } from 'lucide-react'
import { CAPABILITIES } from './capabilities'
import { CAPABILITY_ICONS, CAPABILITY_TONES, TOOLBOX_SECTIONS } from './toolbox'

// 工作模式只编排任务场景；标题、路由和能力状态仍由原有注册表提供。
const toolsById = new Map([
  ...TOOLBOX_SECTIONS.flatMap(section => section.items),
  ...CAPABILITIES.filter(capability => capability.status === 'available').map(capability => ({
    ...capability,
    to: capability.href,
    icon: CAPABILITY_ICONS[capability.icon],
    tone: CAPABILITY_TONES[capability.tone],
  })),
].map(tool => [tool.id, tool]))

export const WORKSPACE_GROUPS = [
  {
    id: 'focus',
    title: '安排今天',
    description: '日程、倒数日和小习惯，到点我提醒你。',
    icon: CalendarDays,
    illustration: '/design-assets/work-focus.svg',
    itemIds: ['planner'],
  },
  {
    id: 'journal',
    title: '记录生活',
    description: '心情、书页和身体的节奏，都值得被记下。',
    icon: BookHeart,
    illustration: '/design-assets/work-journal.svg',
    itemIds: ['diary', 'reading', 'period'],
  },
  {
    id: 'style',
    title: '灵感装扮',
    description: '从一抹妆色到一件喜欢的衣服，试试新灵感。',
    icon: Palette,
    illustration: '/design-assets/work-style.svg',
    itemIds: ['makeup-room', 'wardrobe'],
  },
  {
    id: 'together',
    title: '关于我们',
    description: '看看她的理解，读一封关于这一周的信。',
    icon: HeartHandshake,
    illustration: '/design-assets/work-together.svg',
    itemIds: ['workspace', 'letters'],
  },
].map(group => ({ ...group, items: group.itemIds.map(id => toolsById.get(id)).filter(Boolean) }))

export const WORKSPACE_MEDIA = {
  videoSrc: '/design-assets/work-desk-loop.mp4',
  imageSrc: '/design-assets/work-desk-poster.webp',
}
