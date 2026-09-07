import { useState } from 'react'
import Header from '../layout/Header'
import TabBar from '../layout/TabBar'
import PhotoIntake from './PhotoIntake'
import ItemPicker from './ItemPicker'
import GeneratePanel from './GeneratePanel'

function StepBadge({ children }) {
  return (
    <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-pastel-apricot text-[11px] font-bold text-action-primary" aria-hidden="true">
      {children}
    </span>
  )
}

// 虚拟化妆间 / 虚拟试衣间共用的页面骨架：标题、说明、隐私提示与三步流程。
export default function VirtualRoomShell({ title, intro, scene, items, itemNoun, pickerLabel, icon: Icon, toneClass }) {
  const [photo, setPhoto] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const selectedItem = items.find(item => item.id === selectedId) || null

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-transparent">
      <Header title={title} showBack />
      <main className="flex-1 overflow-y-auto px-4 py-5">
        <section className={`rounded-3xl p-5 shadow-card ${toneClass}`}>
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-card text-action-primary" aria-hidden="true">
              <Icon size={22} />
            </div>
            <div>
              <h1 className="text-base font-semibold text-text-primary">{title}</h1>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">{intro}</p>
              <span className="mt-3 inline-flex rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-status-local">
                照片只在本机处理（本地 ComfyUI 生图），不出这台设备
              </span>
            </div>
          </div>
        </section>

        <section aria-labelledby={`${scene}-step-photo`} className="mt-4 rounded-3xl bg-surface-card p-5 shadow-card">
          <h2 id={`${scene}-step-photo`} className="text-sm font-semibold text-text-primary">
            <StepBadge>1</StepBadge>
            选一张照片
          </h2>
          <PhotoIntake onPhotoChange={setPhoto} />
        </section>

        <section aria-labelledby={`${scene}-step-item`} className="mt-4 rounded-3xl bg-surface-card p-5 shadow-card">
          <h2 id={`${scene}-step-item`} className="text-sm font-semibold text-text-primary">
            <StepBadge>2</StepBadge>
            {pickerLabel}
          </h2>
          <ItemPicker items={items} selectedId={selectedId} onSelect={setSelectedId} groupLabel={pickerLabel} />
        </section>

        <section aria-labelledby={`${scene}-step-generate`} className="mt-4 rounded-3xl bg-surface-card p-5 shadow-card">
          <h2 id={`${scene}-step-generate`} className="text-sm font-semibold text-text-primary">
            <StepBadge>3</StepBadge>
            生成预览
          </h2>
          <GeneratePanel scene={scene} photo={photo} selectedItem={selectedItem} itemNoun={itemNoun} />
        </section>
      </main>
      <TabBar />
    </div>
  )
}
