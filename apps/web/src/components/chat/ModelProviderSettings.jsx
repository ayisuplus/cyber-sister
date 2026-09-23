import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Plug, Plus, RefreshCw, Server } from 'lucide-react'
import { modelStatusService } from '../../services/modelStatusService'
import { modelProviderService } from '../../services/modelProviderService'

// 用途与网关的 scene 一一对应（llm-gateway 按 scene 选供应商）
const SCENE_OPTIONS = [
  { value: 'chat', label: '聊天' },
  { value: 'explain', label: '记忆与短评' },
  { value: 'work', label: '工作台' },
]
const EMPTY_FORM = { name: '', baseUrl: '', model: '', scenes: ['chat'], apiKey: '' }

const reasonOf = (error, fallback) => error?.response?.data?.error || fallback

/**
 * 「模型供应商」：只有实例管理员看得见的一张卡片，放在「聊天模型」旁边。
 * 列表 / 新增 / 编辑 / 排序 / 启停 / 试一下 / 删除；key 输入框只写不显示，列表只回 hasKey。
 * 是不是管理员由 /api/llm/status 的 isInstanceAdmin 决定（不是管理员什么都不渲染）。
 */
export default function ModelProviderSettings() {
  const [admin, setAdmin] = useState(null)
  const [providers, setProviders] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [deleteArmed, setDeleteArmed] = useState(null)
  const requestVersion = useRef(0)

  const load = useCallback(async () => {
    const request = ++requestVersion.current
    setBusy(true)
    setError('')
    try {
      const list = await modelProviderService.list()
      if (request === requestVersion.current) setProviders(list)
    } catch (failure_) {
      if (request === requestVersion.current) setError(reasonOf(failure_, '供应商列表没读出来，请重试。'))
    } finally {
      if (request === requestVersion.current) setBusy(false)
    }
  }, [])

  // 拿不到管理员身份就整张卡片不出现：这里静默返回 false，不额外报错
  useEffect(() => {
    let active = true
    modelStatusService.getStatus()
      .then((status) => { if (active) setAdmin(status?.isInstanceAdmin === true) })
      .catch(() => { if (active) setAdmin(false) })
    return () => { active = false; requestVersion.current += 1 }
  }, [])

  useEffect(() => { if (admin === true) load() }, [admin, load])

  // 一次只做一件事（保存 / 启停 / 排序 / 删除 / 试一下），避免并发改动互相覆盖
  const run = async (action, fallback, done) => {
    if (busy) return false
    const request = ++requestVersion.current
    setBusy(true)
    setError('')
    setNote('')
    try {
      const result = await action()
      // done 里通常会刷新列表（会推进 requestVersion），所以 warning 放在它之后单独写，
      // 且这一次写入不再看版本：busy 期间用户点不了别的，不存在更晚的写入被覆盖。
      if (request === requestVersion.current && done) await done(result)
      if (result?.warning) setNote(result.warning)
      return true
    } catch (failure_) {
      if (request === requestVersion.current) setError(reasonOf(failure_, fallback))
      return false
    } finally {
      if (request === requestVersion.current) setBusy(false)
    }
  }

  const save = async () => {
    if (!form) return
    const scenes = form.scenes.length > 0 ? form.scenes : ['chat']
    const fields = { name: form.name, baseUrl: form.baseUrl, model: form.model, scenes }
    // 编辑时留空就是「不改密钥」；新增时留空表示这家不需要密钥（自建端点常常不需要）
    if (form.apiKey) fields.apiKey = form.apiKey
    setDeleteArmed(null)
    await run(
      () => (form.id ? modelProviderService.update(form.id, fields) : modelProviderService.create(fields)),
      '没保存成功，请检查显示名、接口地址（须 https）、模型名和密钥。',
      async () => {
        setForm(null)
        setNote('保存好了。新的配置立刻生效，不用重启。')
        await load()
      },
    )
  }

  const toggleEnabled = provider => run(
    () => modelProviderService.update(provider.id, { enabled: !provider.enabled }),
    '没切成功，请重试。',
    async () => {
      setNote(provider.enabled ? `已经停用「${provider.name}」。` : `已经启用「${provider.name}」。`)
      await load()
    },
  )

  const move = (index, delta) => {
    const target = index + delta
    if (!providers || target < 0 || target >= providers.length) return
    const ordered = [...providers]
    const [moved] = ordered.splice(index, 1)
    ordered.splice(target, 0, moved)
    return run(
      () => modelProviderService.reorder(ordered.map(provider => provider.id)),
      '没排成功，请重试。',
      async () => { setNote(`「${moved.name}」现在排第 ${target + 1} 位。`); await load() },
    )
  }

  const remove = provider => {
    if (deleteArmed !== provider.id) {
      setDeleteArmed(provider.id)
      setNote('')
      setError('')
      return undefined
    }
    setDeleteArmed(null)
    return run(
      () => modelProviderService.remove(provider.id),
      '没删掉，请重试。',
      async () => { setNote(`「${provider.name}」删掉了。`); await load() },
    )
  }

  const tryProvider = provider => run(
    () => modelProviderService.test(provider.id),
    '试一下没通，请核对地址、模型名和密钥。',
    (result) => setNote(`「${provider.name}」通了：${result.model}，用时 ${result.latencyMs} 毫秒${result.reply ? `，它回了一句「${result.reply}」` : ''}。`),
  )

  if (admin !== true) return null

  const editing = field => event => setForm(previous => ({ ...previous, [field]: event.target.value }))
  const toggleScene = value => () => setForm(previous => ({
    ...previous,
    scenes: previous.scenes.includes(value)
      ? previous.scenes.filter(scene => scene !== value)
      : [...previous.scenes, value],
  }))

  return (
    <section aria-labelledby="model-providers-title" className="overflow-hidden rounded-card border border-border-hairline bg-surface-card shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <h2 id="model-providers-title" className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Server size={17} className="text-status-info" aria-hidden="true" />模型供应商</h2>
        <button type="button" disabled={busy} onClick={load} className="flex min-h-11 items-center gap-1.5 text-xs text-action-primary disabled:opacity-50"><RefreshCw size={14} aria-hidden="true" />刷新列表</button>
      </div>
      <div className="space-y-4 p-4">
        <p className="text-xs leading-relaxed text-text-secondary">
          在这里配置聊天用哪几家的模型（只要支持 OpenAI 兼容接口就行）。配了多家就按下面的顺序依次尝试：前一家不通，自动换下一家。密钥加密存在服务器上，保存后不会再显示，列表里只显示「已保存」。
        </p>

        {providers && providers.length === 0 && !form && (
          <p className="text-xs text-text-muted">还没有配置供应商。没有配置时，服务器会用原来的环境变量槽。</p>
        )}

        {providers && providers.length > 0 && (
          <ul className="space-y-2">
            {providers.map((provider, index) => (
              <li key={provider.id} className="rounded-control border border-border-subtle px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text-primary">{provider.name}</p>
                    <p className="mt-0.5 truncate text-xs text-text-muted">{provider.model} · {provider.baseUrl}</p>
                    <p className="mt-1 text-[11px] text-text-muted">
                      第 {index + 1} 位 · {provider.scenes.map(scene => SCENE_OPTIONS.find(option => option.value === scene)?.label || scene).join('、')} · {provider.hasKey ? '密钥已保存' : '没有密钥'}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={provider.enabled}
                    aria-label={`启用：${provider.name}`}
                    disabled={busy}
                    onClick={() => toggleEnabled(provider)}
                    className={`min-h-11 shrink-0 rounded-control border px-3 text-xs font-semibold disabled:opacity-50 ${provider.enabled ? 'border-action-primary text-action-primary' : 'border-border-default text-text-muted'}`}
                  >
                    {provider.enabled ? '已启用' : '已停用'}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={`上移：${provider.name}`} className="flex min-h-11 items-center gap-1 rounded-control border border-border-subtle px-3 text-xs text-text-secondary disabled:opacity-40"><ArrowUp size={14} aria-hidden="true" />上移</button>
                  <button type="button" disabled={busy || index === providers.length - 1} onClick={() => move(index, 1)} aria-label={`下移：${provider.name}`} className="flex min-h-11 items-center gap-1 rounded-control border border-border-subtle px-3 text-xs text-text-secondary disabled:opacity-40"><ArrowDown size={14} aria-hidden="true" />下移</button>
                  <button type="button" disabled={busy} aria-label={`编辑：${provider.name}`} onClick={() => { setForm({ id: provider.id, name: provider.name, baseUrl: provider.baseUrl, model: provider.model, scenes: provider.scenes, apiKey: '' }); setNote(''); setError(''); setDeleteArmed(null) }} className="min-h-11 rounded-control border border-border-subtle px-3 text-xs font-semibold text-text-secondary disabled:opacity-50">编辑</button>
                  <button type="button" disabled={busy} aria-label={`试一下：${provider.name}`} onClick={() => tryProvider(provider)} className="flex min-h-11 items-center gap-1 rounded-control border border-border-subtle px-3 text-xs font-semibold text-text-secondary disabled:opacity-50"><Plug size={14} aria-hidden="true" />试一下</button>
                  <button type="button" disabled={busy} aria-label={deleteArmed === provider.id ? `确认删除：${provider.name}` : `删除：${provider.name}`} onClick={() => remove(provider)} className="min-h-11 rounded-control border border-border-subtle px-3 text-xs font-semibold text-danger disabled:opacity-50">{deleteArmed === provider.id ? '确认删除' : '删除'}</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {form ? (
          <form
            aria-label={form.id ? '编辑供应商' : '新增供应商'}
            onSubmit={event => { event.preventDefault(); save() }}
            className="space-y-3 rounded-control border border-border-subtle p-3"
          >
            <div>
              <label htmlFor="provider-name" className="text-xs text-text-secondary">显示名</label>
              <input id="provider-name" value={form.name} onChange={editing('name')} maxLength={40} required className="mt-1 min-h-11 w-full rounded-control border border-border-default bg-surface-card px-3 text-sm text-text-primary" />
            </div>
            <div>
              <label htmlFor="provider-base-url" className="text-xs text-text-secondary">接口地址（OpenAI 兼容，须 https）</label>
              <input id="provider-base-url" value={form.baseUrl} onChange={editing('baseUrl')} required placeholder="https://api.example.com/v1" className="mt-1 min-h-11 w-full rounded-control border border-border-default bg-surface-card px-3 text-sm text-text-primary" />
            </div>
            <div>
              <label htmlFor="provider-model" className="text-xs text-text-secondary">模型名</label>
              <input id="provider-model" value={form.model} onChange={editing('model')} required maxLength={120} className="mt-1 min-h-11 w-full rounded-control border border-border-default bg-surface-card px-3 text-sm text-text-primary" />
            </div>
            <fieldset>
              <legend className="text-xs text-text-secondary">用在哪</legend>
              <div className="mt-1 flex flex-wrap gap-3">
                {SCENE_OPTIONS.map(option => (
                  <label key={option.value} className="flex min-h-11 items-center gap-2 text-xs text-text-secondary">
                    <input type="checkbox" checked={form.scenes.includes(option.value)} onChange={toggleScene(option.value)} className="h-4 w-4 accent-action-primary" />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label htmlFor="provider-api-key" className="text-xs text-text-secondary">密钥</label>
              <input id="provider-api-key" type="password" autoComplete="new-password" value={form.apiKey} onChange={editing('apiKey')} placeholder={form.id ? '留空就是不换密钥' : '这家不需要密钥就留空'} className="mt-1 min-h-11 w-full rounded-control border border-border-default bg-surface-card px-3 text-sm text-text-primary" />
              <p className="mt-1 text-[11px] text-text-muted">只写不显示：保存后连你我也看不到，只能重新填一次覆盖它。</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={busy} className="min-h-11 rounded-control bg-action-primary px-4 text-xs font-semibold text-text-inverse hover:bg-action-hover disabled:opacity-50">保存</button>
              <button type="button" disabled={busy} onClick={() => { setForm(null); setError('') }} className="min-h-11 rounded-control border border-border-subtle px-4 text-xs font-semibold text-text-secondary disabled:opacity-50">取消</button>
            </div>
          </form>
        ) : (
          <button type="button" disabled={busy} onClick={() => { setForm({ ...EMPTY_FORM, scenes: ['chat'] }); setNote(''); setError('') }} className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-control border border-border-subtle text-xs font-semibold text-text-secondary disabled:opacity-50"><Plus size={14} aria-hidden="true" />新增供应商</button>
        )}

        <p className="text-xs text-text-muted">「试一下」会真的发一次最小请求（只让它回一个字），会产生一点点费用。</p>
        {note && <p role="status" className="text-xs text-text-secondary">{note}</p>}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </section>
  )
}
