import { Cloud } from 'lucide-react'

// 本轮接口固定模拟模式；真实适配器接入时须一并更新这项用户可见声明。
export default function WorkCloudNotice() {
  return (
    <p className="flex shrink-0 items-start gap-2 border-b border-border-hairline bg-pastel-mist px-4 py-2 text-xs leading-relaxed text-status-info">
      <Cloud size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>云端接口预览 · 尚未连接云服务。个人记录照常保存，模拟结果不入库。</span>
    </p>
  )
}
