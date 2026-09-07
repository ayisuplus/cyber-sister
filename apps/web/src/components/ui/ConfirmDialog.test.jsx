import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ConfirmDialog from './ConfirmDialog'

describe('ConfirmDialog', () => {
  it('renders cancel before confirm so the safe action is focused first', () => {
    render(<ConfirmDialog open title="清空全部记忆" description="此操作无法撤销，确定继续吗？" danger onConfirm={vi.fn()} onCancel={vi.fn()} />)

    const cancel = screen.getByRole('button', { name: '取消' })
    const confirm = screen.getByRole('button', { name: '确认' })
    expect(cancel).toHaveFocus()
    expect(cancel.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('此操作无法撤销，确定继续吗？')).toBeInTheDocument()
  })

  it('routes cancel and confirm to their own callbacks', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmDialog open title="标题" onConfirm={onConfirm} onCancel={onCancel} />)

    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('uses the danger variant and a custom confirm label for destructive actions', () => {
    render(<ConfirmDialog open title="标题" confirmLabel="确认清空" danger onConfirm={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByRole('button', { name: '确认清空' })).toHaveClass('bg-danger')
  })
})
