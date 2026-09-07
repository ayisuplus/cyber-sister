import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createConversation: vi.fn() }))

vi.mock('../stores/chatStore', () => {
  const useChatStore = () => ({})
  useChatStore.getState = () => ({ createConversation: mocks.createConversation })
  return { useChatStore }
})

import useGlobalShortcuts from './useGlobalShortcuts'

function Harness() {
  const { helpOpen } = useGlobalShortcuts()
  const { pathname } = useLocation()
  return (
    <div>
      <textarea aria-label="聊天消息" />
      <div data-testid="pathname">{pathname}</div>
      <div data-testid="help">{helpOpen ? 'open' : 'closed'}</div>
    </div>
  )
}

const renderAt = (route) => render(
  <MemoryRouter initialEntries={[route]}><Harness /></MemoryRouter>,
)

describe('useGlobalShortcuts', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('focuses the chat input on / when on /chat', () => {
    renderAt('/chat')
    const textarea = screen.getByRole('textbox', { name: '聊天消息' })

    fireEvent.keyDown(document, { key: '/' })

    expect(document.activeElement).toBe(textarea)
  })

  it('types / normally inside an input without stealing focus', async () => {
    const user = userEvent.setup()
    renderAt('/chat')
    const textarea = screen.getByRole('textbox', { name: '聊天消息' })

    await user.click(textarea)
    await user.type(textarea, '/')

    expect(textarea).toHaveValue('/')
    expect(document.activeElement).toBe(textarea)
    expect(screen.getByTestId('help')).toHaveTextContent('closed')
  })

  it('does not focus the chat input on / outside /chat', () => {
    renderAt('/tools')

    fireEvent.keyDown(document, { key: '/' })

    expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: '聊天消息' }))
  })

  it('opens help on ? and closes it with Escape', () => {
    renderAt('/chat')

    fireEvent.keyDown(document, { key: '?' })
    expect(screen.getByTestId('help')).toHaveTextContent('open')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByTestId('help')).toHaveTextContent('closed')
  })

  it('blurs the focused input on Escape once help is closed', () => {
    renderAt('/chat')
    const textarea = screen.getByRole('textbox', { name: '聊天消息' })

    fireEvent.keyDown(document, { key: '?' })
    fireEvent.keyDown(document, { key: 'Escape' })
    textarea.focus()
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(document.activeElement).not.toBe(textarea)
  })

  it('creates a new conversation on Ctrl+Shift+O from any page', () => {
    renderAt('/tools')

    fireEvent.keyDown(document, { key: 'O', ctrlKey: true, shiftKey: true })

    expect(mocks.createConversation).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('pathname')).toHaveTextContent('/chat')
  })

  it('creates a new conversation on Meta+Shift+O', () => {
    renderAt('/chat')

    fireEvent.keyDown(document, { key: 'O', metaKey: true, shiftKey: true })

    expect(mocks.createConversation).toHaveBeenCalledTimes(1)
  })

  it('stays inert on /login', () => {
    renderAt('/login')

    fireEvent.keyDown(document, { key: '?' })
    fireEvent.keyDown(document, { key: '/' })
    fireEvent.keyDown(document, { key: 'O', ctrlKey: true, shiftKey: true })

    expect(screen.getByTestId('help')).toHaveTextContent('closed')
    expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: '聊天消息' }))
    expect(mocks.createConversation).not.toHaveBeenCalled()
  })
})
