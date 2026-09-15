import { useSearchParams } from 'react-router-dom'
import Header from '../components/layout/Header'
import TodoPanel from '../components/planner/TodoPanel'
import CountdownPanel from '../components/planner/CountdownPanel'
import RemindersPanel from '../components/planner/RemindersPanel'

const PLANNER_TABS = [
  { value: 'todo', label: '日程' },
  { value: 'countdown', label: '倒数日' },
  { value: 'reminders', label: '提醒' },
]

// 日程与提醒：原日程/倒数日/自定义提醒三页合并，页签与 URL ?tab= 同步
export default function PlannerPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab = PLANNER_TABS.some(tab => tab.value === tabParam) ? tabParam : 'todo'

  const selectTab = (value) => {
    if (value === activeTab) return
    setSearchParams({ tab: value }, { replace: true })
  }

  return (
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
      <Header title="日程与提醒" showBack />

      <div className="flex gap-2 px-4 pt-3" role="group" aria-label="日程与提醒页签">
        {PLANNER_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-pressed={activeTab === tab.value}
            onClick={() => selectTab(tab.value)}
            className={`min-h-11 flex-1 rounded-xl text-xs font-semibold ${
              activeTab === tab.value
                ? 'bg-action-primary text-text-inverse'
                : 'border border-border-subtle text-text-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'todo' && <TodoPanel />}
      {activeTab === 'countdown' && <CountdownPanel />}
      {activeTab === 'reminders' && <RemindersPanel />}
    </div>
  )
}
