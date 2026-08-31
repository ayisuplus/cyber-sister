import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CrisisModal from './CrisisModal'

describe('CrisisModal intervention content', () => {
  it('renders nothing without an intervention', () => {
    const { container } = render(<CrisisModal intervention={null} onClose={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('links hotline resources with a phone number', () => {
    render(
      <CrisisModal
        intervention={{
          message: '我在',
          resources: [{ label: '北京心理危机研究与干预中心', number: '010-82951332' }],
        }}
        onClose={vi.fn()}
      />,
    )

    const hotline = screen.getByRole('link', { name: /010-82951332/ })
    expect(hotline).toHaveAttribute('href', 'tel:010-82951332')
  })

  it('shows plain guidance for resources without a phone number', () => {
    render(
      <CrisisModal
        intervention={{
          message: '我在',
          resources: [
            { label: '找朋友聊聊', guidance: '给一个信任的人发消息' },
            '纯文字提示',
          ],
        }}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('给一个信任的人发消息')).toBeInTheDocument()
    expect(screen.getByText('纯文字提示')).toBeInTheDocument()
  })

  it('closes via the confirm button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<CrisisModal intervention={{ message: '我在', resources: [] }} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: '我知道了' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('CrisisModal', () => {
  it('keeps forward and backward keyboard focus inside the alert dialog', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">背景操作</button>
        <CrisisModal
          intervention={{ message: '请先确保自己处于安全环境', resources: [] }}
          onClose={vi.fn()}
        />
      </>,
    )

    const close = screen.getByRole('button', { name: '我知道了' })
    expect(close).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()
    await user.tab({ shift: true })
    expect(close).toHaveFocus()
    expect(screen.getByRole('button', { name: '背景操作' })).not.toHaveFocus()
  })
})
