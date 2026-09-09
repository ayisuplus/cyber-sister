import { useEffect, useState } from 'react'
import { RefreshCw, Save, Scale, Sparkles, Trash2 } from 'lucide-react'
import Header from '../components/layout/Header'
import Button from '../components/ui/Button'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import Spinner from '../components/ui/Spinner'
import { derivedService } from '../services/derivedService'
import { parseTags } from '../utils/parseTags'

const KIND_META = {
  pattern: { label: '模式', tone: 'bg-pastel-mist text-status-info' },
  hypothesis: { label: '推测', tone: 'bg-pastel-apricot text-action-primary' },
  conflict: { label: '冲突', tone: 'bg-pastel-blush text-danger' },
  summary: { label: '小结', tone: 'bg-pastel-sprout text-status-local' },
}
const CONFIDENCE_LABEL = { low: '把握较低', medium: '把握中等', high: '把握较高' }
const RELATION_LABELS = { similar: '相似', related: '相关', contradicts: '冲突' }
const TYPE_OPTIONS = [
  { value: 'semantic', label: '语义记忆' },
  { value: 'episodic', label: '情景记忆' },
  { value: 'procedural', label: '程序记忆' },
]

// 关系页签：记忆关系边（派生 → 确认晋升 canonical）
const EDGES_TAB = 'edges'

const STATUS_TABS = [
  { value: 'active', label: '待确认' },
  { value: 'promoted', label: '已晋升' },
  { value: 'resolved', label: '已厘清' },
  { value: 'dismissed', label: '不算了' },
  { value: EDGES_TAB, label: '关系' },
]

// evidence 在库内是 JSON 数组字符串；损坏数据按无依据展示
const parseEvidence = (value) => {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const toCard = (insight) => ({
  ...insight,
  evidence: parseEvidence(insight.evidence),
  editor: null,
  saving: false,
  promoted: false,
  resolved: false,
  dismissing: false,
  error: '',
})

const toEdgeCard = (edge) => ({
  ...edge,
  evidence: parseEvidence(edge.evidence),
  saving: false,
  dismissing: false,
  error: '',
})

// 单一拉取口径：edges 页签拉关系边（dismissed 前端过滤掉），其余页签拉 insight
const fetchTabCards = async (tab) => {
  if (tab === EDGES_TAB) {
    const data = await derivedService.listEdges('all')
    const list = Array.isArray(data?.edges) ? data.edges : []
    return list.map(toEdgeCard).filter((edge) => edge.status !== 'dismissed')
  }
  const data = await derivedService.list(tab)
  return (Array.isArray(data?.insights) ? data.insights : []).map(toCard)
}

// 她的工作台：派生理解层，永远不是记忆；用户批准（这条算数）才晋升进显式记忆。
export default function WorkspacePage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const [analyzing, setAnalyzing] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [statusTab, setStatusTab] = useState('active')
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadError('')
    fetchTabCards(statusTab)
      .then((cards) => {
        if (!alive) return
        setItems(cards)
      })
      .catch(() => { if (alive) setLoadError('加载失败，请检查网络后重试') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [reloadTick, statusTab])

  const updateItem = (id, patch) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const handleAnalyze = async () => {
    if (analyzing) return
    setAnalyzing(true)
    setNotice('')
    setActionError('')
    try {
      const result = await derivedService.analyze()
      setNotice(`新增了 ${result?.created ?? 0} 条`)
      setItems(await fetchTabCards(statusTab))
    } catch (requestError) {
      const code = requestError?.response?.data?.code
      if (code === 'CLOUD_NOT_CONSENTED') {
        setActionError('需要先在「我的 → 云端模型」同意')
      } else if (code === 'LLM_UNAVAILABLE') {
        setActionError('云端模型暂时不可用')
      } else {
        setActionError('整理失败，请稍后再试')
      }
    } finally {
      setAnalyzing(false)
    }
  }

  const handleClear = async () => {
    setShowClearConfirm(false)
    if (clearing) return
    setClearing(true)
    setNotice('')
    setActionError('')
    try {
      const result = await derivedService.clear()
      setItems(await fetchTabCards(statusTab))
      setNotice(`已清空 ${result?.cleared ?? 0} 条`)
    } catch {
      setActionError('清空失败，请稍后再试')
    } finally {
      setClearing(false)
    }
  }

  const openEditor = (id) => {
    updateItem(id, { editor: { type: 'semantic', importance: 5, tags: '' }, error: '' })
  }

  const savePromotion = async (id) => {
    const item = items.find((entry) => entry.id === id)
    if (!item?.editor || item.saving) return
    updateItem(id, { saving: true, error: '' })
    try {
      await derivedService.promote(id, {
        type: item.editor.type,
        importance: Number(item.editor.importance),
        tags: parseTags(item.editor.tags),
      })
      updateItem(id, { saving: false, promoted: true, editor: null })
    } catch (requestError) {
      // 保存失败保留条目与编辑区，可修正后重试
      updateItem(id, { saving: false, error: requestError?.response?.data?.error || '保存失败，请重试' })
    }
  }

  const handleDismiss = async (id) => {
    const item = items.find((entry) => entry.id === id)
    if (!item || item.dismissing) return
    updateItem(id, { dismissing: true, error: '' })
    try {
      await derivedService.dismiss(id)
      setItems((current) => current.filter((entry) => entry.id !== id))
    } catch {
      updateItem(id, { dismissing: false, error: '操作失败，请重试' })
    }
  }

  // 关系边：确认后原位变只读（promote → canonical），不算则从列表移除
  const handlePromoteEdge = async (id) => {
    const item = items.find((entry) => entry.id === id)
    if (!item || item.saving) return
    updateItem(id, { saving: true, error: '' })
    try {
      await derivedService.promoteEdge(id)
      updateItem(id, { saving: false, status: 'canonical' })
    } catch (requestError) {
      updateItem(id, { saving: false, error: requestError?.response?.data?.error || '操作失败，请重试' })
    }
  }

  const handleDismissEdge = async (id) => {
    const item = items.find((entry) => entry.id === id)
    if (!item || item.dismissing) return
    updateItem(id, { dismissing: true, error: '' })
    try {
      await derivedService.dismissEdge(id)
      setItems((current) => current.filter((entry) => entry.id !== id))
    } catch {
      updateItem(id, { dismissing: false, error: '操作失败，请重试' })
    }
  }

  const openResolveEditor = (id) => {
    const item = items.find((entry) => entry.id === id)
    if (!item) return
    updateItem(id, { editor: { mode: 'resolve', content: item.content, type: 'semantic', importance: 5, tags: '' }, error: '' })
  }

  const saveResolution = async (id) => {
    const item = items.find((entry) => entry.id === id)
    if (!item?.editor || item.saving) return
    const content = item.editor.content.trim()
    updateItem(id, { saving: true, error: '' })
    try {
      await derivedService.resolve(id, {
        content,
        type: item.editor.type,
        importance: Number(item.editor.importance),
        tags: parseTags(item.editor.tags),
      })
      updateItem(id, { saving: false, resolved: true, resolution: content, editor: null })
    } catch (requestError) {
      // 保存失败保留条目与编辑区，可修正后重试
      updateItem(id, { saving: false, error: requestError?.response?.data?.error || '保存失败，请重试' })
    }
  }

  const handleRebuild = async () => {
    setShowRebuildConfirm(false)
    if (analyzing) return
    setAnalyzing(true)
    setNotice('')
    setActionError('')
    try {
      const result = await derivedService.rebuild()
      setNotice(`已重建：清掉 ${result?.cleared ?? 0} 条，新增 ${result?.created ?? 0} 条`)
      setItems(await fetchTabCards(statusTab))
    } catch (requestError) {
      const code = requestError?.response?.data?.code
      if (code === 'CLOUD_NOT_CONSENTED') {
        setActionError('需要先在「我的 → 云端模型」同意')
      } else if (code === 'LLM_UNAVAILABLE') {
        setActionError('云端模型暂时不可用')
      } else {
        setActionError('重建失败，请稍后再试')
      }
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
      <Header title="她的工作台" showBack />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <p className="px-1 text-xs leading-relaxed text-text-secondary">
          她自己整理的对你的理解，你决定哪些算数。
        </p>

        <div className="flex gap-2">
          <Button className="flex-1" onClick={handleAnalyze} disabled={analyzing}>
            {analyzing ? <Spinner /> : <Sparkles size={15} />}
            {analyzing ? '她正在整理…' : '让她现在整理一下'}
          </Button>
          <Button variant="secondary" onClick={() => setShowRebuildConfirm(true)} disabled={analyzing}>
            <RefreshCw size={15} />
            重建工作台
          </Button>
          <Button variant="secondary" onClick={() => setShowClearConfirm(true)} disabled={clearing}>
            <Trash2 size={15} />
            清空工作台
          </Button>
        </div>

        <div className="flex gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => {
                // items 是页签作用域状态：切签同步失效旧列表，避免按新页签形态渲染旧数据
                if (tab.value === statusTab) return
                setItems([])
                setLoading(true)
                setStatusTab(tab.value)
              }}
              className={`min-h-11 flex-1 rounded-xl text-xs font-semibold ${
                statusTab === tab.value
                  ? 'bg-action-primary text-text-inverse'
                  : 'border border-border-subtle text-text-secondary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {notice && <p role="status" className="text-xs text-status-local">{notice}</p>}
        {actionError && <p role="alert" className="text-xs text-danger">{actionError}</p>}

        {loading ? (
          <p role="status" className="py-8 text-center text-sm text-text-muted">加载中…</p>
        ) : loadError ? (
          <div className="py-8 text-center">
            <p role="alert" className="text-sm text-danger">{loadError}</p>
            <Button variant="secondary" className="mt-3" onClick={() => setReloadTick((tick) => tick + 1)}>重试</Button>
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-muted">
            {statusTab === 'active'
              ? '工作台还是空的。多聊几句，或点上面让她现在整理一下。'
              : statusTab === EDGES_TAB
                ? '还没有她发现的关系，多点上面让她整理'
                : '这一类还是空的。'}
          </p>
        ) : statusTab === EDGES_TAB ? (
          items.map((edge) => (
            <article key={edge.id} className="space-y-3 rounded-card bg-surface-card p-4 shadow-card">
              <p className="text-sm leading-relaxed text-text-primary">
                {edge.from.content} —{RELATION_LABELS[edge.relation] || edge.relation}→ {edge.to.content}
              </p>
              <span className="text-[11px] text-text-muted">
                {CONFIDENCE_LABEL[edge.confidence] || edge.confidence}
              </span>

              {edge.evidence.length > 0 && (
                <details className="text-xs text-text-secondary">
                  <summary className="min-h-11 cursor-pointer select-none py-1">看看依据</summary>
                  <ul className="mt-1 space-y-1 rounded-xl bg-surface-input p-3">
                    {edge.evidence.map((line, index) => <li key={index}>「{line}」</li>)}
                  </ul>
                </details>
              )}

              {edge.status === 'derived' ? (
                <div className="space-y-2">
                  {edge.error && <p role="alert" className="text-xs text-danger">{edge.error}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleDismissEdge(edge.id)}
                      disabled={edge.dismissing}
                      className="min-h-11 flex-1 rounded-xl border border-border-subtle text-sm text-text-secondary disabled:opacity-50"
                    >
                      不算
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePromoteEdge(edge.id)}
                      disabled={edge.saving}
                      className="min-h-11 flex-1 rounded-xl bg-action-primary text-sm font-semibold text-text-inverse hover:bg-action-hover disabled:opacity-50"
                    >
                      确认关系
                    </button>
                  </div>
                </div>
              ) : (
                <p role="status" className="text-xs text-status-local">已定为关系</p>
              )}
            </article>
          ))
        ) : (
          items.map((item) => {
            const kindMeta = KIND_META[item.kind] || { label: item.kind, tone: 'bg-pastel-mist text-status-info' }
            return (
              <article key={item.id} className="space-y-3 rounded-card bg-surface-card p-4 shadow-card">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${kindMeta.tone}`}>
                    {kindMeta.label}
                  </span>
                  <span className="text-[11px] text-text-muted">
                    {CONFIDENCE_LABEL[item.confidence] || item.confidence}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-text-primary">{item.content}</p>

                {item.evidence.length > 0 && (
                  <details className="text-xs text-text-secondary">
                    <summary className="min-h-11 cursor-pointer select-none py-1">看看依据</summary>
                    <ul className="mt-1 space-y-1 rounded-xl bg-surface-input p-3">
                      {item.evidence.map((line, index) => <li key={index}>「{line}」</li>)}
                    </ul>
                  </details>
                )}

                {item.resolved ? (
                  <p role="status" className="text-xs text-status-local">已厘清并记入记忆</p>
                ) : item.status === 'resolved' ? (
                  <div className="space-y-1">
                    <p className="text-xs text-text-muted">定稿：</p>
                    <p className="rounded-xl bg-surface-input p-3 text-sm leading-relaxed text-text-primary">{item.resolution}</p>
                  </div>
                ) : item.promoted || item.status === 'promoted' ? (
                  <p role="status" className="text-xs text-status-local">已记入记忆</p>
                ) : item.status === 'dismissed' ? null : item.editor ? (
                  <div className="space-y-3">
                    {item.editor.mode === 'resolve' && (
                      <div>
                        <label htmlFor={`workspace-content-${item.id}`} className="mb-1 block text-xs text-text-secondary">定稿文案</label>
                        <textarea
                          id={`workspace-content-${item.id}`}
                          rows={3}
                          value={item.editor.content}
                          onChange={(event) => updateItem(item.id, { editor: { ...item.editor, content: event.target.value } })}
                          className="w-full rounded-xl bg-surface-input px-3 py-2 text-sm"
                        />
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor={`workspace-type-${item.id}`} className="mb-1 block text-xs text-text-secondary">类型</label>
                        <select
                          id={`workspace-type-${item.id}`}
                          value={item.editor.type}
                          onChange={(event) => updateItem(item.id, { editor: { ...item.editor, type: event.target.value } })}
                        >
                          {TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label htmlFor={`workspace-importance-${item.id}`} className="mb-1 block text-xs text-text-secondary">重要度（1–10）</label>
                        <input
                          id={`workspace-importance-${item.id}`}
                          type="number"
                          min="1"
                          max="10"
                          value={item.editor.importance}
                          onChange={(event) => updateItem(item.id, { editor: { ...item.editor, importance: Number(event.target.value) } })}
                          className="min-h-11 w-full rounded-xl bg-surface-input px-3 text-sm"
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor={`workspace-tags-${item.id}`} className="mb-1 block text-xs text-text-secondary">标签（逗号分隔）</label>
                      <input
                        id={`workspace-tags-${item.id}`}
                        value={item.editor.tags}
                        onChange={(event) => updateItem(item.id, { editor: { ...item.editor, tags: event.target.value } })}
                        className="min-h-11 w-full rounded-xl bg-surface-input px-3 text-sm"
                      />
                    </div>
                    {item.error && <p role="alert" className="text-xs text-danger">{item.error}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => updateItem(item.id, { editor: null, error: '' })}
                        className="min-h-11 flex-1 rounded-xl border border-border-subtle text-sm text-text-secondary"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => (item.editor.mode === 'resolve' ? saveResolution(item.id) : savePromotion(item.id))}
                        disabled={item.saving || (item.editor.mode === 'resolve' && !item.editor.content.trim())}
                        className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-action-primary text-sm font-semibold text-text-inverse hover:bg-action-hover disabled:opacity-50"
                      >
                        <Save size={15} />
                        {item.saving ? '保存中…' : '保存'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {item.error && <p role="alert" className="text-xs text-danger">{item.error}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleDismiss(item.id)}
                        disabled={item.dismissing}
                        className="min-h-11 flex-1 rounded-xl border border-border-subtle text-sm text-text-secondary disabled:opacity-50"
                      >
                        不算
                      </button>
                      {item.kind === 'conflict' && (
                        <button
                          type="button"
                          onClick={() => openResolveEditor(item.id)}
                          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border-subtle text-sm text-text-secondary"
                        >
                          <Scale size={15} />
                          厘清一下
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditor(item.id)}
                        className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-action-primary text-sm font-semibold text-text-inverse hover:bg-action-hover"
                      >
                        <Save size={15} />
                        这条算数
                      </button>
                    </div>
                  </div>
                )}
              </article>
            )
          })
        )}
      </div>

      <ConfirmDialog
        open={showClearConfirm}
        title="清空工作台"
        description="清空后她整理的这些理解草稿都会被删掉，确定继续吗？"
        confirmLabel="确认清空"
        danger
        onConfirm={handleClear}
        onCancel={() => setShowClearConfirm(false)}
      />

      <ConfirmDialog
        open={showRebuildConfirm}
        title="重建工作台"
        description="会清掉待确认与不算了的草稿，让她基于最近聊天重新整理；已晋升与已厘清的历史保留。确定继续吗？"
        confirmLabel="确认重建"
        danger
        onConfirm={handleRebuild}
        onCancel={() => setShowRebuildConfirm(false)}
      />
    </div>
  )
}
