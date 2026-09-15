import { useId, useState } from 'react'
import { Leaf, Pause, Play } from 'lucide-react'
import { WORKSPACE_GROUPS, WORKSPACE_MEDIA } from '../../features/workspaces'
import AmbientMedia from './AmbientMedia'
import LandscapeDesk from './LandscapeDesk'
import WorkCloudNotice from './WorkCloudNotice'
import { WorkHubActions, WorkHubPicker } from './WorkHubNavigation'
import './work-desktop.css'

export default function WorkDesktop() {
  const [activeId, setActiveId] = useState(WORKSPACE_GROUPS[0].id)
  const [paused, setPaused] = useState(false)
  const [immersiveOpen, setImmersiveOpen] = useState(false)
  const actionsId = useId()
  const headingId = useId()
  const group = WORKSPACE_GROUPS.find(item => item.id === activeId)
  const toggleMotion = () => setPaused(value => !value)

  return (
    <>
      <nav aria-label="功能桌面" className={`work-desktop${paused ? ' is-paused' : ''}`}>
        <section className="rounded-2xl border border-border-hairline bg-surface-card p-4 mb-3">
          <h2 className="text-base font-semibold text-text-primary">和 Amie 一起把事情做成</h2>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">在下方交给我一个任务：拆解计划、起草文案、整理表格，或写成可以下载的文件。</p>
          <p className="mt-2 text-xs text-text-muted">步骤会实时显示，处理中可以随时停止。角色与已确认的偏好会继续陪着你。</p>
        </section>
        <div className="work-desk-hero">
          <AmbientMedia {...WORKSPACE_MEDIA} paused={paused || immersiveOpen} className="work-desk-media" />
          <div className="work-desk-hero-shade" aria-hidden="true" />
          <div className="work-desk-hero-copy">
            <span className="work-desk-eyebrow"><Leaf size={12} aria-hidden="true" /> 她陪你的小日常</span>
            <h2>把今天，慢慢理顺</h2>
            <p>选一处小天地，做好眼前的事。</p>
          </div>
          <button type="button" className="work-motion-toggle" onClick={toggleMotion} aria-label={paused ? '开启动效' : '暂停动效'}>
            {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
          </button>
          <span className="work-desk-landscape-hint">横过来，坐进书桌里</span>
        </div>

        <WorkHubPicker activeId={activeId} onSelect={setActiveId} controlsId={actionsId} />

        <section id={actionsId} aria-labelledby={headingId} className="work-hub-sheet">
          <WorkCloudNotice />
          <div className="work-hub-sheet-heading">
            <div>
              <h3 id={headingId} aria-live="polite">{group.title}</h3>
              <p>{group.description}</p>
            </div>
            <span className="work-hub-count" aria-hidden="true">{String(group.items.length).padStart(2, '0')}</span>
          </div>
          <WorkHubActions key={activeId} group={group} />
          <p className="work-desk-footnote">选择一项功能，预览云端接口流程。</p>
        </section>
      </nav>
      <LandscapeDesk activeId={activeId} onSelect={setActiveId} paused={paused} onToggleMotion={toggleMotion} onOpenChange={setImmersiveOpen} />
    </>
  )
}
