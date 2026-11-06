import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
const listeners = vi.hoisted(() => new Map())
vi.mock('./native', () => ({ isIOSApp: () => true, SessionVault: {} }))
vi.mock('@capacitor/app', () => ({ App: { addListener: async (event, callback) => {
  listeners.set(event, callback)
  return { remove: () => listeners.delete(event) }
} } }))
vi.mock('@capacitor/keyboard', () => ({ Keyboard: { addListener: async () => ({ remove: () => {} }) } }))
const actions = vi.hoisted(() => ({ restore: vi.fn(), interrupt: vi.fn(), refresh: vi.fn() }))
vi.mock('../stores/authStore', () => ({ useAuthStore: { getState: () => ({ isLoggedIn: true, restoreMobileSession: actions.restore }) } }))
vi.mock('../stores/chatStore', () => ({ useChatStore: { getState: () => ({ interruptForBackground: actions.interrupt, refreshThread: actions.refresh }) } }))
import MobileStartup from './MobileStartup'

describe('native startup and lifecycle', () => {
  beforeEach(() => { vi.clearAllMocks(); listeners.clear() })
  it('holds private screens until restore succeeds and allows retry on offline failure', async () => {
    actions.restore.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
    render(<MobileStartup><p>私密本子</p></MobileStartup>)
    expect(screen.queryByText('私密本子')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: '重试' }))
    expect(await screen.findByText('私密本子')).toBeInTheDocument()
  })
  it('interrupts on background, reloads on foreground and removes subscriptions', async () => {
    actions.restore.mockResolvedValue(undefined)
    const view = render(<MobileStartup><p>本子</p></MobileStartup>)
    await screen.findByText('本子')
    listeners.get('appStateChange')({ isActive: false })
    expect(actions.interrupt).toHaveBeenCalledTimes(1)
    listeners.get('appStateChange')({ isActive: true })
    expect(actions.refresh).toHaveBeenCalledTimes(1)
    view.unmount()
    await waitFor(() => expect(listeners.size).toBe(0))
  })
})
