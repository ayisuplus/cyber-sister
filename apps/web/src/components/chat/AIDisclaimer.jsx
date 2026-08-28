import { useComplianceStore } from '../../stores/complianceStore'
import { Bot } from 'lucide-react'

export default function AIDisclaimer() {
  const showAIDisclaimer = useComplianceStore(s => s.showAIDisclaimer)
  const dismissDisclaimer = useComplianceStore(s => s.dismissDisclaimer)

  if (!showAIDisclaimer) return null

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
    >
      <div className="bg-white rounded-[24px] w-[320px] p-8 text-center animate-fade-in">
        <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-gradient-pink-purple flex items-center justify-center">
          <Bot size={32} className="text-white" />
        </div>
        <h2 className="text-lg font-bold text-text-primary mb-3">我是AI，不是真人</h2>
        <p className="text-sm text-text-secondary leading-relaxed mb-6">
          我会一直陪着你，但我不是真人。如果你需要真正的帮助，请联系身边的朋友或专业机构。
        </p>
        <button
          onClick={(e) => {
            e.stopPropagation()
            dismissDisclaimer()
          }}
          className="w-full h-12 bg-gradient-pink-purple text-white font-semibold rounded-[23px] shadow-lg"
        >
          我知道了
        </button>
      </div>
    </div>
  )
}
