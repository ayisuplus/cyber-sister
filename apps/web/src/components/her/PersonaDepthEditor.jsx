import { useState } from 'react'
import {
  BASES,
  BASIS_LABELS,
  DEPTH_LIMITS,
  EXPRESSION_LABELS,
  HONESTY_MINIMUMS,
  blankHeuristic,
  blankModel,
  hasDepth,
  provenanceBadge,
} from '../../features/personas'

const INPUT = 'min-h-11 w-full rounded-control border border-border-subtle bg-surface-card p-3 text-sm text-text-primary'
const GHOST = 'min-h-11 rounded-control border border-border-subtle px-3 text-xs text-text-muted disabled:opacity-50'
const ADD = 'mt-2 min-h-11 text-xs text-action-primary disabled:opacity-50'

const textOf = (value) => (typeof value === 'string' ? value : '')
const listOf = (value) => (Array.isArray(value) ? value : [])

/** 一串短句（价值观、内在矛盾、诚实边界）：每条一个输入框，可加可去。 */
function StringList({ title, hint = '', items, max, limit, busy, onChange }) {
  const list = listOf(items)
  return (
    <fieldset className="mt-3">
      <legend className="text-xs text-text-secondary">{`${title}（${max} 条内、每条 ${limit} 字内）`}</legend>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{hint}</p>}
      {list.map((item, index) => (
        <div key={index} className="mt-1 flex items-center gap-2">
          <input type="text" aria-label={`${title}第 ${index + 1} 条`} value={textOf(item)} disabled={busy}
            onChange={(event) => onChange(list.map((value, at) => (at === index ? event.target.value : value)))}
            className={INPUT} />
          <button type="button" aria-label={`去掉${title}第 ${index + 1} 条`} disabled={busy}
            onClick={() => onChange(list.filter((_, at) => at !== index))} className={GHOST}>
            去掉
          </button>
        </div>
      ))}
      {list.length < max && (
        <button type="button" disabled={busy} onClick={() => onChange([...list, ''])} className={ADD}>加一条</button>
      )}
    </fieldset>
  )
}

/** 带来源标记的多字段行（判断规则、心智模型）：每行几个输入框加一个「来源」，可加可去。 */
function RowsEditor({ title, hint = '', rows, max, blank, fields, busy, onChange }) {
  const list = listOf(rows)
  const update = (index, patch) => onChange(list.map((row, at) => (at === index ? { ...row, ...patch } : row)))
  return (
    <fieldset className="mt-3">
      <legend className="text-xs text-text-secondary">{`${title}（${max} 条内）`}</legend>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{hint}</p>}
      {list.map((row, index) => (
        <div key={index} className="mt-2 rounded-control border border-border-subtle p-3">
          {fields.map(({ key, label, limit }) => (
            <div key={key} className="mt-1 first:mt-0">
              <span className="block text-[11px] text-text-muted">{`${label}（${limit} 字内）`}</span>
              <input type="text" aria-label={`${title}第 ${index + 1} 条的${label}`} value={textOf(row?.[key])} disabled={busy}
                onChange={(event) => update(index, { [key]: event.target.value })} className={INPUT} />
            </div>
          ))}
          <div className="mt-2 flex items-center gap-2">
            <select aria-label={`${title}第 ${index + 1} 条的来源`} value={BASES.includes(row?.basis) ? row.basis : 'authored'} disabled={busy}
              onChange={(event) => update(index, { basis: event.target.value })}
              className="min-h-11 rounded-control border border-border-subtle bg-surface-card px-2 text-xs text-text-secondary">
              {BASES.map((basis) => <option key={basis} value={basis}>{BASIS_LABELS[basis]}</option>)}
            </select>
            <button type="button" aria-label={`去掉${title}第 ${index + 1} 条`} disabled={busy}
              onClick={() => onChange(list.filter((_, at) => at !== index))} className={GHOST}>
              去掉
            </button>
          </div>
        </div>
      ))}
      {list.length < max && (
        <button type="button" disabled={busy} onClick={() => onChange([...list, blank()])} className={ADD}>加一条</button>
      )}
    </fieldset>
  )
}

const HEURISTIC_FIELDS = [
  { key: 'when', label: '如果', limit: DEPTH_LIMITS.heuristicWhen },
  { key: 'then', label: '就', limit: DEPTH_LIMITS.heuristicThen },
]
const MODEL_FIELDS = [
  { key: 'name', label: '名字', limit: DEPTH_LIMITS.modelName },
  { key: 'idea', label: '一句话说明', limit: DEPTH_LIMITS.modelIdea },
  { key: 'failsWhen', label: '什么时候不适用', limit: DEPTH_LIMITS.modelFailsWhen },
]

/** 表达风格五个维度，每个一个短输入。 */
function ExpressionFields({ expression, busy, onChange }) {
  const value = expression && typeof expression === 'object' ? expression : {}
  return (
    <fieldset className="mt-3">
      <legend className="text-xs text-text-secondary">{`表达风格（每项 ${DEPTH_LIMITS.expression} 字内）`}</legend>
      {Object.entries(EXPRESSION_LABELS).map(([key, label]) => (
        <div key={key} className="mt-1">
          <span className="block text-[11px] text-text-muted">{label}</span>
          <input type="text" aria-label={`表达风格·${label}`} value={textOf(value[key])} disabled={busy}
            onChange={(event) => onChange({ ...value, [key]: event.target.value })} className={INPUT} />
        </div>
      ))}
    </fieldset>
  )
}

/**
 * 「她更深一点的样子」：表达风格、判断规则、心智模型、价值观、内在矛盾、诚实边界。
 * 默认收起（手写的她可以一个都不填）；蒸馏出来的卡带着深度内容，打开时就是展开的。
 * 来源标注（虚构角色 / 公众人物 / 朋友）只读：它决定她要不要替真人说话，不在这里改。
 */
export default function PersonaDepthEditor({ draft, setDraft, busy }) {
  const [open, setOpen] = useState(() => hasDepth(draft))
  const set = (key, value) => setDraft({ ...draft, [key]: value })
  const badge = provenanceBadge(draft)
  const distilled = Boolean(draft.provenance?.kind)

  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="mt-3 rounded-control border border-border-subtle">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-xs text-text-secondary">她更深一点的样子（可不填）</summary>
      <div className="px-3 pb-3">
        {badge && <p className="text-[11px] leading-relaxed text-text-muted">{`来源：${badge}`}</p>}
        {distilled && (
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
            {`整理出来的她，要存下来的话：判断规则至少 ${HONESTY_MINIMUMS.heuristics} 条，内在矛盾至少 ${HONESTY_MINIMUMS.tensions} 处，诚实边界至少 ${HONESTY_MINIMUMS.boundaries} 条，每条规则都标着来源。`}
          </p>
        )}
        <ExpressionFields expression={draft.expression} busy={busy} onChange={(value) => set('expression', value)} />
        <RowsEditor title="判断规则" hint="如果……就……；来源标「来自素材」「推断」或「我写的」。"
          rows={draft.heuristics} max={DEPTH_LIMITS.maxHeuristics} blank={blankHeuristic} fields={HEURISTIC_FIELDS}
          busy={busy} onChange={(value) => set('heuristics', value)} />
        <RowsEditor title="心智模型" hint="她看事情的一种方式，要写明什么时候不适用。"
          rows={draft.models} max={DEPTH_LIMITS.maxModels} blank={blankModel} fields={MODEL_FIELDS}
          busy={busy} onChange={(value) => set('models', value)} />
        <StringList title="价值观" items={draft.values} max={DEPTH_LIMITS.maxValues} limit={DEPTH_LIMITS.value}
          busy={busy} onChange={(value) => set('values', value)} />
        <StringList title="内在矛盾" hint="素材里看不出两头时，写你的推断，句首加「推断：」。"
          items={draft.tensions} max={DEPTH_LIMITS.maxTensions} limit={DEPTH_LIMITS.tension}
          busy={busy} onChange={(value) => set('tensions', value)} />
        <StringList title="诚实边界" hint="她不知道、做不到、不能替真人回答的事。"
          items={draft.boundaries} max={DEPTH_LIMITS.maxBoundaries} limit={DEPTH_LIMITS.boundary}
          busy={busy} onChange={(value) => set('boundaries', value)} />
      </div>
    </details>
  )
}
