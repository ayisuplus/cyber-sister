import { Fragment, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useChatStore } from '../stores/chatStore'
import { useAppearanceStore } from '../stores/appearanceStore'
import { useComplianceStore } from '../stores/complianceStore'
import { modelStatusService } from '../services/modelStatusService'
import ChatHeader from '../components/chat/ChatHeader'
import CloudFallbackNotice, { CLOUD_FALLBACK_DISMISSED_KEY } from '../components/chat/CloudFallbackNotice'
import LetterPad from '../components/letter/LetterPad'
import LetterEntry from '../components/letter/LetterEntry'
import { sameDay } from '../components/letter/letterDate'
import TypingIndicator from '../components/chat/TypingIndicator'
import InputBar from '../components/chat/InputBar'
import NavDrawer from '../components/layout/NavDrawer'
import MemorySuggestion from '../components/chat/MemorySuggestion'
import ActionConfirmCard from '../components/chat/ActionConfirmCard'
import CrisisModal from '../components/chat/CrisisModal'
import AIDisclaimer from '../components/chat/AIDisclaimer'
import UsageReminder from '../components/chat/UsageReminder'
import AmbientMedia from '../components/work/AmbientMedia'
import Openers from '../components/chat/Openers'
import HerNudges from '../components/chat/HerNudges'
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
  if (code === 'LLM_UNAVAILABLE') {
    return '云端模型暂时不可用。原输入已保留，请稍后重试。'
  }
  if (code === 'WORK_CLOUD_NOT_CONNECTED') {
    return '这项能力的云端接口还没接通。原输入已保留。'
  }
  return '消息发送失败，原输入已保留，请重试。'
}

// 空白信纸顶上的手写问候：按本机时段轻声打个招呼
const greetingFor = (hour) => {
  if (hour >= 5 && hour < 11) return '早安，慢慢醒来'
  if (hour >= 11 && hour < 17) return '午后好，歇一会儿'
  if (hour >= 17 && hour < 22) return '傍晚了，辛苦啦'
  return '夜深了，慢慢来'
}

// 封面：本子的第 0 页，也是空白对话打开时看到的那一页。
// 手写问候、贴上去的一张她的小照片、开场话题用铅笔写在下面；翻开它才是第一封信。
function CoverPage({ greeting, onSend, onDraft, draftLocked }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center pb-4">
      <p className="animate-reveal-up mb-4 font-hand text-[15px] tracking-[0.2em] text-text-secondary">{greeting}</p>
      <div className="relative mb-5">
        <div aria-hidden="true" className="halo-glow animate-breathe absolute -inset-8 rounded-full" />
        <div className="animate-reveal-up relative h-40 w-32 overflow-hidden rounded-[999px_999px_28px_28px] bg-gradient-pastel shadow-soft ring-1 ring-border-hairline" style={{ animationDelay: '80ms' }}>
          <AmbientMedia
            videoSrc="/design-assets/chat-ambient.mp4"
            imageSrc="/design-assets/empty-state-chat.png"
            className="ambient-decoration h-full w-full scale-[1.06] object-cover"
          />
        </div>
        <span aria-hidden="true" className="animate-doodle-float absolute -right-6 bottom-1 text-action-primary opacity-40" style={{ animationDuration: '11s' }}>
          <LeafSprig size={56} flip />
        </span>
      </div>
      <h1 className="animate-reveal-up font-display text-[24px] font-medium tracking-[0.02em] text-text-primary" style={{ animationDelay: '160ms' }}>嗨，我是你的Amie</h1>
      <div className="mb-2 mt-1 flex justify-center">
        <Squiggle />
      </div>
      <p className="animate-reveal-up max-w-[280px] text-center text-sm leading-[1.8] text-text-secondary" style={{ animationDelay: '240ms' }}>
        有什么想聊的，随时写给我。<br />
        <span className="text-xs text-text-muted">我是 AI，聊天由经批准的云端模型提供。</span>
      </p>
      <div className="mt-5 w-full">
        <Openers onSend={onSend} onDraft={onDraft} draftLocked={draftLocked} />
      </div>
    </div>
  )
}

export default function ChatPage() {
  const padRef = useRef(null)
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
  const isTyping = useChatStore(state => state.isTyping)
  const isSending = useChatStore(state => state.isSending)
  const sendMessage = useChatStore(state => state.sendMessage)
  const loadThread = useChatStore(state => state.loadThread)
  const hasOlder = useChatStore(state => state.hasOlder)
  const loadOlder = useChatStore(state => state.loadOlder)
  const patchToolRun = useChatStore(state => state.patchToolRun)
  const checkFirstVisit = useComplianceStore(state => state.checkFirstVisit)
  const startSession = useComplianceStore(state => state.startSession)
  const endSession = useComplianceStore(state => state.endSession)
  const checkUsageTime = useComplianceStore(state => state.checkUsageTime)
  const chatBgUrl = useAppearanceStore(s => s.chatBgUrl)
  const [greeting] = useState(() => greetingFor(new Date().getHours()))

  // 只有一段对话：进来就打开它
  useEffect(() => {
    loadThread()
    checkFirstVisit()
  }, [checkFirstVisit, loadThread])

  // 「带去对话」的一次性交接：来信页把一句草稿放在路由状态里，填进输入框就清掉，防重复。
  // 输入框已有草稿时 fillDraft 不覆盖（用户正在写的优先），静默放弃这一句。
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    const compose = location.state?.compose
    if (!compose) return
    inputRef.current?.fillDraft(compose)
    navigate(location.pathname, { replace: true, state: null })
  }, [location, navigate])
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

  // 信纸自己决定翻到哪一页：在最后一页时写满就翻过去，往回翻看时不打扰
  const lastMessage = messages[messages.length - 1]

  const handleSend = async (text, options = {}) => {
    setError('')
    // 你刚写下一句：翻回最新那一页接着写
    padRef.current?.showLatest()
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

      {/* 一个本子：左边一条封皮，翻页绕它翻；封面是第一页，最底下那一行是你落笔的地方 */}
      <div className="letter relative z-10 mx-auto flex min-h-0 w-full flex-1 flex-col px-2 pb-1 pt-2 min-[641px]:px-5">
        <div className="letter-book min-h-0 flex-1">
          <div aria-hidden="true" className="letter-spine" />
          <div className="letter-sheet min-h-0">
            <LetterPad
              ref={padRef}
              cover={<CoverPage greeting={greeting} onSend={handleSend} onDraft={(draft) => inputRef.current?.fillDraft(draft)} draftLocked={draftLocked} />}
              firstKey={messages[0]?.id ?? null}
              lastKey={lastMessage?.id ?? null}
              lastVersion={`${lastMessage?.id}:${lastMessage?.content?.length ?? 0}:${isTyping}`}
              hasOlder={hasOlder}
              onLoadOlder={loadOlder}
            >
              {local && <div className="letter-snap"><WorkTaskPanel tasks={workTasks.tasks} cancel={workTasks.cancel} retry={workTasks.retry} decide={workTasks.decide} /></div>}
              {messages.map((message, index) => {
                // 流式占位还没有字时不留空段，此时由「她正在写」的墨点承担进行中视觉
                if (message.streaming && !message.content && !message.progress?.length) return null
                // 待确认动作卡跟着产生它的那条回复；key 用消息 id + toolRuns 下标（端点凭下标执行）
                const pendings = Array.isArray(message.toolRuns)
                  ? message.toolRuns.map((run, runIndex) => ({ run, runIndex })).filter(({ run }) => run.pending === true)
                  : []
                return (
                  <Fragment key={message.id}>
                    <LetterEntry message={message} isLast={index === messages.length - 1} showDate={index === 0 || !sameDay(messages[index - 1].createdAt, message.createdAt)} />
                    {pendings.map(({ run, runIndex }) => (
                      <div key={`${message.id}-${runIndex}`} className="letter-snap">
                        <ActionConfirmCard
                          messageId={message.id}
                          index={runIndex}
                          toolRun={run}
                          onDone={(toolRun) => patchToolRun(message.id, runIndex, toolRun)}
                        />
                      </div>
                    ))}
                  </Fragment>
                )
              })}
              {suggestionUserMessage && (
                // key 绑定回复 id：新回复后建议状态随之重置，入口只跟随最新正常回复
                <div className="letter-snap"><MemorySuggestion key={lastMessage.id} userMessageId={suggestionUserMessage.id} autoOpen={lastMessage.offerMemory === true} /></div>
              )}
              <div className="letter-snap"><HerNudges onComposeDraft={(text) => inputRef.current?.fillDraft(text)} /></div>
              {isTyping && <TypingIndicator />}
            </LetterPad>
            <div className="letter-writing">
              <InputBar ref={inputRef} onSend={handleSend} onBackgroundSend={local && workTasks.available ? workTasks.submit : undefined} disabled={isSending || isTyping || workTasks.submitting} onDraftChange={setDraftLocked} />
            </div>
          </div>
        </div>
      </div>

      <div aria-live="polite" className="min-h-5 px-4 text-center text-xs text-danger">{error || workTasks.error}</div>
      <CrisisModal intervention={intervention} onClose={() => setIntervention(null)} />
      <AIDisclaimer />
      <UsageReminder />
      <NavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </div>
    </div>
  )
}
