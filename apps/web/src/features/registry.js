// 入口注册表：导航的唯一来源（侧栏与手机抽屉共用 AppNav）。
// /tools/ 前缀是本地客户端功能的分发边界：网页版路由守卫据此拦截，页头据此显示云端接口声明。
import { CalendarClock, CalendarHeart, Heart, NotebookPen, WandSparkles } from 'lucide-react'

export const ENTRIES = [
  { id: 'her', title: '她', description: '她的说话方式，和她记得的你', to: '/her', icon: Heart, localOnly: false },
  { id: 'schedule', title: '安排', description: '日程、倒数日和每天的小习惯，到点提醒你', to: '/tools/schedule', icon: CalendarClock, localOnly: true },
  { id: 'notes', title: '手记', description: '日记、读书笔记，和她每周的来信', to: '/tools/notes', icon: NotebookPen, localOnly: true },
  { id: 'period', title: '经期', description: '记下经期，推算下一次', to: '/tools/period', icon: CalendarHeart, localOnly: true },
  { id: 'style', title: '装扮', description: '化妆间与 3D 衣柜', to: '/tools/style', icon: WandSparkles, localOnly: true },
]

/** @param {{ local: boolean }} options */
export const visibleEntries = ({ local }) => ENTRIES.filter(entry => local || !entry.localOnly)
