import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DoodleField, Squiggle } from './Doodles'

describe('DoodleField', () => {
  it('renders decorative doodles hidden from assistive tech', () => {
    const { container } = render(<DoodleField />)

    const field = container.firstChild
    expect(field).toHaveAttribute('aria-hidden', 'true')
    expect(field.className).toContain('pointer-events-none')
    // 静谧层只留少量枝叶：每枝一个 SVG，均带缓慢摇曳
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBeGreaterThanOrEqual(3)
    const animated = container.querySelectorAll('.animate-doodle-float')
    expect(animated.length).toBe(svgs.length)
  })
})

describe('Squiggle', () => {
  it('renders the leaf divider with draw-in animation', () => {
    const { container } = render(<Squiggle />)

    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg.classList.contains('animate-squiggle-draw')).toBe(true)
  })
})
