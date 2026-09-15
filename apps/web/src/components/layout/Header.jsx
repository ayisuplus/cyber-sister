import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import WorkCloudNotice from '../work/WorkCloudNotice'

export default function Header({ title, showBack = false, rightAction = null }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <>
    {/* 二级页面页头与聊天页头同一材质：半透明玻璃 + 细影线 */}
    <div className="glass-bar relative z-10 flex h-14 shrink-0 items-center justify-between px-4">
      <div className="w-10">
        {showBack && (
          <button type="button" aria-label="返回上一页" onClick={() => navigate(-1)} className="flex h-11 w-11 items-center justify-center rounded-full transition-colors duration-300 ease-calm hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-status-info active:scale-95">
            <ChevronLeft size={24} className="text-text-primary" aria-hidden="true" />
          </button>
        )}
      </div>
      <h1 className="display-serif text-lg font-semibold text-text-primary">{title}</h1>
      <div className="w-10 flex justify-end">
        {rightAction}
      </div>
    </div>
    {pathname.startsWith('/tools/') && <WorkCloudNotice />}
    </>
  )
}
