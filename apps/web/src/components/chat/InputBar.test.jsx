import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import InputBar from './InputBar'

describe('InputBar', () => {
  it('keeps the original input when sending is not confirmed', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn().mockResolvedValue(false)
    render(<InputBar onSend={onSend} disabled={false} />)

    const input = screen.getByRole('textbox', { name: '聊天消息' })
    await user.type(input, '  请重试  ')
    await user.click(screen.getByRole('button', { name: '发送消息' }))

    expect(onSend).toHaveBeenCalledWith('请重试')
    expect(input).toHaveValue('  请重试  ')
  })

  it('clears the input only after a confirmed send', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn().mockResolvedValue(true)
    render(<InputBar onSend={onSend} disabled={false} />)

    const input = screen.getByRole('textbox', { name: '聊天消息' })
    await user.type(input, '你好{Enter}')

    expect(onSend).toHaveBeenCalledWith('你好')
    expect(input).toHaveValue('')
  })
})
