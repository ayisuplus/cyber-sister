import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, ImagePlus, PenLine, Sprout } from 'lucide-react'
import CameraCapture from '../collection/CameraCapture'
import CollectionPhoto from '../collection/CollectionPhoto'
import IdentifyResult from './IdentifyResult'
import PlantDetail from './PlantDetail'
import PlantEditor from './PlantEditor'
import { Sticker } from '../letter/Decor'
import { gardenService } from '../../services/gardenService'
import { getSessionVersion, onSessionReset } from '../../services/sessionLifecycle'
import { preparePhoto } from '../../features/collection/preparePhoto'
import { dayLabel, identifyFailure, kindsOf, STATUS_LABELS } from '../../features/garden/labels'

const chip = (active) => `min-h-11 shrink-0 rounded-full px-3 text-sm transition-colors duration-300 ease-calm ${active ? 'bg-action-primary text-text-inverse' : 'border border-border-subtle bg-surface-card text-text-secondary hover:bg-surface-muted'}`
const choiceClass = 'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl border border-border-default bg-surface-card px-2 text-sm text-text-secondary hover:bg-surface-muted'
/** @typedef {{ kind: 'browse' | 'camera' | 'identifying' | 'result' | 'failed' | 'manual' | 'detail' | 'edit', id?: string, photos?: any, result?: any, failure?: any }} GardenView */

// 手机、平板上直接交给系统相机；电脑上在页面里开摄像头
const prefersSystemCamera = () => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches

/** 一张标本签：照片加白边，名字手写，下面一行科和哪天。 */
function SpecimenCard({ entry, onOpen }) {
  return (
    <li>
      <button type="button" onClick={onOpen} aria-label={`${entry.name}，${STATUS_LABELS[entry.status] ?? ''}`} className="specimen-card block w-full text-left">
        <span className="specimen-photo block aspect-square overflow-hidden">
          {entry.thumbUrl
            ? <CollectionPhoto path={entry.thumbUrl} className="h-full w-full object-cover" />
            : <span className="flex h-full items-center justify-center bg-pastel-sprout"><Sprout size={28} className="text-text-secondary" aria-hidden="true" /></span>}
        </span>
        <span aria-hidden="true" className="specimen-label mt-2 block px-1">
          <span className="block truncate font-hand text-base">{entry.name}</span>
          <span className="block truncate text-[11px] text-text-secondary">{[entry.family, dayLabel(entry.createdAt)].filter(Boolean).join(' · ')}</span>
        </span>
      </button>
    </li>
  )
}

function useGardenEntries() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    let alive = true
    const session = getSessionVersion()
    const current = () => alive && session === getSessionVersion()
    gardenService.list()
      .then((list) => { if (current()) setEntries(list ?? []) })
      .catch(() => { if (current()) setLoadError('图鉴没读出来，请稍后再试。') })
      .finally(() => { if (current()) setLoading(false) })
    // 退出登录时清空，不把上一个人的图鉴留在页面上
    const unsubscribe = onSessionReset(() => { setEntries([]); setLoadError('') })
    return () => { alive = false; unsubscribe() }
  }, [])
  return { entries, setEntries, loading, loadError }
}

/** 翻看图鉴：认一认的三个入口、遇见/养着筛选、标本签网格；空的时候说一句怎么开始。 */
function GardenBrowse({ entries, visible, loading, error, status, onStatus, adding, onToggleAdding, onTakePhoto, onPickAlbum, onManual, onOpen, pickers }) {
  const kinds = kindsOf(entries)
  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      {pickers}
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-hand text-lg text-text-primary">
          <Sticker name="daisy" size={34} className="-my-2" />
          {kinds > 0 ? `遇见过 ${kinds} 种` : '花草图鉴'}
        </p>
        <button type="button" aria-expanded={adding} onClick={onToggleAdding} className="flex min-h-11 items-center gap-1.5 rounded-full bg-action-primary px-4 text-sm font-semibold text-text-inverse">
          <Sprout size={16} aria-hidden="true" />认一认
        </button>
      </div>
      {adding && (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onTakePhoto} className={choiceClass}><Camera size={16} aria-hidden="true" />拍一张</button>
          <button type="button" onClick={onPickAlbum} className={choiceClass}><ImagePlus size={16} aria-hidden="true" />从相册选</button>
          <button type="button" onClick={onManual} className={choiceClass}><PenLine size={16} aria-hidden="true" />自己写</button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      {loading && <p role="status" className="mt-6 text-center text-sm text-text-muted">正在翻开…</p>}
      {!loading && !error && entries.length === 0 && (
        <p className="mt-10 px-6 text-center font-hand text-lg leading-relaxed text-text-secondary">路上看到一朵叫不出名字的花，拍下来，她帮你认一认。</p>
      )}
      {entries.length > 0 && (
        <div className="mt-4">
          <div role="group" aria-label="路上遇见还是我养的" className="flex gap-2">
            {[['all', '全部'], ...Object.entries(STATUS_LABELS)].map(([value, label]) => (
              <button key={value} type="button" aria-pressed={status === value} onClick={() => onStatus(value)} className={chip(status === value)}>{label}</button>
            ))}
          </div>
          <ul aria-label="花草图鉴" className="mt-3 grid grid-cols-2 gap-3 pb-6 min-[641px]:grid-cols-3 min-[1024px]:grid-cols-4">
            {visible.map((entry) => <SpecimenCard key={entry.id} entry={entry} onOpen={() => onOpen(entry.id)} />)}
          </ul>
          {visible.length === 0 && <p className="text-center text-sm text-text-secondary">这里还没有。</p>}
        </div>
      )}
    </div>
  )
}

/** 花草图鉴（路线图 C26）：拍一张 → 她认一认、讲一讲 → 收不收由你；也可以不认，自己写名字收进来。 */
export default function GardenBook() {
  const navigate = useNavigate()
  const { entries, setEntries, loading, loadError } = useGardenEntries()
  const [status, setStatus] = useState('all')
  const [view, setView] = useState(/** @type {GardenView} */ ({ kind: 'browse' }))
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const albumRef = useRef(null)
  const cameraRef = useRef(null)
  // 认到一半换了页面（不收了、退出登录）就丢掉晚到的结果
  const attempt = useRef(0)

  const visible = useMemo(() => entries.filter((entry) => status === 'all' || entry.status === status), [entries, status])
  const detail = ['detail', 'edit'].includes(view.kind) ? entries.find((entry) => entry.id === view.id) : null

  const identify = async (photos) => {
    const mine = ++attempt.current
    setView({ kind: 'identifying', photos })
    try {
      const result = await gardenService.identify(photos.photo)
      if (mine === attempt.current) setView({ kind: 'result', photos, result })
    } catch (failure) {
      if (mine === attempt.current) setView({ kind: 'failed', photos, failure: identifyFailure(failure) })
    }
  }

  const withPhoto = async (file) => {
    if (!file) return
    setError('')
    setAdding(false)
    try {
      await identify(await preparePhoto(file))
    } catch (failure) {
      setView({ kind: 'browse' })
      setError(failure.message)
    }
  }

  const backToBrowse = () => {
    attempt.current += 1
    setView({ kind: 'browse' })
  }

  const takePhoto = () => {
    if (prefersSystemCamera()) cameraRef.current?.click()
    else setView({ kind: 'camera' })
  }

  const collect = async (fields, photos) => {
    const saved = await gardenService.create(fields, photos)
    setEntries((list) => [saved, ...list])
    setView({ kind: 'browse' })
  }

  const saveEdit = async (fields, photos) => {
    const saved = await gardenService.update(view.id, fields, photos)
    setEntries((list) => list.map((entry) => (entry.id === saved.id ? saved : entry)))
    setView({ kind: 'detail', id: saved.id })
  }

  const changeStatus = async (next) => {
    const saved = await gardenService.update(detail.id, { status: next })
    setEntries((list) => list.map((entry) => (entry.id === saved.id ? saved : entry)))
  }

  const remove = async () => {
    await gardenService.remove(detail.id)
    setEntries((list) => list.filter((entry) => entry.id !== detail.id))
    setView({ kind: 'browse' })
  }

  const pickers = (
    <>
      <input ref={albumRef} type="file" accept="image/*" aria-label="从相册选一张" className="sr-only" onChange={(event) => { withPhoto(event.target.files?.[0]); event.target.value = '' }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" aria-label="拍一张（打开相机）" className="sr-only" onChange={(event) => { withPhoto(event.target.files?.[0]); event.target.value = '' }} />
    </>
  )
  const page = (content) => <div className="flex-1 overflow-y-auto px-4 py-4">{content}</div>

  if (view.kind === 'camera') {
    return page(<>{pickers}<CameraCapture onCapture={withPhoto} onCancel={backToBrowse} onFallback={() => { backToBrowse(); albumRef.current?.click() }} /></>)
  }
  if (['identifying', 'result', 'failed'].includes(view.kind)) {
    return page(
      <IdentifyResult
        key={view.kind}
        photos={view.photos} state={/** @type {'identifying' | 'result' | 'failed'} */ (view.kind)} result={view.result} failure={view.failure}
        onCollect={(fields) => collect(fields, view.photos)}
        onDiscard={backToBrowse}
        onRetry={() => identify(view.photos)}
        onManual={() => setView({ kind: 'manual', photos: view.photos })}
        onSettings={() => navigate('/settings')}
      />,
    )
  }
  if (view.kind === 'manual') {
    return page(<PlantEditor initial={{ photos: view.photos ?? null }} title="自己写一株" onSubmit={collect} onCancel={backToBrowse} />)
  }
  if (view.kind === 'edit' && detail) {
    return page(<PlantEditor initial={{ ...detail, photoPath: detail.photoUrl }} title="改一改" onSubmit={saveEdit} onCancel={() => setView({ kind: 'detail', id: detail.id })} />)
  }
  if (detail) {
    return page(
      <PlantDetail
        entry={detail}
        onBack={backToBrowse}
        onEdit={() => setView({ kind: 'edit', id: detail.id })}
        onStatus={changeStatus}
        onDelete={remove}
      />,
    )
  }

  return (
    <GardenBrowse
      entries={entries} visible={visible} loading={loading} error={error || loadError}
      status={status} onStatus={setStatus}
      adding={adding} onToggleAdding={() => setAdding((open) => !open)}
      onTakePhoto={takePhoto} onPickAlbum={() => albumRef.current?.click()}
      onManual={() => { setAdding(false); setView({ kind: 'manual' }) }}
      onOpen={(id) => setView({ kind: 'detail', id })}
      pickers={pickers}
    />
  )
}
