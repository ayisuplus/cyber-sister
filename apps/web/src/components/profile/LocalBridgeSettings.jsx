import { useCallback, useEffect, useState } from 'react'
import { Laptop } from 'lucide-react'
import { bridgeService } from '../../services/bridgeService'
import Card from '../ui/Card'
import ConfirmDialog from '../ui/ConfirmDialog'

const WATCH_INTERVAL_MS = 5000
const formatCode = (code) => `${code.slice(0, 4)}-${code.slice(4)}`
const formatSeen = (iso) => (iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

// 连接你的电脑：用一次性连接码把电脑上的「Amie 本机助手」连进来；连着的时候她才能在授权文件夹里做事。
export default function LocalBridgeSettings() {
  const [bridges, setBridges] = useState(null)
  const [pairing, setPairing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revoking, setRevoking] = useState(null)

  const load = useCallback(async () => {
    try {
      const data = await bridgeService.list()
      setBridges(Array.isArray(data?.bridges) ? data.bridges : [])
      return data?.bridges ?? []
    } catch {
      setError('暂时读不到已连接的电脑，请稍后再试。')
      return null
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 连接码亮着时，隔几秒看一眼电脑连上了没有；过期或连上后停下
  useEffect(() => {
    if (!pairing) return undefined
    const known = new Set((bridges ?? []).map((bridge) => bridge.id))
    const timer = setInterval(async () => {
      if (Date.now() > new Date(pairing.expiresAt).getTime()) { setPairing(null); return }
      const latest = await load()
      if (latest?.some((bridge) => !known.has(bridge.id))) setPairing(null)
    }, WATCH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [pairing, bridges, load])

  const createPairing = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      setPairing(await bridgeService.createPairing())
    } catch (failure) {
      setError(failure?.response?.data?.error || '没生成成功，请重试。')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async () => {
    if (!revoking || busy) return
    setBusy(true)
    setError('')
    try {
      await bridgeService.revoke(revoking.id)
      setRevoking(null)
      await load()
    } catch {
      setError('没断开成功，请重试。')
    } finally {
      setBusy(false)
    }
  }

  const command = pairing ? `amie-bridge pair ${pairing.code} --server ${window.location.origin} --folder "你想让她看的文件夹"` : ''

  return (
    <Card className="overflow-hidden">
      <section aria-labelledby="local-bridge-title" className="p-4">
        <h2 id="local-bridge-title" className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Laptop size={16} className="text-status-info" aria-hidden="true" />
          连接你的电脑
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-text-secondary">
          在电脑上打开「Amie 本机助手」，她就能在你指定的那个文件夹里帮你找文件、读文件、写新文件；不会覆盖、删除，也碰不到文件夹以外的东西。她读到的内容会和聊天一样交给云端模型处理。助手关掉就断开。
        </p>

        {bridges?.length > 0 && (
          <ul aria-label="已连接的电脑" className="mt-3 space-y-2">
            {bridges.map((bridge) => (
              <li key={bridge.id} className="flex items-center gap-3 rounded-control border border-border-subtle px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text-primary">{bridge.name || '我的电脑'}</span>
                  <span className="block text-[11px] text-text-muted">{bridge.online ? '在线' : bridge.lastSeenAt ? `上次在线 ${formatSeen(bridge.lastSeenAt)}` : '没有在线'}</span>
                </span>
                <button type="button" disabled={busy} onClick={() => setRevoking(bridge)} className="min-h-11 px-2 text-xs text-text-secondary disabled:opacity-50">断开</button>
              </li>
            ))}
          </ul>
        )}

        {pairing ? (
          <div role="status" aria-label="连接码" className="mt-3 rounded-control bg-pastel-mist p-3">
            <p className="text-xs text-text-secondary">连接码（10 分钟内有效，只能用一次）</p>
            <p className="mt-1 font-mono text-xl tracking-[0.2em] text-text-primary">{formatCode(pairing.code)}</p>
            <p className="mt-2 text-xs text-text-secondary">在电脑上运行：</p>
            <code className="mt-1 block break-all rounded-control bg-surface-card p-2 text-[11px] text-text-primary">{command}</code>
            <p className="mt-2 text-[11px] text-text-muted">还没有安装包：内测期间需要电脑上装有 Node.js 24，用项目里的 apps/bridge 运行这条命令。连上后这里会自动显示。</p>
          </div>
        ) : (
          <button type="button" disabled={busy || bridges === null} onClick={createPairing} className="mt-3 min-h-11 w-full rounded-xl border border-border-subtle text-xs font-semibold text-text-secondary disabled:opacity-50">
            {busy ? '正在生成…' : '生成连接码'}
          </button>
        )}
        {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      </section>
      <ConfirmDialog
        open={revoking !== null}
        title="断开这台电脑"
        description={revoking ? `「${revoking.name || '我的电脑'}」断开后，她就不能再碰那个文件夹了；想再连要重新生成连接码。` : ''}
        confirmLabel="断开"
        danger
        busy={busy}
        onConfirm={revoke}
        onCancel={() => setRevoking(null)}
      />
    </Card>
  )
}
