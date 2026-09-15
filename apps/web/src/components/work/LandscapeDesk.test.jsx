import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkDesktop from './WorkDesktop'
import LandscapeDesk from './LandscapeDesk'
import UsageReminder from '../chat/UsageReminder'
import ShortcutHelpModal from '../chat/ShortcutHelpModal'
import { useComplianceStore } from '../../stores/complianceStore'

function DeskHarness() {
  const [activeId, onSelect] = useState('focus')
  const [paused, setPaused] = useState(false)
  return <LandscapeDesk activeId={activeId} onSelect={onSelect} paused={paused} onToggleMotion={() => setPaused(value => !value)} />
}
const renderDesk = () => render(<MemoryRouter><DeskHarness /></MemoryRouter>)
const mockMatchMedia = matchesFor => {
  window.matchMedia = vi.fn().mockImplementation(query => ({
    matches: matchesFor(query), media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(),
    removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
}
const setInnerHeight = value => Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value })
const mockLandscapePhone = () => {
  mockMatchMedia(query => query === '(orientation: landscape)')
  setInnerHeight(400)
}
afterEach(() => {
  useComplianceStore.setState({ showUsageReminder: false })
  mockMatchMedia(() => false)
  setInnerHeight(768)
})

describe('LandscapeDesk', () => {
  it('竖屏和正常桌面高度不自动打开', () => {
    const view = renderDesk()
    expect(screen.queryByRole('dialog', { name: '沉浸书桌' })).not.toBeInTheDocument()
    mockMatchMedia(query => query === '(orientation: landscape)')
    setInnerHeight(800)
    fireEvent.resize(window)
    expect(screen.queryByRole('dialog', { name: '沉浸书桌' })).not.toBeInTheDocument()
    view.unmount()
  })

  it('通过 portal 展示分组书桌，每次只显示当前主题的链接', () => {
    mockLandscapePhone()
    const { container } = renderDesk()
    const dialog = screen.getByRole('dialog', { name: '沉浸书桌' })
    expect(container).not.toContainElement(dialog)
    expect(screen.getByRole('heading', { name: '坐进她的书桌' })).toBeInTheDocument()
    expect(within(dialog).getByText('Amie · AI 陪伴')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('link')).toHaveLength(3)
    fireEvent.click(within(dialog).getByRole('button', { name: '灵感装扮' }))
    expect(within(dialog).getAllByRole('link')).toHaveLength(2)
    expect(within(dialog).getByRole('link', { name: '化妆间' })).toHaveAttribute('href', '/tools/makeup-room')
    expect(within(dialog).queryByRole('link', { name: '日程与提醒' })).not.toBeInTheDocument()
  })

  it('打开时聚焦关闭按钮，Tab 不越过弹层，Esc 恢复原焦点', async () => {
    const user = userEvent.setup()
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    mockLandscapePhone()
    const view = renderDesk()
    const closeButton = screen.getByRole('button', { name: '关闭沉浸模式' })
    expect(closeButton).toHaveFocus()
    const firstButton = screen.getByRole('button', { name: '暂停动效' })
    firstButton.focus()
    await user.tab({ shift: true })
    expect(screen.getByRole('link', { name: '手帐打卡' })).toHaveFocus()
    await user.tab()
    expect(firstButton).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '沉浸书桌' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    view.unmount()
    trigger.remove()
  })

  it('关闭后本次横屏不再弹出，旋转后恢复且保留主题', () => {
    mockLandscapePhone()
    renderDesk()
    fireEvent.click(screen.getByRole('button', { name: '关于我们' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭沉浸模式' }))
    fireEvent.resize(window)
    expect(screen.queryByRole('dialog', { name: '沉浸书桌' })).not.toBeInTheDocument()
    setInnerHeight(800)
    fireEvent.resize(window)
    setInnerHeight(400)
    fireEvent.resize(window)
    expect(screen.getByRole('button', { name: '关于我们' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('link', { name: '她的信' })).toBeInTheDocument()
  })

  it('选择链接即关闭沉浸层', () => {
    mockLandscapePhone()
    renderDesk()
    fireEvent.click(screen.getByRole('link', { name: '日程与提醒' }))
    expect(screen.queryByRole('dialog', { name: '沉浸书桌' })).not.toBeInTheDocument()
  })

  it('横竖屏共享任务主题与动效偏好', () => {
    render(<MemoryRouter><WorkDesktop /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '记录生活' }))
    fireEvent.click(screen.getByRole('button', { name: '暂停动效' }))
    mockLandscapePhone()
    fireEvent.resize(window)
    const dialog = screen.getByRole('dialog', { name: '沉浸书桌' })
    expect(within(dialog).getByRole('button', { name: '记录生活' })).toHaveAttribute('aria-pressed', 'true')
    expect(dialog).toHaveClass('is-paused')
    fireEvent.click(within(dialog).getByRole('button', { name: '关于我们' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭沉浸模式' }))
    expect(screen.getByRole('button', { name: '关于我们' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '开启动效' })).toBeInTheDocument()
  })

  it('使用提醒打开时退出沉浸，不抢走提醒焦点，也不自动重开', async () => {
    mockLandscapePhone()
    render(<MemoryRouter><DeskHarness /><UsageReminder /></MemoryRouter>)
    expect(screen.getByRole('dialog', { name: '沉浸书桌' })).toBeInTheDocument()
    act(() => useComplianceStore.setState({ showUsageReminder: true }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '沉浸书桌' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '好的，知道了' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '再聊5分钟' }))
    expect(screen.queryByRole('dialog', { name: '沉浸书桌' })).not.toBeInTheDocument()
  })

  it('已有快捷键帮助时不会在其上自动打开沉浸层', async () => {
    mockLandscapePhone()
    render(<MemoryRouter><DeskHarness /><ShortcutHelpModal open onClose={() => {}} /></MemoryRouter>)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '沉浸书桌' })).not.toBeInTheDocument())
    expect(screen.getByRole('alertdialog', { name: '键盘快捷键' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '知道了' })).toHaveFocus()
  })
})
