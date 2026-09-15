import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import TabbedPage from './TabbedPage'

const TABS = [
  { id: 'diary', label: '日记', render: () => <p>日记内容</p> },
  { id: 'letters', label: '来信', render: () => <p>来信内容</p> },
]

function Search() {
  return <output aria-label="当前查询">{useLocation().search}</output>
}

const renderPage = (url) => render(
  <MemoryRouter initialEntries={[url]}>
    <TabbedPage title="手记" label="手记分类" tabs={TABS} />
    <Search />
  </MemoryRouter>,
)

describe('TabbedPage', () => {
  it('opens the tab named in ?tab= and falls back to the first one', () => {
    renderPage('/tools/notes?tab=letters')
    expect(screen.getByText('来信内容')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '来信' })).toHaveAttribute('aria-current', 'page')
  })

  it('falls back to the first tab for an unknown ?tab=', () => {
    renderPage('/tools/notes?tab=nope')
    expect(screen.getByText('日记内容')).toBeInTheDocument()
  })

  it('switching tabs keeps the URL in sync', async () => {
    const user = userEvent.setup()
    renderPage('/tools/notes')

    await user.click(screen.getByRole('button', { name: '来信' }))

    expect(screen.getByText('来信内容')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: '当前查询' })).toHaveTextContent('?tab=letters')
  })
})
