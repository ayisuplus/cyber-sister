import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const chat = vi.hoisted(() => ({ confirmToolAction: vi.fn(), dismissToolAction: vi.fn() }))
vi.mock('../../services/chatService', () => ({ chatService: chat }))

import ActionConfirmCard from './ActionConfirmCard'

const toolRun = { tool: 'delete_diary', ok: true, pending: true, args: { day: '2026-09-22' }, summary: '想删掉 2026-09-22 的手记，等你点头' }

describe('ActionConfirmCard', () => {
  it('点「好，就这么做」→ 调确认端点、行内变已处理', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    chat.confirmToolAction.mockResolvedValue({ toolRun: { tool: 'delete_diary', ok: true, summary: '已删掉 2026-09-22 的手记' } })

    render(<ActionConfirmCard messageId="m1" index={2} toolRun={toolRun} onDone={onDone} />)
    await user.click(screen.getByRole('button', { name: '好，就这么做' }))

    expect(chat.confirmToolAction).toHaveBeenCalledWith('m1', 2)
    expect(await screen.findByText('已删掉 2026-09-22 的手记')).toBeInTheDocument()
    expect(onDone).toHaveBeenCalledWith({ tool: 'delete_diary', ok: true, summary: '已删掉 2026-09-22 的手记' })
  })

  it('点「不用」→ 调取消端点', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    chat.dismissToolAction.mockResolvedValue({ toolRun: { tool: 'delete_diary', ok: true, dismissed: true, summary: '你没让做' } })

    render(<ActionConfirmCard messageId="m1" index={0} toolRun={toolRun} onDone={onDone} />)
    await user.click(screen.getByRole('button', { name: '不用' }))

    expect(chat.dismissToolAction).toHaveBeenCalledWith('m1', 0)
    expect(await screen.findByText('你没让做')).toBeInTheDocument()
    expect(onDone).toHaveBeenCalledWith({ tool: 'delete_diary', ok: true, dismissed: true, summary: '你没让做' })
  })

  it('处理失败保留卡片、行内报错，可重试', async () => {
    const user = userEvent.setup()
    chat.confirmToolAction.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ toolRun: { tool: 'delete_diary', ok: true, summary: '已删掉' } })

    render(<ActionConfirmCard messageId="m1" index={0} toolRun={toolRun} />)
    await user.click(screen.getByRole('button', { name: '好，就这么做' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('没处理成功，请重试')
    await user.click(screen.getByRole('button', { name: '好，就这么做' }))
    expect(await screen.findByText('已删掉')).toBeInTheDocument()
  })

  it('服务端拦下动作时不显示成功', async () => {
    const user = userEvent.setup()
    chat.confirmToolAction.mockResolvedValue({ toolRun: { tool: 'delete_diary', ok: false, summary: '这个动作被拦下了' } })

    render(<ActionConfirmCard messageId="m1" index={0} toolRun={toolRun} />)
    await user.click(screen.getByRole('button', { name: '好，就这么做' }))
    expect(await screen.findByText('这个动作被拦下了')).toBeInTheDocument()
    expect(screen.queryByText('已处理')).not.toBeInTheDocument()
  })
})
