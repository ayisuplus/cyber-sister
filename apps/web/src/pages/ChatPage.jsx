import { useEffect, useRef } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'
import ChatHeader from '../components/chat/ChatHeader'
import MessageBubble from '../components/chat/MessageBubble'
import TypingIndicator from '../components/chat/TypingIndicator'
import InputBar from '../components/chat/InputBar'
import QuickTools from '../components/chat/QuickTools'
import TabBar from '../components/layout/TabBar'
import { Sparkles, Heart } from 'lucide-react'

export default function ChatPage() {
  const messagesEndRef = useRef(null)
  const user = useAuthStore(s => s.user)
  const messages = useChatStore(s => s.messages)
  const isTyping = useChatStore(s => s.isTyping)
  const isSending = useChatStore(s => s.isSending)
  const sendMessage = useChatStore(s => s.sendMessage)
  const loadConversations = useChatStore(s => s.loadConversations)

  // 初始化
  useEffect(() => {
    loadConversations()
  }, [])

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  const handleSend = async (text) => {
    await sendMessage(text, user?.persona || 'toxic')
  }

  return (
    <div className="flex-1 flex flex-col bg-[#FAF9FE]">
      <ChatHeader />

      {/* 消息区域 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-hide">
        {/* 空状态 - 使用生成的插画 */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 animate-fade-in">
            {/* 插画容器 */}
            <div className="relative mb-6">
              <div className="w-48 h-48 rounded-3xl overflow-hidden shadow-lg">
                <img 
                  src="/design-assets/empty-state-chat.png" 
                  alt="等待聊天" 
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    // 图片加载失败时显示备用设计
                    e.target.style.display = 'none'
                    e.target.parentElement.style.background = 'linear-gradient(135deg, rgba(255,107,157,0.1) 0%, rgba(181,166,255,0.1) 100%)'
                    e.target.parentElement.innerHTML = `
                      <div class="flex items-center justify-center h-full">
                        <div class="text-center">
                          <div class="w-16 h-16 mx-auto mb-3 rounded-2xl flex items-center justify-center" style="background: linear-gradient(135deg, #FF6B9D, #B5A6FF)">
                            <span class="text-white text-3xl">💬</span>
                          </div>
                          <span class="text-4xl">🤖</span>
                        </div>
                      </div>
                    `
                  }}
                />
              </div>
              
              {/* 装饰性元素 */}
              <div className="absolute -top-2 -right-2 w-8 h-8 bg-[#FFCB47] rounded-full flex items-center justify-center shadow-md">
                <Sparkles size={14} className="text-white" />
              </div>
              <div className="absolute -bottom-2 -left-2 w-6 h-6 bg-[#10B981] rounded-full flex items-center justify-center shadow-md">
                <Heart size={12} className="text-white" />
              </div>
            </div>
            
            {/* 欢迎文字 */}
            <h3 className="text-lg font-semibold text-[#1A1A2E] mb-2">
              嗨~ 我是你的赛博姐妹
            </h3>
            <p className="text-sm text-[#6B6B8A] text-center leading-relaxed max-w-[240px]">
              有什么想聊的，随时找我！<br />
              <span className="text-xs text-[#B0B0C8]">我会一直陪着你 ❤️</span>
            </p>
            
            {/* 快捷话题 */}
            <div className="flex flex-wrap justify-center gap-2 mt-6">
              {['今天心情不好', '推荐个电影', '聊聊八卦', '帮我出主意'].map((topic, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(topic)}
                  className="px-4 py-2 bg-white rounded-full text-xs text-[#6B6B8A] shadow-sm hover:shadow-md hover:text-[#FF6B9D] transition-all active:scale-95"
                  style={{ animationDelay: `${i * 100}ms` }}
                >
                  {topic}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 消息列表 */}
        {messages.map((msg, i) => (
          <MessageBubble key={msg.id} message={msg} isLast={i === messages.length - 1} />
        ))}

        {/* 打字指示器 */}
        {isTyping && <TypingIndicator />}
        
        {/* 滚动锚点 */}
        <div ref={messagesEndRef} />
      </div>

      {/* 快捷工具 */}
      <QuickTools />

      {/* 输入栏 */}
      <InputBar onSend={handleSend} disabled={isSending || isTyping} />

      {/* Tab栏 */}
      <TabBar />
    </div>
  )
}
