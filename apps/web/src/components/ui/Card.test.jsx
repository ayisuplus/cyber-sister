import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Card from './Card'

describe('Card', () => {
  it('renders children inside the token-styled surface', () => {
    render(<Card>卡片内容</Card>)

    const card = screen.getByText('卡片内容')
    expect(card).toHaveClass('rounded-card', 'bg-surface-card', 'shadow-card')
  })

  it('merges extra classes for layout variants like overflow-hidden', () => {
    render(<Card className="overflow-hidden">x</Card>)

    expect(screen.getByText('x')).toHaveClass('overflow-hidden', 'bg-surface-card')
  })
})
