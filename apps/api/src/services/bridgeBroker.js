/**
 * 本机助手的任务中转（进程内存）。
 *
 * 服务端连不到用户电脑，所以由用户电脑上的助手长轮询来取任务，执行后把结果交回。
 * 每台电脑同一时间只挂一个轮询；轮询结束后的短暂空档仍算在线。
 * 当前是单实例 API（单机 2 核 2G），内存足够；多实例部署时需要换成共享队列。
 */
import { randomUUID } from 'node:crypto'
import { HttpError } from '../utils/dbHelpers.js'

export const POLL_WAIT_MS = 25_000
const ONLINE_GRACE_MS = 40_000
const DEFAULT_JOB_TIMEOUT_MS = 60_000

/** bridgeId → { userId, queue, waiter, lastPollAt } */
const bridges = new Map()
/** jobId → { bridgeId, resolve, reject, timer } */
const jobs = new Map()

const offline = () => Object.assign(new HttpError('没有连接你的电脑：请在电脑上打开 Amie 本机助手', 409), { code: 'BRIDGE_OFFLINE' })

function bridgeEntry(bridge) {
  let entry = bridges.get(bridge.id)
  if (!entry) {
    entry = { userId: bridge.userId, queue: [], waiter: null, lastPollAt: 0 }
    bridges.set(bridge.id, entry)
  }
  return entry
}

function isOnline(entry, now = Date.now()) {
  return Boolean(entry.waiter) || now - entry.lastPollAt < ONLINE_GRACE_MS
}

export function isBridgeConnected(bridgeId) {
  const entry = bridges.get(bridgeId)
  return Boolean(entry && isOnline(entry))
}

export function isUserBridgeOnline(userId) {
  for (const entry of bridges.values()) if (entry.userId === userId && isOnline(entry)) return true
  return false
}

/** 助手来取任务：有排队的立即给；没有就挂起，最多等 POLL_WAIT_MS，返回 null 表示这轮没有任务。 */
export function waitForJob(bridge, { signal } = {}) {
  const entry = bridgeEntry(bridge)
  entry.lastPollAt = Date.now()
  if (entry.queue.length) return Promise.resolve(entry.queue.shift())
  // 同一台电脑的旧轮询让位给新的（例如助手重启后重连）
  entry.waiter?.finish(null)
  return new Promise((resolve) => {
    const waiter = {
      finish(job) {
        clearTimeout(waiter.timer)
        signal?.removeEventListener('abort', onAbort)
        if (entry.waiter === waiter) entry.waiter = null
        entry.lastPollAt = Date.now()
        resolve(job)
      },
    }
    const onAbort = () => waiter.finish(null)
    waiter.timer = setTimeout(() => waiter.finish(null), POLL_WAIT_MS)
    signal?.addEventListener('abort', onAbort, { once: true })
    entry.waiter = waiter
    if (signal?.aborted) waiter.finish(null)
  })
}

/** 把一个工具调用交给用户最近在线的那台电脑，等它交回结果。 */
export function dispatchJob(userId, tool, args, { signal, timeoutMs = DEFAULT_JOB_TIMEOUT_MS } = {}) {
  signal?.throwIfAborted()
  let target = null
  for (const [bridgeId, entry] of bridges) {
    if (entry.userId !== userId || !isOnline(entry)) continue
    if (!target || entry.lastPollAt > target.entry.lastPollAt) target = { bridgeId, entry }
  }
  if (!target) return Promise.reject(offline())
  const job = { id: randomUUID(), tool, args }
  return new Promise((resolve, reject) => {
    const settle = (callback, value) => {
      const pending = jobs.get(job.id)
      if (!pending) return
      clearTimeout(pending.timer)
      signal?.removeEventListener('abort', onAbort)
      jobs.delete(job.id)
      target.entry.queue = target.entry.queue.filter((queued) => queued.id !== job.id)
      callback(value)
    }
    const onAbort = () => settle(reject, signal.reason)
    jobs.set(job.id, {
      bridgeId: target.bridgeId,
      resolve: (value) => settle(resolve, value),
      reject: (error) => settle(reject, error),
      timer: setTimeout(() => settle(reject, Object.assign(new HttpError('电脑那边太久没有回应', 504), { code: 'BRIDGE_TIMEOUT' })), timeoutMs),
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    if (target.entry.waiter) target.entry.waiter.finish(job)
    else target.entry.queue.push(job)
  })
}

/** 助手交回结果；只接受发给这台电脑、仍在等待的任务。 */
export function completeJob(bridgeId, jobId, { ok, result, error } = {}) {
  const pending = jobs.get(jobId)
  if (!pending || pending.bridgeId !== bridgeId) return false
  if (ok === true) pending.resolve(result)
  else pending.reject(Object.assign(new HttpError(typeof error === 'string' && error ? error.slice(0, 200) : '电脑那边没有完成', 400), { code: 'BRIDGE_TOOL_FAILED' }))
  return true
}

/** 断开一台电脑：结束它的轮询，在途任务按离线失败。 */
export function disconnectBridge(bridgeId) {
  const entry = bridges.get(bridgeId)
  if (!entry) return
  entry.waiter?.finish(null)
  bridges.delete(bridgeId)
  for (const pending of jobs.values()) if (pending.bridgeId === bridgeId) pending.reject(offline())
}

export function resetBridgeBroker() {
  for (const bridgeId of [...bridges.keys()]) disconnectBridge(bridgeId)
}
