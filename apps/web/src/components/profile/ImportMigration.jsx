import { useState } from 'react'
import { FileUp, Upload } from 'lucide-react'
import { migrationService } from '../../services/userService'

// 数据迁移导入（迁移窗口）：上传自家导出包 JSON 或粘贴外部人设文本（豆包/千问智能体）。
// 预览绝不落库；应用只落用户逐条勾选的候选，角色扮演与记忆全部走服务端既有校验与红线闸。
export default function ImportMigration() {
  const [mode, setMode] = useState('bundle') // bundle | persona-text
  const [fileName, setFileName] = useState('')
  const [bundle, setBundle] = useState(null)
  const [parseError, setParseError] = useState('')
  const [roleName, setRoleName] = useState('')
  const [roleSetting, setRoleSetting] = useState('')
  const [preview, setPreview] = useState(null)
  const [checked, setChecked] = useState([])
  const [busy, setBusy] = useState(false)
  const [resultMessage, setResultMessage] = useState('')

  const resetPreview = () => {
    setPreview(null)
    setChecked([])
  }

  const handleFile = (event) => {
    const file = event.target.files?.[0]
    setParseError('')
    setBundle(null)
    setFileName('')
    resetPreview()
    setResultMessage('')
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setParseError('文件不能超过 10MB')
      return
    }
    // FileReader 而不是 file.text()：jsdom 的 File 没有 .text()，FileReader 全端可用
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? ''))
        setBundle(parsed)
        setFileName(file.name)
      } catch {
        setParseError('这个文件不是有效的 JSON，请选赛博姐妹导出的文件')
      }
    }
    reader.onerror = () => setParseError('文件读取失败，请重试')
    reader.readAsText(file)
  }

  const handlePreview = async () => {
    if (busy) return
    setBusy(true)
    setResultMessage('')
    try {
      const payload = mode === 'bundle' ? bundle : { format: 'persona-text', roleName, roleSetting }
      const result = await migrationService.previewImport(payload)
      setPreview(result)
      setChecked((result.memoryCandidates || []).map(() => true))
    } catch (error) {
      setResultMessage(error?.response?.data?.error || '解析失败，请检查内容后重试')
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  const previewReady = mode === 'bundle' ? Boolean(bundle) : Boolean(roleName.trim() && roleSetting.trim())

  const handleApply = async () => {
    if (busy || !preview) return
    setBusy(true)
    setResultMessage('')
    try {
      const selected = (preview.memoryCandidates || []).filter((_, index) => checked[index])
      const payload = { memories: selected }
      if (preview.role?.ok) payload.role = { name: preview.role.name, setting: preview.role.setting }
      if (preview.persona?.ok) payload.persona = preview.persona.id
      const result = await migrationService.applyImport(payload)
      const parts = []
      if (result.roleApplied) parts.push('角色扮演')
      if (result.personaApplied) parts.push('人格')
      if (result.memoriesApplied > 0) parts.push(`${result.memoriesApplied} 条记忆`)
      const skipped = result.memoriesSkipped > 0 ? `；${result.memoriesSkipped} 条重复或非法已跳过` : ''
      setResultMessage(`已导入${parts.join('、') || '无新内容'}${skipped}。`)
      resetPreview()
      setBundle(null)
      setFileName('')
      setRoleName('')
      setRoleSetting('')
    } catch (error) {
      setResultMessage(error?.response?.data?.error || '导入失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const applyDisabled = busy || !preview || (
    !preview.role?.ok && !preview.persona?.ok && !checked.some(Boolean)
  )

  return (
    <div className="mt-3 border-t border-border-hairline pt-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        <Upload size={15} className="text-status-info" />
        导入数据
      </h3>
      <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">从别的平台搬来的姐妹（比如下线的智能体），或自己的导出包。先解析预览，你逐条确认后才真正落库；角色扮演命中恋人红线会被如实拒绝。</p>

      <div role="group" aria-label="导入方式" className="mt-2.5 flex gap-2">
        {[
          { id: 'bundle', label: '上传导出包' },
          { id: 'persona-text', label: '粘贴人设文本' },
        ].map(option => (
          <button
            key={option.id}
            type="button"
            aria-pressed={mode === option.id}
            onClick={() => { setMode(option.id); resetPreview(); setParseError('') }}
            className={`min-h-11 flex-1 rounded-xl text-xs font-semibold ${mode === option.id ? 'bg-action-primary text-text-inverse' : 'border border-border-subtle text-text-secondary'}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {mode === 'bundle' ? (
        <label className="mt-2.5 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border-subtle px-3 text-xs text-text-secondary">
          <FileUp size={14} aria-hidden="true" />
          {fileName || '选择赛博姐妹导出包（.json）'}
          <input type="file" accept="application/json,.json" aria-label="选择导出包文件" className="hidden" onChange={handleFile} />
        </label>
      ) : (
        <div className="mt-2.5 space-y-2">
          <input
            aria-label="角色名"
            value={roleName}
            maxLength={20}
            onChange={event => { setRoleName(event.target.value); resetPreview() }}
            placeholder="角色名，比如：豆包上的「念念」"
            className="w-full rounded-2xl bg-surface-input p-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-status-info"
          />
          <textarea
            aria-label="人设文本"
            value={roleSetting}
            maxLength={200}
            rows={3}
            onChange={event => { setRoleSetting(event.target.value); resetPreview() }}
            placeholder="粘贴对方智能体的人设/角色描述…"
            className="w-full resize-none rounded-2xl bg-surface-input p-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-status-info"
          />
        </div>
      )}
      {parseError && <p role="alert" className="mt-2 text-xs text-danger">{parseError}</p>}

      <button type="button" disabled={busy || !previewReady} onClick={handlePreview} className="mt-2.5 min-h-11 w-full rounded-xl border border-border-subtle text-xs font-semibold text-text-secondary disabled:opacity-50">
        {busy && !preview ? '正在解析…' : '解析预览'}
      </button>

      {preview && (
        <div className="mt-3 rounded-2xl bg-surface-muted p-3">
          {preview.role && (
            <p className={`text-xs ${preview.role.ok ? 'text-text-primary' : 'text-danger'}`}>
              角色扮演「{preview.role.name}」{preview.role.ok ? '：可导入' : `：${preview.role.error}`}
            </p>
          )}
          {preview.persona && (
            <p className={`mt-1 text-xs ${preview.persona.ok ? 'text-text-primary' : 'text-danger'}`}>
              人格 {preview.persona.id}{preview.persona.ok ? '：可导入' : `：${preview.persona.error}`}
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
                        onChange={(event) => {
                          const next = [...checked]
                          next[index] = event.target.checked
                          setChecked(next)
                        }}
                        className="mt-0.5 h-4 w-4"
                      />
                      <span>{candidate.content}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
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
