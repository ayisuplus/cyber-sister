import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/memoryService', () => ({
  memoryService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  },
}))

import { memoryService } from '../services/memoryService'
import MemoriesPage from './MemoriesPage'

const renderPage = () => render(<MemoryRouter><MemoriesPage /></MemoryRouter>)

const sampleMemory = {
  id: 'm1',
  type: 'semantic',
  content: '喜欢桂花味',
  importance: 7,
  tags: ['偏好', '香水'],
}

describe('MemoriesPage', () => {
  beforeEach(() => {
    memoryService.list.mockResolvedValue([])
  })

  it('explains that memories are only created explicitly', async () => {
    renderPage()

    expect(screen.getByText(/系统不会自动提取或推断记忆/)).toBeInTheDocument()
    expect(await screen.findByText('还没有记忆')).toBeInTheDocument()
    expect(screen.getByText('我的记忆（0）')).toBeInTheDocument()
  })

  it('shows a recoverable error when loading fails', async () => {
    memoryService.list.mockRejectedValue(new Error('offline'))

    renderPage()

    expect(await screen.findByText('记忆加载失败，请重试')).toBeInTheDocument()
  })

  it('renders existing memories with type label, tags and importance', async () => {
    memoryService.list.mockResolvedValue([sampleMemory])

    renderPage()

    expect(await screen.findByText('喜欢桂花味')).toBeInTheDocument()
    const card = within(screen.getByText('喜欢桂花味').closest('article'))
    expect(card.getByText('语义记忆')).toBeInTheDocument()
    expect(screen.getByText('偏好')).toBeInTheDocument()
    expect(screen.getByText('重要度 7')).toBeInTheDocument()
    expect(screen.getByText('我的记忆（1）')).toBeInTheDocument()
  })

  it('requires content before saving', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /保存/ }))

    expect(screen.getByText('请输入要记住的内容')).toBeInTheDocument()
    expect(memoryService.create).not.toHaveBeenCalled()
  })

  it('creates a memory with parsed tags and shows it first', async () => {
    const user = userEvent.setup()
    memoryService.create.mockImplementation(async (payload) => ({ id: 'm-new', ...payload }))
    renderPage()

    await screen.findByText('还没有记忆')
    await user.type(screen.getByLabelText('记忆内容'), '对新工作环境焦虑')
    await user.selectOptions(screen.getByLabelText('类型'), 'episodic')
    await user.clear(screen.getByLabelText('重要度（1–10）'))
    await user.type(screen.getByLabelText('重要度（1–10）'), '8')
    await user.type(screen.getByLabelText('标签（逗号分隔）'), '工作，情绪')
    await user.click(screen.getByRole('button', { name: /保存/ }))

    expect(memoryService.create).toHaveBeenCalledWith({
      type: 'episodic',
      content: '对新工作环境焦虑',
      importance: 8,
      tags: ['工作', '情绪'],
    })
    expect(await screen.findByText('记忆已创建')).toBeInTheDocument()
    expect(screen.getByText('对新工作环境焦虑')).toBeInTheDocument()
    expect(within(screen.getByText('对新工作环境焦虑').closest('article')).getByText('情景记忆')).toBeInTheDocument()
  })

  it('reports save failures without losing the draft', async () => {
    const user = userEvent.setup()
    memoryService.create.mockRejectedValue(new Error('server error'))
    renderPage()

    await screen.findByText('还没有记忆')
    await user.type(screen.getByLabelText('记忆内容'), '草稿内容')
    await user.click(screen.getByRole('button', { name: /保存/ }))

    expect(await screen.findByText('记忆保存失败，请重试')).toBeInTheDocument()
    expect(screen.getByLabelText('记忆内容')).toHaveValue('草稿内容')
  })

  it('edits an existing memory through the same form', async () => {
    const user = userEvent.setup()
    memoryService.list.mockResolvedValue([sampleMemory])
    memoryService.update.mockImplementation(async (id, payload) => ({ id, ...payload }))
    renderPage()

    await user.click(await screen.findByRole('button', { name: '编辑这条记忆' }))

    expect(screen.getByText('编辑记忆')).toBeInTheDocument()
    expect(screen.getByLabelText('记忆内容')).toHaveValue('喜欢桂花味')
    expect(screen.getByLabelText('标签（逗号分隔）')).toHaveValue('偏好，香水')

    await user.clear(screen.getByLabelText('记忆内容'))
    await user.type(screen.getByLabelText('记忆内容'), '喜欢栀子花味')
    await user.click(screen.getByRole('button', { name: /保存/ }))

    expect(memoryService.update).toHaveBeenCalledWith('m1', {
      type: 'semantic',
      content: '喜欢栀子花味',
      importance: 7,
      tags: ['偏好', '香水'],
    })
    expect(await screen.findByText('记忆已更新')).toBeInTheDocument()
    expect(screen.getByText('喜欢栀子花味')).toBeInTheDocument()
    // 表单回到创建模式
    expect(screen.getByText('创建记忆')).toBeInTheDocument()
  })

  it('cancelling an edit restores the blank creation form', async () => {
    const user = userEvent.setup()
    memoryService.list.mockResolvedValue([sampleMemory])
    renderPage()

    await user.click(await screen.findByRole('button', { name: '编辑这条记忆' }))
    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.getByText('创建记忆')).toBeInTheDocument()
    expect(screen.getByLabelText('记忆内容')).toHaveValue('')
    expect(memoryService.update).not.toHaveBeenCalled()
  })

  it('deletes a single memory', async () => {
    const user = userEvent.setup()
    memoryService.list.mockResolvedValue([sampleMemory])
    memoryService.remove.mockResolvedValue(undefined)
    renderPage()

    await user.click(await screen.findByRole('button', { name: '删除这条记忆' }))

    expect(memoryService.remove).toHaveBeenCalledWith('m1')
    expect(await screen.findByText('记忆已删除')).toBeInTheDocument()
    expect(screen.getByText('还没有记忆')).toBeInTheDocument()
  })

  it('reports delete failures and keeps the memory', async () => {
    const user = userEvent.setup()
    memoryService.list.mockResolvedValue([sampleMemory])
    memoryService.remove.mockRejectedValue(new Error('offline'))
    renderPage()

    await user.click(await screen.findByRole('button', { name: '删除这条记忆' }))

    expect(await screen.findByText('删除失败，请重试')).toBeInTheDocument()
    expect(screen.getByText('喜欢桂花味')).toBeInTheDocument()
  })

  it('does not clear anything when the confirmation is rejected', async () => {
    const user = userEvent.setup()
    memoryService.list.mockResolvedValue([sampleMemory])
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()

    await user.click(await screen.findByRole('button', { name: '清空全部' }))

    expect(memoryService.clear).not.toHaveBeenCalled()
    expect(screen.getByText('喜欢桂花味')).toBeInTheDocument()
  })

  it('clears every memory after confirmation', async () => {
    const user = userEvent.setup()
    memoryService.list.mockResolvedValue([sampleMemory])
    memoryService.clear.mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()

    await user.click(await screen.findByRole('button', { name: '清空全部' }))

    expect(memoryService.clear).toHaveBeenCalled()
    expect(await screen.findByText('全部记忆已清空')).toBeInTheDocument()
    expect(screen.getByText('还没有记忆')).toBeInTheDocument()
  })

  it('reports clear failures and keeps the list', async () => {
    const user = userEvent.setup()
    memoryService.list.mockResolvedValue([sampleMemory])
    memoryService.clear.mockRejectedValue(new Error('offline'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()

    await user.click(await screen.findByRole('button', { name: '清空全部' }))

    expect(await screen.findByText('清空失败，请重试')).toBeInTheDocument()
    expect(screen.getByText('喜欢桂花味')).toBeInTheDocument()
  })
})
