import { useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight, Lock, ShieldCheck, Smartphone } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import Spinner from '../components/ui/Spinner'
import BrandMark from '../components/ui/BrandMark'
import { LeafSprig } from '../components/chat/Doodles'

const PHONE_PATTERN = /^1[3-9]\d{9}$/
const CODE_PATTERN = /^\d{6}$/
const BACKEND_PENDING = import.meta.env.VITE_BACKEND_PENDING === 'true'

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
    if (BACKEND_PENDING) return
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
      <div className="relative flex min-h-[310px] flex-col items-center justify-center overflow-hidden bg-gradient-pastel px-8 pb-12 pt-8">
        {/* 两枝叶子从卡片边缘探进来，极慢摇曳 */}
        <span aria-hidden="true" className="animate-doodle-float absolute -left-1 bottom-6 text-action-primary opacity-25" style={{ animationDuration: '13s' }}>
          <LeafSprig size={96} />
        </span>
        <span aria-hidden="true" className="animate-doodle-float absolute -right-1 top-5 text-action-primary opacity-20" style={{ animationDuration: '15s', animationDelay: '-6s' }}>
          <LeafSprig size={76} flip />
        </span>

        <div className="relative z-10 mb-5 h-36 w-32 overflow-hidden rounded-[999px_999px_28px_28px] bg-surface-card shadow-soft ring-4 ring-surface-card">
          <img src="/design-assets/hero-login.png" alt="" loading="lazy" className="h-full w-full object-cover saturate-[.85]" onError={event => { event.currentTarget.style.display = 'none' }} />
        </div>

        <BrandMark as="h1" size="lg" className="relative z-10" />
        <p className="relative z-10 mt-3 font-hand text-[15px] tracking-[0.18em] text-text-secondary">像闺蜜一样好好说话</p>
        <span className="relative z-10 mt-4 inline-flex items-center gap-1.5 rounded-full bg-surface-card px-3 py-1.5 text-xs font-medium text-status-info shadow-soft">
          <ShieldCheck size={14} aria-hidden="true" />
          聊天由经批准的云端模型提供，用你的同意才开放
        </span>
      </div>

      <div className="relative z-10 -mt-8 flex-1 rounded-t-[32px] bg-surface-card px-8 pb-8 pt-8 overflow-y-auto">
        <form className="space-y-5" onSubmit={handleLogin}>
          {BACKEND_PENDING && <p role="status" className="text-center text-sm text-text-secondary">聊天后端正在接入，登录暂未开放。安排、手记等功能将通过本地客户端提供。</p>}
          <div className="group relative">
            <Smartphone size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted transition-colors group-focus-within:text-status-info" aria-hidden="true" />
            <input id="phone" aria-label="手机号" autoComplete="tel" type="tel" inputMode="numeric" value={phone} onChange={event => setPhone(digitsOnly(event.target.value).slice(0, 11))} placeholder="请输入 11 位手机号" maxLength={11} className="field-calm min-h-12 w-full rounded-2xl pl-12 pr-4 text-sm text-text-primary placeholder:text-text-muted" />
          </div>

          <div className="group relative">
            <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted transition-colors group-focus-within:text-status-info" aria-hidden="true" />
            <input id="verification-code" aria-label="内测验证码" autoComplete="one-time-code" inputMode="numeric" type="text" ref={codeInputRef} value={code} onChange={event => setCode(digitsOnly(event.target.value).slice(0, 6))} placeholder="6 位数字验证码" maxLength={6} className="field-calm min-h-12 w-full rounded-2xl pl-12 pr-4 text-sm text-text-primary placeholder:text-text-muted" />
          </div>

          {error && <p role="alert" className="text-center text-xs text-danger">{error}</p>}

          <p className="text-center">
            <span className="inline-block rounded-full bg-pastel-blush px-3 py-1 text-xs text-action-primary">请输入内测负责人单独发放的验证码</span>
          </p>

          <button type="submit" disabled={loading || BACKEND_PENDING} className="group flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-action-primary font-semibold text-text-inverse shadow-button transition-[background-color,box-shadow,transform] duration-300 ease-calm hover:bg-action-hover hover:shadow-md focus-visible:ring-2 focus-visible:ring-status-info active:scale-[0.99] disabled:opacity-60">
            {loading ? (
              <>
                <Spinner onDark />
                登录中...
              </>
            ) : (
              <>
                开始聊天
                <ArrowRight size={18} aria-hidden="true" className="transition-transform duration-300 ease-calm group-hover:translate-x-[3px]" />
              </>
            )}
          </button>
        </form>

        <p className="mt-8 text-center text-xs leading-relaxed text-text-muted">仅限已获准的成年白名单测试者使用</p>
      </div>
    </div>
  )
}
