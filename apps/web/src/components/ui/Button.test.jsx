import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Button from './Button'

describe('Button', () => {
  it('defaults to the primary variant with a 44px touch target and type=button', () => {
    render(<Button>保存</Button>)

    const button = screen.getByRole('button', { name: '保存' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('min-h-11', 'rounded-control', 'bg-action-primary', 'text-text-inverse')
  })

  it('applies the secondary and danger variants', () => {
    render(
      <>
        <Button variant="secondary">次要</Button>
        <Button variant="danger">危险</Button>
      </>,
    )

    expect(screen.getByRole('button', { name: '次要' })).toHaveClass('border', 'bg-surface-card', 'text-text-secondary')
    expect(screen.getByRole('button', { name: '危险' })).toHaveClass('bg-danger', 'text-text-inverse')
  })

  it('passes through className, disabled and click handlers', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button className="w-full" disabled onClick={onClick}>不可点</Button>)

    const button = screen.getByRole('button', { name: '不可点' })
    expect(button).toBeDisabled()
    expect(button).toHaveClass('w-full')
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})
