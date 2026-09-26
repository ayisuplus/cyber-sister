import { useState } from 'react'
import { ChecklistCredit, ChecklistTag, PlantCaution, PlantExplanation } from './PlantNotes'
import { HONEST_NOTE, LIKELIHOOD_PHRASES, STATUS_LABELS } from '../../features/garden/labels'

const chip = (active) => `min-h-11 rounded-full px-3 text-sm transition-colors duration-300 ease-calm ${active ? 'bg-action-primary text-text-inverse' : 'border border-border-subtle bg-surface-card text-text-secondary hover:bg-surface-muted'}`
const inputClass = 'mt-1 min-h-11 w-full rounded-2xl border border-border-default bg-surface-input px-3 text-sm text-text-primary'
const OWN = 'own'

/** 认一认的结果：她认出的候选、她的讲解、要小心的地方；选一个（或自己写），再决定收不收。 */
function Identified({ result, onCollect, onDiscard }) {
  const [pick, setPick] = useState(/** @type {number | 'own'} */ (0))
  const [ownName, setOwnName] = useState('')
  const [status, setStatus] = useState('met')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [top] = result.candidates

  const collect = async () => {
    const chosen = pick === OWN ? null : result.candidates[pick]
    const name = chosen ? chosen.name : ownName.trim()
    if (!name) { setError('给它写个名字吧'); return }
    setBusy(true)
    setError('')
    try {
      await onCollect({
        name,
        scientificName: chosen?.scientificName ?? undefined,
        family: chosen?.family ?? undefined,
        status,
        note: note.trim(),
        identification: JSON.stringify(result),
        ...(chosen ? { pick: String(pick) } : {}),
      })
    } catch (failure) {
      setError(failure.response?.data?.error || '没收进去，请重试')
      setBusy(false)
    }
  }

  return (
    <>
      <p className="mt-3 font-hand text-lg text-text-primary">她说，{LIKELIHOOD_PHRASES[top.likelihood] ?? '有点像'}「{top.name}」</p>
      <fieldset className="mt-3">
        <legend className="text-xs text-text-secondary">是哪一种</legend>
        <div className="mt-1 space-y-1">
          {result.candidates.map((candidate, index) => (
            <label key={candidate.name} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-2 hover:bg-surface-muted">
              <input type="radio" name="plant-pick" checked={pick === index} onChange={() => setPick(index)} className="h-4 w-4 accent-[var(--cs-action-primary)]" />
              <span className="min-w-0 flex-1">
                <span className="text-sm text-text-primary">{candidate.name}</span>
                {candidate.scientificName && <i className="ml-2 text-xs text-text-secondary">{candidate.scientificName}</i>}
                {candidate.family && <span className="ml-2 text-xs text-text-secondary">{candidate.family}</span>}
                <ChecklistTag reference={result.reference} index={index} name={candidate.name} block />
              </span>
              <span className="shrink-0 text-xs text-text-muted">{candidate.likelihood}</span>
            </label>
          ))}
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-2 hover:bg-surface-muted">
            <input type="radio" name="plant-pick" checked={pick === OWN} onChange={() => setPick(OWN)} className="h-4 w-4 accent-[var(--cs-action-primary)]" />
            <span className="text-sm text-text-primary">都不是，我自己写</span>
          </label>
        </div>
        {pick === OWN && (
          <label className="mt-2 block text-xs text-text-secondary">
            它叫什么
            <input value={ownName} onChange={(event) => setOwnName(event.target.value)} maxLength={40} className={inputClass} />
          </label>
        )}
      </fieldset>
      <p className="mt-2 text-xs text-text-muted">{HONEST_NOTE}</p>
      <PlantCaution caution={result.caution} reference={result.reference} />
      {pick === 0
        ? <PlantExplanation explanation={result.explanation} />
        : result.explanation && <p className="mt-3 text-xs text-text-secondary">她的讲解是照「{top.name}」写的，换了一种就先不放讲解。</p>}
      {pick !== OWN && <ChecklistCredit reference={result.reference} index={pick} />}
      <div role="group" aria-label="路上遇见还是我养的" className="mt-4 flex gap-2">
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)} className={chip(status === value)}>{label}</button>
        ))}
      </div>
      <label className="mt-3 block text-xs text-text-secondary">
        写一句（在哪遇见的、那天的心情……）
        <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} rows={2} className={`${inputClass} py-2`} />
      </label>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onDiscard} className="min-h-11 flex-1 rounded-2xl border border-border-default bg-surface-card text-sm text-text-secondary">不收了</button>
        <button type="button" onClick={collect} disabled={busy} className="min-h-11 flex-1 rounded-2xl bg-action-primary text-sm font-semibold text-text-inverse disabled:opacity-50">{busy ? '正在收…' : '收进图鉴'}</button>
      </div>
    </>
  )
}

/**
 * 认一认这一屏：照片在上；认的时候写「她在认…」，认完给结果，没认成说清原因。
 * @param {{ photos: any, state: 'identifying' | 'result' | 'failed', result?: any, failure?: { message: string, toSettings?: boolean },
 *   onCollect: (fields: any) => Promise<void>, onDiscard: () => void, onRetry: () => void, onManual: () => void, onSettings: () => void }} props
 */
export default function IdentifyResult({ photos, state, result, failure, onCollect, onDiscard, onRetry, onManual, onSettings }) {
  return (
    <article aria-label="认一认" aria-busy={state === 'identifying'} className="specimen-sheet rounded-card p-4">
      <img src={photos.previewUrl} alt="你拍的这张" className="specimen-photo mx-auto max-h-72 w-auto object-contain" />
      {state === 'identifying' && <p role="status" className="mt-4 text-center font-hand text-lg text-text-secondary">她在认…</p>}
      {state === 'failed' && (
        <>
          <p role="alert" className="mt-4 text-sm leading-relaxed text-text-primary">{failure.message}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {failure.toSettings
              ? <button type="button" onClick={onSettings} className="min-h-11 flex-1 rounded-2xl bg-action-primary px-3 text-sm font-semibold text-text-inverse">去设置</button>
              : <button type="button" onClick={onRetry} className="min-h-11 flex-1 rounded-2xl bg-action-primary px-3 text-sm font-semibold text-text-inverse">再认一次</button>}
            <button type="button" onClick={onManual} className="min-h-11 flex-1 rounded-2xl border border-border-default bg-surface-card px-3 text-sm text-text-secondary">自己写名字</button>
            <button type="button" onClick={onDiscard} className="min-h-11 flex-1 rounded-2xl border border-border-default bg-surface-card px-3 text-sm text-text-secondary">不收了</button>
          </div>
        </>
      )}
      {state === 'result' && !result.isPlant && (
        <>
          <p className="mt-4 font-hand text-lg text-text-primary">这张好像不是花草。</p>
          <p className="mt-1 text-sm text-text-secondary">换一张清楚一点的试试，或者自己写名字收进来。</p>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={onManual} className="min-h-11 flex-1 rounded-2xl border border-border-default bg-surface-card text-sm text-text-secondary">自己写名字</button>
            <button type="button" onClick={onDiscard} className="min-h-11 flex-1 rounded-2xl border border-border-default bg-surface-card text-sm text-text-secondary">不收了</button>
          </div>
        </>
      )}
      {state === 'result' && result.isPlant && <Identified result={result} onCollect={onCollect} onDiscard={onDiscard} />}
    </article>
  )
}
