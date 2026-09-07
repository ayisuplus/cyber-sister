import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import Modal from './Modal'

describe('Modal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<Modal open={false} title="标题">内容</Modal>)

    expect(container).toBeEmptyDOMElement()
  })

  it('exposes an alert dialog labelled by its title when open', () => {
    render(<Modal open title="清空全部记忆">内容</Modal>)

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('清空全部记忆')
    expect(screen.getByText('内容')).toBeInTheDocument()
  })

  it('keeps keyboard focus cycling inside the dialog', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">背景操作</button>
        <Modal open title="标题">
          <button type="button">甲</button>
          <button type="button">乙</button>
        </Modal>
      </>,
    )

    const first = screen.getByRole('button', { name: '甲' })
    const last = screen.getByRole('button', { name: '乙' })
    expect(first).toHaveFocus()
    await user.tab()
    expect(last).toHaveFocus()
    await user.tab()
    expect(first).toHaveFocus()
    await user.tab({ shift: true })
    expect(last).toHaveFocus()
    expect(screen.getByRole('button', { name: '背景操作' })).not.toHaveFocus()
  })
})
