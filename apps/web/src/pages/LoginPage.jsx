import { useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight, Lock, ShieldCheck, Smartphone } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'

const PHONE_PATTERN = /^1[3-9]\d{9}$/
const CODE_PATTERN = /^\d{6}$/

// 防呆：粘贴板里的空格/连字符等一律剔除，只留数字，避免肉眼不可见的字符送检失败。
const digitsOnly = (value) => value.replace(/\D/g, '')

export default function LoginPage() {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const codeInputRef = useRef(null)
  const login = useAuthStore(state => state.login)
  const isLoggedIn = useAuthStore(state => state.isLoggedIn)
  const navigate = useNavigate()

  if (isLoggedIn) return <Navigate to="/chat" replace />

  const handleLogin = async (event) => {
    event.preventDefault()
    // 本地格式校验先行：格式根本不合法的请求不发给服务端，避免白扣锁定计数。
    if (!phone) { setError('请输入手机号'); return }
    if (!PHONE_PATTERN.test(phone)) { setError('手机号是 11 位数字、以 1 开头，再检查一下'); return }
    if (!code) { setError('请输入验证码'); return }
    if (!CODE_PATTERN.test(code)) { setError('验证码是 6 位数字'); return }
    setError('')
    setLoading(true)

    try {
      await login(phone, code)
      navigate('/chat', { replace: true })
    } catch (requestError) {
      const status = requestError.response?.status
      if (status === 401) {
        // 防枚举：凭证被拒保持通用文案，只清验证码并聚焦重试。
        setError('手机号或验证码错误')
        setCode('')
        codeInputRef.current?.focus()
      } else if (status === 429) {
        setError('尝试次数太多啦，已临时锁定，请 30 分钟后再试')
      } else if (status === 400) {
        setError('信息格式不对，请检查后再试')
      } else if (!requestError.response) {
        setError('连不上本地服务器，请确认服务已启动后重试')
      } else {
        setError('登录失败，请稍后重试')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-surface-card">
      <div className="relative flex min-h-[310px] flex-col items-center justify-center overflow-hidden bg-gradient-pastel px-8 py-6">
        <div className="absolute -left-12 top-10 h-40 w-40 rounded-full bg-pastel-blush blur-2xl opacity-70" aria-hidden="true" />
        <div className="absolute -right-10 bottom-3 h-44 w-44 rounded-full bg-pastel-sprout blur-2xl opacity-70" aria-hidden="true" />

        <div className="relative z-10 mb-4 flex h-24 w-24 items-center justify-center rounded-3xl bg-surface-card shadow-card">
          <img src="/design-assets/logo.png" alt="赛博姐妹" className="h-16 w-16 object-contain" onError={event => { event.currentTarget.style.display = 'none' }} />
        </div>
        <img src="/design-assets/hero-login.png" alt="" loading="lazy" className="relative z-10 mb-4 max-h-36 w-auto max-w-full rounded-2xl object-cover" onError={event => { event.currentTarget.style.display = 'none' }} />

        <h1 className="relative z-10 mb-2 text-3xl font-bold tracking-tight text-text-primary">赛博姐妹</h1>
        <p className="relative z-10 text-sm font-medium text-text-secondary">像闺蜜一样好好说话</p>
        <span className="relative z-10 mt-4 inline-flex items-center gap-1.5 rounded-full bg-surface-card px-3 py-1.5 text-xs font-medium text-status-info shadow-card">
          <ShieldCheck size={14} aria-hidden="true" />
          聊天由经批准的云端模型提供，用你的同意才开放
        </span>
      </div>

      <div className="relative z-10 -mt-8 flex-1 rounded-t-[32px] bg-surface-card px-8 pt-8 overflow-y-auto">
        <form className="space-y-5" onSubmit={handleLogin}>
          <div className="group relative">
            <Smartphone size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted transition-colors group-focus-within:text-status-info" aria-hidden="true" />
            <input id="phone" aria-label="手机号" autoComplete="tel" type="tel" inputMode="numeric" value={phone} onChange={event => setPhone(digitsOnly(event.target.value).slice(0, 11))} placeholder="请输入 11 位手机号" maxLength={11} className="min-h-12 w-full rounded-2xl bg-surface-input pl-12 pr-4 text-sm text-text-primary outline-none transition-all placeholder:text-text-muted focus:bg-surface-card focus:ring-2 focus:ring-status-info" />
          </div>

          <div className="group relative">
            <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted transition-colors group-focus-within:text-status-info" aria-hidden="true" />
            <input id="verification-code" aria-label="内测验证码" autoComplete="one-time-code" inputMode="numeric" type="text" ref={codeInputRef} value={code} onChange={event => setCode(digitsOnly(event.target.value).slice(0, 6))} placeholder="6 位数字验证码" maxLength={6} className="min-h-12 w-full rounded-2xl bg-surface-input pl-12 pr-4 text-sm text-text-primary outline-none transition-all placeholder:text-text-muted focus:bg-surface-card focus:ring-2 focus:ring-status-info" />
          </div>

          {error && <p role="alert" className="text-center text-xs text-danger">{error}</p>}

          <p className="text-center">
            <span className="inline-block rounded-full bg-pastel-blush px-3 py-1 text-xs text-action-primary">请输入内测负责人单独发放的验证码</span>
          </p>

          <button type="submit" disabled={loading} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-action-primary font-semibold text-text-inverse transition-colors hover:bg-action-hover focus:ring-2 focus:ring-status-info disabled:opacity-60" style={{ boxShadow: 'var(--cs-shadow-button)' }}>
            {loading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-pastel-blush border-t-surface-card" aria-hidden="true" />
                登录中...
              </>
            ) : (
              <>
                开始聊天
                <ArrowRight size={18} aria-hidden="true" />
              </>
            )}
          </button>
        </form>

        <p className="mt-8 text-center text-xs leading-relaxed text-text-muted">仅限已获准的成年白名单测试者使用</p>
      </div>
    </div>
  )
}
