import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import WorkActionCard from './WorkActionCard'

const action = { id: 'a1', status: 'pending', method: 'POST', url: 'https://example.com/save?recipient=test', purpose: '发送测试内容',
  body: 'message=%E6%B5%8B%E8%AF%95&message=%3Cscript%3Ebad%3C%2Fscript%3E', contentType: 'application/x-www-form-urlencoded', expiresAt: '2099-01-01T00:00:00.000Z' }

describe('concrete external action approval', () => {
  it('shows the upload and billing terms before a paid image action and the recovery path after submission', () => {
    const decide = vi.fn()
    const { rerender } = render(<WorkActionCard taskId="t1" action={{ ...action, provider: 'runninghub', body: '{"prompt":"合成插画"}', contentType: 'application/json' }} decide={decide} />)
    expect(screen.getByText(/当前没有金额硬上限/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认付费生成一次' })).toBeInTheDocument()
    expect(decide).not.toHaveBeenCalled()
    rerender(<WorkActionCard taskId="t1" action={{ ...action, provider: 'runninghub', status: 'completed', providerTaskId: '2099741730948743170' }} decide={decide} />)
    expect(screen.getByText('云端任务已提交')).toBeInTheDocument()
    expect(screen.getByText(/2099741730948743170/)).toHaveTextContent('取回上次生成的图片')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it('shows destination and every field as text; no submission happens by rendering', async () => {
    let release
    const decide = vi.fn(() => new Promise(resolve => { release = resolve }))
    render(<WorkActionCard taskId="t1" action={action} decide={decide} />)
    expect(screen.getByText(/recipient=test/)).toBeInTheDocument()
    expect(screen.getByText(/message: 测试/)).toHaveTextContent('message: <script>bad</script>')
    expect(screen.getByText('查看请求原文')).toBeInTheDocument()
    expect(screen.getByText(action.body)).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
    expect(decide).not.toHaveBeenCalled()
    const confirm = screen.getByRole('button', { name: '确认提交一次' })
    fireEvent.click(confirm); fireEvent.click(confirm)
    expect(decide).toHaveBeenCalledTimes(1)
    expect(decide).toHaveBeenCalledWith('t1', 'a1', 'approve')
    expect(confirm).toBeDisabled()
    release()
    await waitFor(() => expect(confirm).not.toBeDisabled())
  })

  it('preserves large JSON integers and duplicate keys in the request preview', () => {
    const body = '{"amount":9007199254740993,"tag":"first","tag":"last"}'
    render(<WorkActionCard taskId="t1" action={{ ...action, contentType: 'application/json', body }} decide={vi.fn()} />)
    expect(screen.getByText(body)).toBeInTheDocument()
  })

  it('rejects separately and retains confirmation errors without implying success', async () => {
    const decide = vi.fn().mockRejectedValue({ response: { data: { error: '此确认已失效' } } })
    render(<WorkActionCard taskId="t1" action={action} decide={decide} />)
    fireEvent.click(screen.getByRole('button', { name: '不提交' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('此确认已失效')
    expect(decide).toHaveBeenCalledWith('t1', 'a1', 'reject')
  })

  it('expired or uncertain requests cannot be confirmed again', () => {
    const { rerender } = render(<WorkActionCard taskId="t1" action={{ ...action, expiresAt: '2000-01-01T00:00:00.000Z' }} decide={vi.fn()} />)
    expect(screen.getByRole('button', { name: '确认提交一次' })).toBeDisabled()
    rerender(<WorkActionCard taskId="t1" action={{ ...action, status: 'uncertain' }} decide={vi.fn()} />)
    expect(screen.getByText(/提交结果需要核对/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
