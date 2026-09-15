import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CAPABILITIES } from '../../features/capabilities'
import { TOOLBOX_SECTIONS } from '../../features/toolbox'
import { WORKSPACE_GROUPS } from '../../features/workspaces'
import WorkDesktop from './WorkDesktop'

const renderDesktop = () => render(<MemoryRouter><WorkDesktop /></MemoryRouter>)
const mockMatchMedia = matchesFor => {
  window.matchMedia = vi.fn().mockImplementation(query => ({
    matches: matchesFor(query), media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(),
    removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
}

afterEach(() => mockMatchMedia(() => false))

describe('WorkDesktop', () => {
  it('紧凑书桌保留氛围媒体与四个明确的任务主题', () => {
    renderDesktop()
    expect(screen.getByRole('heading', { name: '把今天，慢慢理顺' })).toBeInTheDocument()
    expect(screen.getByText('横过来，坐进书桌里')).toBeInTheDocument()
    const video = document.querySelector('video')
    expect(video).toHaveAttribute('src', '/design-assets/work-desk-loop.mp4')
    expect(video).toHaveAttribute('poster', '/design-assets/work-desk-poster.webp')
    expect(video).toHaveAttribute('loop')
    expect(video).toHaveAttribute('playsinline')
    expect(video.muted).toBe(true)
    const picker = screen.getByRole('group', { name: '选择工作主题' })
    expect(within(picker).getAllByRole('button')).toHaveLength(4)
    expect(screen.getByRole('button', { name: '安排今天' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.queryByRole('link', { name: /化妆间/ })).not.toBeInTheDocument()
  })

  it('切换主题时只显示相关入口，完整保留注册表所有可用能力且不重复', () => {
    renderDesktop()
    const routes = []
    for (const group of WORKSPACE_GROUPS) {
      const button = screen.getByRole('button', { name: group.title })
      fireEvent.click(button)
      expect(button).toHaveAttribute('aria-pressed', 'true')
      const region = screen.getByRole('region', { name: group.title })
      expect(button).toHaveAttribute('aria-controls', region.id)
      const links = within(region).getAllByRole('link')
      expect(links).toHaveLength(group.items.length)
      routes.push(...links.map(link => link.getAttribute('href')))
    }
    const availableRoutes = [
      ...CAPABILITIES.filter(item => item.status === 'available').map(item => item.href),
      ...TOOLBOX_SECTIONS.flatMap(section => section.items.map(item => item.to)),
    ]
    expect(routes.sort()).toEqual(availableRoutes.sort())
    expect(new Set(routes).size).toBe(routes.length)
    expect(screen.queryByRole('link', { name: /^安排/ })).not.toBeInTheDocument()
  })

  it('键盘可选择主题并直接进入对应链接', async () => {
    const user = userEvent.setup()
    renderDesktop()
    const button = screen.getByRole('button', { name: '记录生活' })
    button.focus()
    await user.keyboard('{Enter}')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('link', { name: /日记/ })).toHaveAttribute('href', '/tools/diary')
    await user.keyboard(' ')
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })

  it('装扮入口明确标注云端模拟状态', () => {
    renderDesktop()
    fireEvent.click(screen.getByRole('button', { name: '灵感装扮' }))
    expect(screen.getAllByText('云端接口 · 模拟')).toHaveLength(2)
  })

  it('暂停后切换主题仍保持静态状态，再次点击恢复', () => {
    renderDesktop()
    const desktop = screen.getByRole('navigation', { name: '功能桌面' })
    fireEvent.click(screen.getByRole('button', { name: '暂停动效' }))
    expect(desktop).toHaveClass('is-paused')
    fireEvent.click(screen.getByRole('button', { name: '关于我们' }))
    expect(desktop).toHaveClass('is-paused')
    expect(screen.getByRole('link', { name: /她的信/ })).toHaveAttribute('href', '/tools/letters')
    fireEvent.click(screen.getByRole('button', { name: '开启动效' }))
    expect(desktop).not.toHaveClass('is-paused')
  })

  it('媒体失败与贴纸失败均不影响任务入口', () => {
    renderDesktop()
    fireEvent.error(document.querySelector('video'))
    expect(document.querySelector('video')).not.toBeInTheDocument()
    expect(document.querySelector('img[src="/design-assets/work-desk-poster.webp"]')).toBeInTheDocument()
    fireEvent.error(document.querySelector('img[src="/design-assets/work-journal.svg"]'))
    fireEvent.click(screen.getByRole('button', { name: '记录生活' }))
    expect(screen.getByRole('link', { name: /日记/ })).toBeInTheDocument()
  })

  it('减少动态效果时直接使用静态贴图', () => {
    mockMatchMedia(query => query === '(prefers-reduced-motion: reduce)')
    renderDesktop()
    expect(document.querySelector('video')).not.toBeInTheDocument()
    expect(document.querySelector('img[src="/design-assets/work-desk-poster.webp"]')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '沉浸书桌' })).not.toBeInTheDocument()
  })
})
