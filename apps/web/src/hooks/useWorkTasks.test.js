import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../services/workTaskService', () => ({ workTaskService: {
  status: vi.fn(), list: vi.fn(), create: vi.fn(), cancel: vi.fn(), retry: vi.fn(),
} }))
import { workTaskService } from '../services/workTaskService'
import { useChatStore } from '../stores/chatStore'
import { resetSession } from '../services/sessionLifecycle'
import { useWorkTasks } from './useWorkTasks'

const deferred = () => {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}
const task = { id: 'one', conversationId: 'c1', content: '整理报告', status: 'queued', updatedAt: '2026-09-15T00:00:00Z' }
describe('work task lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workTaskService.status.mockResolvedValue({ capabilities: { backgroundTasks: true } })
    workTaskService.list.mockResolvedValue([])
    useChatStore.setState({ chatMode: 'work', currentConversationId: 'c1', isSending: false, refreshConversation: vi.fn() })
  })

  it('remount discovers persistent results and refreshes their conversation', async () => {
    workTaskService.list.mockResolvedValue([{ ...task, status: 'completed' }])
    const first = renderHook(() => useWorkTasks(true))
    await waitFor(() => expect(first.result.current.tasks).toHaveLength(1))
    first.unmount()
    const second = renderHook(() => useWorkTasks(true))
    await waitFor(() => expect(second.result.current.tasks[0].status).toBe('completed'))
    expect(useChatStore.getState().refreshConversation).toHaveBeenCalledWith('c1')
    expect(workTaskService.cancel).not.toHaveBeenCalled()
  })

  it('an uncertain submission retries with the same key and original file', async () => {
    workTaskService.create.mockRejectedValueOnce(new Error('Lost response')).mockResolvedValue(task)
    const file = new File(['x'], 'sample.csv')
    const hook = renderHook(() => useWorkTasks(true))
    await waitFor(() => expect(hook.result.current.available).toBe(true))
    await act(async () => { expect(await hook.result.current.submit('整理报告', { files: [file] })).toBe(false) })
    const key = workTaskService.create.mock.calls[0][3]
    await act(async () => { expect(await hook.result.current.submit('整理报告', { files: [file] })).toBe(true) })
    expect(workTaskService.create.mock.calls[1]).toEqual(['c1', '整理报告', [file], key])
    expect(key).toBeTruthy()
  })

  it('late submit and polling responses cannot restore the old account after logout', async () => {
    const submitted = deferred(), polled = deferred()
    workTaskService.create.mockReturnValue(submitted.promise)
    workTaskService.list.mockReturnValue(polled.promise)
    const hook = renderHook(() => useWorkTasks(true))
    await waitFor(() => expect(hook.result.current.available).toBe(true))
    let request
    act(() => { request = hook.result.current.submit('整理报告') })
    act(() => resetSession())
    await act(async () => { submitted.resolve(task); polled.resolve([task]); await request })
    expect(hook.result.current.tasks).toEqual([])
    expect(hook.result.current.available).toBe(false)
    expect(hook.result.current.submitting).toBe(false)
  })

  it('leaving work mode does not cancel a submitted task or inject it into chat mode', async () => {
    const pending = deferred()
    workTaskService.create.mockReturnValue(pending.promise)
    const hook = renderHook(({ enabled }) => useWorkTasks(enabled), { initialProps: { enabled: true } })
    await waitFor(() => expect(hook.result.current.available).toBe(true))
    let request
    act(() => { request = hook.result.current.submit('整理报告') })
    hook.rerender({ enabled: false })
    await act(async () => { pending.resolve(task); await request })
    expect(hook.result.current.tasks).toEqual([])
    expect(hook.result.current.submitting).toBe(false)
    expect(workTaskService.cancel).not.toHaveBeenCalled()
  })

  it('only explicit cancellation invokes the cancel API', async () => {
    workTaskService.list.mockResolvedValue([task])
    workTaskService.cancel.mockResolvedValue({ ...task, status: 'cancelled' })
    const hook = renderHook(() => useWorkTasks(true))
    await waitFor(() => expect(hook.result.current.tasks).toHaveLength(1))
    await act(async () => hook.result.current.cancel('one'))
    expect(hook.result.current.tasks[0].status).toBe('cancelled')
    expect(workTaskService.cancel).toHaveBeenCalledWith('one')
  })
})
