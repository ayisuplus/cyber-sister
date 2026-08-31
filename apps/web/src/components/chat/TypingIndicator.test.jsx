import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TypingIndicator from './TypingIndicator'

describe('TypingIndicator', () => {
  it('shows the AI avatar with three pulsing dots', () => {
    const { container, getByText } = render(<TypingIndicator />)

    expect(getByText('AI')).toBeInTheDocument()
    expect(container.querySelectorAll('.typing-dot')).toHaveLength(3)
  })
})
