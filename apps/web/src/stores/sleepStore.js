import { create } from 'zustand'
import { sleepService } from '../services/sleepService'
import { nudgeService } from '../services/nudgeService'
import { assertSessionVersion, getSessionVersion, onSessionReset } from '../services/sessionLifecycle'

// 对话页便签与睡眠卡、早安卡收起的是同一张便签：谁收起了就广播一声，另一边跟着拿掉
export const NUDGE_ACKED_EVENT = 'amie:nudge-acked'

export const announceNudgeAcked = (id) => {
  window.dispatchEvent(new CustomEvent(NUDGE_ACKED_EVENT, { detail: { id } }))
}

const EMPTY = { bedtime: null, wake: null, due: [], loaded: false }

/**
 * 睡眠卡的一份状态：日程页的睡眠卡改时间，全局的闹钟马上按新时间守着。
 * bedtime / wake 为 null 表示还没设过；due 是到点还没收起的便签。
 */
export const useSleepStore = create((set) => ({
  ...EMPTY,

  load: async () => {
    const session = getSessionVersion()
    const data = await sleepService.get()
    assertSessionVersion(session)
    const next = { bedtime: data?.bedtime ?? null, wake: data?.wake ?? null, due: Array.isArray(data?.due) ? data.due : [], loaded: true }
    set(next)
    return next
  },

  /** kind 为 'bedtime' | 'wake'，setting 为 { enabled, time, weekdays }。 */
  save: async (kind, setting) => {
    const session = getSessionVersion()
    const routine = await sleepService.save({ [kind]: setting })
    assertSessionVersion(session)
    // 改过的那一类，旧便签服务端已经收起了
    set((state) => ({
      bedtime: routine?.bedtime ?? null,
      wake: routine?.wake ?? null,
      due: state.due.filter((note) => note.kind !== kind),
      loaded: true,
    }))
    return routine
  },

  /** 收起一张便签：本地先拿掉，再告诉服务端；失败不打扰，下次拉取时条件仍成立还会出现。 */
  dismiss: (id) => {
    set((state) => ({ due: state.due.filter((note) => note.id !== id) }))
    announceNudgeAcked(id)
    return nudgeService.ack(id).catch(() => {})
  },
}))

// 对话页那边收起了同一张便签
if (typeof window !== 'undefined') {
  window.addEventListener(NUDGE_ACKED_EVENT, (event) => {
    const id = /** @type {CustomEvent} */ (event).detail?.id
    if (!id) return
    useSleepStore.setState((state) => (state.due.some((note) => note.id === id)
      ? { due: state.due.filter((note) => note.id !== id) }
      : state))
  })
}

onSessionReset(() => useSleepStore.setState({ ...EMPTY }))
