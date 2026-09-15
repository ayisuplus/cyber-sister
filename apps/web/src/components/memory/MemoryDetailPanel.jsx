import { useCallback, useEffect, useRef, useState } from 'react'
import { memoryService } from '../../services/memoryService'
import ConfirmDialog from '../ui/ConfirmDialog'

const ACTIONS = { baseline: '历史基线', create: '主动记住', edit: '编辑', restore: '恢复版本', promote: '确认理解', resolve: '厘清冲突', import: '导入' }
const TYPES = { semantic: '事实与偏好', episodic: '经历', procedural: '习惯与方法' }

export default function MemoryDetailPanel({ id, onClose, onRestored }) {
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const sequence = useRef(0)
  const load = useCallback(async () => {
    const request = ++sequence.current
    setError('')
    try {
      const [memory, revisions] = await Promise.all([memoryService.get(id), memoryService.revisions(id)])
      if (request === sequence.current) { setData({ memory, revisions }); setSelected(revisions[0]?.revision) }
    } catch (failure) { if (request === sequence.current) setError(failure?.response?.data?.error || '详情读取失败，请重试') }
  }, [id])
  // 这里是请求序号而非 DOM 引用；清理时必须失效当时最新的请求。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setData(null); load(); return () => { sequence.current++ } }, [load])
  const restore = async () => {
    setConfirm(false); setBusy(true); setError('')
    try {
      await memoryService.restore(id, { revision: selected, expectedRevision: data.memory.revision })
      await load(); onRestored()
    } catch (failure) { setError(failure?.response?.data?.error || '恢复失败，现有记忆已保留') }
    finally { setBusy(false) }
  }
  const previous = data?.revisions.find((revision) => revision.revision === selected)
  return <section aria-label="记忆详情" className="space-y-3 rounded-card border border-status-info/30 bg-surface-card p-4">
    <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-text-primary">来源与版本历史</h2><button type="button" className="min-h-11 px-2 text-xs text-text-secondary" onClick={onClose}>关闭详情</button></div>
    {error && <p role="alert" className="text-xs text-danger">{error}<button type="button" className="ml-2 min-h-11 underline" onClick={load}>重新读取</button></p>}
    {!data ? <p role="status" className="text-sm text-text-muted">正在读取详情…</p> : <>
      <div className="space-y-2 text-xs text-text-secondary"><p>当前为第 {data.memory.revision} 版</p>{data.memory.importedAt && <p>你于 {new Date(data.memory.importedAt).toLocaleString()} 确认导入；早期历史为导出包提供的记录。</p>}
        {data.memory.sources?.length ? data.memory.sources.map((source, index) => <blockquote key={index} className="border-l-2 border-border-subtle pl-3">
          <p>{source.type === 'memory' ? '来源记忆' : '来源消息'}{source.revision ? ` · 第 ${source.revision} 版` : ''} · {source.status === 'missing' ? '来源已缺失' : source.status === 'imported' ? '来自导入记录' : '已核对来源'}</p>
          <p className="mt-1 whitespace-pre-wrap">{source.quote}</p>
        </blockquote>) : <p>未记录可追溯来源；这条内容由你主动保存或来自历史基线。</p>}
      </div>
      <label className="block text-xs text-text-secondary" htmlFor="memory-revision">查看历史版本</label>
      <select id="memory-revision" className="min-h-11 w-full rounded-xl bg-surface-input px-3 text-sm text-text-primary" value={selected ?? ''} onChange={(event) => setSelected(Number(event.target.value))}>
        {data.revisions.map((revision) => <option key={revision.revision} value={revision.revision}>第 {revision.revision} 版 · {revision.imported ? '导入的历史 · ' : ''}{ACTIONS[revision.action] || '确认记录'} · {new Date(revision.confirmedAt).toLocaleString()}</option>)}
      </select>
      {previous && <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-surface-muted p-3"><p className="mb-2 text-xs text-text-muted">当前内容</p><p className="whitespace-pre-wrap text-sm text-text-primary">{data.memory.content}</p><p className="mt-2 text-xs text-text-secondary">{TYPES[data.memory.type]} · 重要度 {data.memory.importance} · {(data.memory.tags || []).join('、')}</p></div>
        <div className="rounded-xl bg-pastel-mist p-3"><p className="mb-2 text-xs text-text-muted">选中的第 {previous.revision} 版</p><p className="whitespace-pre-wrap text-sm text-text-primary">{previous.content}</p><p className="mt-2 text-xs text-text-secondary">{TYPES[previous.type]} · 重要度 {previous.importance} · {(previous.tags || []).join('、')}</p></div>
      </div>}
      <button type="button" disabled={busy || !previous || selected === data.memory.revision} className="min-h-11 rounded-xl bg-action-primary px-4 text-xs text-text-inverse disabled:opacity-40" onClick={() => setConfirm(true)}>恢复这个版本</button>
      <p className="text-xs text-text-muted">恢复会生成新版本；内容发生变化时，相关关系需要重新确认。</p>
    </>}
    <ConfirmDialog open={confirm} title="恢复历史版本" description="会把所选内容保存成新版本，当前历史仍会保留。" confirmLabel="确认恢复" onConfirm={restore} onCancel={() => setConfirm(false)} />
  </section>
}
