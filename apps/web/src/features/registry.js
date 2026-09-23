// 入口注册表：导航的唯一来源（侧栏与手机抽屉共用 AppNav）。只有一个 Web 版，所有入口对所有人可见。
import { BookOpen, CalendarDays, Heart, NotebookPen, WandSparkles } from 'lucide-react'

export const ENTRIES = [
  { id: 'her', title: '她', description: '她的说话方式，和她记得的你', to: '/her', icon: Heart },
  { id: 'calendar', title: '日历', description: '安排和经期，都记在这一页', to: '/tools/calendar', icon: CalendarDays },
  { id: 'notes', title: '手记', description: '日记和读书笔记，排成一条时间线', to: '/tools/notes', icon: NotebookPen },
  { id: 'reading', title: '读书', description: '把书放进来，和她一起读', to: '/tools/reading', icon: BookOpen },
  { id: 'style', title: '装扮', description: '化妆间与 3D 衣柜', to: '/tools/style', icon: WandSparkles },
]
