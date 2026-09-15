import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { Sparkles } from 'lucide-react'
import Header from '../components/layout/Header'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import SourceBadge from '../components/ui/SourceBadge'
import Spinner from '../components/ui/Spinner'
import { studyService } from '../services/studyService'

const PRESET_MINUTES = [25, 45, 60]
const MAX_MINUTES = 240

const inputClass = 'w-full rounded-2xl bg-surface-input p-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-status-info'

function formatClock(totalSec) {
  const sec = Math.max(0, totalSec)
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
}

export default function StudyPage() {
  const [summary, setSummary] = useState(null)
  const [sessions, setSessions] = useState([])
  const [phase, setPhase] = useState('idle') // idle | running | done
  const [selectedMinutes, setSelectedMinutes] = useState(25)
  const [customMinutes, setCustomMinutes] = useState('')
  const [subject, setSubject] = useState('')
  const [run, setRun] = useState(null)
  const [remainingSec, setRemainingSec] = useState(0)
  const [doneActual, setDoneActual] = useState(0)
  const [showGiveUp, setShowGiveUp] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [savedSession, setSavedSession] = useState(null)
  const [commentLoading, setCommentLoading] = useState(false)
  const [commentError, setCommentError] = useState('')
  const [commentPreview, setCommentPreview] = useState(null)
  const [loadingRun, setLoadingRun] = useState(true)
  const [runError, setRunError] = useState('')
  const [statsError, setStatsError] = useState('')
  const [busy, setBusy] = useState(false)
  const finishPending = useRef(false)
  const autoFinishedId = useRef(null)

  const plannedMinutes = customMinutes.trim() ? Number(customMinutes) : selectedMinutes
  const plannedValid = Number.isInteger(plannedMinutes) && plannedMinutes >= 1 && plannedMinutes <= MAX_MINUTES

  const refreshStats = useCallback(() => {
    setStatsError('')
    Promise.all([studyService.getSummary(), studyService.listSessions(30)])
      .then(([nextSummary, nextSessions]) => { setSummary(nextSummary); setSessions(nextSessions) })
      .catch(() => setStatsError('自习统计加载失败，请重试'))
  }, [])
  const applyRun = useCallback((next) => {
    setRun(next ? { ...next, clockOffset: new Date(next.serverNow).getTime() - Date.now() } : null)
    setRemainingSec(next ? next.plannedMinutes * 60 - Math.floor((new Date(next.serverNow).getTime() - new Date(next.startedAt).getTime()) / 1000) : 0)
    setPhase(!next ? 'idle' : next.status === 'running' ? 'running' : 'done')
    setDoneActual(next?.actualMinutes || 0)
    setSavedSession(next?.savedSession || null)
    if (next) setSubject(next.subject || '')
  }, [])
  const loadActive = useCallback(async () => {
    setLoadingRun(true); setRunError('')
    try { applyRun(await studyService.getActive()) } catch { setRunError('计时状态加载失败，请重试后再开始') }
    finally { setLoadingRun(false) }
  }, [applyRun])
  useEffect(() => { refreshStats(); loadActive() }, [refreshStats, loadActive])

  // 计时用时间戳推算：interval 只触发重算，避免标签页隐藏时漂移
  const finishRef = useRef(() => {})
  finishRef.current = async () => {
    if (!run || finishPending.current) return
    finishPending.current = true
    setBusy(true); setRunError('')
    try { applyRun(await studyService.finish(run.id)) }
    catch (error) { setRunError(error?.response?.data?.error || '结束计时失败，请重试') }
    finally { finishPending.current = false; setBusy(false) }
  }
  useEffect(() => {
    if (!run || phase !== 'running') return undefined
    const tick = () => {
      const remaining = run.plannedMinutes * 60 - Math.floor((Date.now() + run.clockOffset - new Date(run.startedAt).getTime()) / 1000)
      setRemainingSec(remaining)
      if (remaining <= 0 && autoFinishedId.current !== run.id) {
        autoFinishedId.current = run.id
        finishRef.current()
      }
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [run, phase])

  const handleStart = async () => {
    if (!plannedValid || busy || loadingRun) return
    setBusy(true); setRunError('')
    try {
      applyRun(await studyService.start({ plannedMinutes, subject: subject.trim() || undefined }))
      setNote(''); setCommentError(''); setCommentPreview(null); setSaveError('')
    } catch (error) {
      if (error?.response?.status === 409) await loadActive()
      setRunError(error?.response?.data?.error || '开始计时失败，请重试')
    } finally { setBusy(false) }
  }

  const handleGiveUp = async () => {
    setShowGiveUp(false)
    if (!run || busy) return
    setBusy(true); setRunError('')
    try { await studyService.cancel(run.id); applyRun(null) }
    catch (error) { setRunError(error?.response?.data?.error || '取消计时失败，请重试') }
    finally { setBusy(false) }
  }

  const handleSave = async () => {
    if (!run || saving) return
    setSaving(true); setSaveError('')
    try {
      const session = await studyService.recordSession({
        runId: run.id,
        note: note.trim() || undefined,
      })
      setSavedSession(session)
      refreshStats()
    } catch (requestError) {
      setSaveError(requestError?.response?.data?.error || '保存失败，请稍后再试')
    } finally {
      setSaving(false)
    }
  }

  const handleComment = async () => {
    if (!savedSession || commentLoading) return
    setCommentLoading(true); setCommentError('')
    try {
      const result = await studyService.requestSessionComment(savedSession.id)
      if (result.source === 'cloud_mock') setCommentPreview(result)
      else setSavedSession(prev => ({ ...prev, aiComment: result.aiComment, aiCommentSource: result.source }))
    } catch (requestError) {
      const code = requestError?.response?.data?.code
      setCommentError(code === 'CLOUD_NOT_CONSENTED' ? 'not_consented' : 'unavailable')
    } finally {
      setCommentLoading(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
      <Header title="专注自习" showBack />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <Card className="p-4">
          {statsError ? <div><p role="alert" className="text-xs text-danger">{statsError}</p><Button variant="secondary" onClick={refreshStats}>重试统计</Button></div> : summary ? <p className="text-sm text-text-secondary tabular-nums">
            今天 {summary?.todayMinutes ?? 0} 分钟 · 本周 {summary?.weekMinutes ?? 0} 分钟 · 连续 {summary?.streak ?? 0} 天
          </p> : <p role="status" className="text-sm text-text-muted">正在读取自习统计…</p>}
        </Card>

        <Card className="p-4">
          <p className="mb-3 text-xs text-text-muted">本轮计时为模拟预览，服务重启或 24 小时后未保存的计时会失效。点击「记下这次」才会保存自习记录。</p>
          {loadingRun && <p role="status" className="mb-3 text-sm text-text-muted">正在恢复计时…</p>}
          {runError && <div className="mb-3"><p role="alert" className="text-xs text-danger">{runError}</p><Button variant="secondary" disabled={busy || loadingRun} onClick={loadActive}>重新读取计时</Button></div>}
          {phase === 'idle' && (
            <>
              <div className="flex gap-2" role="group" aria-label="专注时长">
                {PRESET_MINUTES.map(minutes => (
                  <button
                    key={minutes}
                    type="button"
                    aria-pressed={!customMinutes.trim() && selectedMinutes === minutes}
                    onClick={() => { setSelectedMinutes(minutes); setCustomMinutes('') }}
                    className={`min-h-11 flex-1 rounded-xl text-sm ${!customMinutes.trim() && selectedMinutes === minutes ? 'bg-pastel-blush font-semibold text-action-primary' : 'bg-surface-muted text-text-muted'}`}
                  >
                    {minutes} 分钟
                  </button>
                ))}
              </div>
              <div className="mt-2 space-y-2">
                <input
                  aria-label="自定义分钟"
                  inputMode="numeric"
                  value={customMinutes}
                  onChange={event => setCustomMinutes(event.target.value)}
                  placeholder={`自定义分钟（1-${MAX_MINUTES}）`}
                  className={inputClass}
                />
                <input
                  aria-label="科目"
                  value={subject}
                  maxLength={20}
                  onChange={event => setSubject(event.target.value)}
                  placeholder="科目/标签，可空"
                  className={inputClass}
                />
              </div>
              <Button variant="primary" className="mt-2 w-full" disabled={!plannedValid || busy || loadingRun || !!runError} onClick={handleStart}>
                开始自习
              </Button>
            </>
          )}

          {phase === 'running' && run && (
            <div className="text-center">
              <p className="text-4xl font-bold tabular-nums text-text-primary">{formatClock(remainingSec)}</p>
              <p className="mt-2 text-sm text-text-secondary">我在旁边安静看书呢，你专心学</p>
              <div className="mt-4 flex gap-2">
                <Button variant="primary" className="flex-1" disabled={busy || loadingRun} onClick={() => finishRef.current()}>提前完成</Button>
                <Button variant="secondary" className="flex-1" disabled={busy || loadingRun} onClick={() => setShowGiveUp(true)}>放弃</Button>
              </div>
            </div>
          )}

          {phase === 'done' && (
            <>
              <p className="text-center text-sm text-text-secondary">这次专注了 <span className="font-semibold text-text-primary">{doneActual} 分钟</span></p>
              {!savedSession ? (
                <div className="mt-3 space-y-2">
                  <input
                    aria-label="一句话收获"
                    value={note}
                    maxLength={200}
                    onChange={event => setNote(event.target.value)}
                    placeholder="一句话收获，可空"
                    className={inputClass}
                  />
                  {saveError && <p role="alert" className="text-xs text-danger">{saveError}</p>}
                  <Button variant="primary" className="w-full" disabled={saving} onClick={handleSave}>
                    {saving ? <Spinner onDark /> : null}
                    记下这次
                  </Button>
                </div>
              ) : (
                <div className="mt-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex rounded-full bg-pastel-mist px-2 py-0.5 text-[10px] font-medium text-status-info">AI</span>
                    <span className="text-xs font-semibold text-text-primary">姐妹的回应</span>
                  </div>
                  {savedSession.aiComment || commentPreview ? (
                    <div className="mt-2">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{commentPreview?.aiComment || savedSession.aiComment}</p>
                      <div className="mt-1">
                        <SourceBadge source={commentPreview?.source || savedSession.aiCommentSource} />
                      </div>
                      {commentPreview && <p className="mt-2 text-xs text-text-muted">这是模拟回应，未连接云端，也未保存到自习记录。</p>}
                    </div>
                  ) : (
                    <div className="mt-2">
                      <Button variant="secondary" className="w-full" disabled={commentLoading} onClick={handleComment}>
                        {commentLoading ? <Spinner /> : <Sparkles size={16} />}
                        让姐妹看看
                      </Button>
                      {commentError === 'not_consented' && (
                        <p role="alert" className="mt-2 text-xs text-danger">
                          还没有同意使用云端模型，去<Link to="/settings" className="underline">「设置 → 聊天模型」</Link>开启后再让她看看吧
                        </p>
                      )}
                      {commentError === 'unavailable' && (
                        <p role="alert" className="mt-2 text-xs text-danger">姐妹现在有点忙，稍后再让她看看吧</p>
                      )}
                    </div>
                  )}
                </div>
              )}
              <Button variant="secondary" className="mt-3 w-full" disabled={busy || saving} onClick={() => savedSession ? applyRun(null) : setShowGiveUp(true)}>
                {savedSession ? '再来一轮' : '放弃这次记录'}
              </Button>
            </>
          )}
        </Card>

        {sessions.length > 0 && (
          <section>
            <h2 className="px-1 text-xs font-semibold text-text-muted">最近的自习</h2>
            <Card className="mt-2 p-4">
              <ul className="divide-y divide-border-hairline">
                {sessions.map(session => (
                  <li key={session.id} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm text-text-primary">
                        {format(new Date(session.createdAt), 'M月d日')} · {session.subject || '自习'}
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-text-secondary">{session.actualMinutes} 分钟</span>
                    </div>
                    {session.aiComment && (
                      <p title={session.aiComment} className="mt-1 truncate text-xs text-text-muted">{session.aiComment}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={showGiveUp}
        title="放弃这次自习"
        description="现在放弃不会记录这次自习，确定吗？"
        confirmLabel="确定放弃"
        danger
        onConfirm={handleGiveUp}
        onCancel={() => setShowGiveUp(false)}
      />

    </div>
  )
}
