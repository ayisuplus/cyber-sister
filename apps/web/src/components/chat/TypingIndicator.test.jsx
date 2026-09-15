import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TypingIndicator from './TypingIndicator'

describe('TypingIndicator', () => {
  it('shows the AI avatar with three pulsing dots', () => {
    const { container } = render(<TypingIndicator />)

    const avatar = container.querySelector('img[src*="ai-avatar-v2"]')
    expect(avatar).not.toBeNull()
    expect(container.querySelectorAll('.typing-dot')).toHaveLength(3)
  })
})
