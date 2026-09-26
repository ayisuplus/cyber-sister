import { TriangleAlert } from 'lucide-react'
import { checklistCredit, EXPLANATION_SECTIONS, toxicCredit, toxicLine } from '../../features/garden/labels'

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

/**
 * 要小心的：单独一块，不跟讲解混在一起。
 * 本机毒性库里有记载的先写（有据可查、写明出处），她自己的提醒另起一行写「她还提醒」；只有她的提醒时照旧一句。
 */
export function PlantCaution({ caution, reference }) {
  const recorded = reference?.toxic ?? []
  if (!caution && !recorded.length) return null
  return (
    <div className="mt-3 flex gap-2 rounded-2xl border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-sm leading-relaxed text-text-primary">
      <TriangleAlert size={16} className="mt-0.5 shrink-0 text-status-warning" aria-hidden="true" />
      <div>
        <span className="sr-only">小心：</span>
        {recorded.map((item) => <p key={item.recordedAs}>{toxicLine(item)}别入口，也别让猫狗啃。</p>)}
        {caution && <p>{recorded.length ? `她还提醒：${caution}` : caution}</p>}
        {recorded.length > 0 && <p className="mt-1 text-xs text-text-secondary">{toxicCredit(reference)}</p>}
      </div>
    </div>
  )
}

/**
 * 一个候选在名录里的样子：「名录里有」（叫法不同时写名录里的名字），或「中国名录里没查到」；没装名录什么都不写。
 * 名录只收在中国有记录的植物，石莲花、发财树这类外来栽培的常查不到，所以写明是中国名录，免得读成「她认错了」。
 */
export function ChecklistTag({ reference, index, name, block = false }) {
  if (!reference?.checked) return null
  const found = reference.candidates?.[index]
  const place = block ? 'mt-0.5 block' : 'ml-2'
  if (!found?.found) return <span className={`${place} text-xs text-text-muted`}>中国名录里没查到</span>
  const other = found.standardName && found.standardName !== name ? `，名录作「${found.standardName}」` : ''
  return <span className={`${place} text-xs text-text-secondary`}>名录里有{other}</span>
}

/** 名录的出处（三层）：只在真核过、有记录显示出来时写 */
export function ChecklistCredit({ reference, index }) {
  const found = reference?.candidates?.[index]
  const text = found?.found ? checklistCredit(reference, found.scrutiny) : null
  return text ? <p className="mt-2 text-[11px] leading-relaxed text-text-muted">{text}</p> : null
}
