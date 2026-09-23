import { useCallback, useEffect, useRef, useState } from 'react'
import { Brain, Heart, Plus, Trash2 } from 'lucide-react'
import Header from '../components/layout/Header'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import EmptyState from '../components/ui/EmptyState'
import { memoryService } from '../services/memoryService'

// 她记得的你：一句一条，能改能删。类型、重要度、标签这些机器用的字段不摆在眼前，
// 新写的按默认值保存，编辑时沿用这条原来的值。
const DEFAULTS = { type: 'semantic', importance: 5, tags: [] }
const PAGE_SIZE = 20

/** 一条记忆：放在心上、改一改、删掉。 */
function MemoryCard({ memory, saving, onTogglePin, onEdit, onDelete }) {
  const pinned = memory.pinned === true
  return <article className="rounded-card bg-surface-card p-4 shadow-card">
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{memory.content}</p>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button type="button" aria-pressed={pinned} disabled={saving} onClick={() => onTogglePin(memory)}
        className={`flex min-h-11 items-center gap-1 text-xs ${pinned ? 'text-action-primary' : 'text-text-muted'}`}>
        <Heart size={13} aria-hidden="true" className={pinned ? 'fill-current' : ''} />放在心上
      </button>
      <button type="button" disabled={saving} onClick={() => onEdit(memory)} className="min-h-11 text-xs text-action-primary">改一改</button>
      <button type="button" aria-label={`删除这条记忆：${memory.content.slice(0, 12)}`} disabled={saving} onClick={() => onDelete(memory.id)} className="ml-auto flex h-11 w-11 items-center justify-center text-text-muted hover:text-danger"><Trash2 size={15} /></button>
    </div>
  </article>
}

export default function MemoriesPage({ embedded = false }) {
  const contentRef = useRef(null)
  const sequence = useRef(0)
  const [memories, setMemories] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(null) // null | { id, revision, type, importance, tags }
  const [conflictLatest, setConflictLatest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)

  const load = useCallback(async () => {
    const request = ++sequence.current
    setLoading(true)
    try {
      const result = await memoryService.listPage({ page, limit: PAGE_SIZE })
      if (request === sequence.current) {
        setMemories(result.data || []); setTotal(result.total || 0)
        if (page > 1 && !result.data?.length) setPage(Math.max(1, page - 1))
      }
    } catch { if (request === sequence.current) setMessage('记忆加载失败，请重试') }
    finally { if (request === sequence.current) setLoading(false) }
  }, [page])
  // 这里是请求序号而非 DOM 引用；清理时必须失效当时最新的请求。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); return () => { sequence.current++ } }, [load])

  const reset = () => { setDraft(''); setEditing(null); setConflictLatest(null) }

  const save = async (event) => {
    event.preventDefault()
    if (saving) return
    const content = draft.trim()
    if (!content) { setMessage('写下想让她记住的一句话'); contentRef.current?.focus(); return }
    setSaving(true); setMessage('')
    try {
      if (editing) {
        const { id, revision, type, importance, tags } = editing
        await memoryService.update(id, { type, importance, tags, content, expectedRevision: revision })
      } else {
        await memoryService.create({ ...DEFAULTS, content })
      }
      setMessage(editing ? '改好了' : '记住了')
      reset(); await load()
    } catch (error) {
      setMessage(error?.response?.data?.error || '没保存成功，请重试')
      if (error?.response?.status === 409 && editing) {
        try { setConflictLatest(await memoryService.get(editing.id)) } catch { /* 输入仍保留，可以手动重新读取。 */ }
      }
    } finally { setSaving(false) }
  }

  const edit = (memory) => {
    setEditing({ id: memory.id, revision: memory.revision, type: memory.type, importance: memory.importance, tags: memory.tags || [] })
    setDraft(memory.content)
    setConflictLatest(null)
    requestAnimationFrame(() => contentRef.current?.focus())
  }

  const remove = async () => {
    const id = pendingDelete
    setPendingDelete(null); setSaving(true); setMessage('')
    try {
      await memoryService.remove(id)
      if (editing?.id === id) reset()
      setMessage('删掉了'); await load()
    } catch (error) { setMessage(error?.response?.data?.error || '没删掉，请重试') }
    finally { setSaving(false) }
  }

  // 放在心上的每次聊天她都记着（最多 5 件）；满了由服务端如实说
  const togglePin = async (memory) => {
    setSaving(true); setMessage('')
    try {
      await memoryService.setPinned(memory.id, memory.pinned !== true)
      await load()
    } catch (error) { setMessage(error?.response?.data?.error || '没放上去，请重试') }
    finally { setSaving(false) }
  }

  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
    {!embedded && <Header title="她记得的你" showBack />}
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
      <p className="text-xs leading-relaxed text-text-secondary">只有你确认过的才会成为长期记忆。放在心上的（最多 5 件）每次聊天她都记着，其余的聊到才会想起。删掉的连同它的历史一起删，原来的聊天不动。</p>

      <form onSubmit={save} className="space-y-3 rounded-card bg-surface-card p-4 shadow-card" aria-labelledby="memory-form-title">
        <h2 id="memory-form-title" className="text-sm font-semibold text-text-primary">{editing ? '改一改' : '让她记住'}</h2>
        <label htmlFor="memory-content" className="sr-only">记忆内容</label>
        <textarea id="memory-content" ref={contentRef} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} rows={2}
          placeholder="比如：我不吃香菜" aria-label="记忆内容"
          className="w-full rounded-xl bg-surface-input p-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-status-info" />
        {conflictLatest && <div role="alert" className="space-y-2 rounded-xl bg-pastel-apricot p-3 text-xs leading-relaxed text-text-primary">
          <p>这条刚在别处改过，现在是：{conflictLatest.content}</p>
          <p>你写的还在上面。核对后可以接着保存。</p>
          <button type="button" className="min-h-11 underline" onClick={() => { setEditing((current) => ({ ...current, revision: conflictLatest.revision })); setConflictLatest(null) }}>已核对，继续保存</button>
        </div>}
        <div className="flex gap-2">
          {editing && <button type="button" onClick={reset} disabled={saving} className="min-h-11 flex-1 rounded-xl border border-border-subtle text-sm text-text-secondary">取消</button>}
          <button type="submit" disabled={saving || Boolean(conflictLatest)} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-action-primary text-sm font-semibold text-text-inverse disabled:opacity-50">
            <Plus size={15} aria-hidden="true" />{saving ? '保存中…' : editing ? '保存' : '记住'}
          </button>
        </div>
      </form>

      {message && <p role="status" className="text-xs text-text-secondary">{message}<button type="button" className="ml-2 min-h-11 underline" onClick={() => { setMessage(''); load() }}>重新读取</button></p>}

      {loading ? <p role="status" className="py-8 text-center text-sm text-text-muted">加载中…</p>
        : !memories.length ? <EmptyState icon={Brain} title="她还没记住什么" />
          : memories.map((memory) => <MemoryCard key={memory.id} memory={memory} saving={saving}
            onTogglePin={togglePin} onEdit={edit} onDelete={setPendingDelete} />)}

      {total > PAGE_SIZE && <nav aria-label="记忆分页" className="flex items-center justify-between text-xs text-text-secondary">
        <button type="button" disabled={page === 1 || loading} className="min-h-11 px-3 disabled:opacity-30" onClick={() => setPage(page - 1)}>上一页</button>
        <span>第 {page} / {Math.max(1, Math.ceil(total / PAGE_SIZE))} 页</span>
        <button type="button" disabled={page * PAGE_SIZE >= total || loading} className="min-h-11 px-3 disabled:opacity-30" onClick={() => setPage(page + 1)}>下一页</button>
      </nav>}
    </div>
    <ConfirmDialog open={Boolean(pendingDelete)} title="删掉这条"
      description="连同它的历史和索引一起删除，找不回来；原来的聊天保留。"
      confirmLabel="确认删除" danger onConfirm={remove} onCancel={() => setPendingDelete(null)} />
  </div>
}
