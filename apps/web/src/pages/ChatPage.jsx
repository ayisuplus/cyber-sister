import { useEffect, useRef, useState } from 'react'
import { Heart, Sparkles } from 'lucide-react'
import { useChatStore } from '../stores/chatStore'
import { useAppearanceStore } from '../stores/appearanceStore'
import { useComplianceStore } from '../stores/complianceStore'
import { localModelService } from '../services/localModelService'
import ChatHeader from '../components/chat/ChatHeader'
import CloudFallbackNotice, { CLOUD_FALLBACK_DISMISSED_KEY } from '../components/chat/CloudFallbackNotice'
import MessageBubble from '../components/chat/MessageBubble'
import TypingIndicator from '../components/chat/TypingIndicator'
import InputBar from '../components/chat/InputBar'
import ConversationPanel from '../components/chat/ConversationPanel'
import MemorySuggestion from '../components/chat/MemorySuggestion'
import CrisisModal from '../components/chat/CrisisModal'
import AIDisclaimer from '../components/chat/AIDisclaimer'
import UsageReminder from '../components/chat/UsageReminder'
import TabBar from '../components/layout/TabBar'

const getSendErrorMessage = (requestError, llmMode) => {
  const responseError = requestError.response?.data?.error
  // 流式错误直接携带 code；HTTP 层错误沿用 JSON 端点错误体
  const code = requestError.code || requestError.response?.data?.code || responseError?.code || responseError

  if (llmMode === 'external_primary') {
    if (code === 'LOCAL_LLM_UNAVAILABLE') {
      return '需要你先同意使用云端模型才能聊天：请到「我的」页面开启。原输入已保留。'
    }
    if (code === 'LLM_UNAVAILABLE' || code === 'LOCAL_LLM_NOT_CONFIGURED') {
      return '云端模型暂时不可用。原输入已保留，请稍后重试。'
    }
  }
  if (code === 'LOCAL_LLM_NOT_CONFIGURED') {
    return '本地模型尚未连接，请前往“我的 → 本地模型”查看设置。原输入已保留。'
  }
  if (code === 'LOCAL_LLM_UNAVAILABLE') {
    return '本地模型暂时不可用，且没有在未授权时转发到云端。原输入已保留，请稍后重试。'
  }
  if (code === 'LLM_UNAVAILABLE') {
    return '本地模型与已授权的云端备用均不可用。原输入已保留，请稍后重试。'
  }
  return '消息发送失败，原输入已保留，请重试。'
}

export default function ChatPage() {
  const messagesEndRef = useRef(null)
  const [error, setError] = useState('')
  const [intervention, setIntervention] = useState(null)
  const [fallbackNoticeState, setFallbackNoticeState] = useState(null)
  const messages = useChatStore(state => state.messages)
  const isTyping = useChatStore(state => state.isTyping)
  const isSending = useChatStore(state => state.isSending)
  const sendMessage = useChatStore(state => state.sendMessage)
  const llmMode = useChatStore(state => state.llmMode)
  const setLlmMode = useChatStore(state => state.setLlmMode)
  const loadConversations = useChatStore(state => state.loadConversations)
  const checkFirstVisit = useComplianceStore(state => state.checkFirstVisit)
  const startSession = useComplianceStore(state => state.startSession)
  const endSession = useComplianceStore(state => state.endSession)
  const checkUsageTime = useComplianceStore(state => state.checkUsageTime)
  const chatBgUrl = useAppearanceStore(s => s.chatBgUrl)

  useEffect(() => {
    loadConversations()
    checkFirstVisit()
  }, [checkFirstVisit, loadConversations])
  // 本地模型不可用且云端备用已配置但用户未表态时，主动引导授权；拉取失败静默，不影响聊天
  useEffect(() => {
    if (sessionStorage.getItem(CLOUD_FALLBACK_DISMISSED_KEY) === 'true') return undefined
    let cancelled = false
    localModelService.getStatus()
      .then((status) => {
        if (cancelled) return
        setLlmMode(status?.mode === 'external_primary' ? 'external_primary' : 'local_first')
        const shouldPrompt = status?.local?.state !== 'ready'
          && status?.externalFallback?.configured === true
          && status?.externalFallback?.consent === null
        if (shouldPrompt) setFallbackNoticeState(status.local.state)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [setLlmMode])

  // 使用时长合规：进入聊天开始计时，每分钟检查一次，离开即结算
  useEffect(() => {
    startSession()
    const timer = setInterval(checkUsageTime, 60_000)
    return () => {
      clearInterval(timer)
      endSession()
    }
  }, [checkUsageTime, endSession, startSession])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  const handleSend = async (text) => {
    setError('')
    try {
      const result = await sendMessage(text)
      if (result?.status === 'blocked') setIntervention(result.intervention)
      return true
    } catch (requestError) {
      setError(getSendErrorMessage(requestError, llmMode))
      return false
    }
  }

  // 「帮我记住」入口只跟随最新一条正常回复：最后一条须为已持久化（非临时 id）、
  // 非流式占位的 assistant 消息，且其前方存在已持久化的 user 消息（建议接口以它为对象）。
  // blocked 只落库用户消息、流式中最后是临时气泡，均不满足条件，入口自然不出现。
  const lastMessage = messages[messages.length - 1]
  const isNormalAssistantReply = Boolean(
    lastMessage
    && lastMessage.role === 'assistant'
    && !lastMessage.streaming
    && lastMessage.content
    && !String(lastMessage.id).startsWith('temp-'),
  )
  const suggestionUserMessage = isNormalAssistantReply
    ? messages.slice(0, -1).reverse().find((message) => message.role === 'user' && !String(message.id).startsWith('temp-'))
    : undefined

  return (
    <div
      className="chat-full relative flex flex-1 bg-transparent"
      style={chatBgUrl ? { backgroundImage: `url(${chatBgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
    >
      {chatBgUrl && <div className="chat-bg-overlay" aria-hidden="true" />}
      <ConversationPanel />
      <div className="relative flex min-w-0 flex-1 flex-col">
      <ChatHeader />
      {fallbackNoticeState !== null && (
        <CloudFallbackNotice localState={fallbackNoticeState} onClose={() => setFallbackNoticeState(null)} primary={llmMode === 'external_primary'} />
      )}

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 scrollbar-hide">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="relative mb-6">
              <div className="h-48 w-48 overflow-hidden rounded-3xl bg-gradient-pastel shadow-card">
                <img src="/design-assets/empty-state-chat.png" alt="赛博姐妹在这里等你聊天" className="h-full w-full object-cover" />
              </div>
              <div className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-pastel-apricot text-status-warning shadow-card" aria-hidden="true">
                <Sparkles size={14} />
              </div>
              <div className="absolute -bottom-2 -left-2 flex h-7 w-7 items-center justify-center rounded-full bg-pastel-sprout text-status-local shadow-card" aria-hidden="true">
                <Heart size={13} />
              </div>
            </div>

            <h1 className="mb-2 text-lg font-semibold text-text-primary">嗨，我是你的赛博姐妹</h1>
            <p className="max-w-[260px] text-center text-sm leading-relaxed text-text-secondary">
              有什么想聊的，随时找我。<br />
              <span className="text-xs text-text-muted">我是 AI，会优先在本地陪你梳理想法。</span>
            </p>

            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {['今天心情不好', '推荐个电影', '聊聊八卦', '帮我出主意'].map(topic => (
                <button key={topic} type="button" onClick={() => handleSend(topic)} className="min-h-11 rounded-full border border-border-subtle bg-surface-card px-4 py-2 text-xs text-text-secondary shadow-card transition-colors hover:bg-pastel-blush hover:text-action-primary">
                  {topic}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          // 流式占位气泡尚无内容时不渲染空气泡，此阶段由 TypingIndicator 承担进行中视觉
          message.streaming && !message.content
            ? null
            : <MessageBubble key={message.id} message={message} isLast={index === messages.length - 1} />
        ))}

        {suggestionUserMessage && (
          // key 绑定回复 id：新回复/切换会话后建议状态随之重置，入口只跟随最新正常回复
          <MemorySuggestion key={lastMessage.id} userMessageId={suggestionUserMessage.id} />
        )}

        {isTyping && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      <div aria-live="polite" className="min-h-5 px-4 text-center text-xs text-danger">{error}</div>
      <InputBar onSend={handleSend} disabled={isSending || isTyping} />
      <TabBar />
      <CrisisModal intervention={intervention} onClose={() => setIntervention(null)} />
      <AIDisclaimer />
      <UsageReminder />
      </div>
    </div>
  )
}
