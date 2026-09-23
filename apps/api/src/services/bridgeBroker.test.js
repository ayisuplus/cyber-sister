import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  POLL_WAIT_MS,
  completeJob,
  disconnectBridge,
  dispatchJob,
  isBridgeConnected,
  isUserBridgeOnline,
  resetBridgeBroker,
  waitForJob,
} from './bridgeBroker.js'

const laptop = { id: 'bridge-a', userId: 'user-1' }
const desktop = { id: 'bridge-b', userId: 'user-1' }
const stranger = { id: 'bridge-x', userId: 'user-2' }

afterEach(() => {
  resetBridgeBroker()
  vi.useRealTimers()
})

describe('本机助手任务中转', () => {
  it('没有电脑在线时直接说没连上，不排队', async () => {
    expect(isUserBridgeOnline('user-1')).toBe(false)
    await expect(dispatchJob('user-1', 'list', { path: '' })).rejects.toMatchObject({ statusCode: 409, code: 'BRIDGE_OFFLINE' })
  })

  it('助手正在等时任务立刻交给它，交回结果后调用方拿到结果', async () => {
    const polling = waitForJob(laptop)
    expect(isUserBridgeOnline('user-1')).toBe(true)
    expect(isBridgeConnected('bridge-a')).toBe(true)
    const pending = dispatchJob('user-1', 'read', { path: 'a.md' })
    const job = await polling
    expect(job).toMatchObject({ tool: 'read', args: { path: 'a.md' } })
    expect(completeJob('bridge-a', job.id, { ok: true, result: { content: '你好' } })).toBe(true)
    await expect(pending).resolves.toEqual({ content: '你好' })
    expect(completeJob('bridge-a', job.id, { ok: true })).toBe(false)
  })

  it('助手不在等时先排队，下次来取时拿到；失败原因带给调用方', async () => {
    await waitForJob(laptop, { signal: AbortSignal.abort() })
    const pending = dispatchJob('user-1', 'write', { path: 'x.md', content: '内容' })
    const job = await waitForJob(laptop)
    completeJob('bridge-a', job.id, { ok: false, error: '同名文件已存在，没有覆盖' })
    await expect(pending).rejects.toMatchObject({ statusCode: 400, message: '同名文件已存在，没有覆盖', code: 'BRIDGE_TOOL_FAILED' })
  })

  it('别的电脑交不了这个任务的结果，也不会把任务发给别的用户的电脑', async () => {
    const strangerPoll = waitForJob(stranger)
    const polling = waitForJob(laptop)
    const pending = dispatchJob('user-1', 'list', {})
    const job = await polling
    expect(completeJob('bridge-x', job.id, { ok: true, result: 'forged' })).toBe(false)
    completeJob('bridge-a', job.id, { ok: true, result: { entries: [] } })
    await expect(pending).resolves.toEqual({ entries: [] })
    disconnectBridge('bridge-x')
    await expect(strangerPoll).resolves.toBeNull()
  })

  it('多台电脑在线时交给最近来过的那台', async () => {
    vi.useFakeTimers()
    const first = waitForJob(laptop)
    vi.advanceTimersByTime(1000)
    const second = waitForJob(desktop)
    const pending = dispatchJob('user-1', 'list', {})
    const job = await second
    expect(job.tool).toBe('list')
    completeJob('bridge-b', job.id, { ok: true, result: { entries: [] } })
    await pending
    vi.advanceTimersByTime(POLL_WAIT_MS)
    await expect(first).resolves.toBeNull()
  })

  it('轮询到时没有任务就返回 null，之后一段时间内仍算在线', async () => {
    vi.useFakeTimers()
    const polling = waitForJob(laptop)
    vi.advanceTimersByTime(POLL_WAIT_MS)
    await expect(polling).resolves.toBeNull()
    expect(isUserBridgeOnline('user-1')).toBe(true)
    vi.advanceTimersByTime(41_000)
    expect(isUserBridgeOnline('user-1')).toBe(false)
  })

  it('电脑迟迟不回就超时，调用方取消时任务也撤回', async () => {
    vi.useFakeTimers()
    void waitForJob(laptop)
    const slow = dispatchJob('user-1', 'read', { path: 'big.txt' }, { timeoutMs: 1000 })
    vi.advanceTimersByTime(1000)
    await expect(slow).rejects.toMatchObject({ statusCode: 504, code: 'BRIDGE_TIMEOUT' })

    const controller = new AbortController()
    const cancelled = dispatchJob('user-1', 'list', {}, { signal: controller.signal })
    controller.abort(new Error('用户取消'))
    await expect(cancelled).rejects.toThrow('用户取消')
  })

  it('断开时结束轮询，在途任务按离线失败', async () => {
    const polling = waitForJob(laptop)
    const pending = dispatchJob('user-1', 'list', {})
    await polling
    disconnectBridge('bridge-a')
    await expect(pending).rejects.toMatchObject({ code: 'BRIDGE_OFFLINE' })
    expect(isUserBridgeOnline('user-1')).toBe(false)
  })
})
