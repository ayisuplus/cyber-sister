import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AppNav from './AppNav'
import { ENTRIES } from '../../features/registry'

const renderNav = () => render(<MemoryRouter initialEntries={['/tools/notes']}><AppNav /></MemoryRouter>)
const links = () => within(screen.getByRole('navigation', { name: '页面导航' })).getAllByRole('link')

afterEach(() => vi.unstubAllEnvs())

describe('AppNav', () => {
  it('shows every entry plus settings on the one Web version, and marks the current one', () => {
    vi.stubEnv('VITE_APP_DISTRIBUTION', 'web')
    renderNav()

    expect(links().map(link => link.textContent)).toEqual(['对话', '她', '日历', '手记', '读书', '装扮', '设置'])
    expect(screen.getByRole('link', { name: '对话' })).toHaveAttribute('href', '/chat')
    expect(screen.getByRole('link', { name: '手记' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '设置' })).toHaveAttribute('href', '/settings')
  })

  it('「她」入口不再带待确认数字（那些草稿收进她的来信）', () => {
    renderNav()

    expect(screen.getByRole('link', { name: '她' })).toHaveTextContent(/^她$/)
  })
})

describe('entry registry', () => {
  it('has no per-distribution flags', () => {
    for (const entry of ENTRIES) expect(entry).not.toHaveProperty('localOnly')
  })
})
