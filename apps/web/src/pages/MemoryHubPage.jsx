import { useSearchParams } from 'react-router-dom'
import Header from '../components/layout/Header'
import MemoriesPage from './MemoriesPage'
import MemoryReviewPanel from '../components/memory/MemoryReviewPanel'

const TABS = [{ id: 'saved', label: '已记住' }, { id: 'pending', label: '待确认' }, { id: 'relations', label: '关系' }]

export default function MemoryHubPage() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((item) => item.id === params.get('tab')) ? params.get('tab') : 'saved'
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <Header title="我们的记忆" showBack />
    <nav aria-label="记忆分类" className="grid grid-cols-3 gap-2 px-4 py-3">
      {TABS.map((item) => <button key={item.id} type="button" aria-current={tab === item.id ? 'page' : undefined}
        className={`min-h-11 rounded-xl text-sm ${tab === item.id ? 'bg-action-primary text-text-inverse' : 'border border-border-subtle bg-surface-card text-text-secondary'}`}
        onClick={() => setParams({ tab: item.id })}>{item.label}</button>)}
    </nav>
    {tab === 'saved' ? <MemoriesPage embedded /> : <MemoryReviewPanel key={tab} relations={tab === 'relations'} />}
  </div>
}
