import { useEffect, useState } from 'react'
import { Cpu, LockKeyhole, RefreshCw, Save, Search, Server, ShieldCheck } from 'lucide-react'
import Header from '../components/layout/Header'
import { localModelService } from '../services/localModelService'

const PRESETS = [
  { value: 'host', label: 'Docker 宿主机', hint: '推荐：llama.cpp 运行在部署服务器上' },
  { value: 'development', label: '本机开发', hint: '仅用于非容器开发环境' },
]

const STATE_LABELS = {
  ready: '已就绪',
  loading: '模型加载中',
  unavailable: '暂时不可用',
  not_configured: '尚未连接',
}

const getRequestError = (error) => {
  const code = error.response?.data?.code
  if (code === 'LOCAL_LLM_ORIGIN_NOT_ALLOWED') return '该地址不在安装允许的本地模型范围内'
  if (code === 'LOCAL_LLM_PROBE_FAILED') return '未能连接 llama.cpp，请确认服务已启动并已加载模型'
  if (code === 'LOCAL_LLM_LOADING') return 'llama.cpp 已连接，但模型仍在加载，请稍后重新测试再保存'
  if (code === 'INVALID_LOCAL_LLM_CONFIG') return '请检查地址和模型名称'
  return '操作失败，请检查本地模型服务后重试'
}

export default function LocalModelPage() {
  const [status, setStatus] = useState(null)
  const [isAdmin, setIsAdmin] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [preset, setPreset] = useState('host')
  const [models, setModels] = useState([])
  const [form, setForm] = useState({ enabled: true, baseUrl: '', model: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const nextStatus = await localModelService.getStatus()
        if (active) setStatus(nextStatus)
      } catch {
        if (active) setError('无法读取本地模型状态，请稍后重试')
      }

      try {
        const config = await localModelService.getConfig()
        if (!active) return
        const availableModels = config.model ? [config.model] : []
        setModels(availableModels)
        setForm({
          enabled: config.enabled,
          baseUrl: config.baseUrl || '',
          model: config.model || '',
        })
      } catch (requestError) {
        if (!active) return
        if (requestError.response?.status === 403) {
          setIsAdmin(false)
        } else {
          setError('无法读取本地模型配置，请稍后重试')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => { active = false }
  }, [])

  const applyProbeResult = (result) => {
    const nextModels = result.models || []
    setModels(nextModels)
    setForm(current => ({
      ...current,
      enabled: true,
      baseUrl: result.baseUrl || current.baseUrl,
      model: result.model || nextModels[0] || current.model,
    }))
  }

  const handleDetect = async () => {
    setBusy('detect')
    setError('')
    setMessage('')
    try {
      const result = await localModelService.detect(preset)
      applyProbeResult(result)
      setMessage(result.state === 'loading' ? '已发现 llama.cpp，模型仍在加载，请稍后重新检测' : '已发现 llama.cpp，并自动填写连接信息')
    } catch (requestError) {
      setError(getRequestError(requestError))
    } finally {
      setBusy('')
    }
  }

  const handleTest = async () => {
    if (!form.baseUrl.trim() || !form.model.trim()) {
      setError('请先填写 llama.cpp 地址并选择模型')
      return
    }
    setBusy('test')
    setError('')
    setMessage('')
    try {
      const result = await localModelService.test({
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
      })
      applyProbeResult(result)
      setMessage(result.state === 'loading' ? 'llama.cpp 已连接，模型仍在加载' : '连接测试成功，llama.cpp 已就绪')
    } catch (requestError) {
      setError(getRequestError(requestError))
    } finally {
      setBusy('')
    }
  }

  const handleSave = async (event) => {
    event.preventDefault()
    if (form.enabled && (!form.baseUrl.trim() || !form.model.trim())) {
      setError('启用本地模型前，请填写地址并选择模型')
      return
    }
    setBusy('save')
    setError('')
    setMessage('')
    try {
      const saved = await localModelService.update({
        enabled: form.enabled,
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
      })
      // 保存响应不带运行状态：优先用响应里的 state，否则重新拉取真实状态，不硬编码 ready
      let savedState = saved.state
      if (!savedState) {
        const refreshed = await localModelService.getStatus()
        savedState = refreshed.local?.state
      }
      setStatus(current => ({
        ...(current || {}),
        mode: 'local_first',
        local: { configured: saved.enabled, state: savedState || (saved.enabled ? 'loading' : 'not_configured') },
      }))
      setMessage(saved.enabled ? '本地模型配置已保存并生效' : '本地模型已停用')
    } catch (requestError) {
      setError(getRequestError(requestError))
    } finally {
      setBusy('')
    }
  }

  const localState = status?.local?.state || 'not_configured'

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-surface-page">
      <Header title="本地模型" showBack />
      <main className="flex-1 overflow-y-auto px-4 py-5">
        <section aria-labelledby="local-status-title" className="rounded-3xl bg-pastel-sprout p-5 shadow-card">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-card text-status-local" aria-hidden="true">
              <ShieldCheck size={22} />
            </div>
            <div>
              <h1 id="local-status-title" className="text-base font-semibold text-text-primary">本地优先，云端备用</h1>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">默认先在部署服务器上的 llama.cpp 处理聊天。只有本地失败且你已授权时，才会尝试云端备用模型。</p>
              <span className="mt-3 inline-flex rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-status-local">
                {loading ? '正在读取状态' : STATE_LABELS[localState] || '状态未知'}
              </span>
            </div>
          </div>
        </section>

        <div className="mt-4 rounded-2xl border border-border-subtle bg-pastel-mist px-4 py-3 text-xs leading-relaxed text-text-secondary">
          <strong className="text-text-primary">请注意：</strong>这里检测的是运行赛博姐妹的部署服务器，不是你当前使用的手机或浏览器设备。
        </div>

        {!loading && !isAdmin ? (
          <section aria-labelledby="readonly-title" className="mt-4 rounded-3xl bg-surface-card p-5 shadow-card">
            <div className="flex items-center gap-2 text-status-info">
              <LockKeyhole size={18} aria-hidden="true" />
              <h2 id="readonly-title" className="text-sm font-semibold text-text-primary">只读状态</h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">只有安装管理员可以修改 llama.cpp 连接。当前状态为“{STATE_LABELS[localState] || '状态未知'}”，如需调整请联系安装管理员。</p>
          </section>
        ) : !loading ? (
          <form className="mt-4 space-y-4" onSubmit={handleSave}>
            <section aria-labelledby="detect-title" className="rounded-3xl bg-surface-card p-5 shadow-card">
              <div className="flex items-center gap-2">
                <Search size={18} className="text-status-info" aria-hidden="true" />
                <h2 id="detect-title" className="text-sm font-semibold text-text-primary">自动发现 llama.cpp</h2>
              </div>
              <fieldset className="mt-4 space-y-2">
                <legend className="text-xs font-medium text-text-secondary">运行位置</legend>
                {PRESETS.map(option => (
                  <label key={option.value} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-border-subtle bg-surface-page px-3 py-2">
                    <input type="radio" name="preset" value={option.value} checked={preset === option.value} onChange={() => setPreset(option.value)} className="h-4 w-4 accent-action-primary" />
                    <span>
                      <span className="block text-sm font-medium text-text-primary">{option.label}</span>
                      <span className="block text-[11px] text-text-muted">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <button type="button" disabled={Boolean(busy)} onClick={handleDetect} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-action-primary px-4 text-sm font-semibold text-text-inverse shadow-card disabled:opacity-50">
                {busy === 'detect' ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
                自动发现并填写
              </button>
            </section>

            <section aria-labelledby="connection-title" className="rounded-3xl bg-surface-card p-5 shadow-card">
              <div className="flex items-center gap-2">
                <Server size={18} className="text-status-info" aria-hidden="true" />
                <h2 id="connection-title" className="text-sm font-semibold text-text-primary">连接信息</h2>
              </div>

              <label className="mt-4 block text-xs font-medium text-text-secondary" htmlFor="local-model-url">llama.cpp 地址</label>
              <input id="local-model-url" type="url" value={form.baseUrl} onChange={event => setForm(current => ({ ...current, baseUrl: event.target.value }))} placeholder="http://host.docker.internal:8080/v1" className="mt-2 min-h-11 w-full rounded-2xl border border-border-subtle bg-surface-input px-3 text-sm text-text-primary outline-none focus:border-status-info focus:ring-2 focus:ring-status-info" />

              <label className="mt-4 block text-xs font-medium text-text-secondary" htmlFor="local-model-name">模型</label>
              {models.length > 0 ? (
                <select id="local-model-name" value={form.model} onChange={event => setForm(current => ({ ...current, model: event.target.value }))} className="mt-2 min-h-11 w-full rounded-2xl border border-border-subtle bg-surface-input px-3 text-sm text-text-primary outline-none focus:border-status-info focus:ring-2 focus:ring-status-info">
                  {models.map(model => <option key={model} value={model}>{model}</option>)}
                </select>
              ) : (
                <input id="local-model-name" type="text" value={form.model} onChange={event => setForm(current => ({ ...current, model: event.target.value }))} placeholder="自动发现后填入模型" className="mt-2 min-h-11 w-full rounded-2xl border border-border-subtle bg-surface-input px-3 text-sm text-text-primary outline-none focus:border-status-info focus:ring-2 focus:ring-status-info" />
              )}

              <p className="mt-4 rounded-2xl bg-pastel-apricot px-3 py-2 text-[11px] leading-relaxed text-text-secondary">首版仅连接受控私网或 Docker 内部网络，不在网页中接收或保存 llama.cpp 密钥。</p>

              <label className="mt-4 flex min-h-11 items-center gap-3 rounded-2xl bg-pastel-sprout px-3 text-sm text-text-primary">
                <input type="checkbox" checked={form.enabled} onChange={event => setForm(current => ({ ...current, enabled: event.target.checked }))} className="h-4 w-4 accent-action-primary" />
                启用本地模型优先
              </label>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" disabled={Boolean(busy)} onClick={handleTest} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border-default bg-surface-card text-sm font-semibold text-status-info disabled:opacity-50">
                  <Cpu size={16} />
                  测试连接
                </button>
                <button type="submit" disabled={Boolean(busy)} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-action-primary text-sm font-semibold text-text-inverse shadow-card disabled:opacity-50">
                  <Save size={16} />
                  保存并生效
                </button>
              </div>
            </section>
          </form>
        ) : null}

        <div aria-live="polite" className="min-h-10 px-2 py-3 text-center text-xs">
          {error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-status-local">{message}</p>}
        </div>
      </main>
    </div>
  )
}
