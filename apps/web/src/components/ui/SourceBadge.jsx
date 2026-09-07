import { useEffect } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { localModelService } from '../../services/localModelService'

// 与 MessageBubble 同源的来源徽标：部署模式为外部主用时，云端模型是主力而非备用
const SOURCE_LABELS = {
  local_model: { label: '本机模型', className: 'bg-pastel-sprout text-status-local' },
  qwen: { label: '云端备用', primaryLabel: '云端模型', className: 'bg-pastel-mist text-status-info' },
  local_template: { label: '本地安全模板', className: 'bg-pastel-apricot text-text-secondary' },
}

// 部署模式是全局只读事实：模块级缓存一次拉取，供未经过聊天页的页面（日记/手帐）自给
let statusPromise = null
function useEnsureLlmMode() {
  const llmMode = useChatStore(state => state.llmMode)
  const setLlmMode = useChatStore(state => state.setLlmMode)
  useEffect(() => {
    if (llmMode !== null) return
    if (!statusPromise) {
      statusPromise = localModelService.getStatus()
        .then(status => (status?.mode === 'external_primary' ? 'external_primary' : 'local_first'))
        .catch(() => 'local_first')
    }
    let cancelled = false
    statusPromise.then((mode) => { if (!cancelled) setLlmMode(mode) })
    return () => { cancelled = true }
  }, [llmMode, setLlmMode])
}

export default function SourceBadge({ source }) {
  useEnsureLlmMode()
  const llmMode = useChatStore(state => state.llmMode)
  const config = SOURCE_LABELS[source]
  if (!config) return null
  const label = config.primaryLabel && llmMode === 'external_primary' ? config.primaryLabel : config.label
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${config.className}`}>{label}</span>
}
