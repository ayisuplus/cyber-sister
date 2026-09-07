import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SHORTCUTS } from '../../hooks/useGlobalShortcuts'
import ShortcutHelpModal from './ShortcutHelpModal'

describe('ShortcutHelpModal', () => {
  it('renders the title and every shortcut when open', () => {
    render(<ShortcutHelpModal open onClose={vi.fn()} />)

    expect(screen.getByRole('alertdialog', { name: '键盘快捷键' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
    for (const { keys, label } of SHORTCUTS) {
      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.getByText(keys)).toBeInTheDocument()
    }
  })

  it('renders nothing when closed', () => {
    const { container } = render(<ShortcutHelpModal open={false} onClose={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('calls onClose from the confirm button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ShortcutHelpModal open onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: '知道了' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
