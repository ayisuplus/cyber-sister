import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import NavDrawer from './NavDrawer'

const renderDrawer = (props) => render(<MemoryRouter initialEntries={['/chat']}><NavDrawer {...props} /></MemoryRouter>)

describe('NavDrawer', () => {
  it('renders nothing when closed', () => {
    const { container } = renderDrawer({ open: false, onClose: vi.fn() })
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the page navigation and closes after choosing an entry or tapping the backdrop', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderDrawer({ open: true, onClose })

    expect(screen.getByRole('link', { name: '对话' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('navigation', { name: '会话列表' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: '手记' }))
    await user.click(screen.getByRole('button', { name: '关闭导航' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
