// 功能桌面/发现页共享的功能目录：姐妹工具箱分组 + 能力图标与配色映射。
// ToolsPage 与工作模式功能桌面（WorkDesktop）共用这一份，避免两处漂移。
import { BookHeart, BookOpen, CalendarHeart, Camera, GraduationCap, Lightbulb, ListTodo, Mail, NotebookPen, Shirt, Sparkles, WandSparkles } from 'lucide-react'

export const CAPABILITY_ICONS = {
  sparkles: Sparkles,
  shirt: Shirt,
  wand: WandSparkles,
  camera: Camera,
}

export const TOOLBOX_SECTIONS = [
  {
    id: 'plan',
    label: '计划提醒',
    items: [
      {
        id: 'planner',
        title: '日程与提醒',
        description: '日程、倒数日和提醒，都在这一处。',
        to: '/tools/planner',
        icon: ListTodo,
        tone: 'bg-pastel-sprout text-status-local',
      },
      {
        id: 'period',
        title: '大姨妈记录',
        description: '记下经期，帮你推算下次大概什么时候来。',
        to: '/tools/period',
        icon: CalendarHeart,
        tone: 'bg-pastel-blush text-action-primary',
      },
    ],
  },
  {
    id: 'life',
    label: '生活陪伴',
    items: [
      {
        id: 'diary',
        title: '日记',
        description: '写下今天的心情，姐妹会认真回应你。',
        to: '/tools/diary',
        icon: BookHeart,
        tone: 'bg-pastel-blush text-action-primary',
      },
      {
        id: 'handbook',
        title: '手帐打卡',
        description: '小习惯每天打卡，看看能坚持多久。',
        to: '/tools/handbook',
        icon: NotebookPen,
        tone: 'bg-pastel-apricot text-action-primary',
      },
      {
        id: 'reading',
        title: '一起读书',
        description: '在读的书和感想，姐妹会陪你聊。',
        to: '/tools/reading',
        icon: BookOpen,
        tone: 'bg-pastel-mist text-status-info',
      },
      {
        id: 'study',
        title: '专注自习',
        description: '定个番茄钟，姐妹安静陪你学。',
        to: '/tools/study',
        icon: GraduationCap,
        tone: 'bg-pastel-sprout text-status-local',
      },
    ],
  },
  {
    id: 'her',
    label: '她的内心',
    items: [
      {
        id: 'workspace',
        title: '她的工作台',
        description: '她自己整理的对你的理解，你决定哪些算数。',
        to: '/tools/workspace',
        icon: Lightbulb,
        tone: 'bg-pastel-lavender text-action-primary',
      },
      {
        id: 'letters',
        title: '她的信',
        description: '每周一封，只写你这周真实发生的事。',
        to: '/tools/letters',
        icon: Mail,
        tone: 'bg-pastel-lavender text-action-primary',
      },
    ],
  },
]

export const CAPABILITY_TONES = {
  apricot: 'bg-pastel-apricot text-action-primary',
  mist: 'bg-pastel-mist text-status-info',
  blush: 'bg-pastel-blush text-action-primary',
  sprout: 'bg-pastel-sprout text-status-local',
}
