import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import TypingIndicator from './TypingIndicator'

afterEach(() => vi.useRealTimers())

it('writes in her place on the letter: her mark in the margin and three breathing ink dots', () => {
  const { container, getByRole } = render(<TypingIndicator />)
  expect(getByRole('status', { name: 'Amie 正在输入' })).toHaveClass('letter-entry')
  expect(container.querySelector('.letter-who')).toHaveTextContent('她')
  expect(container.querySelectorAll('.typing-dot')).toHaveLength(3)
})

it('等待较久时给出云端回复尚未到达的提示', () => {
  vi.useFakeTimers()
  render(<TypingIndicator />)
  expect(screen.getByRole('status', { name: 'Amie 正在输入' })).toBeInTheDocument()
  expect(screen.queryByText('正在等云端回复…')).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(10000))
  expect(screen.getByRole('status', { name: '正在等待云端回复' })).toHaveTextContent('正在等云端回复…')
})

it('回复到达或离开页面后撤销等待提示计时', () => {
  vi.useFakeTimers()
  const view = render(<TypingIndicator />)
  expect(vi.getTimerCount()).toBe(1)
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})
