import { useEffect, useRef, useState } from 'react'
import '@chinese-fonts/mkwtyt/dist/MaoKenTangYuan/result.css'
import { Pencil } from 'lucide-react'
import Header from '../components/layout/Header'
import { Cushion, HeartIcon, SnackIcon } from '../components/pet/PetDoodles'
import { usePetting } from '../hooks/usePetting'
import { activePetOf, usePetStore } from '../stores/petStore'
import { isNight, petImage, PET_SPECIES, speciesOf } from '../features/pets'

// 宠物页（路线图 C29）：每天来领一份零食，喂它长成长值，摸它长好感度；只涨不掉，
// 几天不来它也不会饿、不会难过。画是本机 ComfyUI 画好的简笔画，动起来靠一点点 CSS。

const STAGE_SCALE = [0.84, 0.9, 0.96, 1]
const EAT_MS = 1800
const inputClass = 'min-h-11 w-full rounded-xl bg-surface-input px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-status-info'

function NameForm({ initial, submitLabel, onSubmit, busy = false }) {
  const [name, setName] = useState(initial)
  return (
    <form className="flex w-full items-center gap-2" onSubmit={(event) => { event.preventDefault(); onSubmit(name) }}>
      <label className="min-w-0 flex-1">
        <span className="sr-only">给它起个名字</span>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={12} disabled={busy} placeholder="给它起个名字" className={inputClass} />
      </label>
      <button type="submit" disabled={busy} className="min-h-11 shrink-0 rounded-xl bg-action-primary px-4 font-round text-sm text-text-inverse disabled:opacity-50">{submitLabel}</button>
    </form>
  )
}

/** 还没养：四只里挑一只，起个名字带回家。 */
function Adoption() {
  const adopt = usePetStore((state) => state.adopt)
  const [picked, setPicked] = useState(/** @type {string | null} */ (null))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const bringHome = async (name) => {
    setBusy(true); setError('')
    try {
      await adopt(picked, name)
    } catch {
      setError('没带回来，稍后再试一次')
      setBusy(false)
    }
  }

  return (
    <div className="flex w-full flex-col items-center">
      <p className="font-round text-[24px] text-text-primary">挑一只带回家吧</p>
      <p className="mt-1 text-xs text-text-muted">每天来领零食、喂喂它、摸摸它，它会慢慢长大</p>
      <div className="mt-5 grid w-full grid-cols-2 gap-3">
        {PET_SPECIES.map((species) => (
          <button
            key={species.id}
            type="button"
            aria-pressed={picked === species.id}
            onClick={() => setPicked(species.id)}
            className={`flex flex-col items-center rounded-card bg-surface-card px-3 pb-3 pt-4 shadow-card ring-2 transition-transform duration-200 ease-calm active:scale-95 ${picked === species.id ? 'ring-action-primary' : 'ring-transparent'}`}
          >
            <img src={petImage(species.id, 'awake', { small: true })} alt="" className="h-20 w-auto" draggable={false} />
            <span className="mt-2 font-round text-[17px] text-text-primary">{species.title}</span>
          </button>
        ))}
      </div>
      {picked && (
        <div className="mt-5 w-full">
          <p className="mb-2 font-round text-[15px] text-text-secondary">给{speciesOf(picked).title}起个名字</p>
          <NameForm key={picked} initial={speciesOf(picked).defaultName} submitLabel="带它回家" busy={busy} onSubmit={bringHome} />
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}

function Hearts({ count }) {
  return (
    <span className="flex items-center gap-1 text-text-muted" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((index) => <HeartIcon key={index} filled={index < count} />)}
    </span>
  )
}

function Stats({ pet }) {
  const { stage } = pet
  const percent = stage.to ? Math.max(4, Math.round(((pet.growth - stage.from) / (stage.to - stage.from)) * 100)) : 100
  return (
    <div className="w-full space-y-3 rounded-card bg-surface-card p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <span className="font-round text-[15px] text-text-secondary">好感度</span>
        <span className="flex items-center gap-2">
          <Hearts count={pet.hearts} />
          <span className="font-round text-[15px] tabular-nums text-text-primary">{pet.affection}</span>
        </span>
      </div>
      <p className="sr-only">好感度 {pet.affection}，{pet.hearts} 颗心</p>
      <div>
        <div className="flex items-center justify-between gap-3">
          <span className="font-round text-[15px] text-text-secondary">成长值</span>
          <span className="font-round text-[15px] tabular-nums text-text-primary">
            {stage.to ? `${pet.growth} / ${stage.to}` : `${pet.growth}`}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="成长值"
          aria-valuemin={stage.from}
          aria-valuemax={stage.to ?? pet.growth}
          aria-valuenow={pet.growth}
          className="pet-growth mt-2 h-3 w-full overflow-hidden rounded-full"
        >
          <div className="pet-growth__fill h-full rounded-full" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-1.5 text-right font-round text-[13px] text-text-muted">
          {stage.to ? `还差 ${stage.to - pet.growth} 就长成下一阶段啦` : '已经是老朋友啦'}
        </p>
      </div>
    </div>
  )
}

/** 换一只 / 再领养一只：领养过的点一下就换成在养它，没领养的点一下起名带回家。 */
function Switcher({ current }) {
  const pets = usePetStore((state) => state.pets)
  const setActive = usePetStore((state) => state.setActive)
  const adopt = usePetStore((state) => state.adopt)
  const [adopting, setAdopting] = useState(/** @type {string | null} */ (null))
  const [busy, setBusy] = useState(false)

  const choose = async (species) => {
    const owned = pets.some((item) => item.species === species)
    if (!owned) { setAdopting(species); return }
    setAdopting(null)
    if (species !== current) await setActive(species).catch(() => {})
  }
  const bringHome = async (name) => {
    setBusy(true)
    try { await adopt(adopting, name); setAdopting(null) } catch { /* 留在表单里，可以再点 */ } finally { setBusy(false) }
  }

  return (
    <div className="w-full">
      <p className="mb-2 font-round text-[14px] text-text-muted">它们也在等你</p>
      <div className="grid grid-cols-4 gap-2">
        {PET_SPECIES.map((species) => {
          const owned = pets.find((item) => item.species === species.id)
          return (
            <button
              key={species.id}
              type="button"
              aria-pressed={species.id === current}
              aria-label={owned ? `换成${owned.name}` : `领养一只${species.title}`}
              onClick={() => choose(species.id)}
              className={`flex min-h-11 flex-col items-center rounded-card px-1 pb-2 pt-2 transition-colors duration-200 ease-calm ${species.id === current ? 'bg-pastel-blush' : 'bg-surface-card hover:bg-surface-muted'} shadow-card`}
            >
              <img src={petImage(species.id, owned ? 'awake' : 'sleep', { small: true })} alt="" draggable={false} className={`h-10 w-auto ${owned ? '' : 'opacity-60 grayscale-[35%]'}`} />
              <span className="mt-1 max-w-full truncate font-round text-[12px] text-text-secondary">{owned ? owned.name : `+ ${species.title}`}</span>
            </button>
          )
        })}
      </div>
      {adopting && (
        <div className="mt-3">
          <p className="mb-2 font-round text-[14px] text-text-secondary">给{speciesOf(adopting).title}起个名字</p>
          <NameForm key={adopting} initial={speciesOf(adopting).defaultName} submitLabel="带回家" busy={busy} onSubmit={bringHome} />
        </div>
      )}
    </div>
  )
}

function PetRoom({ pet, grant }) {
  const food = usePetStore((state) => state.food)
  const rename = usePetStore((state) => state.rename)
  const species = speciesOf(pet.species)
  const [night] = useState(() => isNight(new Date().getHours()))
  const [eating, setEating] = useState(false)
  const [feeding, setFeeding] = useState(false)
  const [pops, setPops] = useState(/** @type {{ id: number, text: string }[]} */ ([]))
  const [hint, setHint] = useState('')
  const [editing, setEditing] = useState(false)
  const eatTimer = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined))
  const popId = useRef(0)

  useEffect(() => () => clearTimeout(eatTimer.current), [])
  useEffect(() => { setHint(''); setEditing(false) }, [pet.species])

  const pop = (text) => {
    popId.current += 1
    const id = popId.current
    setPops((list) => [...list.slice(-2), { id, text }])
  }

  const { mood, purrKey, handlers } = usePetting({
    onPurr: () => {
      usePetStore.getState().pet(pet.species)
        .then((result) => {
          if (!result) return
          if (result.gained) pop(`♥ +${result.gained}`)
          else setHint(`今天摸够啦，${pet.name}已经很满足了`)
        })
        .catch(() => {})
    },
  })

  const feed = async () => {
    if (feeding || food <= 0) return
    setFeeding(true)
    setHint('')
    setEating(true)
    clearTimeout(eatTimer.current)
    try {
      const result = await usePetStore.getState().feed(pet.species)
      if (result) {
        pop(`成长 +${result.gained.growth}`)
        if (result.grewUp) setHint(`${pet.name}长成「${result.pet.stage.name}」啦！`)
      }
    } catch (error) {
      setHint(error?.response?.data?.code === 'NO_FOOD' ? `${species.snack}吃完啦，明天再来领` : '没喂上，稍后再试')
    } finally {
      setFeeding(false)
      eatTimer.current = setTimeout(() => setEating(false), EAT_MS)
    }
  }

  const frame = eating ? 'eat' : mood === 'purr' || mood === 'stretch' ? 'happy' : mood === 'peek' ? 'awake' : night ? 'sleep' : 'awake'
  const defaultHint = night && mood === 'idle' && !eating ? `${pet.name}睡着啦，轻轻摸摸它` : '摸摸它，来回摸会呼噜哦'
  const purring = mood === 'purr' || mood === 'stretch'

  return (
    <div className="flex w-full flex-col items-center">
      {grant > 0 && (
        <p className="pet-grant mb-3 flex items-center gap-2 rounded-full bg-surface-card px-4 py-2 font-round text-[15px] text-text-primary shadow-card" role="status">
          <SnackIcon species={pet.species} />
          今天的{species.snack}到啦 +{grant}
        </p>
      )}

      <div className="flex items-center gap-2">
        {editing ? (
          <div className="w-60">
            <NameForm initial={pet.name} submitLabel="好" onSubmit={async (name) => { await rename(pet.species, name).catch(() => {}); setEditing(false) }} />
          </div>
        ) : (
          <>
            <h2 className="font-round text-[28px] text-text-primary">{pet.name}</h2>
            <span className="rounded-full bg-pastel-mist px-2.5 py-0.5 font-round text-[13px] text-text-secondary">{pet.stage.name}</span>
            <button type="button" onClick={() => setEditing(true)} aria-label="给它改名字" className="flex h-11 w-11 items-center justify-center rounded-full text-text-muted hover:bg-surface-muted">
              <Pencil size={15} aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      <div className="pet-stage relative mt-2 w-full max-w-[340px]">
        <Cushion className="absolute bottom-1 left-1/2 h-14 w-[86%] -translate-x-1/2" />
        <div className="pet-stage__scale" style={{ transform: `scale(${STAGE_SCALE[pet.stage.index] ?? 1})` }}>
          <button type="button" aria-label={`摸摸${pet.name}`} data-mood={mood} data-frame={frame} className="pet-body-button" {...handlers}>
            <span className={`pet-body ${eating ? 'pet-body--eating' : ''}`} data-mood={mood} aria-hidden="true">
              {['sleep', 'awake', 'happy', 'eat'].map((name) => (
                <img key={`${pet.species}-${name}`} src={petImage(pet.species, name)} alt="" draggable={false} decoding="async" style={{ opacity: name === frame ? 1 : 0 }} />
              ))}
            </span>
          </button>
        </div>
        {purring && <span key={purrKey} className="pet-purr font-round" aria-hidden="true">呼噜呼噜…</span>}
        {night && mood === 'idle' && !eating && <span className="pet-zzz font-round" aria-hidden="true">z z</span>}
        {eating && <span className="pet-snack-drop" aria-hidden="true"><SnackIcon species={pet.species} size={30} /></span>}
        {pops.map((item) => (
          <span key={item.id} className="pet-heart-pop pet-stage__pop font-round" aria-hidden="true" onAnimationEnd={() => setPops((list) => list.filter((entry) => entry.id !== item.id))}>{item.text}</span>
        ))}
      </div>
      <p className="mt-1 min-h-6 font-round text-[15px] text-text-muted" aria-live="polite">{hint || defaultHint}</p>

      <button
        type="button"
        onClick={feed}
        disabled={feeding || food <= 0}
        className="mt-4 flex min-h-12 items-center gap-2 rounded-full bg-action-primary px-6 font-round text-[17px] text-text-inverse shadow-button transition-transform duration-200 ease-calm active:scale-95 disabled:opacity-50"
      >
        <SnackIcon species={pet.species} />
        {food > 0 ? `喂一口${species.snack}` : `${species.snack}吃完啦，明天再来`}
      </button>
      <p className="mt-2 font-round text-[14px] text-text-muted">还剩 {food} 份 · 每天来领 3 份</p>

      <div className="mt-6 w-full"><Stats pet={pet} /></div>
      <div className="mt-6 w-full"><Switcher current={pet.species} /></div>
      <p className="mt-6 text-center text-[11px] leading-relaxed text-text-muted">好感度和成长值只会往上涨。几天没来也没关系，它不会饿，也不会难过。</p>
    </div>
  )
}

export default function PetPage() {
  const status = usePetStore((state) => state.status)
  const load = usePetStore((state) => state.load)
  const claimDaily = usePetStore((state) => state.claimDaily)
  const pet = usePetStore(activePetOf)
  const [grant, setGrant] = useState(0)
  const claimed = useRef(false)

  useEffect(() => { load() }, [load])
  // 每天第一次来（或者刚领养回来）：领今天的零食
  useEffect(() => {
    if (status !== 'ready' || !pet || claimed.current) return
    claimed.current = true
    claimDaily().then((granted) => { if (granted > 0) setGrant(granted) }).catch(() => {})
  }, [status, pet, claimDaily])

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-transparent">
      <Header title="宠物" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-md flex-col items-center px-5 pb-10 pt-5">
          {status === 'idle' && <div className="h-64" aria-busy="true" />}
          {status === 'error' && (
            <div className="flex flex-col items-center text-center">
              <p className="font-round text-[20px] text-text-primary">它们暂时找不到了</p>
              <button type="button" onClick={load} className="mt-4 min-h-11 rounded-full border border-border-subtle bg-surface-card px-5 text-sm text-text-secondary">再试一次</button>
            </div>
          )}
          {status === 'ready' && !pet && <Adoption />}
          {status === 'ready' && pet && <PetRoom pet={pet} grant={grant} />}
        </div>
      </div>
    </div>
  )
}
