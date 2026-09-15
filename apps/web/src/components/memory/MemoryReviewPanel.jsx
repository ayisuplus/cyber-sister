import { useCallback, useEffect, useRef, useState } from 'react'
import { derivedService } from '../../services/derivedService'
import ConfirmDialog from '../ui/ConfirmDialog'

const RELATIONS = { related: '相关', similar: '相似', contradicts: '冲突' }
const KINDS = { hypothesis: '推测', pattern: '模式', conflict: '冲突', summary: '小结' }
const button = 'min-h-11 rounded-xl border border-border-subtle px-3 text-xs text-text-primary disabled:opacity-40'
const evidence = (item) => {
  if (item.sources?.length) return item.sources.map((source) => source.quote)
  try { return Array.isArray(item.evidence) ? item.evidence : JSON.parse(item.evidence || '[]') } catch { return [] }
}

export default function MemoryReviewPanel({ relations = false }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [editor, setEditor] = useState(null)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const sequence = useRef(0)
  const load = useCallback(async () => {
    const request = ++sequence.current
    setLoading(true)
    try {
      const data = relations ? await derivedService.listEdges('all') : await derivedService.list('all')
      if (request === sequence.current) setItems(relations ? (data.edges || []).filter((item) => item.status !== 'dismissed')
        : (data.insights || []).filter((item) => ['active', 'needs_review'].includes(item.status)))
    } catch { if (request === sequence.current) setError('加载失败，请重试') }
    finally { if (request === sequence.current) setLoading(false) }
  }, [relations])
  // 这里是请求序号而非 DOM 引用；清理时必须失效当时最新的请求。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); return () => { sequence.current++ } }, [load])

  const act = async (operation, message) => {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await operation(); setNotice(message); setEditor(null); await load() }
    catch (failure) { setError(failure?.response?.data?.error || '操作失败，当前内容已保留，请重试') }
    finally { setBusy(false) }
  }
  const preview = async (rebuild = false) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const result = await (rebuild ? derivedService.rebuild() : derivedService.analyze())
      setNotice(result.preview?.content || '整理结果已更新')
    } catch (failure) { setError(failure?.response?.data?.error || '预览失败，请重试') }
    finally { setBusy(false) }
  }
  const confirm = (item) => {
    if (relations) return act(() => derivedService.promoteEdge(item.id, {
      expectedRevision: item.revision, expectedFromRevision: item.from.revision, expectedToRevision: item.to.revision,
    }), '关系已确认，可以参与聊天联想。')
    const asManual = Boolean(!item.sources?.length || item.status === 'needs_review' || editor?.manual)
    const payload = { expectedRevision: item.revision, type: 'semantic', content: editor?.content, asManual }
    return act(() => item.kind === 'conflict' && !asManual ? derivedService.resolve(item.id, payload)
      : derivedService.promote(item.id, payload), '已经记住，确认记录可在记忆详情中查看。')
  }
  const filtered = items.filter((item) => (!status || item.status === status)
    && (relations ? item.from.content + item.to.content : item.content).toLowerCase().includes(query.trim().toLowerCase()))
  const lastPage = Math.max(1, Math.ceil(filtered.length / 20))
  const currentPage = Math.min(page, lastPage)
  const visible = filtered.slice((currentPage - 1) * 20, currentPage * 20)

  return <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6">
    <p className="text-xs leading-relaxed text-text-secondary">{relations ? '只有已确认且依据仍有效的关系会参与聊天。记忆改变后，相关关系需要重新核对。'
      : '这里是待核对的理解，确认前不会参与聊天。云端整理目前仅提供模拟预览。'}</p>
    {!relations && <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy} onClick={() => preview()}>预览整理</button>
      <button type="button" className={button} disabled={busy} onClick={() => preview(true)}>预览重建</button>
      <button type="button" className={button} disabled={busy || !items.length} onClick={() => setClearConfirm(true)}>清空待确认草稿</button>
    </div>}
    {notice && <p role="status" className="rounded-xl bg-pastel-mist p-3 text-xs leading-relaxed text-text-primary">{notice}</p>}
    <div className="grid gap-2 sm:grid-cols-2">
      <input type="search" aria-label={relations ? '搜索关系' : '搜索待确认内容'} placeholder="搜索内容" value={query} className="min-h-11 rounded-xl bg-surface-input px-3 text-sm text-text-primary" onChange={(event) => { setQuery(event.target.value); setPage(1) }} />
      <select aria-label="筛选确认状态" value={status} className="min-h-11 rounded-xl bg-surface-input px-3 text-sm text-text-primary" onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
        <option value="">全部状态</option><option value={relations ? 'derived' : 'active'}>待确认</option><option value="needs_review">待重审</option>{relations && <option value="canonical">已确认</option>}
      </select>
    </div>
    {error && <p role="alert" className="text-sm text-danger">{error}<button type="button" className={`${button} ml-2`} onClick={load}>重新读取</button></p>}
    {loading ? <p role="status" className="py-8 text-center text-sm text-text-muted">加载中…</p> : !filtered.length ? <p className="py-8 text-center text-sm text-text-muted">{query || status ? '没有匹配的内容' : relations ? '还没有记忆关系' : '暂时没有待确认的理解'}</p> : visible.map((item) => <article key={item.id} className="space-y-3 rounded-card border border-border-subtle bg-surface-card p-4">
      <p className="text-xs text-status-info">{relations ? RELATIONS[item.relation] : KINDS[item.kind]} · {item.status === 'needs_review' ? '依据已变化，待重审' : item.status === 'canonical' ? '已确认' : '待确认'}</p>
      {relations ? <div className="space-y-2 text-sm text-text-primary"><p>{item.from.content}</p><p className="text-xs text-text-muted">{RELATIONS[item.relation]}</p><p>{item.to.content}</p>
        {item.status === 'needs_review' && <p className="text-xs text-text-secondary">依据版本：v{item.fromRevision} / v{item.toRevision}；当前版本：v{item.from.revision} / v{item.to.revision}。请核对两端内容后重新确认。</p>}
      </div>
        : <p className="whitespace-pre-wrap text-sm text-text-primary">{item.content}</p>}
      {!relations && <details className="text-xs text-text-secondary"><summary className="min-h-11 cursor-pointer">查看依据</summary>
        {evidence(item).map((quote, index) => <p key={index} className="mt-2 whitespace-pre-wrap">{quote}</p>)}
        {!item.sources?.length && <p>这条历史草稿没有可验证的来源；请编辑核对后，以你自己的确认保存。</p>}
      </details>}
      {relations && <details className="text-xs text-text-secondary"><summary className="min-h-11 cursor-pointer">查看关系依据与确认记录</summary>
        {evidence(item).map((source, index) => <p key={index} className="mb-2 whitespace-pre-wrap">{typeof source === 'string' ? '历史片段：' + source : `${source.status === 'missing' ? '来源已缺失' : source.revision ? `依据第 ${source.revision} 版` : '来源片段'}：${source.quote}`}</p>)}
        {item.decisions?.length ? item.decisions.map((decision, index) => <p key={index}>{decision.imported ? '导入的历史 · ' : ''}{decision.action === 'dismiss' ? '移除关系' : decision.action === 'import' ? '确认导入' : '确认关系'} · {new Date(decision.at).toLocaleString()} · 依据 v{decision.fromRevision} / v{decision.toRevision}</p>) : <p>没有可追溯的确认记录。</p>}
      </details>}
      {editor?.id === item.id && <div className="space-y-2">
        <label className="block text-xs text-text-secondary" htmlFor="review-content">核对后的记忆内容</label>
        <textarea id="review-content" className="w-full rounded-xl bg-surface-input p-3 text-sm text-text-primary" rows={3} maxLength={2000} value={editor.content} onChange={(event) => setEditor({ ...editor, content: event.target.value })} />
        <button type="button" disabled={busy || !editor.content.trim()} className={button} onClick={() => confirm(item)}>确认并记住</button>
        <button type="button" disabled={busy} className={`${button} ml-2`} onClick={() => setEditor(null)}>取消编辑</button>
      </div>}
      <div className="flex flex-wrap gap-2">
        {relations && item.status !== 'canonical' && <button type="button" disabled={busy} className={button} onClick={() => confirm(item)}>{item.status === 'needs_review' ? '重新确认关系' : '确认关系'}</button>}
        {!relations && !editor && item.status === 'active' && item.kind !== 'conflict' && !!item.sources?.length && <button type="button" disabled={busy} className={button} onClick={() => confirm(item)}>确认这条理解</button>}
        {!relations && !editor && <button type="button" disabled={busy} className={button} onClick={() => setEditor({ id: item.id, content: item.content, manual: item.kind !== 'conflict' })}>编辑核对后记住</button>}
        <button type="button" disabled={busy} className={button} onClick={() => act(() => relations ? derivedService.dismissEdge(item.id) : derivedService.dismiss(item.id), relations ? '关系已移除' : '草稿已忽略')}>{relations ? '移除关系' : '忽略这条'}</button>
      </div>
    </article>)}
    {lastPage > 1 && <nav aria-label="待确认与关系分页" className="flex items-center justify-between text-xs text-text-secondary"><button type="button" className={button} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</button><span>第 {currentPage} / {lastPage} 页</span><button type="button" className={button} disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>下一页</button></nav>}
    <ConfirmDialog open={clearConfirm} title="清空待确认草稿" description="只清除未确认或已忽略的草稿，已记住的内容和确认历史会保留。" confirmLabel="确认清空" danger onCancel={() => setClearConfirm(false)} onConfirm={() => { setClearConfirm(false); act(() => derivedService.clear(), '待确认草稿已清空') }} />
  </div>
}
