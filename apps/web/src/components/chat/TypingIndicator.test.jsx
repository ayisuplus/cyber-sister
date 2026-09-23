import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TypingIndicator from './TypingIndicator'

describe('TypingIndicator', () => {
  it('writes in her place on the letter: her mark in the margin and three breathing ink dots', () => {
    const { container, getByRole } = render(<TypingIndicator />)

    expect(getByRole('status', { name: 'Amie 正在输入' })).toHaveClass('letter-entry')
    expect(container.querySelector('.letter-who')).toHaveTextContent('她')
    expect(container.querySelectorAll('.typing-dot')).toHaveLength(3)
  })
})
