import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useAppearanceStore } from '../stores/appearanceStore'
import { useComplianceStore } from '../stores/complianceStore'
import { modelStatusService } from '../services/modelStatusService'
import ChatHeader from '../components/chat/ChatHeader'
import CloudFallbackNotice, { CLOUD_FALLBACK_DISMISSED_KEY } from '../components/chat/CloudFallbackNotice'
import MessageBubble from '../components/chat/MessageBubble'
import TypingIndicator from '../components/chat/TypingIndicator'
import InputBar from '../components/chat/InputBar'
import ConversationDrawer from '../components/chat/ConversationDrawer'
import MemorySuggestion from '../components/chat/MemorySuggestion'
import CrisisModal from '../components/chat/CrisisModal'
import AIDisclaimer from '../components/chat/AIDisclaimer'
import UsageReminder from '../components/chat/UsageReminder'
import AmbientMedia from '../components/work/AmbientMedia'
import Openers from '../components/chat/Openers'
import { DoodleField, LeafSprig, Squiggle } from '../components/chat/Doodles'
import { useWorkTasks } from '../hooks/useWorkTasks'
import WorkTaskPanel from '../components/work/WorkTaskPanel'
import { isLocalWorkClient } from '../features/distribution'

const getSendErrorMessage = (requestError) => {
  const responseError = requestError.response?.data?.error
  // 流式错误直接携带 code；HTTP 层错误沿用 JSON 端点错误体
  const code = requestError.code || requestError.response?.data?.code || responseError?.code || responseError

  if (code === 'CLOUD_NOT_CONSENTED') {
    return '需要你先同意使用云端模型才能聊天：请到「设置」页面开启。原输入已保留。'
  }
  if (code === 'CONVERSATION_ARCHIVED') {
    return '这段对话已归档，请到「对话归档」恢复后继续聊天。原输入已保留。'
  }
  if (code === 'LLM_UNAVAILABLE') {
    return '云端模型暂时不可用。原输入已保留，请稍后重试。'
  }
  if (code === 'WORK_CLOUD_NOT_CONNECTED') {
    return '这项能力的云端接口还没接通。原输入已保留。'
  }
  return '消息发送失败，原输入已保留，请重试。'
}

// 空态顶部的手写问候：按本机时段轻声打个招呼
const greetingFor = (hour) => {
  if (hour >= 5 && hour < 11) return '早安，慢慢醒来'
  if (hour >= 11 && hour < 17) return '午后好，歇一会儿'
  if (hour >= 17 && hour < 22) return '傍晚了，辛苦啦'
  return '夜深了，慢慢来'
}

export default function ChatPage() {
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const [draftLocked, setDraftLocked] = useState(false)
  const [error, setError] = useState('')
  const [intervention, setIntervention] = useState(null)
  const [fallbackNoticeState, setFallbackNoticeState] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const messages = useChatStore(state => state.messages)
  // 只有一种对话：本地客户端才有后台任务面板与「后台执行」
  const local = isLocalWorkClient()
  const workTasks = useWorkTasks(local)
  const currentConversationId = useChatStore(state => state.currentConversationId)
  const isTyping = useChatStore(state => state.isTyping)
  const isSending = useChatStore(state => state.isSending)
  const sendMessage = useChatStore(state => state.sendMessage)
  const loadConversations = useChatStore(state => state.loadConversations)
  const checkFirstVisit = useComplianceStore(state => state.checkFirstVisit)
  const startSession = useComplianceStore(state => state.startSession)
  const endSession = useComplianceStore(state => state.endSession)
  const checkUsageTime = useComplianceStore(state => state.checkUsageTime)
  const chatBgUrl = useAppearanceStore(s => s.chatBgUrl)
  const [greeting] = useState(() => greetingFor(new Date().getHours()))

  // 翻页：会话变化时旧页先翻出（220ms），再挂载新页以书脊为轴翻入
  const conversationPageKey = currentConversationId ?? 'empty'
  const [renderedPageKey, setRenderedPageKey] = useState(conversationPageKey)
  const [pageLeaving, setPageLeaving] = useState(false)
  useEffect(() => {
    if (conversationPageKey === renderedPageKey) return undefined
    setPageLeaving(true)
    const timer = setTimeout(() => {
      setRenderedPageKey(conversationPageKey)
      setPageLeaving(false)
    }, 200)
    return () => clearTimeout(timer)
  }, [conversationPageKey, renderedPageKey])

  useEffect(() => {
    loadConversations()
    checkFirstVisit()
  }, [checkFirstVisit, loadConversations])
  // 云端模型未获同意时主动引导授权（100% 用户的首屏门）；拉取失败静默，不影响其它 UI
  useEffect(() => {
    if (sessionStorage.getItem(CLOUD_FALLBACK_DISMISSED_KEY) === 'true') return undefined
    let cancelled = false
    modelStatusService.getStatus()
      .then((status) => {
        if (cancelled) return
        const shouldPrompt = status?.externalFallback?.configured === true
          && status?.externalFallback?.consent === null
        if (shouldPrompt) setFallbackNoticeState('consent_required')
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

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
    // 空态（欢迎插画与开场）是顶对齐的整屏内容，不跟随滚到底部
    if (messages.length === 0 && !isTyping) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  const handleSend = async (text, options = {}) => {
    setError('')
    try {
      const result = await sendMessage(text, options)
      if (result?.status === 'blocked') setIntervention(result.intervention)
      return result?.status !== 'aborted'
    } catch (requestError) {
      setError(getSendErrorMessage(requestError))
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
      <div className="relative flex min-w-0 flex-1 flex-col">
      {/* 枝叶只陪空白页；有消息后让出版面，只留晨雾，避免从气泡后面露出半截 */}
      {messages.length === 0 && <DoodleField />}
      <ChatHeader onOpenDrawer={() => setDrawerOpen(true)} />
      {fallbackNoticeState !== null && (
        <CloudFallbackNotice onClose={() => setFallbackNoticeState(null)} />
      )}

      {/* key 绑定会话页：切换/新建会话时旧页淡出、新页轻翻落定；上下边缘渐隐进晨雾 */}
      <div
        key={renderedPageKey}
        className={`chat-paper relative z-10 flex-1 space-y-5 overflow-y-auto px-4 pb-6 pt-4 scrollbar-hide ${pageLeaving ? 'animate-page-leave' : 'animate-page-turn'}`}
      >
        {local && <WorkTaskPanel tasks={workTasks.tasks} cancel={workTasks.cancel} retry={workTasks.retry} decide={workTasks.decide} />}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10">
            {/* 依次浮现：问候 → 拱窗 → 标题 → 说明 → 话题，全程约 1s，不阻塞点击 */}
            <p className="animate-reveal-up mb-6 font-hand text-[15px] tracking-[0.2em] text-text-secondary">{greeting}</p>

            {/* 拱窗里的她，背后一团随呼吸明暗的柔光，窗边探进一枝叶子 */}
            <div className="relative mb-7">
              <div aria-hidden="true" className="halo-glow animate-breathe absolute -inset-10 rounded-full" />
              <div className="animate-reveal-up relative h-52 w-44 overflow-hidden rounded-[999px_999px_36px_36px] bg-gradient-pastel shadow-soft ring-1 ring-border-hairline" style={{ animationDelay: '80ms' }}>
                <AmbientMedia
                  videoSrc="/design-assets/chat-ambient.mp4"
                  imageSrc="/design-assets/empty-state-chat.png"
                  className="ambient-decoration h-full w-full scale-[1.06] object-cover"
                />
              </div>
              <span aria-hidden="true" className="animate-doodle-float absolute -right-7 bottom-1 text-action-primary opacity-40" style={{ animationDuration: '11s' }}>
                <LeafSprig size={72} flip />
              </span>
            </div>

            <h1 className="animate-reveal-up font-display text-[26px] font-medium tracking-[0.02em] text-text-primary" style={{ animationDelay: '160ms' }}>嗨，我是你的Amie</h1>
            <div className="mb-3 mt-2 flex justify-center">
              <Squiggle />
            </div>
            <p className="animate-reveal-up max-w-[280px] text-center text-sm leading-[1.8] text-text-secondary" style={{ animationDelay: '240ms' }}>
              有什么想聊的，随时找我。<br />
              <span className="text-xs text-text-muted">我是 AI，聊天由经批准的云端模型提供。</span>
            </p>

            <div className="mt-7 w-full">
              <Openers
                onSend={handleSend}
                onDraft={(draft) => inputRef.current?.fillDraft(draft)}
                draftLocked={draftLocked}
                withCare={local}
              />
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          // 流式占位气泡尚无内容时不渲染空气泡，此阶段由 TypingIndicator 承担进行中视觉
          message.streaming && !message.content && !message.progress?.length
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

      <div aria-live="polite" className="min-h-5 px-4 text-center text-xs text-danger">{error || workTasks.error}</div>
      <InputBar ref={inputRef} onSend={handleSend} onBackgroundSend={local && workTasks.available ? workTasks.submit : undefined} disabled={isSending || isTyping || workTasks.submitting} onDraftChange={setDraftLocked} />
      <CrisisModal intervention={intervention} onClose={() => setIntervention(null)} />
      <AIDisclaimer />
      <UsageReminder />
      <ConversationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </div>
    </div>
  )
}
