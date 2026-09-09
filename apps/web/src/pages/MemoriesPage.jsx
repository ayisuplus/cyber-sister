import { useEffect, useRef, useState } from 'react'
import { Brain, Edit3, Plus, RefreshCw, Save, Tag, Trash2 } from 'lucide-react'
import Header from '../components/layout/Header'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { memoryService } from '../services/memoryService'
import { parseTags } from '../utils/parseTags'

const TYPE_LABELS = {
  semantic: '语义记忆',
  episodic: '情景记忆',
  procedural: '程序记忆',
}

const ORIGIN_LABELS = { manual: '你记下的', suggestion: '来自帮我记住', promoted: '工作台定典' }

const EMPTY_FORM = { type: 'semantic', content: '', importance: 5, tags: '' }

export default function MemoriesPage() {
  const contentRef = useRef(null)
  const [memories, setMemories] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [showEmbedConfirm, setShowEmbedConfirm] = useState(false)

  const load = async () => {
    setLoading(true)
    setMessage('')
    try {
      setMemories(await memoryService.list())
    } catch {
      setMessage('记忆加载失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
  }

  const save = async (event) => {
    event.preventDefault()
    if (!form.content.trim()) {
      setMessage('请输入要记住的内容')
      contentRef.current?.focus()
      return
    }
    setSaving(true)
    setMessage('')
    const payload = {
      type: form.type,
      content: form.content.trim(),
      importance: Number(form.importance),
      tags: parseTags(form.tags),
    }
    try {
      if (editingId) {
        const updated = await memoryService.update(editingId, payload)
        setMemories(current => current.map(memory => memory.id === editingId ? updated : memory))
        setMessage('记忆已更新')
      } else {
        const created = await memoryService.create(payload)
        setMemories(current => [created, ...current])
        setMessage('记忆已创建')
      }
      resetForm()
    } catch {
      setMessage('记忆保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  const edit = (memory) => {
    setEditingId(memory.id)
    setForm({
      type: memory.type,
      content: memory.content,
      importance: memory.importance,
      tags: Array.isArray(memory.tags) ? memory.tags.join('，') : '',
    })
    requestAnimationFrame(() => contentRef.current?.focus())
  }

  const remove = async (id) => {
    setMessage('')
    try {
      await memoryService.remove(id)
      setMemories(current => current.filter(memory => memory.id !== id))
      if (editingId === id) resetForm()
      setMessage('记忆已删除')
    } catch {
      setMessage('删除失败，请重试')
    }
  }

  const clear = async () => {
    setShowClearConfirm(false)
    setMessage('')
    try {
      await memoryService.clear()
      setMemories([])
      resetForm()
      setMessage('全部记忆已清空')
    } catch {
      setMessage('清空失败，请重试')
    }
  }

  // 语义索引重建（M2）：向量投影可重建，非破坏操作；同意/可用性错误给诚实文案
  const rebuildEmbeddings = async () => {
    setShowEmbedConfirm(false)
    setMessage('')
    try {
      const result = await memoryService.rebuildEmbeddings()
      setMessage(`语义索引已重建：新增 ${result?.embedded ?? 0} 条${result?.failed ? `，失败 ${result.failed} 条` : ''}，已是最新 ${result?.skipped ?? 0} 条`)
    } catch (error) {
      const code = error?.response?.data?.code
      if (code === 'CLOUD_NOT_CONSENTED') {
        setMessage('需要先在「我的 → 云端模型」同意')
      } else if (code === 'LLM_UNAVAILABLE') {
        setMessage('云端模型暂时不可用')
      } else {
        setMessage('重建失败，请稍后再试')
      }
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
      <Header title="显式记忆" showBack />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <p className="text-xs leading-relaxed text-text-secondary">这里只有你主动创建的记忆。系统不会自动提取或推断记忆。</p>

        <form onSubmit={save} className="rounded-card bg-surface-card p-4 shadow-card space-y-3" aria-labelledby="memory-form-title">
          <h2 id="memory-form-title" className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            {editingId ? <Edit3 size={16} /> : <Plus size={16} />}
            {editingId ? '编辑记忆' : '创建记忆'}
          </h2>
          <div>
            <label htmlFor="memory-content" className="mb-1 block text-xs text-text-secondary">记忆内容</label>
            <textarea id="memory-content" ref={contentRef} value={form.content} onChange={event => setForm(current => ({ ...current, content: event.target.value }))} maxLength={500} rows={3} className="w-full rounded-xl bg-surface-input p-3 text-sm outline-none focus:ring-2 focus:ring-brand-pink/30" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="memory-type" className="mb-1 block text-xs text-text-secondary">类型</label>
              <select id="memory-type" value={form.type} onChange={event => setForm(current => ({ ...current, type: event.target.value }))} className="min-h-11 w-full rounded-xl bg-surface-input px-3 text-sm">
                {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="memory-importance" className="mb-1 block text-xs text-text-secondary">重要度（1–10）</label>
              <input id="memory-importance" type="number" min="1" max="10" value={form.importance} onChange={event => setForm(current => ({ ...current, importance: Number(event.target.value) }))} className="min-h-11 w-full rounded-xl bg-surface-input px-3 text-sm" />
            </div>
          </div>
          <div>
            <label htmlFor="memory-tags" className="mb-1 block text-xs text-text-secondary">标签（逗号分隔）</label>
            <input id="memory-tags" value={form.tags} onChange={event => setForm(current => ({ ...current, tags: event.target.value }))} className="min-h-11 w-full rounded-xl bg-surface-input px-3 text-sm" />
          </div>
          <div className="flex gap-2">
            {editingId && <button type="button" onClick={resetForm} className="min-h-11 flex-1 rounded-xl border border-border-subtle text-sm text-text-secondary">取消</button>}
            <button type="submit" disabled={saving} className="min-h-11 flex-1 rounded-xl bg-action-primary hover:bg-action-hover text-sm font-semibold text-text-inverse disabled:opacity-50 flex items-center justify-center gap-2"><Save size={15} />{saving ? '保存中…' : '保存'}</button>
          </div>
        </form>

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">我的记忆（{memories.length}）</h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setShowEmbedConfirm(true)} className="flex min-h-11 items-center gap-1 px-3 text-xs text-text-secondary">
              <RefreshCw size={13} />重建语义索引
            </button>
            {memories.length > 0 && <button type="button" onClick={() => setShowClearConfirm(true)} className="min-h-11 px-3 text-xs text-danger">清空全部</button>}
          </div>
        </div>

        <p aria-live="polite" className="min-h-5 text-center text-xs text-text-secondary">{message}</p>

        {loading ? (
          <p role="status" className="py-8 text-center text-sm text-text-muted">加载中…</p>
        ) : memories.length === 0 ? (
          <div className="py-10 text-center"><Brain size={44} className="mx-auto mb-3 text-text-muted" /><p className="text-sm text-text-muted">还没有记忆</p></div>
        ) : (
          <div className="space-y-2">
            {memories.map(memory => (
              <article key={memory.id} className="rounded-2xl bg-surface-card p-4 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <span className="rounded-full bg-brand-purple/10 px-2 py-1 text-[10px] text-brand-purple">{TYPE_LABELS[memory.type] || memory.type}</span>
                  {ORIGIN_LABELS[memory.origin] && (
                    <span className="rounded-full bg-pastel-mist px-2 py-1 text-[10px] text-status-info">{ORIGIN_LABELS[memory.origin]}</span>
                  )}
                  <div className="flex gap-1">
                    <button type="button" aria-label="编辑这条记忆" onClick={() => edit(memory)} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-muted hover:bg-surface-muted hover:text-brand-purple"><Edit3 size={15} /></button>
                    <button type="button" aria-label="删除这条记忆" onClick={() => remove(memory.id)} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-muted hover:bg-pastel-blush hover:text-danger"><Trash2 size={15} /></button>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-text-primary">{memory.content}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
                  {(memory.tags || []).map(tag => <span key={tag} className="flex items-center gap-1"><Tag size={9} />{tag}</span>)}
                  <span className="ml-auto">重要度 {memory.importance}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={showClearConfirm}
        title="清空全部记忆"
        description="此操作无法撤销，确定继续吗？"
        confirmLabel="确认清空"
        danger
        onConfirm={clear}
        onCancel={() => setShowClearConfirm(false)}
      />

      <ConfirmDialog
        open={showEmbedConfirm}
        title="重建语义索引"
        description="会把你的全部记忆内容发往云端模型生成语义向量，用于聊天时找得更准。需要已同意云端模型。确定继续吗？"
        confirmLabel="确认重建"
        onConfirm={rebuildEmbeddings}
        onCancel={() => setShowEmbedConfirm(false)}
      />
    </div>
  )
}
