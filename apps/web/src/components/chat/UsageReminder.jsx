import { useComplianceStore } from '../../stores/complianceStore'
import { Clock } from 'lucide-react'

export default function UsageReminder() {
  const showUsageReminder = useComplianceStore(s => s.showUsageReminder)
  const dismissUsageReminder = useComplianceStore(s => s.dismissUsageReminder)
  const resetSession = useComplianceStore(s => s.resetSession)

  if (!showUsageReminder) return null

  const handleDismiss = () => {
    dismissUsageReminder()
    resetSession()
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
    >
      <div className="bg-white rounded-[24px] w-[300px] p-8 text-center animate-fade-in">
        <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-brand-yellow/20 flex items-center justify-center">
          <Clock size={32} className="text-brand-yellow" />
        </div>
        <h2 className="text-lg font-bold text-text-primary mb-3">已经聊了两个小时啦</h2>
        <p className="text-sm text-text-secondary leading-relaxed mb-6">
          起来活动一下，喝杯水吧~
        </p>
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleDismiss()
          }}
          className="w-full h-12 bg-gradient-pink-purple text-white font-semibold rounded-[23px] shadow-lg mb-3"
        >
          好的，知道了
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            dismissUsageReminder()
          }}
          className="text-sm text-text-muted hover:text-text-secondary"
        >
          再聊5分钟
        </button>
      </div>
    </div>
  )
}
