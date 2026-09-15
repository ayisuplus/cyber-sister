import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppNav from './AppNav'
import { ENTRIES } from '../../features/registry'

const renderNav = () => render(<MemoryRouter initialEntries={['/tools/notes']}><AppNav /></MemoryRouter>)
const links = () => within(screen.getByRole('navigation', { name: '页面导航' })).getAllByRole('link')

afterEach(() => vi.unstubAllEnvs())

describe('AppNav', () => {
  it('local client shows every entry plus settings, and marks the current one', () => {
    renderNav()

    expect(links().map(link => link.textContent)).toEqual(['她', '安排', '手记', '经期', '装扮', '设置'])
    expect(screen.getByRole('link', { name: '手记' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '设置' })).toHaveAttribute('href', '/settings')
  })

  it('web only shows the entries the web can open', () => {
    vi.stubEnv('VITE_APP_DISTRIBUTION', 'web')
    renderNav()

    expect(links().map(link => link.textContent)).toEqual(['她', '设置'])
  })
})

describe('entry registry', () => {
  it('keeps every local-only entry under the /tools/ distribution boundary', () => {
    for (const entry of ENTRIES) {
      expect(entry.to.startsWith('/tools/')).toBe(entry.localOnly)
    }
  })
})
