import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useComplianceStore } from '../../stores/complianceStore'
import UsageReminder from './UsageReminder'

describe('UsageReminder', () => {
  beforeEach(() => {
    useComplianceStore.setState({
      showUsageReminder: false,
      usageStartTime: null,
      usageMinutes: 0,
    })
  })

  it('renders nothing while under the limit', () => {
    const { container } = render(<UsageReminder />)

    expect(container).toBeEmptyDOMElement()
  })

  it('exposes an accessible modal dialog when shown', () => {
    useComplianceStore.setState({ showUsageReminder: true })

    render(<UsageReminder />)

    const dialog = screen.getByRole('dialog', { name: '已经聊了两个小时啦' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('traps keyboard focus across both actions', async () => {
    const user = userEvent.setup()
    useComplianceStore.setState({ showUsageReminder: true })
    render(<UsageReminder />)

    const confirm = screen.getByRole('button', { name: '好的，知道了' })
    const snooze = screen.getByRole('button', { name: '再聊5分钟' })
    expect(confirm).toHaveFocus()
    await user.tab()
    expect(snooze).toHaveFocus()
    await user.tab()
    expect(confirm).toHaveFocus()
    await user.tab({ shift: true })
    expect(snooze).toHaveFocus()
  })

  it('acknowledging the break dismisses the reminder and restarts the clock', async () => {
    const user = userEvent.setup()
    useComplianceStore.setState({ showUsageReminder: true, usageMinutes: 121 })
    render(<UsageReminder />)

    await user.click(screen.getByRole('button', { name: '好的，知道了' }))

    expect(useComplianceStore.getState().showUsageReminder).toBe(false)
    expect(useComplianceStore.getState().usageMinutes).toBe(0)
    expect(useComplianceStore.getState().usageStartTime).not.toBeNull()
  })

  it('snoozing keeps the session clock running', async () => {
    const user = userEvent.setup()
    const startedAt = Date.now() - 121 * 60_000
    useComplianceStore.setState({ showUsageReminder: true, usageStartTime: startedAt, usageMinutes: 121 })
    render(<UsageReminder />)

    await user.click(screen.getByRole('button', { name: '再聊5分钟' }))

    expect(useComplianceStore.getState().showUsageReminder).toBe(false)
    expect(useComplianceStore.getState().usageStartTime).toBe(startedAt)
  })
})
