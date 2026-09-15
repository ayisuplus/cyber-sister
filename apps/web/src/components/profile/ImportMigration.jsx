import { useRef, useState } from 'react'
import { FileUp, Upload } from 'lucide-react'
import { migrationService } from '../../services/userService'

// 数据迁移导入：上传自家导出包 JSON。预览绝不落库；应用只落用户逐条勾选的候选（人格、记忆与记忆关系），
// 全部走服务端既有校验。角色扮演已取消，导出包里的旧角色值与外部人设文本都不再导入。
export default function ImportMigration() {
  const [fileName, setFileName] = useState('')
  const [bundle, setBundle] = useState(null)
  const [parseError, setParseError] = useState('')
  const [preview, setPreview] = useState(null)
  const [checked, setChecked] = useState([])
  const [checkedEdges, setCheckedEdges] = useState([])
  const [busy, setBusy] = useState(false)
  const [resultMessage, setResultMessage] = useState('')
  const fileVersion = useRef(0)

  const resetPreview = () => {
    fileVersion.current++
    setPreview(null)
    setChecked([])
    setCheckedEdges([])
  }

  const handleFile = (event) => {
    const file = event.target.files?.[0]
    setParseError('')
    setBundle(null)
    setFileName('')
    resetPreview()
    setResultMessage('')
    if (!file) return
    const request = fileVersion.current
    if (file.size > 10 * 1024 * 1024) {
      setParseError('文件不能超过 10MB')
      return
    }
    // FileReader 而不是 file.text()：jsdom 的 File 没有 .text()，FileReader 全端可用
    const reader = new FileReader()
    reader.onload = () => {
      if (request !== fileVersion.current) return
      try {
        const parsed = JSON.parse(String(reader.result ?? ''))
        setBundle(parsed)
        setFileName(file.name)
      } catch {
        setParseError('这个文件不是有效的 JSON，请选Amie导出的文件')
      }
    }
    reader.onerror = () => { if (request === fileVersion.current) setParseError('文件读取失败，请重试') }
    reader.readAsText(file)
  }

  const handlePreview = async () => {
    if (busy) return
    setBusy(true)
    setResultMessage('')
    try {
      const result = await migrationService.previewImport(bundle)
      setPreview(result)
      setChecked((result.memoryCandidates || []).map((item) => item.state !== 'conflict'))
      setCheckedEdges((result.edges || []).map(() => false))
    } catch (error) {
      setResultMessage(error?.response?.data?.error || '解析失败，请检查内容后重试')
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  const handleApply = async () => {
    if (busy || !preview) return
    setBusy(true)
    setResultMessage('')
    try {
      const selected = (preview.memoryCandidates || []).filter((_, index) => checked[index])
      const payload = preview.format === 'cyber-sister-export-v2' ? {
        memoryBundle: bundle.memoryBundle, selectedIds: selected.map((item) => item.id),
        selectedEdgeIds: (preview.edges || []).filter((edge, index) => checkedEdges[index]
          && selected.some((item) => item.id === edge.from) && selected.some((item) => item.id === edge.to)).map((edge) => edge.id),
      } : { memories: selected }
      payload.expectedMemoryEpoch = preview.memoryEpoch
      if (preview.persona?.ok) payload.persona = preview.persona.id
      const result = await migrationService.applyImport(payload)
      const parts = []
      if (result.personaApplied) parts.push('说话方式')
      if (result.memoriesApplied > 0) parts.push(`${result.memoriesApplied} 条记忆`)
      if (result.edgesApplied > 0) parts.push(`${result.edgesApplied} 条关系`)
      const skipped = result.memoriesSkipped > 0 ? `；${result.memoriesSkipped} 条重复或非法已跳过` : ''
      setResultMessage(`已导入${parts.join('、') || '无新内容'}${skipped}。`)
      resetPreview()
      setBundle(null)
      setFileName('')
    } catch (error) {
      setResultMessage(error?.response?.data?.error || '导入失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const applyDisabled = busy || !preview || (!preview.persona?.ok && !checked.some(Boolean))

  return (
    <div className="mt-3 border-t border-border-hairline pt-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        <Upload size={15} className="text-status-info" />
        导入数据
      </h3>
      <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">把自己的 Amie 导出包带回来。先解析预览，你逐条确认后才真正落库。</p>

      <label className="mt-2.5 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border-subtle px-3 text-xs text-text-secondary">
        <FileUp size={14} aria-hidden="true" />
        {fileName || '选择Amie导出包（.json）'}
        <input type="file" accept="application/json,.json" aria-label="选择导出包文件" className="hidden" disabled={busy} onChange={handleFile} />
      </label>
      {parseError && <p role="alert" className="mt-2 text-xs text-danger">{parseError}</p>}

      <button type="button" disabled={busy || !bundle} onClick={handlePreview} className="mt-2.5 min-h-11 w-full rounded-xl border border-border-subtle text-xs font-semibold text-text-secondary disabled:opacity-50">
        {busy && !preview ? '正在解析…' : '解析预览'}
      </button>

      {preview && (
        <div className="mt-3 rounded-2xl bg-surface-muted p-3">
          {preview.persona && (
            <p className={`text-xs ${preview.persona.ok ? 'text-text-primary' : 'text-danger'}`}>
              说话方式 {preview.persona.id}{preview.persona.ok ? '：可导入' : `：${preview.persona.error}`}
            </p>
          )}
          {preview.memoryCandidates?.length > 0 && (
            <fieldset className="mt-2">
              <legend className="text-xs font-semibold text-text-primary">记忆候选（勾选确认后才落库）</legend>
              <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto">
                {preview.memoryCandidates.map((candidate, index) => (
                  <li key={`${candidate.content}-${index}`}>
                    <label className="flex items-start gap-2 text-xs text-text-secondary">
                      <input
                        type="checkbox"
                        checked={Boolean(checked[index])}
                        disabled={busy || candidate.state === 'conflict'}
                        onChange={(event) => {
                          const next = [...checked]
                          next[index] = event.target.checked
                          setChecked(next)
                        }}
                        className="mt-0.5 h-4 w-4"
                      />
                      <span>{candidate.content}{candidate.revision ? ` · 第 ${candidate.revision} 版` : ''}{candidate.state === 'conflict' ? ' · 已有不同内容，不能覆盖' : candidate.state === 'duplicate' ? ' · 已存在，不会重复创建' : ''}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          {preview.edges?.length > 0 && <fieldset className="mt-3">
            <legend className="text-xs font-semibold text-text-primary">记忆关系（需要同时选择两端记忆）</legend>
            <div className="max-h-48 overflow-y-auto">{preview.edges.map((edge, index) => {
              const fromIndex = preview.memoryCandidates.findIndex((item) => item.id === edge.from)
              const toIndex = preview.memoryCandidates.findIndex((item) => item.id === edge.to)
              return <label key={edge.id} className="flex min-h-11 items-start gap-2 py-2 text-xs text-text-secondary">
                <input type="checkbox" disabled={busy || !checked[fromIndex] || !checked[toIndex]} checked={Boolean(checkedEdges[index] && checked[fromIndex] && checked[toIndex])}
                  onChange={(event) => setCheckedEdges(checkedEdges.map((value, i) => i === index ? event.target.checked : value))} />
                <span>{preview.memoryCandidates[fromIndex]?.content} · {{ related: '相关', similar: '相似', contradicts: '冲突' }[edge.relation]} · {preview.memoryCandidates[toIndex]?.content}{edge.status === 'needs_review' ? '（待重审）' : ''}</span>
              </label>
            })}</div>
          </fieldset>}
          {preview.memoriesSkipped > 0 && (
            <p className="mt-1 text-xs text-text-muted">{preview.memoriesSkipped} 条重复或非法候选已自动跳过</p>
          )}
          {preview.notes?.map((note) => (
            <p key={note} className="mt-1 text-xs text-text-muted">{note}</p>
          ))}

          <button type="button" disabled={applyDisabled} onClick={handleApply} className="mt-3 min-h-11 w-full rounded-xl bg-action-primary text-xs font-semibold text-text-inverse hover:bg-action-hover disabled:opacity-50">
            {busy ? '正在导入…' : '确认导入'}
          </button>
        </div>
      )}

      <p aria-live="polite" className="mt-2 min-h-4 text-center text-xs text-text-secondary">{resultMessage}</p>
    </div>
  )
}
