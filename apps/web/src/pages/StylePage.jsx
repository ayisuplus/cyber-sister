import { lazy } from 'react'
import TabbedPage from '../components/layout/TabbedPage'

// 各页签按需加载：打开化妆不会顺带下载 3D 衣柜的模型查看器
const MakeupRoomPage = lazy(() => import('./MakeupRoomPage'))
const WardrobePage = lazy(() => import('./WardrobePage'))

// 装扮：化妆间与 3D 衣柜两个特色功能共用一个入口，功能本身原样保留。
const TABS = [
  { id: 'makeup', label: '化妆', render: () => <MakeupRoomPage embedded /> },
  { id: 'wardrobe', label: '衣柜', render: () => <WardrobePage embedded /> },
]

export default function StylePage() {
  return <TabbedPage title="装扮" label="装扮分类" tabs={TABS} />
}
