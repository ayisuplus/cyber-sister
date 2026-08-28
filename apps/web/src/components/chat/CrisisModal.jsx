import { useComplianceStore } from '../../stores/complianceStore'
import { Heart, Phone } from 'lucide-react'

const HOTLINES = [
  { name: '24小时心理援助热线', number: '400-161-9995' },
  { name: '北京心理危机研究与干预中心', number: '010-82951332' },
  { name: '生命热线', number: '400-821-1215' },
]

export default function CrisisModal() {
  const showCrisisModal = useComplianceStore(s => s.showCrisisModal)
  const dismissCrisis = useComplianceStore(s => s.dismissCrisis)

  if (!showCrisisModal) return null

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
    >
      <div className="bg-white rounded-[24px] w-[320px] p-8 text-center animate-fade-in">
        <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-red-100 flex items-center justify-center">
          <Heart size={32} className="text-red-500" />
        </div>
        <h2 className="text-lg font-bold text-text-primary mb-3">我很担心你</h2>
        <p className="text-sm text-text-secondary leading-relaxed mb-5">
          你现在可能正在经历非常困难的时刻，请知道你不是一个人。以下热线24小时有人接听，请打一个电话聊聊。
        </p>

        <div className="space-y-2 mb-6">
          {HOTLINES.map(h => (
            <a
              key={h.number}
              href={`tel:${h.number}`}
              className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors"
            >
              <Phone size={16} className="text-brand-pink shrink-0" />
              <div className="text-left">
                <p className="text-xs text-text-secondary">{h.name}</p>
                <p className="text-sm font-semibold text-text-primary">{h.number}</p>
              </div>
            </a>
          ))}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation()
            dismissCrisis()
          }}
          className="w-full h-12 bg-gradient-pink-purple text-white font-semibold rounded-[23px] shadow-lg"
        >
          我已联系帮助
        </button>
      </div>
    </div>
  )
}
