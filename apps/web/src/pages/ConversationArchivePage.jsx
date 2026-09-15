import { useCallback, useEffect, useRef, useState } from 'react'
import { Archive, ArchiveRestore, ArrowLeft, MessageCircle } from 'lucide-react'
import { chatService } from '../services/chatService'
import { useChatStore } from '../stores/chatStore'
import Header from '../components/layout/Header'
import MessageBubble from '../components/chat/MessageBubble'
import Button from '../components/ui/Button'

const PAGE_SIZE = 20
const MESSAGE_PAGE_SIZE = 50

export default function ConversationArchivePage() {
  const [conversations, setConversations] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)
  const [messagePage, setMessagePage] = useState(1)
  const [hasOlder, setHasOlder] = useState(false)
  const [reading, setReading] = useState(false)
  const [restoring, setRestoring] = useState(null)
  const [failedAction, setFailedAction] = useState(null)
  const listRequest = useRef(0)
  const detailRequest = useRef(0)
  const loadConversations = useChatStore(state => state.loadConversations)
  const archiveRevision = useChatStore(state => state.archiveRevision)

  const loadArchives = useCallback(async (nextPage = 1) => {
    const request = ++listRequest.current
    setLoading(true)
    setError('')
    try {
      const rows = await chatService.getConversations({ archived: true, page: nextPage, limit: PAGE_SIZE })
      if (request !== listRequest.current) return
      setConversations(previous => nextPage === 1 ? rows : [...new Map([...previous, ...rows].map(row => [row.id, row])).values()])
      setPage(nextPage)
      setHasMore(rows.length === PAGE_SIZE)
    } catch {
      if (request === listRequest.current) {
        setError('归档列表加载失败，请重试。')
        setFailedAction({ type: 'list', page: nextPage })
      }
    } finally {
      if (request === listRequest.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadArchives()
  }, [loadArchives, archiveRevision])

  useEffect(() => () => { listRequest.current += 1; detailRequest.current += 1 }, [])

  const readConversation = async (conversation, nextPage = 1) => {
    const request = ++detailRequest.current
    setReading(true)
    setError('')
    if (nextPage === 1) {
      setDetail({ ...conversation, messages: [] })
      setMessagePage(1)
      setHasOlder(false)
    }
    try {
      const result = await chatService.getConversation(conversation.id, { page: nextPage, limit: MESSAGE_PAGE_SIZE })
      if (request !== detailRequest.current) return
      setDetail(previous => ({ ...result, messages: nextPage === 1 ? result.messages : [...result.messages, ...previous.messages] }))
      setMessagePage(nextPage)
      setHasOlder(result.messages.length === MESSAGE_PAGE_SIZE)
    } catch {
      if (request === detailRequest.current) {
        setError('聊天记录加载失败，请重试。')
        setFailedAction({ type: 'messages', page: nextPage })
      }
    } finally {
      if (request === detailRequest.current) setReading(false)
    }
  }

  const restoreConversation = async (id) => {
    if (restoring) return
    setRestoring(id)
    setError('')
    try {
      await chatService.setArchived(id, false)
      detailRequest.current += 1
      setDetail(null)
      setReading(false)
      await loadArchives()
      await loadConversations()
    } catch {
      setError('恢复失败，聊天记录仍保留在归档中，请重试。')
      setFailedAction({ type: 'restore', id })
    } finally {
      setRestoring(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      <Header title="对话归档" showBack />
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="rounded-card border border-border-hairline bg-surface-card p-5 shadow-card">
            <Archive size={24} className="mb-3 text-action-primary" aria-hidden="true" />
            <h2 className="display-serif text-xl font-semibold text-text-primary">把聊过的，妥善收藏</h2>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">归档后，对话会从会话列表收起，聊天记录完整保留。随时恢复，就能继续聊。</p>
          </div>

          {error && <div role="alert" className="rounded-control bg-pastel-blush p-3 text-sm text-danger">
            {error}
            <button type="button" disabled={loading || reading || restoring !== null} className="ml-3 min-h-11 underline" onClick={() => failedAction?.type === 'restore' ? restoreConversation(failedAction.id) : failedAction?.type === 'messages' && detail ? readConversation(detail, failedAction.page) : loadArchives(failedAction?.page || 1)}>重试</button>
          </div>}

          {detail ? <section aria-label="归档聊天记录" className="rounded-card border border-border-hairline bg-surface-card p-4">
            <button type="button" className="mb-4 flex min-h-11 items-center gap-2 text-sm text-text-secondary" onClick={() => { detailRequest.current += 1; setDetail(null); setReading(false); setError('') }}>
              <ArrowLeft size={16} aria-hidden="true" />返回归档列表
            </button>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h3 className="min-w-0 break-words font-semibold text-text-primary">{detail.title || '新会话'}</h3>
              <Button disabled={restoring !== null} onClick={() => restoreConversation(detail.id)}><ArchiveRestore size={16} aria-hidden="true" />恢复对话</Button>
            </div>
            {hasOlder && <button type="button" disabled={reading} className="mb-4 min-h-11 w-full text-sm text-action-primary" onClick={() => readConversation(detail, messagePage + 1)}>加载更早的消息</button>}
            {reading && <p role="status" className="py-3 text-center text-sm text-text-muted">正在读取聊天记录…</p>}
            {!reading && !error && detail.messages.length === 0 && <p className="py-8 text-center text-sm text-text-muted">这段对话还没有消息</p>}
            <div className="space-y-5">{detail.messages.map(message => <MessageBubble key={message.id} message={message} isLast />)}</div>
          </section> : <>
            {loading && <p role="status" className="py-3 text-center text-sm text-text-muted">正在读取归档…</p>}
            {!loading && !error && conversations.length === 0 && <div className="py-12 text-center text-text-muted"><MessageCircle size={32} className="mx-auto mb-3" aria-hidden="true" /><p className="text-sm">还没有归档的对话</p><p className="mt-2 text-xs">在会话列表中，点击对话旁的归档按钮即可收藏。</p></div>}
            {conversations.map(conversation => <article key={conversation.id} className="rounded-card border border-border-hairline bg-surface-card p-4 shadow-card">
              <div className="flex items-start justify-between gap-3">
                <h3 className="min-w-0 break-words font-semibold text-text-primary">{conversation.title || '新会话'}</h3>
              </div>
              <p className="mt-2 truncate text-sm text-text-muted">{conversation.messages?.[0]?.content || '暂无消息'}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-text-muted">{conversation.archivedAt ? `${new Date(conversation.archivedAt).toLocaleDateString('zh-CN')} 归档` : '已归档'}</span>
                <div className="flex gap-2">
                  <button type="button" className="min-h-11 rounded-control px-3 text-sm text-text-secondary hover:bg-surface-muted" onClick={() => readConversation(conversation)} aria-label={`查看记录 ${conversation.title || '新会话'}`}>查看记录</button>
                  <button type="button" disabled={restoring !== null} className="flex min-h-11 items-center gap-1.5 rounded-control bg-pastel-blush px-3 text-sm font-medium text-action-primary disabled:opacity-50" onClick={() => restoreConversation(conversation.id)} aria-label={`恢复对话 ${conversation.title || '新会话'}`}><ArchiveRestore size={15} aria-hidden="true" />{restoring === conversation.id ? '恢复中…' : '恢复'}</button>
                </div>
              </div>
            </article>)}
            {hasMore && <button type="button" disabled={loading} className="min-h-11 w-full rounded-control bg-surface-card text-sm text-action-primary" onClick={() => loadArchives(page + 1)}>加载更多归档</button>}
          </>}
        </div>
      </div>
    </div>
  )
}
