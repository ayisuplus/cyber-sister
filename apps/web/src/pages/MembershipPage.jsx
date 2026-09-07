import { useAuthStore } from '../stores/authStore'
import Header from '../components/layout/Header'
import Card from '../components/ui/Card'
import { Crown, Check, Shield, Sparkles } from 'lucide-react'

const FREE_FEATURES = [
  '正常聊天',
  '3种基础工具',
  '记忆保留7天',
  '每天主动提醒1次',
  '2种免费人格',
  '有广告',
]

const VIP_FEATURES = [
  '正常聊天',
  '全部工具解锁',
  '永久记忆',
  '主动提醒每天1条（可自定义）',
  '全部人格随便切换',
  '无广告',
  '优先响应',
]

// 会员体系暂未上线：本页只做静态展示，不提供任何支付或伪交互入口
export default function MembershipPage() {
  const user = useAuthStore(s => s.user)

  return (
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
      <Header title="升级会员" showBack />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* 标题区 */}
        <div className="text-center py-4">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-gradient-pink-purple flex items-center justify-center">
            <Crown size={32} className="text-text-inverse" />
          </div>
          <h2 className="text-xl font-bold text-text-primary">成为VIP会员</h2>
          <p className="text-sm text-text-secondary mt-1">解锁全部功能，享受更好的陪伴体验</p>
        </div>

        {/* 免费版 */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield size={18} className="text-text-muted" />
            <h3 className="text-sm font-semibold text-text-primary">免费版</h3>
          </div>
          <ul className="space-y-2">
            {FREE_FEATURES.map(f => (
              <li key={f} className="flex items-center gap-2 text-sm text-text-secondary">
                <Check size={14} className="text-text-muted" />
                {f}
              </li>
            ))}
          </ul>
        </Card>

        {/* 会员版 */}
        <Card className="p-5 border-2 border-brand-pink relative overflow-hidden">
          <div className="absolute top-3 right-3">
            <span className="text-[10px] px-2 py-0.5 bg-brand-pink text-text-inverse rounded-full">推荐</span>
          </div>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={18} className="text-brand-pink" />
            <h3 className="text-sm font-semibold text-text-primary">VIP会员</h3>
          </div>
          <ul className="space-y-2 mb-4">
            {VIP_FEATURES.map(f => (
              <li key={f} className="flex items-center gap-2 text-sm text-text-primary">
                <Check size={14} className="text-brand-pink" />
                {f}
              </li>
            ))}
          </ul>

          {/* 套餐展示（静态，不可选） */}
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 rounded-xl border-2 border-border-subtle">
              <p className="text-lg font-bold text-brand-pink">¥18<span className="text-xs font-normal">/月</span></p>
              <p className="text-xs text-text-muted">按月付费</p>
            </div>
            <div className="p-3 rounded-xl border-2 border-border-subtle relative">
              <span className="absolute -top-1 -right-1 text-[9px] px-1.5 py-0.5 bg-brand-yellow text-text-inverse rounded-full">省2个月</span>
              <p className="text-lg font-bold text-brand-pink">¥128<span className="text-xs font-normal">/年</span></p>
              <p className="text-xs text-text-muted">约¥10.7/月</p>
            </div>
          </div>
        </Card>

        {/* 提示 */}
        <p className="text-center text-xs text-text-muted">
          所有付费明码标价，无情感绑定，无抽卡盲盒
        </p>
      </div>

      {/* 底部状态区 */}
      <div className="px-4 py-3 bg-surface-card shadow-input">
        {user?.isVip ? (
          <div className="w-full h-12 bg-brand-green/10 text-brand-green font-semibold rounded-[23px] flex items-center justify-center gap-2">
            <Crown size={18} />
            您已是VIP会员
          </div>
        ) : (
          <p className="py-3 text-center text-xs text-text-muted">
            内测期间全部功能免费开放，会员体系暂未上线
          </p>
        )}
      </div>
    </div>
  )
}
