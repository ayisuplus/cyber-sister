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

  it('does not steal focus from a replacement modal when the old one closes', () => {
    function Dialogs({ firstOpen, secondOpen }) {
      return <><Modal open={firstOpen} title="旧弹层"><button>旧按钮</button></Modal><Modal open={secondOpen} title="新弹层"><button>新按钮</button></Modal></>
    }
    const view = render(<Dialogs firstOpen secondOpen={false} />)
    view.rerender(<Dialogs firstOpen secondOpen />)
    expect(screen.getByRole('button', { name: '新按钮' })).toHaveFocus()
    view.rerender(<Dialogs firstOpen={false} secondOpen />)
    expect(screen.getByRole('button', { name: '新按钮' })).toHaveFocus()
  })

  it('still restores the original control when focus moved to a non-modal element', () => {
    const trigger = document.createElement('button')
    const background = document.createElement('button')
    document.body.append(trigger, background)
    trigger.focus()
    const view = render(<Modal open title="标题"><button>弹层按钮</button></Modal>)
    background.focus()
    view.rerender(<Modal open={false} title="标题"><button>弹层按钮</button></Modal>)
    expect(trigger).toHaveFocus()
    view.unmount()
    trigger.remove()
    background.remove()
  })
})
