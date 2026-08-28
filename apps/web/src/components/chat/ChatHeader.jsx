import { Phone, MoreHorizontal, Sparkles } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'

const PERSONA_CONFIG = {
  toxic: { 
    name: '毒舌互怼型', 
    tag: '毒舌·护短·嘴硬心软', 
    gradient: 'from-pink-500 to-rose-500',
    emoji: '😏'
  },
  gentle: { 
    name: '温柔姐姐型', 
    tag: '包容·耐心·讲道理', 
    gradient: 'from-purple-500 to-violet-500',
    emoji: '🥰'
  },
  wild: { 
    name: '疯批搭子型', 
    tag: '疯·嗨·情绪宣泄', 
    gradient: 'from-yellow-500 to-orange-500',
    emoji: '🤪'
  },
}

export default function ChatHeader() {
  const user = useAuthStore(state => state.user)
  const persona = user?.persona || 'toxic'
  const personaInfo = PERSONA_CONFIG[persona]

  return (
    <>
      {/* AI身份标识栏 - 合规要求 */}
      <div 
        className="flex items-center justify-center h-8 text-xs shrink-0"
        style={{ 
          background: 'linear-gradient(135deg, rgba(181,166,255,0.15) 0%, rgba(255,196,242,0.15) 100%)' 
        }}
      >
        <span className="flex items-center gap-1.5 text-[#6B6B8A]">
          <span className="w-4 h-4 rounded-full bg-[#6B5FC6]/20 flex items-center justify-center">
            <Sparkles size={10} className="text-[#6B5FC6]" />
          </span>
          <span>这是AI，不是真人</span>
        </span>
      </div>

      {/* 聊天头部 */}
      <div 
        className="flex items-center justify-between px-4 h-16 bg-white shrink-0"
        style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}
      >
        <div className="flex items-center gap-3">
          {/* AI头像 */}
          <div className="relative">
            <div className="w-11 h-11 rounded-2xl overflow-hidden shadow-md">
              <img 
                src="/design-assets/ai-avatar.png" 
                alt="赛博姐妹" 
                className="w-full h-full object-cover"
                onError={(e) => {
                  // 图片加载失败时显示渐变备用
                  e.target.style.display = 'none'
                  e.target.parentElement.style.background = 'linear-gradient(135deg, #FF6B9D, #B5A6FF)'
                  e.target.parentElement.innerHTML = '<span class="text-white text-lg font-bold flex items-center justify-center h-full">赛</span>'
                }}
              />
            </div>
            {/* 在线状态指示器 */}
            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-[#10B981] rounded-full border-2 border-white shadow-sm" />
          </div>

          {/* 名称和标签 */}
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold text-[#1A1A2E]">赛博姐妹</h2>
              <span className="text-xs">{personaInfo.emoji}</span>
            </div>
            <span 
              className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-gradient-to-r ${personaInfo.gradient} text-white font-medium mt-0.5 w-fit`}
            >
              {personaInfo.tag}
            </span>
          </div>
        </div>

        {/* 右侧按钮 */}
        <div className="flex items-center gap-2">
          <button 
            className="w-9 h-9 rounded-xl bg-[#F5F5FA] flex items-center justify-center text-[#6B6B8A] hover:text-[#FF6B9D] hover:bg-[#FF6B9D]/10 transition-all active:scale-95"
          >
            <Phone size={18} />
          </button>
          <button 
            className="w-9 h-9 rounded-xl bg-[#F5F5FA] flex items-center justify-center text-[#6B6B8A] hover:text-[#FF6B9D] hover:bg-[#FF6B9D]/10 transition-all active:scale-95"
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>
    </>
  )
}
