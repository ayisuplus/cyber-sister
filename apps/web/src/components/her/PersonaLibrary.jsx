import { useEffect, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import PersonaDepthEditor from './PersonaDepthEditor'
import {
  DEPTH_LIMITS,
  DISTILL_EMPTY_MATERIAL,
  DISTILL_FAILED,
  DISTILL_KINDS,
  FRIEND_ATTESTATION,
  FRIEND_CLOSED,
  IMMERSIONS,
  IMMERSION_DESCRIPTIONS,
  IMMERSION_LABELS,
  MALE_REFUSAL,
  MAX_DISTILL_IMAGES,
  MAX_MATERIAL_CHARS,
  MAX_SAMPLES,
  PERSONA_CARD_LIMITS,
  PERSONA_FIELDS,
  PERSONA_FIELD_LABELS,
  PERSONA_SWITCH_FAILED,
  PERSONA_SWITCHED,
  SAMPLE_LABEL,
  TONES,
  TONE_LABELS,
  TONE_NOTE,
  buildPersonaCard,
  canResearchKind,
  emptyPersonaCard,
  pickDepth,
  provenanceBadge,
  sampleLineOf,
  validateDistillSource,
  validatePersonaCard,
} from '../../features/personas'
import { personaService } from '../../services/userService'

// 服务端的 error 字段原样展示（至少留一个她 / 没有这个她 / 这段写得有点太过了……都带了完整文案）；没有就用兜底
const errorOf = (error, fallback) => error?.response?.data?.error || fallback

// 人设卡草稿的字段取值：空/非字符串一律当空串
const fieldOf = (draft, field) => (typeof draft[field] === 'string' ? draft[field] : '')

/** 造她的第一步：她从哪来。朋友路径没开就如实写「还没开放」，不假装能用。 */
function KindPicker({ kind, setKind, friendEnabled, busy }) {
  return (
    <fieldset className="mt-3">
      <legend className="text-xs text-text-secondary">她从哪来</legend>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {DISTILL_KINDS.map(({ kind: value, title, hint }) => {
          const closed = value === 'friend' && !friendEnabled
          const tone = kind === value
            ? 'border-action-primary bg-pastel-blush text-text-primary'
            : 'border-border-subtle bg-surface-card text-text-secondary hover:bg-surface-muted'
          return (
            <label key={value}
              className={`flex min-h-11 flex-col justify-center rounded-control border p-2 transition-colors duration-300 ease-calm ${closed ? 'cursor-not-allowed border-border-subtle opacity-60' : `cursor-pointer ${tone}`}`}>
              <input type="radio" name="persona-kind" className="sr-only" checked={kind === value} disabled={busy || closed}
                onChange={() => setKind(value)} />
              <span className="block text-sm">{closed ? `${title}（${FRIEND_CLOSED}）` : title}</span>
              <span className="mt-1 block text-[11px] leading-relaxed">{hint}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/** 这一类来源要多填的东西：作品或人物名；朋友要先声明。 */
function SourceFields({ kind, label, setLabel, attested, setAttested, busy }) {
  if (kind === 'friend') {
    return (
      <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-2 text-xs text-text-secondary">
        <input type="checkbox" className="mt-1" checked={attested} disabled={busy} onChange={(event) => setAttested(event.target.checked)} />
        {FRIEND_ATTESTATION}
      </label>
    )
  }
  if (!canResearchKind(kind)) return null
  const figure = kind === 'public_figure'
  return (
    <div className="mt-3">
      <label htmlFor="persona-source-label" className="block text-xs text-text-secondary">
        {figure ? '她是谁（公众人物的名字，必填）' : '哪部作品、哪个角色（可不写）'}
      </label>
      <input id="persona-source-label" type="text" value={label} disabled={busy} maxLength={DEPTH_LIMITS.provenanceLabel}
        onChange={(event) => setLabel(event.target.value)}
        className="mt-1 min-h-11 w-full rounded-control border border-border-subtle bg-surface-card p-3 text-sm text-text-primary" />
    </div>
  )
}

/** 素材文字，以及这一类才有的照片与「顺手查公开资料」；朋友只收文字。 */
function MaterialFields({ kind, material, setMaterial, images, pickImages, research, setResearch, busy }) {
  const friend = kind === 'friend'
  return (
    <>
      <label htmlFor="persona-material" className="mt-3 block text-xs text-text-secondary">
        {`${friend ? '你们的聊天记录' : '她的素材'}（${MAX_MATERIAL_CHARS} 字内）`}
      </label>
      <textarea
        id="persona-material"
        value={material}
        rows={5}
        disabled={busy}
        onChange={(event) => setMaterial(event.target.value)}
        placeholder={friend ? '把你们的聊天记录贴在这里……' : '她是谁、怎么说话、你们怎么认识的……'}
        className="mt-1 w-full rounded-control border border-border-subtle bg-surface-card p-3 text-sm text-text-primary"
      />
      {!friend && (
        <label className="mt-2 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border border-dashed border-border-subtle px-3 text-xs text-text-secondary">
          {images.length ? `已选 ${images.length} 张照片` : `加几张她的照片（最多 ${MAX_DISTILL_IMAGES} 张）`}
          <input type="file" accept="image/*" multiple aria-label="她的照片" disabled={busy} onChange={pickImages} className="hidden" />
        </label>
      )}
      {canResearchKind(kind) && (
        <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2 text-xs text-text-secondary">
          <input type="checkbox" checked={research} disabled={busy} onChange={(event) => setResearch(event.target.checked)} />
          顺手查查公开资料
        </label>
      )}
    </>
  )
}

/** 造她的面板：先选她从哪来，再给素材，蒸馏出草稿填进人设卡表单。 */
function DistillPanel({ kind, setKind, label, setLabel, attested, setAttested, friendEnabled, material, setMaterial, images, setImages, research, setResearch, busy, onDistill, onClose }) {
  const [notice, setNotice] = useState('')

  const pickImages = (event) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length > MAX_DISTILL_IMAGES) {
      // 跟服务端同口径：多了就整个退回，让重新选
      setNotice(`图片最多 ${MAX_DISTILL_IMAGES} 张`)
      event.target.value = ''
      return
    }
    setNotice('')
    setImages(files)
  }

  const submit = () => {
    // 预校验跟服务端同口径：先说清来源；素材空 → 先给点她的素材；太长 → 素材不能超过 5000 个字符
    const problem = validateDistillSource({ kind, label, attested })
    if (problem) {
      setNotice(problem)
      return
    }
    if (!material.trim() && (kind === 'friend' || images.length === 0)) {
      setNotice(DISTILL_EMPTY_MATERIAL)
      return
    }
    if (material.length > MAX_MATERIAL_CHARS) {
      setNotice(`素材不能超过${MAX_MATERIAL_CHARS}个字符`)
      return
    }
    setNotice('')
    onDistill()
  }

  return (
    <div className="mt-3 rounded-card border border-border-subtle bg-surface-card p-4">
      <h3 className="text-sm font-semibold text-text-primary">造一个她</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
        先说她从哪来，再给点素材。我先帮你整理成草稿，你再改；整理出来的每一条都会标明是素材里有的，还是我推断的。
      </p>
      <KindPicker kind={kind} setKind={setKind} friendEnabled={friendEnabled} busy={busy} />
      <SourceFields kind={kind} label={label} setLabel={setLabel} attested={attested} setAttested={setAttested} busy={busy} />
      <MaterialFields kind={kind} material={material} setMaterial={setMaterial} images={images} pickImages={pickImages}
        research={research} setResearch={setResearch} busy={busy} />
      {notice && <p role="alert" className="mt-2 text-xs text-danger">{notice}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={submit} className="min-h-11 rounded-control bg-action-primary px-4 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? '整理中…' : '帮我整理'}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-control border border-border-subtle px-4 text-sm text-text-secondary disabled:opacity-50">
          先不了
        </button>
      </div>
    </div>
  )
}

/** 人设卡表单：手写入口、蒸馏草稿与「改一改」共用；保存前预校验，错误文案跟服务端同口径。 */
function PersonaCardForm({ draft, setDraft, editingName, busy, error, onSave, onClose }) {
  const setField = (field, value) => setDraft({ ...draft, [field]: value })
  const setSample = (index, value) => setDraft({
    ...draft,
    samples: draft.samples.map((sample, at) => (at === index ? value : sample)),
  })

  return (
    <div className="mt-3 rounded-card border border-border-subtle bg-surface-card p-4">
      <h3 className="text-sm font-semibold text-text-primary">{editingName ? `改一改「${editingName}」` : '手写一个她'}</h3>
      {PERSONA_FIELDS.map(({ field, multiline }) => (
        <div key={field} className="mt-3">
          <label htmlFor={`persona-${field}`} className="block text-xs text-text-secondary">{PERSONA_FIELD_LABELS[field]}</label>
          {multiline
            ? <textarea id={`persona-${field}`} value={fieldOf(draft, field)} rows={3} disabled={busy}
                onChange={(event) => setField(field, event.target.value)}
                className="mt-1 w-full rounded-control border border-border-subtle bg-surface-card p-3 text-sm text-text-primary" />
            : <input id={`persona-${field}`} type="text" value={fieldOf(draft, field)} disabled={busy}
                onChange={(event) => setField(field, event.target.value)}
                className="mt-1 w-full rounded-control border border-border-subtle bg-surface-card p-3 text-sm text-text-primary" />}
        </div>
      ))}

      <fieldset className="mt-3">
        <legend className="text-xs text-text-secondary">{`${SAMPLE_LABEL}（${MAX_SAMPLES} 条内、每条 ${PERSONA_CARD_LIMITS.sample} 字内）`}</legend>
        {draft.samples.map((sample, index) => (
          <div key={index} className="mt-1 flex items-center gap-2">
            <input type="text" aria-label={`${SAMPLE_LABEL}第 ${index + 1} 条`} value={sample} disabled={busy}
              onChange={(event) => setSample(index, event.target.value)}
              className="min-h-11 w-full rounded-control border border-border-subtle bg-surface-card p-3 text-sm text-text-primary" />
            <button type="button" aria-label={`删掉${SAMPLE_LABEL}第 ${index + 1} 条`} disabled={busy}
              onClick={() => setDraft({ ...draft, samples: draft.samples.filter((_, at) => at !== index) })}
              className="min-h-11 rounded-control border border-border-subtle px-3 text-xs text-text-muted disabled:opacity-50">
              去掉
            </button>
          </div>
        ))}
        {draft.samples.length < MAX_SAMPLES && (
          <button type="button" disabled={busy} onClick={() => setDraft({ ...draft, samples: [...draft.samples, ''] })}
            className="mt-2 min-h-11 text-xs text-action-primary disabled:opacity-50">
            加一句
          </button>
        )}
      </fieldset>

      <fieldset className="mt-3">
        <legend className="text-xs text-text-secondary">沉浸深度</legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {IMMERSIONS.map((value) => (
            <label key={value}
              className={`flex min-h-11 cursor-pointer flex-col justify-center rounded-control border p-2 transition-colors duration-300 ease-calm ${draft.immersion === value ? 'border-action-primary bg-pastel-blush text-text-primary' : 'border-border-subtle bg-surface-card text-text-secondary hover:bg-surface-muted'}`}>
              <input type="radio" name="persona-immersion" className="sr-only" checked={draft.immersion === value}
                onChange={() => setField('immersion', value)} />
              <span className="block text-sm">{IMMERSION_LABELS[value]}</span>
              <span className="mt-1 block text-[11px] leading-relaxed">{IMMERSION_DESCRIPTIONS[value]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-3">
        <legend className="text-xs text-text-secondary">口吻底子</legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {TONES.map((value) => (
            <label key={value}
              className={`flex min-h-11 cursor-pointer items-center justify-center rounded-control border px-2 text-sm transition-colors duration-300 ease-calm ${draft.tone === value ? 'border-action-primary bg-pastel-blush text-text-primary' : 'border-border-subtle bg-surface-card text-text-secondary hover:bg-surface-muted'}`}>
              <input type="radio" name="persona-tone" className="sr-only" checked={draft.tone === value}
                onChange={() => setField('tone', value)} />
              {TONE_LABELS[value]}
            </label>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-text-muted">{TONE_NOTE}</p>
      </fieldset>

      <PersonaDepthEditor draft={draft} setDraft={setDraft} busy={busy} />

      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={onSave} className="min-h-11 rounded-control bg-action-primary px-4 text-sm font-semibold text-white disabled:opacity-50">
          {editingName ? '存好改动' : '建好她'}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-control border border-border-subtle px-4 text-sm text-text-secondary disabled:opacity-50">
          先不了
        </button>
      </div>
    </div>
  )
}

/**
 * 人设库：她的样子全在这里。列出每个她（名字 + 一句示例句），点一下就换她来陪你说；
 * 「造一个她」拿素材蒸馏出草稿再改，「手写一个她」直接空表单；每张卡都能改一改、删掉。
 */
export default function PersonaLibrary() {
  const user = useAuthStore(state => state.user)
  const updatePersona = useAuthStore(state => state.updatePersona)
  const updateProfile = useAuthStore(state => state.updateProfile)

  const [personas, setPersonas] = useState([])
  const [listError, setListError] = useState('')
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const [distillOpen, setDistillOpen] = useState(false)
  const [material, setMaterial] = useState('')
  const [images, setImages] = useState([])
  const [research, setResearch] = useState(true)
  const [kind, setKind] = useState('original')
  const [label, setLabel] = useState('')
  const [attested, setAttested] = useState(false)
  const [friendEnabled, setFriendEnabled] = useState(false)

  const [form, setForm] = useState(null) // { id: 人设卡 id，null=建新卡 }
  const [draft, setDraft] = useState(emptyPersonaCard)
  const [formError, setFormError] = useState('')
  // 草稿被整个换掉（手写、改一改、蒸馏回填）时给表单换个 key，让「更深一点的样子」按新草稿重新决定展不展开
  const [formSeed, setFormSeed] = useState(0)

  const current = user?.persona

  useEffect(() => {
    let alive = true
    personaService.list()
      .then((data) => {
        if (!alive) return
        setPersonas(Array.isArray(data?.personas) ? data.personas : [])
        setFriendEnabled(data?.friendEnabled === true)
      })
      .catch(() => {
        if (alive) setListError('她的人设暂时读不到，请稍后再试。')
      })
    return () => { alive = false }
  }, [])

  // 换她：成功才挪选中态，失败停在原处、照实说没换成功
  const choose = async (id) => {
    if (busy || id === current) return
    setBusy(true)
    setMessage('')
    setNotice('')
    try {
      await updatePersona(id)
      setMessage(PERSONA_SWITCHED)
    } catch {
      setMessage(PERSONA_SWITCH_FAILED)
    } finally {
      setBusy(false)
    }
  }

  const startDistill = () => {
    setDistillOpen(true)
    setAttested(false)
    setNotice('')
    setMessage('')
  }

  const startBlank = () => {
    setDraft(emptyPersonaCard())
    setForm({ id: null })
    setFormSeed((seed) => seed + 1)
    setFormError('')
    setNotice('')
    setMessage('')
    setDistillOpen(false)
  }

  const startEdit = (persona) => {
    const card = persona.card ?? {}
    setDraft({
      ...emptyPersonaCard(),
      ...Object.fromEntries(Object.keys(PERSONA_FIELD_LABELS).map((field) => [field, fieldOf(card, field)])),
      samples: Array.isArray(card.samples) && card.samples.length ? card.samples.map(String) : [''],
      immersion: IMMERSIONS.includes(card.immersion) ? card.immersion : 'medium',
      tone: TONES.includes(card.tone) ? card.tone : 'gentle',
      ...pickDepth(card),
    })
    setForm({ id: persona.id })
    setFormSeed((seed) => seed + 1)
    setFormError('')
    setNotice('')
    setMessage('')
  }

  // 蒸馏：成功把草稿填进表单继续改；{ refused: 'male' } 照实拒绝；失败不动表单里已填的内容
  const distill = async () => {
    setBusy(true)
    setNotice('')
    setMessage('')
    try {
      const result = await personaService.distill({
        material: material.trim(),
        images: kind === 'friend' ? [] : images,
        research: canResearchKind(kind) && research,
        kind,
        label: label.trim(),
        attested,
      })
      if (result?.refused === 'male') {
        setNotice(MALE_REFUSAL)
        return
      }
      const card = result?.card
      if (!card) {
        setNotice(DISTILL_FAILED)
        return
      }
      setDraft({
        ...emptyPersonaCard(),
        ...Object.fromEntries(Object.keys(PERSONA_FIELD_LABELS).map((field) => [field, fieldOf(card, field)])),
        samples: Array.isArray(card.samples) && card.samples.length ? card.samples.map(String) : [''],
        immersion: IMMERSIONS.includes(card.immersion) ? card.immersion : 'medium',
        tone: TONES.includes(card.tone) ? card.tone : 'gentle',
        ...pickDepth(card),
      })
      setForm({ id: null })
      setFormSeed((seed) => seed + 1)
      setFormError('')
      setDistillOpen(false)
      setMessage(result.researched ? '顺手查了公开资料，整理好了；你看看，改好再存。' : '整理好了；你看看，改好再存。')
    } catch (error) {
      // 502「没整理出来，你可以自己动手写」等：只说结果，表单里已填的内容原样留着
      setNotice(errorOf(error, DISTILL_FAILED))
    } finally {
      setBusy(false)
    }
  }

  // 保存：先预校验（跟服务端同口径），过了才建卡/落卡；建卡即启用
  const save = async () => {
    const problem = validatePersonaCard(draft)
    if (problem) {
      setFormError(problem)
      return
    }
    setBusy(true)
    setFormError('')
    setMessage('')
    try {
      const card = buildPersonaCard(draft)
      const saved = form.id
        ? await personaService.update(form.id, card)
        : await personaService.create(card)
      if (form.id) {
        setPersonas((items) => items.map((item) => (item.id === saved.id ? { ...item, name: saved.name, card: saved.card } : item)))
        setMessage('改好了。')
      } else {
        setPersonas((items) => [...items.map((item) => ({ ...item, active: false })), { id: saved.id, name: saved.name, card: saved.card, active: true }])
        setMessage('存好了，就用她陪你聊。')
      }
      updateProfile({ persona: saved.persona })
      setForm(null)
    } catch (error) {
      setFormError(errorOf(error, '没保存成功，请重试'))
    } finally {
      setBusy(false)
    }
  }

  // 删她：只剩一个时服务端 400「至少留一个她」，照实说；删掉当前启用的，服务端会启用剩下里最早建的
  const remove = async (persona) => {
    if (busy) return
    setBusy(true)
    setNotice('')
    setMessage('')
    try {
      const data = await personaService.remove(persona.id)
      const list = Array.isArray(data?.personas) ? data.personas : []
      setPersonas(list)
      const active = list.find((item) => item.active)
      if (active) updateProfile({ persona: active.id })
      if (form?.id === persona.id) setForm(null)
      setMessage('删掉了。')
    } catch (error) {
      setNotice(errorOf(error, '没删掉，请重试'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="her-persona-title" className="rounded-card bg-surface-card p-4 shadow-card">
      <h2 id="her-persona-title" className="text-sm font-semibold text-text-primary">她的样子</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-text-muted">人设库：她是什么样，由你来写。点一下就换她来陪你说。</p>

      {listError && <p role="alert" className="mt-2 text-xs text-danger">{listError}</p>}
      <ul className="mt-3 space-y-2">
        {personas.map((persona) => {
          const active = persona.id === current
          return (
            <li key={persona.id} className="flex items-stretch gap-2">
              <button
                type="button"
                aria-pressed={active}
                disabled={busy}
                onClick={() => choose(persona.id)}
                className={`min-h-[64px] flex-1 rounded-control border p-3 text-left transition-colors duration-300 ease-calm disabled:opacity-50 ${active ? 'border-action-primary bg-pastel-blush' : 'border-border-subtle bg-surface-card hover:bg-surface-muted'}`}
              >
                <span className="block font-display text-base text-text-primary">{persona.name}</span>
                <span className="mt-1 block font-hand text-[11px] leading-relaxed text-text-muted">{sampleLineOf(persona.card)}</span>
                {provenanceBadge(persona.card) && (
                  <span className="mt-1 block text-[11px] leading-relaxed text-text-muted">{provenanceBadge(persona.card)}</span>
                )}
              </button>
              <button type="button" aria-label={`改一改「${persona.name}」`} disabled={busy} onClick={() => startEdit(persona)}
                className="min-h-11 rounded-control border border-border-subtle px-3 text-xs text-text-secondary disabled:opacity-50">
                改一改
              </button>
              <button type="button" aria-label={`删掉「${persona.name}」`} disabled={busy} onClick={() => remove(persona)}
                className="min-h-11 rounded-control border border-border-subtle px-3 text-xs text-text-muted disabled:opacity-50">
                删掉
              </button>
            </li>
          )
        })}
      </ul>
      <p aria-live="polite" className="mt-2 min-h-5 text-xs text-text-secondary">{message}</p>

      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={startDistill} className="min-h-11 rounded-control border border-border-subtle px-4 text-sm text-text-secondary disabled:opacity-50">
          造一个她
        </button>
        <button type="button" disabled={busy} onClick={startBlank} className="min-h-11 rounded-control border border-border-subtle px-4 text-sm text-text-secondary disabled:opacity-50">
          手写一个她
        </button>
      </div>

      {distillOpen && (
        <DistillPanel
          kind={kind} setKind={setKind} label={label} setLabel={setLabel}
          attested={attested} setAttested={setAttested} friendEnabled={friendEnabled}
          material={material} setMaterial={setMaterial}
          images={images} setImages={setImages}
          research={research} setResearch={setResearch}
          busy={busy} onDistill={distill}
          onClose={() => setDistillOpen(false)}
        />
      )}

      {notice && <p role="alert" className="mt-2 text-xs text-danger">{notice}</p>}

      {form && (
        <PersonaCardForm
          key={formSeed}
          draft={draft} setDraft={setDraft}
          editingName={form.id ? personas.find((item) => item.id === form.id)?.name : null}
          busy={busy} error={formError} onSave={save}
          onClose={() => { setForm(null); setFormError('') }}
        />
      )}
    </section>
  )
}
