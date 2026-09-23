import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import WorkTaskPanel from './WorkTaskPanel'
import { useChatStore } from '../../stores/chatStore'

describe('WorkTaskPanel', () => {
  it('shows resumable progress and refreshes the one conversation to show the result', () => {
    const open = vi.fn()
    useChatStore.setState({ refreshThread: open })
    render(<WorkTaskPanel tasks={[
      { id: 'one', status: 'running', content: '研究报告', progress: [{ tool: 'read_web', status: 'running' }] },
      { id: 'two', status: 'completed', content: '统计表', conversationId: 'c2' },
    ]} cancel={vi.fn()} retry={vi.fn()} />)
    expect(screen.getByText('正在处理')).toBeInTheDocument()
    expect(screen.getByText('阅读网页正文…')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看结果' }))
    expect(open).toHaveBeenCalledTimes(1)
  })
  it('uncertain external effects offer cancellation without an automatic replay button', () => {
    render(<WorkTaskPanel tasks={[{ id: 'uncertain', status: 'paused', errorCode: 'WORK_TASK_UNCERTAIN' }]} cancel={vi.fn()} retry={vi.fn()} />)
    expect(screen.getByText(/有一步操作需要核对/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '从保存步骤继续' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消任务' })).toBeInTheDocument()
  })
})
