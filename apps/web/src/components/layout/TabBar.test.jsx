import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import TabBar from './TabBar'

const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="*" element={<TabBar />} />
    </Routes>
  </MemoryRouter>,
)

describe('TabBar', () => {
  it('marks the active tab as the current page', () => {
    renderAt('/chat')

    expect(screen.getByRole('button', { name: '聊天' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '发现' })).not.toHaveAttribute('aria-current')
  })

  it('navigates to the selected tab', async () => {
    const user = userEvent.setup()
    renderAt('/chat')

    await user.click(screen.getByRole('button', { name: '发现' }))

    expect(screen.getByRole('button', { name: '发现' })).toHaveAttribute('aria-current', 'page')
  })

  it.each(['/profile/memories', '/profile/local-model', '/tools/virtual-makeup', '/tools/virtual-fitting'])('stays hidden on the sub-page %s', (path) => {
    const { container } = renderAt(path)

    expect(container).toBeEmptyDOMElement()
  })
})
