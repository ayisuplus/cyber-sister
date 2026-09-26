import Header from '../components/layout/Header'
import GardenBook from '../components/garden/GardenBook'

// 花草图鉴（路线图 C26）：白天路上拍下的花草，深夜躺着翻一翻。
export default function GardenPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header title="花草" showBack />
      <GardenBook />
    </div>
  )
}
