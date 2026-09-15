import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../services/memoryService', () => ({
  memoryService: Object.fromEntries(['listPage', 'get', 'revisions', 'restore', 'latestIndexJob', 'indexJob', 'createIndexJob', 'cancelIndexJob'].map((name) => [name, vi.fn()])),
}))
vi.mock('../../services/derivedService', () => ({
  derivedService: Object.fromEntries(['list', 'listEdges', 'promote', 'resolve', 'dismiss', 'promoteEdge', 'dismissEdge', 'clear', 'analyze', 'rebuild'].map((name) => [name, vi.fn()])),
}))
import { memoryService } from '../../services/memoryService'
import { derivedService } from '../../services/derivedService'
import MemoryHubPage from '../../pages/MemoryHubPage'
import MemoryDetailPanel from './MemoryDetailPanel'
import MemoryIndexPanel from './MemoryIndexPanel'

const draft = { id: 'draft1', revision: 1, kind: 'pattern', status: 'active', content: '常在周末爬山', sources: [{ type: 'memory', id: 'm1', revision: 1, quote: '周末爬山' }] }
const renderHub = (tab = 'pending') => render(<MemoryRouter initialEntries={['/memories?tab=' + tab]}><MemoryHubPage /></MemoryRouter>)
beforeEach(() => {
  vi.resetAllMocks()
  memoryService.listPage.mockResolvedValue({ data: [], total: 0 })
  memoryService.latestIndexJob.mockResolvedValue(null)
  derivedService.list.mockResolvedValue({ insights: [draft] })
  derivedService.listEdges.mockResolvedValue({ edges: [] })
})

describe('memory hub confirmation boundary', () => {
  it('pending content remains outside the saved tab until the user confirms', async () => {
    const user = userEvent.setup(); renderHub()
    expect(await screen.findByText(draft.content)).toBeInTheDocument()
    expect(derivedService.promote).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '已记住', exact: true }))
    expect(await screen.findByText('还没有记忆')).toBeInTheDocument()
    expect(screen.queryByText(draft.content)).not.toBeInTheDocument()
  })
  it('confirmation binds the expected draft revision and preserves verified provenance', async () => {
    const user = userEvent.setup(); renderHub()
    await user.click(await screen.findByRole('button', { name: '确认这条理解' }))
    expect(derivedService.promote).toHaveBeenCalledWith('draft1', { expectedRevision: 1, type: 'semantic', content: undefined, asManual: false })
  })
  it('an old draft without evidence requires explicit manual review', async () => {
    derivedService.list.mockResolvedValue({ insights: [{ ...draft, sources: [], status: 'needs_review', revision: 3 }] })
    const user = userEvent.setup(); renderHub()
    await screen.findByText(draft.content)
    expect(screen.queryByRole('button', { name: '确认这条理解' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '编辑核对后记住' }))
    await user.clear(screen.getByLabelText('核对后的记忆内容'))
    await user.type(screen.getByLabelText('核对后的记忆内容'), '这是我核对后的内容')
    await user.click(screen.getByRole('button', { name: '确认并记住' }))
    expect(derivedService.promote).toHaveBeenCalledWith('draft1', expect.objectContaining({ expectedRevision: 3, asManual: true, content: '这是我核对后的内容' }))
  })
  it('a stale confirmation preserves user text and reports the server conflict', async () => {
    derivedService.promote.mockRejectedValue({ response: { status: 409, data: { error: '依据已变化，请重新核对' } } })
    const user = userEvent.setup(); renderHub()
    await user.click(await screen.findByRole('button', { name: '编辑核对后记住' }))
    await user.type(screen.getByLabelText('核对后的记忆内容'), '（我的补充）')
    await user.click(screen.getByRole('button', { name: '确认并记住' }))
    expect(await screen.findByText('依据已变化，请重新核对')).toBeInTheDocument()
    expect(screen.getByLabelText('核对后的记忆内容')).toHaveValue(draft.content + '（我的补充）')
  })
  it('mock analysis only displays the returned preview', async () => {
    derivedService.analyze.mockResolvedValue({ created: 0, preview: { content: '模拟整理示例，没有读取私人记录' } })
    const user = userEvent.setup(); renderHub()
    await user.click(screen.getByRole('button', { name: '预览整理' }))
    expect(await screen.findByText(/模拟整理示例/)).toBeInTheDocument()
    expect(derivedService.promote).not.toHaveBeenCalled()
    expect(derivedService.clear).not.toHaveBeenCalled()
  })
  it('relation review sends both current endpoint versions and the relationship version', async () => {
    derivedService.listEdges.mockResolvedValue({ edges: [{
      id: 'edge1', status: 'needs_review', relation: 'contradicts', revision: 4, fromRevision: 1, toRevision: 1,
      from: { id: 'm1', content: '旧偏好已更改', revision: 2 }, to: { id: 'm2', content: '另一条记忆', revision: 1 }, decisions: [],
      evidence: [{ type: 'memory', status: 'missing', quote: '外部缺失的依据' }],
    }] })
    const user = userEvent.setup(); renderHub('relations')
    expect(await screen.findByText(/依据版本：v1 \/ v1；当前版本：v2 \/ v1/)).toBeInTheDocument()
    expect(derivedService.promoteEdge).not.toHaveBeenCalled()
    await user.click(screen.getByText('查看关系依据与确认记录'))
    expect(screen.getByText('来源已缺失：外部缺失的依据')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新确认关系' }))
    expect(derivedService.promoteEdge).toHaveBeenCalledWith('edge1', { expectedRevision: 4, expectedFromRevision: 2, expectedToRevision: 1 })
  })
})

describe('revision recovery and index tasks', () => {
  it('a late initial status response cannot replace a newly created task', async () => {
    let finishInitial
    memoryService.latestIndexJob.mockImplementationOnce(() => new Promise((resolve) => { finishInitial = resolve }))
    memoryService.createIndexJob.mockResolvedValue({ id: 'new-job', status: 'queued', processed: 0, total: 1, embedded: 0, skipped: 0, failed: 0 })
    const user = userEvent.setup(); render(<MemoryIndexPanel />)
    await user.click(screen.getByText('记忆检索维护'))
    await user.click(screen.getByRole('button', { name: '全部重新生成' }))
    expect(await screen.findByText(/等待处理 · 已处理 0\/1/)).toBeInTheDocument()
    finishInitial(null)
    await waitFor(() => expect(screen.getByRole('button', { name: '取消任务' })).toBeEnabled())
    expect(screen.getByText(/等待处理 · 已处理 0\/1/)).toBeInTheDocument()
  })
  it('compares versions and restores only after confirmation with the current expected revision', async () => {
    const current = { id: 'm1', revision: 2, content: '现在的内容', importance: 5, tags: [], sources: [] }
    memoryService.get.mockResolvedValue(current)
    memoryService.revisions.mockResolvedValue([
      { ...current, action: 'edit', confirmedAt: '2026-09-13T00:00:00Z' },
      { ...current, revision: 1, content: '过去的内容', action: 'create', confirmedAt: '2026-09-12T00:00:00Z' },
    ])
    memoryService.restore.mockResolvedValue({ ...current, revision: 3 })
    const onRestored = vi.fn(), user = userEvent.setup()
    render(<MemoryDetailPanel id="m1" onClose={vi.fn()} onRestored={onRestored} />)
    await user.selectOptions(await screen.findByLabelText('查看历史版本'), '1')
    expect(screen.getByText('过去的内容')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '恢复这个版本' }))
    expect(memoryService.restore).not.toHaveBeenCalled()
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '确认恢复' }))
    expect(memoryService.restore).toHaveBeenCalledWith('m1', { revision: 1, expectedRevision: 2 })
    await waitFor(() => expect(onRestored).toHaveBeenCalledOnce())
  })
  it('a queued receipt is not completion; polling supplies the final counters', async () => {
    const job = { id: 'job1', status: 'queued', processed: 0, total: 3, embedded: 0, skipped: 0, failed: 0 }
    memoryService.createIndexJob.mockResolvedValue(job)
    memoryService.indexJob.mockResolvedValue({ ...job, status: 'completed', processed: 3, embedded: 2, failed: 1 })
    const user = userEvent.setup(); render(<MemoryIndexPanel />)
    await user.click(screen.getByText('记忆检索维护'))
    await user.click(screen.getByRole('button', { name: '修复缺失或过期索引' }))
    expect(await screen.findByText(/等待处理 · 已处理 0\/3/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '全部重新生成' })).toBeDisabled()
    await waitFor(() => expect(screen.getByText(/处理结束 · 已处理 3\/3 · 成功 2 · 跳过 0 · 失败 1/)).toBeInTheDocument(), { timeout: 2500 })
  })
  it('cancellation uses the active task id and preserves the partial result', async () => {
    const job = { id: 'job1', status: 'running', processed: 1, total: 3, embedded: 1, skipped: 0, failed: 0 }
    memoryService.latestIndexJob.mockResolvedValue(job)
    memoryService.cancelIndexJob.mockResolvedValue({ ...job, status: 'cancelled' })
    const user = userEvent.setup(); render(<MemoryIndexPanel />)
    await user.click(screen.getByText('记忆检索维护'))
    await user.click(await screen.findByRole('button', { name: '取消任务' }))
    expect(memoryService.cancelIndexJob).toHaveBeenCalledWith('job1')
    expect(await screen.findByText(/已取消 · 已处理 1\/3/)).toBeInTheDocument()
  })
})

