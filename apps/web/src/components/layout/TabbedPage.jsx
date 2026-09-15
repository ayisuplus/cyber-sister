import { useSearchParams } from 'react-router-dom'
import Header from './Header'

// 领域组合页：一个页头 + 一排页签，页签与 URL ?tab= 同步；各页签渲染以 embedded 方式嵌入的原页面。
/** @param {{ title: string, label: string, tabs: { id: string, label: string, render: () => import('react').ReactNode }[] }} props */
export default function TabbedPage({ title, label, tabs }) {
  const [params, setParams] = useSearchParams()
  const active = tabs.find(tab => tab.id === params.get('tab')) || tabs[0]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header title={title} showBack />
      <nav aria-label={label} className="flex shrink-0 gap-2 px-4 pt-3">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            aria-current={tab.id === active.id ? 'page' : undefined}
            onClick={() => setParams({ tab: tab.id }, { replace: true })}
            className={`min-h-11 flex-1 rounded-full text-sm transition-colors duration-300 ease-calm ${tab.id === active.id ? 'bg-action-primary text-text-inverse' : 'border border-border-subtle bg-surface-card text-text-secondary hover:bg-surface-muted'}`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {active.render()}
    </div>
  )
}
