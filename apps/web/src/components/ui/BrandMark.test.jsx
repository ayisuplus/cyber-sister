import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import BrandMark from './BrandMark'

describe('BrandMark', () => {
  it('renders the wordmark with a decorative leaf', () => {
    const { container } = render(<BrandMark />)

    expect(screen.getByText('Amie')).toBeInTheDocument()
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('can be the page heading', () => {
    render(<BrandMark as="h1" size="lg" />)

    expect(screen.getByRole('heading', { level: 1, name: 'Amie' })).toBeInTheDocument()
  })
})
