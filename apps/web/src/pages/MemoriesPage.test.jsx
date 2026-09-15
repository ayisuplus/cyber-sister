import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../services/memoryService', () => ({
  memoryService: Object.fromEntries(['listPage', 'get', 'revisions', 'restore', 'create', 'update', 'remove', 'clear',
    'latestIndexJob', 'indexJob', 'createIndexJob', 'cancelIndexJob'].map((name) => [name, vi.fn()])),
}))
import { memoryService } from '../services/memoryService'
import MemoriesPage from './MemoriesPage'

const renderPage = () => render(<MemoryRouter><MemoriesPage /></MemoryRouter>)
const sampleMemory = { id: 'm1', revision: 1, type: 'semantic', content: '喜欢桂花味', importance: 7, tags: ['偏好', '香水'], origin: 'manual', sources: [] }
let rows
beforeEach(() => {
  vi.resetAllMocks()
  rows = []
  memoryService.latestIndexJob.mockResolvedValue(null)
  memoryService.listPage.mockImplementation(async () => ({ data: rows, total: rows.length, page: 1, limit: 20 }))
  memoryService.create.mockImplementation(async (payload) => { const row = { id: 'm-new', revision: 1, ...payload }; rows = [row, ...rows]; return row })
  memoryService.update.mockImplementation(async (id, payload) => { rows = rows.map((row) => row.id === id ? { ...row, ...payload, revision: row.revision + 1 } : row); return rows.find((row) => row.id === id) })
  memoryService.remove.mockImplementation(async (id) => { rows = rows.filter((row) => row.id !== id) })
  memoryService.clear.mockImplementation(async () => { rows = [] })
})

describe('confirmed memories and editing', () => {
  it('explains the confirmation rule and the irreversible deletion boundary', async () => {
    renderPage()
    expect(screen.getByText(/只有你确认的内容会成为长期记忆/)).toBeInTheDocument()
    expect(await screen.findByText('还没有记忆')).toBeInTheDocument()
    expect(screen.getByText('我的记忆（0）')).toBeInTheDocument()
  })
  it('shows recoverable loading errors', async () => {
    memoryService.listPage.mockRejectedValueOnce(new Error('offline'))
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('记忆加载失败，请重试')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新读取' }))
    expect(await screen.findByText('还没有记忆')).toBeInTheDocument()
  })
  it('shows revision, provenance and tags for existing content', async () => {
    rows = [{ ...sampleMemory, origin: 'promoted' }]
    renderPage()
    const card = within((await screen.findByText(sampleMemory.content)).closest('article'))
    expect(card.getByText('事实与偏好 · 第 1 版')).toBeInTheDocument()
    expect(card.getByText('已确认的理解')).toBeInTheDocument()
    expect(card.getByText('重要度 7 · 偏好、香水')).toBeInTheDocument()
  })
  it('requires content before saving', async () => {
    const user = userEvent.setup(); renderPage()
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('请输入要记住的内容')).toBeInTheDocument()
    expect(memoryService.create).not.toHaveBeenCalled()
  })
  it('creates a typed memory with parsed tags and reloads the canonical list', async () => {
    const user = userEvent.setup(); renderPage()
    await screen.findByText('还没有记忆')
    await user.type(screen.getByLabelText('记忆内容'), '对新工作环境焦虑')
    await user.selectOptions(screen.getByLabelText('类型'), 'episodic')
    await user.type(screen.getByLabelText('标签（逗号分隔）'), '工作，情绪')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(memoryService.create).toHaveBeenCalledWith({ type: 'episodic', content: '对新工作环境焦虑', importance: 5, tags: ['工作', '情绪'] })
    expect(await screen.findByText('记忆已创建')).toBeInTheDocument()
    expect(screen.getByText('对新工作环境焦虑')).toBeInTheDocument()
  })
  it('preserves unsaved input after a failed save', async () => {
    memoryService.create.mockRejectedValue(new Error('offline'))
    const user = userEvent.setup(); renderPage()
    await user.type(screen.getByLabelText('记忆内容'), '尚未保存的内容')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('记忆保存失败，请重试')).toBeInTheDocument()
    expect(screen.getByLabelText('记忆内容')).toHaveValue('尚未保存的内容')
  })
  it('uses the expected revision and preserves the draft across a 409 until the user reviews the latest version', async () => {
    rows = [sampleMemory]
    memoryService.update.mockRejectedValueOnce({ response: { status: 409, data: { error: '内容已经变化' } } })
    memoryService.get.mockResolvedValue({ ...sampleMemory, revision: 2, content: '另一窗口保存的内容' })
    const user = userEvent.setup(); renderPage()
    await user.click(await screen.findByRole('button', { name: '编辑这条记忆' }))
    await user.clear(screen.getByLabelText('记忆内容'))
    await user.type(screen.getByLabelText('记忆内容'), '我的修改')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(memoryService.update).toHaveBeenCalledWith('m1', expect.objectContaining({ expectedRevision: 1, content: '我的修改' }))
    expect(await screen.findByText('最新第 2 版：另一窗口保存的内容')).toBeInTheDocument()
    expect(screen.getByLabelText('记忆内容')).toHaveValue('我的修改')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '已核对，继续编辑' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(memoryService.update).toHaveBeenLastCalledWith('m1', expect.objectContaining({ expectedRevision: 2, content: '我的修改' }))
  })
  it('cancel editing restores the creation form', async () => {
    rows = [sampleMemory]
    const user = userEvent.setup(); renderPage()
    await user.click(await screen.findByRole('button', { name: '编辑这条记忆' }))
    await user.click(screen.getByRole('button', { name: '取消', exact: true }))
    expect(screen.getByLabelText('记忆内容')).toHaveValue('')
  })
})

describe('deletion and full-library browsing', () => {
  it.each([false, true])('only deletes after explicit confirmation; clear all = %s', async (all) => {
    rows = [sampleMemory]
    const user = userEvent.setup(); renderPage()
    await user.click(await screen.findByRole('button', { name: all ? '清空全部' : '删除这条记忆' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/会永久删除记忆、历史版本/)).toBeInTheDocument()
    expect(memoryService.remove).not.toHaveBeenCalled()
    expect(memoryService.clear).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: all ? '确认清空' : '确认删除' }))
    expect(await screen.findByText('还没有记忆')).toBeInTheDocument()
    if (all) expect(memoryService.clear).toHaveBeenCalledOnce()
    else expect(memoryService.remove).toHaveBeenCalledWith('m1')
  })
  it('keeps the record when deletion fails', async () => {
    rows = [sampleMemory]
    memoryService.remove.mockRejectedValue(new Error('offline'))
    const user = userEvent.setup(); renderPage()
    await user.click(await screen.findByRole('button', { name: '删除这条记忆' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '确认删除' }))
    expect(await screen.findByText('删除失败，请重试')).toBeInTheDocument()
    expect(screen.getByText(sampleMemory.content)).toBeInTheDocument()
  })
  it('requests another page and server-side search instead of a truncated local list', async () => {
    rows = [sampleMemory]
    memoryService.listPage.mockImplementation(async () => ({ data: rows, total: 205 }))
    const user = userEvent.setup(); renderPage()
    await screen.findByText(sampleMemory.content)
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(memoryService.listPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, limit: 20 }))
    await user.type(screen.getByRole('searchbox', { name: '搜索记忆' }), '桂花')
    await waitFor(() => expect(memoryService.listPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, q: '桂花' })))
  })
})
