// 功能桌面/发现页共享的功能目录：姐妹工具箱条目 + 能力图标与配色映射。
// ToolsPage 与工作模式功能桌面（WorkDesktop）共用这一份，避免两处漂移。
import { Bell, BookHeart, BookOpen, CalendarHeart, Camera, GraduationCap, Lightbulb, ListTodo, Mail, NotebookPen, Shirt, Sparkles, Timer, WandSparkles } from 'lucide-react'

export const CAPABILITY_ICONS = {
  sparkles: Sparkles,
  shirt: Shirt,
  wand: WandSparkles,
  camera: Camera,
}

export const TOOLBOX = [
  {
    id: 'period',
    title: '大姨妈记录',
    description: '记下经期，帮你推算下次大概什么时候来。',
    to: '/tools/period',
    icon: CalendarHeart,
    tone: 'bg-pastel-blush text-action-primary',
  },
  {
    id: 'countdown',
    title: '倒数日',
    description: '重要的日子还有几天，一眼就能看到。',
    to: '/tools/countdown',
    icon: Timer,
    tone: 'bg-pastel-apricot text-action-primary',
  },
  {
    id: 'todo',
    title: '日程',
    description: '把要做的事按天排好，今天做什么一眼看清。',
    to: '/tools/todo',
    icon: ListTodo,
    tone: 'bg-pastel-sprout text-status-local',
  },
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
    id: 'scheduled-reminders',
    title: '自定义提醒',
    description: '任何内容、任何时间，到点 Amie 在应用里提醒你。',
    to: '/tools/reminders',
    icon: Bell,
    tone: 'bg-pastel-lavender text-action-primary',
  },
  {
    id: 'reminders',
    title: '提醒设置',
    description: '喝水、睡觉和大姨妈提醒，都在设置里开关。',
    to: '/settings',
    icon: Bell,
    tone: 'bg-pastel-mist text-status-info',
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
]

export const CAPABILITY_TONES = {
  apricot: 'bg-pastel-apricot text-action-primary',
  mist: 'bg-pastel-mist text-status-info',
  blush: 'bg-pastel-blush text-action-primary',
  sprout: 'bg-pastel-sprout text-status-local',
}
