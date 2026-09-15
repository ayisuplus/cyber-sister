import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { WORKSPACE_GROUPS } from '../../features/workspaces'

function WorkHubIllustration({ group }) {
  const [failed, setFailed] = useState(false)
  const Icon = group.icon
  return (
    <span className="work-hub-illustration" aria-hidden="true">
      {failed ? <Icon className="work-hub-fallback" size={30} /> : <img src={group.illustration} alt="" width="128" height="128" onError={() => setFailed(true)} />}
    </span>
  )
}

export function WorkHubPicker({ activeId, onSelect, controlsId, compact = false }) {
  return (
    <div className={`work-hub-picker${compact ? ' work-hub-picker--compact' : ''}`} role="group" aria-label="选择工作主题">
      {WORKSPACE_GROUPS.map(group => {
        return (
          <button
            key={group.id}
            type="button"
            className="work-hub-choice"
            aria-pressed={activeId === group.id}
            aria-controls={controlsId}
            onClick={() => onSelect(group.id)}
          >
            <WorkHubIllustration group={group} />
            <span className="work-hub-label">{group.title}</span>
            <span className="work-hub-marker" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}

export function WorkHubActions({ group, onNavigate = undefined, compact = false }) {
  return (
    <div className={`work-hub-actions${compact ? ' work-hub-actions--compact' : ''}`}>
      {group.items.map((tool, index) => {
        const Icon = tool.icon
        return (
          <Link key={tool.id} to={tool.to} onClick={onNavigate} className="work-hub-action" style={{ animationDelay: `${index * 45}ms` }}>
            <span className={`work-hub-action-icon ${tool.tone}`} aria-hidden="true"><Icon size={21} /></span>
            <span className="work-hub-action-copy">
              <span className="work-hub-action-title">{tool.title}</span>
              {!compact && <span className="work-hub-action-description">{tool.description}</span>}
              {!compact && tool.privacyNote && <span className="work-hub-privacy">{tool.privacyNote}</span>}
            </span>
            <ChevronRight size={16} aria-hidden="true" className="work-hub-arrow" />
          </Link>
        )
      })}
    </div>
  )
}
