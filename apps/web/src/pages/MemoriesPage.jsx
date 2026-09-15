import { useCallback, useEffect, useRef, useState } from 'react'
import { Brain, Edit3, Plus, Save, Trash2 } from 'lucide-react'
import Header from '../components/layout/Header'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import EmptyState from '../components/ui/EmptyState'
import MemoryDetailPanel from '../components/memory/MemoryDetailPanel'
import MemoryIndexPanel from '../components/memory/MemoryIndexPanel'
import { memoryService } from '../services/memoryService'
import { parseTags } from '../utils/parseTags'

const TYPE_LABELS = { semantic: '事实与偏好', episodic: '经历与事件', procedural: '习惯与做法' }
const ORIGIN_LABELS = { manual: '你记下的', suggestion: '来自帮我记住', promoted: '已确认的理解' }
const EMPTY_FORM = { type: 'semantic', content: '', importance: 5, tags: '' }
const control = 'min-h-11 w-full rounded-xl bg-surface-input px-3 text-sm text-text-primary'

export default function MemoriesPage({ embedded = false }) {
  const contentRef = useRef(null)
  const sequence = useRef(0)
  const [memories, setMemories] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [expectedRevision, setExpectedRevision] = useState(null)
  const [conflictLatest, setConflictLatest] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)

  const load = useCallback(async () => {
    const request = ++sequence.current
    setLoading(true)
    try {
      const result = await memoryService.listPage({ page, limit: 20, q: query, type: filter })
      if (request === sequence.current) {
        setMemories(result.data || []); setTotal(result.total || 0)
        if (page > 1 && !result.data?.length) setPage(Math.max(1, page - 1))
      }
    } catch { if (request === sequence.current) setMessage('记忆加载失败，请重试') }
    finally { if (request === sequence.current) setLoading(false) }
  }, [page, query, filter])
  // 这里是请求序号而非 DOM 引用；清理时必须失效当时最新的请求。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); return () => { sequence.current++ } }, [load])

  const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); setExpectedRevision(null); setConflictLatest(null) }
  const save = async (event) => {
    event.preventDefault()
    if (saving) return
    if (!form.content.trim()) { setMessage('请输入要记住的内容'); contentRef.current?.focus(); return }
    setSaving(true); setMessage('')
    const payload = { type: form.type, content: form.content.trim(), importance: Number(form.importance), tags: parseTags(form.tags) }
    try {
      if (editingId) await memoryService.update(editingId, { ...payload, expectedRevision })
      else await memoryService.create(payload)
      setMessage(editingId ? '记忆已更新' : '记忆已创建')
      resetForm(); await load()
    } catch (error) {
      setMessage(error?.response?.data?.error || '记忆保存失败，请重试')
      if (error?.response?.status === 409 && editingId) {
        try { setConflictLatest(await memoryService.get(editingId)) } catch { /* 输入仍保留，可以手动重新读取。 */ }
      }
    } finally { setSaving(false) }
  }
  const edit = (memory) => {
    setEditingId(memory.id); setExpectedRevision(memory.revision); setConflictLatest(null)
    setForm({ type: memory.type, content: memory.content, importance: memory.importance, tags: (memory.tags || []).join('，') })
    requestAnimationFrame(() => contentRef.current?.focus())
  }
  const remove = async () => {
    const id = pendingDelete
    setPendingDelete(null); setSaving(true); setMessage('')
    try {
      if (id === '*') await memoryService.clear()
      else await memoryService.remove(id)
      if (id === '*' || editingId === id) resetForm()
      if (id === '*' || detailId === id) setDetailId(null)
      setMessage('记忆及其历史、索引和依赖已删除'); await load()
    } catch (error) { setMessage(error?.response?.data?.error || '删除失败，请重试') }
    finally { setSaving(false) }
  }

  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
    {!embedded && <Header title="显式记忆" showBack />}
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
      <p className="text-xs leading-relaxed text-text-secondary">只有你确认的内容会成为长期记忆。每次修改都会保留版本；删除会一并清除历史和索引，原始聊天单独管理。</p>
      <form onSubmit={save} className="space-y-3 rounded-card bg-surface-card p-4 shadow-card" aria-labelledby="memory-form-title">
        <h2 id="memory-form-title" className="flex items-center gap-2 text-sm font-semibold text-text-primary">{editingId ? <Edit3 size={16} /> : <Plus size={16} />}{editingId ? '编辑记忆' : '创建记忆'}</h2>
        <label htmlFor="memory-content" className="block text-xs text-text-secondary">记忆内容</label>
        <textarea id="memory-content" ref={contentRef} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} maxLength={2000} rows={3} className="w-full rounded-xl bg-surface-input p-3 text-sm text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-status-info" />
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-xs text-text-secondary">类型<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className={control}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="space-y-1 text-xs text-text-secondary">重要度（1–10）<input type="number" min="1" max="10" value={form.importance} onChange={(event) => setForm({ ...form, importance: Number(event.target.value) })} className={control} /></label>
        </div>
        <label className="block space-y-1 text-xs text-text-secondary">标签（逗号分隔）<input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} className={control} /></label>
        {conflictLatest && <div role="alert" className="space-y-2 rounded-xl bg-pastel-apricot p-3 text-xs text-text-primary"><p>最新第 {conflictLatest.revision} 版：{conflictLatest.content}</p><p>{TYPE_LABELS[conflictLatest.type]} · 重要度 {conflictLatest.importance} · {(conflictLatest.tags || []).join('、')}</p><p>你的输入已保留。核对后可以基于这个版本再次保存。</p><button type="button" className="min-h-11 underline" onClick={() => { setExpectedRevision(conflictLatest.revision); setConflictLatest(null); setMessage('已保留你的输入，请核对后再次保存') }}>已核对，继续编辑</button></div>}
        <div className="flex gap-2">{editingId && <button type="button" onClick={resetForm} disabled={saving} className="min-h-11 flex-1 rounded-xl border border-border-subtle text-sm text-text-secondary">取消</button>}<button type="submit" disabled={saving || Boolean(conflictLatest)} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-action-primary text-sm font-semibold text-text-inverse disabled:opacity-50"><Save size={15} />{saving ? '保存中…' : '保存'}</button></div>
      </form>
      {detailId && <MemoryDetailPanel key={detailId} id={detailId} onClose={() => setDetailId(null)} onRestored={load} />}
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-text-primary">我的记忆（{total}）</h2>{total > 0 && <button type="button" disabled={saving} onClick={() => setPendingDelete('*')} className="min-h-11 px-3 text-xs text-danger">清空全部</button>}</div>
      <div className="grid gap-2 sm:grid-cols-2"><input type="search" aria-label="搜索记忆" placeholder="搜索记忆内容" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} className={control} /><select aria-label="筛选记忆类型" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1) }} className={control}><option value="">全部类型</option>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      {message && <p role="status" className="text-xs text-text-secondary">{message}<button type="button" className="ml-2 min-h-11 underline" onClick={() => { setMessage(''); load() }}>重新读取</button></p>}
      {loading ? <p role="status" className="py-8 text-center text-sm text-text-muted">加载中…</p> : !memories.length ? <EmptyState icon={Brain} title={query || filter ? '没有匹配的记忆' : '还没有记忆'} /> : memories.map((memory) => <article key={memory.id} className="space-y-2 rounded-card bg-surface-card p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-status-info">{TYPE_LABELS[memory.type]} · 第 {memory.revision} 版</span><span className="text-xs text-text-muted">{memory.importedAt ? '由你确认导入' : ORIGIN_LABELS[memory.origin]}</span></div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{memory.content}</p>
        <p className="text-xs text-text-muted">重要度 {memory.importance} · {(memory.tags || []).join('、')}</p>
        <div className="flex flex-wrap items-center gap-2"><button type="button" className="min-h-11 text-xs text-action-primary" onClick={() => setDetailId(memory.id)}>查看来源与历史</button><button type="button" aria-label="编辑这条记忆" disabled={saving} onClick={() => edit(memory)} className="flex h-11 w-11 items-center justify-center text-text-secondary"><Edit3 size={15} /></button><button type="button" aria-label="删除这条记忆" disabled={saving} onClick={() => setPendingDelete(memory.id)} className="flex h-11 w-11 items-center justify-center text-danger"><Trash2 size={15} /></button></div>
      </article>)}
      <nav aria-label="记忆分页" className="flex items-center justify-between text-xs text-text-secondary"><button type="button" disabled={page === 1 || loading} className="min-h-11 px-3 disabled:opacity-30" onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} / {Math.max(1, Math.ceil(total / 20))} 页</span><button type="button" disabled={page * 20 >= total || loading} className="min-h-11 px-3 disabled:opacity-30" onClick={() => setPage(page + 1)}>下一页</button></nav>
      <MemoryIndexPanel />
    </div>
    <ConfirmDialog open={Boolean(pendingDelete)} title={pendingDelete === '*' ? '清空全部记忆' : '删除这条记忆'} description="会永久删除记忆、历史版本、索引和依赖引用，无法恢复；原始聊天保留。" confirmLabel={pendingDelete === '*' ? '确认清空' : '确认删除'} danger onConfirm={remove} onCancel={() => setPendingDelete(null)} />
  </div>
}
