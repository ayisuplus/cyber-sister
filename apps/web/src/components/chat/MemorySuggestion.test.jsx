import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../services/memoryService', () => ({
  memoryService: { getSuggestions: vi.fn(), create: vi.fn() },
}))

import { memoryService } from '../../services/memoryService'
import MemorySuggestion from './MemorySuggestion'

const CANDIDATES = [
  { type: 'semantic', content: '喜欢科幻电影', importance: 7, tags: ['电影', '科幻'] },
  { type: 'episodic', content: '上周去了海边', importance: 4, tags: [] },
]

describe('MemorySuggestion', () => {
  it('fetches candidates for the corresponding user message on click', async () => {
    const user = userEvent.setup()
    memoryService.getSuggestions.mockResolvedValue({ candidates: CANDIDATES })
    render(<MemorySuggestion userMessageId="u1" />)

    await user.click(screen.getByRole('button', { name: /帮我记住/ }))

    expect(memoryService.getSuggestions).toHaveBeenCalledWith('u1')
    // 候选以可编辑表单渲染，预填建议值
    expect(await screen.findByDisplayValue('喜欢科幻电影')).toBeInTheDocument()
    expect(screen.getByDisplayValue('上周去了海边')).toBeInTheDocument()
  })

  it('saves an edited candidate with parsed payload and confirms inline', async () => {
    const user = userEvent.setup()
    memoryService.getSuggestions.mockResolvedValue({ candidates: [CANDIDATES[0]] })
    memoryService.create.mockResolvedValue({ id: 'm1' })
    render(<MemorySuggestion userMessageId="u1" />)

    await user.click(screen.getByRole('button', { name: /帮我记住/ }))
    const content = await screen.findByLabelText('记忆内容')
    await user.clear(content)
    await user.type(content, '最爱科幻电影')
    await user.selectOptions(screen.getByLabelText('类型'), 'episodic')
    const importance = screen.getByLabelText('重要度（1–10）')
    await user.clear(importance)
    await user.type(importance, '9')
    const tags = screen.getByLabelText('标签（逗号分隔）')
    await user.clear(tags)
    await user.type(tags, '电影，科幻')

    await user.click(screen.getByRole('button', { name: /保存/ }))

    expect(memoryService.create).toHaveBeenCalledWith({
      type: 'episodic',
      content: '最爱科幻电影',
      importance: 9,
      tags: ['电影', '科幻'],
    })
    // 保存成功的卡片让位给一句内联确认
    expect(await screen.findByText('已记住')).toBeInTheDocument()
    expect(screen.queryByLabelText('记忆内容')).not.toBeInTheDocument()
  })

  it('dismisses a candidate on ignore without persisting anything', async () => {
    const user = userEvent.setup()
    memoryService.getSuggestions.mockResolvedValue({ candidates: [CANDIDATES[0]] })
    render(<MemorySuggestion userMessageId="u1" />)

    await user.click(screen.getByRole('button', { name: /帮我记住/ }))
    await screen.findByDisplayValue('喜欢科幻电影')
    await user.click(screen.getByRole('button', { name: '忽略' }))

    expect(screen.queryByDisplayValue('喜欢科幻电影')).not.toBeInTheDocument()
    expect(memoryService.create).not.toHaveBeenCalled()
  })

  it('shows an inline notice when suggestion generation fails and stays retryable', async () => {
    const user = userEvent.setup()
    memoryService.getSuggestions.mockRejectedValueOnce(new Error('LOCAL_LLM_UNAVAILABLE'))
    render(<MemorySuggestion userMessageId="u1" />)

    await user.click(screen.getByRole('button', { name: /帮我记住/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法生成记忆建议，稍后再试')
    // 失败不吞掉入口，可重试
    memoryService.getSuggestions.mockResolvedValue({ candidates: [] })
    await user.click(screen.getByRole('button', { name: /帮我记住/ }))
    expect(memoryService.getSuggestions).toHaveBeenCalledTimes(2)
  })

  it('explains when the reply has nothing worth remembering', async () => {
    const user = userEvent.setup()
    memoryService.getSuggestions.mockResolvedValue({ candidates: [] })
    render(<MemorySuggestion userMessageId="u1" />)

    await user.click(screen.getByRole('button', { name: /帮我记住/ }))

    expect(await screen.findByText('这条消息没有值得记住的内容')).toBeInTheDocument()
    expect(memoryService.create).not.toHaveBeenCalled()
  })

  it('keeps the candidate for retry when saving fails', async () => {
    const user = userEvent.setup()
    memoryService.getSuggestions.mockResolvedValue({ candidates: [CANDIDATES[0]] })
    memoryService.create.mockRejectedValueOnce(new Error('network'))
    render(<MemorySuggestion userMessageId="u1" />)

    await user.click(screen.getByRole('button', { name: /帮我记住/ }))
    await screen.findByDisplayValue('喜欢科幻电影')
    await user.click(screen.getByRole('button', { name: /保存/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败，请重试')
    // 候选保留，重试可成功
    memoryService.create.mockResolvedValue({ id: 'm1' })
    await user.click(screen.getByRole('button', { name: /保存/ }))
    expect(await screen.findByText('已记住')).toBeInTheDocument()
    expect(memoryService.create).toHaveBeenCalledTimes(2)
  })

  it('forbids saving when the edited content is empty', async () => {
    const user = userEvent.setup()
    memoryService.getSuggestions.mockResolvedValue({ candidates: [CANDIDATES[0]] })
    render(<MemorySuggestion userMessageId="u1" />)

    await user.click(screen.getByRole('button', { name: /帮我记住/ }))
    const content = await screen.findByLabelText('记忆内容')
    await user.clear(content)

    expect(screen.getByRole('button', { name: /保存/ })).toBeDisabled()
  })

  it('re-offers the entry after every card is closed and refetches instead of reusing candidates', async () => {
    const user = userEvent.setup()
    memoryService.getSuggestions
      .mockResolvedValueOnce({ candidates: [CANDIDATES[0]] })
      .mockResolvedValueOnce({ candidates: [] })
    render(<MemorySuggestion userMessageId="u1" />)

    await user.click(screen.getByRole('button', { name: /帮我记住/ }))
    await screen.findByDisplayValue('喜欢科幻电影')
    await user.click(screen.getByRole('button', { name: '忽略' }))

    // 候选全部关闭后入口重新出现，再次点击重新拉取
    await user.click(screen.getByRole('button', { name: /帮我记住/ }))
    expect(memoryService.getSuggestions).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('这条消息没有值得记住的内容')).toBeInTheDocument()
  })

  it('shows a spinner while suggestions are being generated', async () => {
    const user = userEvent.setup()
    let resolveRequest
    memoryService.getSuggestions.mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve }))
    render(<MemorySuggestion userMessageId="u1" />)

    await user.click(screen.getByRole('button', { name: /帮我记住/ }))

    expect(screen.getByRole('status', { name: '加载中' })).toBeInTheDocument()
    resolveRequest({ candidates: [] })
    expect(await screen.findByText('这条消息没有值得记住的内容')).toBeInTheDocument()
  })
})
