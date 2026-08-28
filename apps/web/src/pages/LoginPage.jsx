import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { Smartphone, Lock, ArrowRight, Sparkles } from 'lucide-react'

export default function LoginPage() {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const login = useAuthStore(s => s.login)
  const navigate = useNavigate()

  const handleLogin = () => {
    if (!phone.trim()) { setError('请输入手机号'); return }
    if (!code.trim()) { setError('请输入验证码'); return }
    setError('')
    setLoading(true)
    
    try {
      login(phone, code)
      // 登录成功，跳转到聊天页
      setTimeout(() => {
        navigate('/chat', { replace: true })
      }, 300)
    } catch (err) {
      setError(err.message || '登录失败')
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      {/* 顶部渐变区域 */}
      <div 
        className="relative h-[320px] flex flex-col items-center justify-center px-8 overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #FF6B9D 0%, #B5A6FF 50%, #6B5FC6 100%)' }}
      >
        {/* 装饰性背景元素 */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-10 left-10 w-32 h-32 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-60 h-60 bg-white/5 rounded-full blur-3xl" />
        </div>
        
        {/* Logo */}
        <div className="relative z-10 mb-4">
          <div className="w-24 h-24 rounded-3xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-lg transform hover:scale-105 transition-transform">
            <img 
              src="/design-assets/logo.png" 
              alt="赛博姐妹" 
              className="w-16 h-16 object-contain"
              onError={(e) => {
                // 如果图片加载失败，显示文字备用
                e.target.style.display = 'none'
                e.target.nextSibling.style.display = 'flex'
              }}
            />
            <div className="hidden items-center justify-center">
              <Sparkles className="text-white" size={32} />
            </div>
          </div>
        </div>
        
        {/* 标题 */}
        <h1 className="relative z-10 text-3xl font-bold text-white mb-2 tracking-wide">
          赛博姐妹
        </h1>
        <p className="relative z-10 text-white/90 text-sm font-medium">
          永远站你这边的AI闺蜜
        </p>
      </div>

      {/* 登录表单 */}
      <div className="flex-1 px-8 -mt-10 bg-white rounded-t-[32px] pt-8 relative z-10">
        <div className="space-y-5">
          {/* 手机号输入 */}
          <div className="relative group">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#B0B0C8] group-focus-within:text-[#FF6B9D] transition-colors">
              <Smartphone size={18} />
            </div>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="请输入手机号"
              maxLength={11}
              className="w-full h-13 bg-[#F5F5FA] rounded-2xl pl-12 pr-4 text-sm outline-none focus:ring-2 focus:ring-[#FF6B9D]/30 focus:bg-white transition-all placeholder:text-[#B0B0C8]"
            />
          </div>

          {/* 验证码输入 */}
          <div className="flex gap-3">
            <div className="relative flex-1 group">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#B0B0C8] group-focus-within:text-[#FF6B9D] transition-colors">
                <Lock size={18} />
              </div>
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="验证码"
                maxLength={6}
                className="w-full h-13 bg-[#F5F5FA] rounded-2xl pl-12 pr-4 text-sm outline-none focus:ring-2 focus:ring-[#FF6B9D]/30 focus:bg-white transition-all placeholder:text-[#B0B0C8]"
              />
            </div>
            <button className="h-13 px-5 bg-gradient-to-r from-[#FF6B9D]/10 to-[#B5A6FF]/10 text-[#FF6B9D] text-sm font-semibold rounded-2xl hover:from-[#FF6B9D]/20 hover:to-[#B5A6FF]/20 transition-all whitespace-nowrap active:scale-95">
              获取验证码
            </button>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="flex items-center justify-center gap-2 text-red-500 text-xs animate-fade-in">
              <span className="w-1 h-1 rounded-full bg-red-500" />
              {error}
            </div>
          )}

          {/* 测试提示 */}
          <div className="text-center">
            <span className="inline-block px-3 py-1 bg-[#FF6B9D]/10 text-[#FF6B9D] text-xs rounded-full">
              测试验证码：888888
            </span>
          </div>

          {/* 登录按钮 */}
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full h-13 text-white font-semibold rounded-2xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.98]"
            style={{ 
              background: loading 
                ? '#ccc' 
                : 'linear-gradient(135deg, #FF6B9D 0%, #B5A6FF 100%)' 
            }}
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                登录中...
              </div>
            ) : (
              <>
                开始聊天
                <ArrowRight size={18} className="ml-1" />
              </>
            )}
          </button>
        </div>

        {/* 用户协议 */}
        <p className="mt-8 text-center text-xs text-[#B0B0C8] leading-relaxed">
          登录即表示同意
          <span className="text-[#FF6B9D] cursor-pointer hover:underline">《用户协议》</span>
          和
          <span className="text-[#FF6B9D] cursor-pointer hover:underline">《隐私政策》</span>
        </p>
      </div>
    </div>
  )
}
