import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { BODY_CARE_PRESETS } from '../../features/bodyCarePresets'
import { EMOTION_REFLECTION_PRESETS } from '../../features/emotionReflectionPresets'

const groups = [
  { id: 'body', label: '身体呵护', description: '参考《女生呵护指南》整理，用于科普和就诊准备，不替代诊疗。', presets: BODY_CARE_PRESETS },
  { id: 'emotion', label: '情绪与关系', description: '借鉴《嫉羡与感恩》梳理感受与边界；理论是参考，不给你或他人下心理诊断。', presets: EMOTION_REFLECTION_PRESETS },
]

export default function ChatSkillPresets({ disabled, hasDraft, onSelect }) {
  const [groupId, setGroupId] = useState('body')
  const group = groups.find((item) => item.id === groupId)
  return (
    <details className="group mb-2 text-xs text-text-secondary">
      <summary className="inline-flex min-h-11 cursor-pointer list-none select-none items-center gap-1 rounded-full px-3 transition-colors duration-300 ease-calm hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} aria-hidden="true" className="transition-transform duration-300 ease-calm group-open:rotate-90" />
        聊天预设 · 身体与情绪
      </summary>
      <div className="mb-2 flex animate-fade-in flex-wrap gap-2 px-1" role="group" aria-label="预设主题">
        {groups.map((item) => (
          <button key={item.id} type="button" aria-pressed={item.id === groupId} onClick={() => setGroupId(item.id)} className="min-h-11 rounded-full border border-border-subtle px-4 transition-colors duration-300 ease-calm aria-pressed:bg-pastel-mist aria-pressed:text-text-primary">{item.label}</button>
        ))}
      </div>
      <p className="mb-2 px-1 leading-relaxed">{group.description} 选好后可修改再发送。</p>
      <div className="flex flex-wrap gap-2 px-1">
        {group.presets.map((preset) => (
          <button key={preset.id} type="button" disabled={disabled || hasDraft} onClick={() => onSelect(preset.text)} className="min-h-11 rounded-full border border-border-subtle bg-surface-card px-4 py-2 transition-colors duration-300 ease-calm hover:bg-pastel-blush disabled:opacity-40">{preset.label}</button>
        ))}
      </div>
      {hasDraft && <p className="mt-2">已有输入时保留你的内容，清空文字和图片后可选择预设。</p>}
    </details>
  )
}
