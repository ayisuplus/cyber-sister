import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useComplianceStore } from '../../stores/complianceStore'
import AIDisclaimer from './AIDisclaimer'

describe('AIDisclaimer', () => {
  beforeEach(() => {
    useComplianceStore.setState({ showAIDisclaimer: false, hasShownDisclaimer: false })
  })

  it('renders nothing while hidden', () => {
    const { container } = render(<AIDisclaimer />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the AI identity dialog with focus on the confirm button', () => {
    useComplianceStore.setState({ showAIDisclaimer: true })

    render(<AIDisclaimer />)

    expect(screen.getByRole('dialog', { name: '我是AI，不是真人' })).toBeInTheDocument()
    expect(screen.getByText(/我不是真人/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '我知道了' })).toHaveFocus()
  })

  it('dismisses and persists the acknowledgement', async () => {
    const user = userEvent.setup()
    useComplianceStore.setState({ showAIDisclaimer: true })
    render(<AIDisclaimer />)

    await user.click(screen.getByRole('button', { name: '我知道了' }))

    expect(useComplianceStore.getState().showAIDisclaimer).toBe(false)
    expect(localStorage.getItem('cyber-sister-disclaimer-shown')).toBe('true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps keyboard focus trapped on the confirm button', async () => {
    const user = userEvent.setup()
    useComplianceStore.setState({ showAIDisclaimer: true })
    render(
      <>
        <button type="button">背景操作</button>
        <AIDisclaimer />
      </>,
    )

    const confirm = screen.getByRole('button', { name: '我知道了' })
    expect(confirm).toHaveFocus()
    await user.tab()
    expect(confirm).toHaveFocus()
    await user.tab({ shift: true })
    expect(confirm).toHaveFocus()
    expect(screen.getByRole('button', { name: '背景操作' })).not.toHaveFocus()
  })
})
