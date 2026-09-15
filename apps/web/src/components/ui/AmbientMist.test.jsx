import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AmbientMist from './AmbientMist'

describe('AmbientMist', () => {
  it('renders decorative mist orbs hidden from assistive tech', () => {
    const { container } = render(<AmbientMist />)

    const mist = container.firstChild
    expect(mist).toHaveClass('ambient-mist')
    expect(mist).toHaveAttribute('aria-hidden', 'true')
    expect(mist.querySelectorAll('.ambient-mist__orb')).toHaveLength(3)
  })
})
