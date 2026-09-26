import { TriangleAlert } from 'lucide-react'
import { EXPLANATION_SECTIONS } from '../../features/garden/labels'

/** 她的讲解：一段一小节，手写字；没有的那段不写。 */
export function PlantExplanation({ explanation }) {
  const sections = EXPLANATION_SECTIONS.filter(([key]) => explanation?.[key])
  if (!sections.length) return null
  return (
    <dl className="specimen-notes mt-3 space-y-2">
      {sections.map(([key, label]) => (
        <div key={key}>
          <dt className="text-xs text-text-secondary">{label}</dt>
          <dd className="font-hand text-[15px] leading-relaxed">{explanation[key]}</dd>
        </div>
      ))}
    </dl>
  )
}

/** 对人或猫狗有毒、菌菇别吃：单独一块，不跟讲解混在一起。 */
export function PlantCaution({ caution }) {
  if (!caution) return null
  return (
    <p className="mt-3 flex gap-2 rounded-2xl border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-sm leading-relaxed text-text-primary">
      <TriangleAlert size={16} className="mt-0.5 shrink-0 text-status-warning" aria-hidden="true" />
      <span><span className="sr-only">小心：</span>{caution}</span>
    </p>
  )
}
