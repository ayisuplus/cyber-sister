import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../services/memoryService', () => ({
  memoryService: Object.fromEntries(['listPage', 'get', 'create', 'update', 'remove', 'setPinned'].map((name) => [name, vi.fn()])),
}))
import { memoryService } from '../services/memoryService'
import MemoriesPage from './MemoriesPage'

const renderPage = () => render(<MemoryRouter><MemoriesPage /></MemoryRouter>)
const sampleMemory = { id: 'm1', revision: 1, type: 'semantic', content: '喜欢桂花味', importance: 7, tags: ['偏好', '香水'], origin: 'manual', sources: [] }
let rows
beforeEach(() => {
  vi.resetAllMocks()
  rows = []
  memoryService.listPage.mockImplementation(async () => ({ data: rows, total: rows.length, page: 1, limit: 20 }))
  memoryService.create.mockImplementation(async (payload) => { const row = { id: 'm-new', revision: 1, ...payload }; rows = [row, ...rows]; return row })
  memoryService.update.mockImplementation(async (id, payload) => { rows = rows.map((row) => row.id === id ? { ...row, ...payload, revision: row.revision + 1 } : row); return rows.find((row) => row.id === id) })
  memoryService.remove.mockImplementation(async (id) => { rows = rows.filter((row) => row.id !== id) })
  memoryService.setPinned.mockImplementation((id, pinned) => {
    rows = rows.map((row) => row.id === id ? { ...row, pinned } : row)
    return Promise.resolve(rows.find((row) => row.id === id))
  })
})

describe('她记得的你', () => {
  it('说清确认规则与删除边界，空着时也安静', async () => {
    renderPage()
    expect(screen.getByText(/只有你确认过的才会成为长期记忆/)).toBeInTheDocument()
    expect(await screen.findByText('她还没记住什么')).toBeInTheDocument()
  })

  it('shows recoverable loading errors', async () => {
    memoryService.listPage.mockRejectedValueOnce(new Error('offline'))
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('记忆加载失败，请重试')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新读取' }))
    expect(await screen.findByText('她还没记住什么')).toBeInTheDocument()
  })

  it('一条记忆只显示它本身，类型、重要度、版本号这些不摆出来', async () => {
    rows = [{ ...sampleMemory, origin: 'promoted' }]
    renderPage()
    const card = within((await screen.findByText(sampleMemory.content)).closest('article'))
    expect(card.getByRole('button', { name: '改一改' })).toBeInTheDocument()
    expect(card.queryByRole('button', { name: '她是怎么记住的' })).not.toBeInTheDocument()
    for (const hidden of ['事实与偏好', '第 1 版', '重要度 7', '已确认的理解']) {
      expect(screen.queryByText(new RegExp(hidden))).not.toBeInTheDocument()
    }
  })

  it('requires content before saving', async () => {
    const user = userEvent.setup(); renderPage()
    await user.click(screen.getByRole('button', { name: '记住' }))
    expect(await screen.findByText('写下想让她记住的一句话')).toBeInTheDocument()
    expect(memoryService.create).not.toHaveBeenCalled()
  })

  it('写一句话就能记住，机器用的字段按默认值保存', async () => {
    const user = userEvent.setup(); renderPage()
    await screen.findByText('她还没记住什么')
    await user.type(screen.getByLabelText('记忆内容'), '对新工作环境焦虑')
    await user.click(screen.getByRole('button', { name: '记住' }))
    expect(memoryService.create).toHaveBeenCalledWith({ type: 'semantic', content: '对新工作环境焦虑', importance: 5, tags: [] })
    expect(await screen.findByText('记住了')).toBeInTheDocument()
    expect(screen.getByText('对新工作环境焦虑')).toBeInTheDocument()
  })

  it('preserves unsaved input after a failed save', async () => {
    memoryService.create.mockRejectedValue(new Error('offline'))
    const user = userEvent.setup(); renderPage()
    await user.type(screen.getByLabelText('记忆内容'), '尚未保存的内容')
    await user.click(screen.getByRole('button', { name: '记住' }))
    expect(await screen.findByText('没保存成功，请重试')).toBeInTheDocument()
    expect(screen.getByLabelText('记忆内容')).toHaveValue('尚未保存的内容')
  })

  it('编辑沿用这条原来的类型与标签，并带上版本；别处改过时先给你看最新的', async () => {
    rows = [sampleMemory]
    memoryService.update.mockRejectedValueOnce({ response: { status: 409, data: { error: '内容已经变化' } } })
    memoryService.get.mockResolvedValue({ ...sampleMemory, revision: 2, content: '另一窗口保存的内容' })
    const user = userEvent.setup(); renderPage()
    await user.click(await screen.findByRole('button', { name: '改一改' }))
    await user.clear(screen.getByLabelText('记忆内容'))
    await user.type(screen.getByLabelText('记忆内容'), '我的修改')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(memoryService.update).toHaveBeenCalledWith('m1', { type: 'semantic', importance: 7, tags: ['偏好', '香水'], content: '我的修改', expectedRevision: 1 })
    expect(await screen.findByText(/另一窗口保存的内容/)).toBeInTheDocument()
    expect(screen.getByLabelText('记忆内容')).toHaveValue('我的修改')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '已核对，继续保存' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(memoryService.update).toHaveBeenLastCalledWith('m1', expect.objectContaining({ expectedRevision: 2, content: '我的修改' }))
  })

  it('cancel editing restores the creation form', async () => {
    rows = [sampleMemory]
    const user = userEvent.setup(); renderPage()
    await user.click(await screen.findByRole('button', { name: '改一改' }))
    await user.click(screen.getByRole('button', { name: '取消', exact: true }))
    expect(screen.getByLabelText('记忆内容')).toHaveValue('')
  })
})

describe('deletion and full-library browsing', () => {
  it('only deletes after explicit confirmation', async () => {
    rows = [sampleMemory]
    const user = userEvent.setup(); renderPage()
    await user.click(await screen.findByRole('button', { name: `删除这条记忆：${sampleMemory.content}` }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/连同它的历史和索引一起删除/)).toBeInTheDocument()
    expect(memoryService.remove).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: '确认删除' }))
    expect(await screen.findByText('她还没记住什么')).toBeInTheDocument()
    expect(memoryService.remove).toHaveBeenCalledWith('m1')
  })

  it('keeps the record when deletion fails', async () => {
    rows = [sampleMemory]
    memoryService.remove.mockRejectedValue(new Error('offline'))
    const user = userEvent.setup(); renderPage()
    await user.click(await screen.findByRole('button', { name: `删除这条记忆：${sampleMemory.content}` }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '确认删除' }))
    expect(await screen.findByText('没删掉，请重试')).toBeInTheDocument()
    expect(screen.getByText(sampleMemory.content)).toBeInTheDocument()
  })

  it('requests another page instead of a truncated local list', async () => {
    rows = [sampleMemory]
    memoryService.listPage.mockImplementation(async () => ({ data: rows, total: 205 }))
    const user = userEvent.setup(); renderPage()
    await screen.findByText(sampleMemory.content)
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(memoryService.listPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, limit: 20 }))
  })

  it('不再有搜索框与清空入口', async () => {
    rows = [sampleMemory]
    renderPage()
    await screen.findByText(sampleMemory.content)
    expect(screen.queryByRole('searchbox', { name: '搜索记忆' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '清空' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '她是怎么记住的' })).not.toBeInTheDocument()
    expect(memoryService.clear).toBeUndefined()
  })
})

describe('放在心上', () => {
  it('说清楚放在心上是什么意思', async () => {
    renderPage()
    expect(screen.getByText(/放在心上的（最多 5 件）每次聊天她都记着/)).toBeInTheDocument()
    await screen.findByText('她还没记住什么')
  })

  it('点一下放上去，再点一下拿下来；不改内容', async () => {
    const user = userEvent.setup()
    rows = [sampleMemory]
    renderPage()

    const toggle = await screen.findByRole('button', { name: '放在心上' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await user.click(toggle)
    expect(memoryService.setPinned).toHaveBeenLastCalledWith('m1', true)
    expect(await screen.findByRole('button', { name: '放在心上', pressed: true })).toBeInTheDocument()
    expect(memoryService.update).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '放在心上' }))
    expect(memoryService.setPinned).toHaveBeenLastCalledWith('m1', false)
  })

  it('满 5 件时把原因如实说出来', async () => {
    const user = userEvent.setup()
    rows = [sampleMemory]
    memoryService.setPinned.mockRejectedValue({ response: { status: 400, data: { error: '最多放 5 件在心上，先拿下一件再放' } } })
    renderPage()

    await user.click(await screen.findByRole('button', { name: '放在心上' }))

    expect(await screen.findByText('最多放 5 件在心上，先拿下一件再放')).toBeInTheDocument()
  })
})
