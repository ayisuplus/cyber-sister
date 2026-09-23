import TabbedPage from '../components/layout/TabbedPage'
import CollectionShelf from '../components/collection/CollectionShelf'

// 装扮：你自己的收藏。衣柜放衣服鞋包，化妆间放彩妆护肤；两个柜子共用一套收藏方式。
// 页签 id 沿用 wardrobe / makeup，旧链接 /tools/wardrobe、/tools/makeup-room 照常落到这里。
const TABS = [
  { id: 'wardrobe', label: '衣柜', render: () => <CollectionShelf key="wardrobe" shelf="wardrobe" /> },
  { id: 'makeup', label: '化妆间', render: () => <CollectionShelf key="makeup" shelf="makeup" /> },
]

export default function StylePage() {
  return <TabbedPage title="装扮" label="装扮分类" tabs={TABS} />
}
