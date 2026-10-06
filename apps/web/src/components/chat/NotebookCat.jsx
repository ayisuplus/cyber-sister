import { useEffect, useState } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { usePetting } from '../../hooks/usePetting'
import { activePetOf, usePetStore } from '../../stores/petStore'
import { isNight, petImage } from '../../features/pets'

// 本子角上的小家伙（路线图 C29）：趴在本子右上角，每一页都在。
// 养了宠物就是你养的那一只，在这儿摸它也算好感（和宠物页同一份，每天有上限）；还没养就是封面那只小猫，摸了不记数。
// 轻点醒一下；来回摸就呼噜；摸很久伸个懒腰。不出声；它不会饿，也不会因为你没来而难过。

const MOOD_FRAMES = { idle: 'sleep', peek: 'awake', purr: 'happy', stretch: 'stretch' }
const FRAMES = ['sleep', 'awake', 'happy', 'stretch']
const ANNOUNCE = { peek: '醒了一下', purr: '在呼噜', stretch: '伸了个懒腰' }

export default function NotebookCat() {
  const reducedMotion = useReducedMotion()
  const status = usePetStore((state) => state.status)
  const load = usePetStore((state) => state.load)
  const pet = usePetStore(activePetOf)
  const [broken, setBroken] = useState(false)
  const [heartKey, setHeartKey] = useState(0)
  const [night, setNight] = useState(() => isNight(new Date().getHours()))
  const species = pet?.species ?? 'cat'

  useEffect(() => { if (status === 'idle') load() }, [status, load])
  useEffect(() => {
    const timer = setInterval(() => setNight(isNight(new Date().getHours())), 10 * 60 * 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => { setBroken(false) }, [species])

  const { mood, purrKey, handlers } = usePetting({
    onPurr: () => {
      if (!pet) return
      usePetStore.getState().pet(pet.species)
        .then((result) => { if (result?.gained) setHeartKey((key) => key + 1) })
        .catch(() => {})
    },
  })

  if (broken) return null

  const frame = MOOD_FRAMES[mood]
  const who = pet?.name ?? '小猫'
  const purring = mood === 'purr' || mood === 'stretch'
  return (
    <button
      type="button"
      aria-label={`摸摸${who}`}
      data-mood={mood}
      data-species={species}
      className="notebook-cat"
      {...handlers}
    >
      <span className="notebook-cat__body" aria-hidden="true">
        {FRAMES.map((name) => (
          <img
            key={`${species}-${name}`}
            src={petImage(species, name, { small: true })}
            alt=""
            draggable={false}
            decoding="async"
            style={{ opacity: name === frame ? 1 : 0 }}
            onError={name === 'sleep' ? () => setBroken(true) : undefined}
          />
        ))}
      </span>
      {purring && <span key={purrKey} className="notebook-cat__purr" aria-hidden="true">呼噜呼噜…</span>}
      {heartKey > 0 && <span key={`heart-${heartKey}`} className="pet-heart-pop notebook-cat__heart" aria-hidden="true">♥ +1</span>}
      {night && mood === 'idle' && !reducedMotion && <span className="notebook-cat__z" aria-hidden="true">z</span>}
      <span className="sr-only" aria-live="polite">{ANNOUNCE[mood] ? `${who}${ANNOUNCE[mood]}` : ''}</span>
    </button>
  )
}
