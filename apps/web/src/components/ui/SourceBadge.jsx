// 与 MessageBubble 同源的来源徽标：云端切割后云端模型是唯一主力
const SOURCE_LABELS = {
  cloud_mock: { label: '模拟结果 · 未连接云端', className: 'bg-pastel-apricot text-text-secondary' },
  qwen: { label: '云端模型', className: 'bg-pastel-mist text-status-info' },
  local_template: { label: '本地安全模板', className: 'bg-pastel-apricot text-text-secondary' },
}

export default function SourceBadge({ source }) {
  const config = SOURCE_LABELS[source]
  if (!config) return null
  return <span className={`inline-flex select-none whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${config.className}`}>{config.label}</span>
}
