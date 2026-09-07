import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Spinner from './Spinner'

describe('Spinner', () => {
  it('exposes a polite loading status', () => {
    render(<Spinner />)

    const spinner = screen.getByRole('status', { name: '加载中' })
    expect(spinner).toHaveClass('animate-spin', 'border-border-subtle', 'border-t-action-primary')
  })

  it('swaps to the on-dark palette inside brand buttons', () => {
    render(<Spinner onDark />)

    expect(screen.getByRole('status')).toHaveClass('border-pastel-blush', 'border-t-surface-card')
  })
})
