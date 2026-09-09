import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/careService', () => ({
  careService: { list: vi.fn(), dismiss: vi.fn() },
}))

import { careService } from '../../services/careService'
import CareCards from './CareCards'

const CARDS = [
  {
    key: 'countdown:c1:2026-09-09',
    kind: 'countdown',
    title: '「面试」还有 1 天',
    body: '时间刚刚好，今天顺手推进一点。',
    reason: '你在倒数日里记的日子',
    action: { to: '/tools/countdown', label: '看看倒数日' },
  },
  {
    key: 'habit:h1:2026-09-09',
    kind: 'habit',
    title: '「喝水」今天还没打卡',
    body: '已经连续 12 天了，别断在这儿。',
    reason: '手帐连续打卡统计',
    action: { to: '/tools/handbook', label: '去打卡' },
  },
]

const renderCards = (props) => render(<MemoryRouter><CareCards {...props} /></MemoryRouter>)

describe('CareCards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    careService.list.mockResolvedValue({ touchpoints: CARDS })
    careService.dismiss.mockResolvedValue({ dismissed: true })
  })

  it('renders cards with reason and action link', async () => {
    renderCards()

    expect(await screen.findByText('「面试」还有 1 天')).toBeInTheDocument()
    expect(screen.getByText('为什么看到这条：你在倒数日里记的日子')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /看看倒数日/ })).toHaveAttribute('href', '/tools/countdown')
    expect(screen.getByText('她来想你')).toBeInTheDocument()
  })

  it('dismisses a card optimistically and calls the server', async () => {
    const user = userEvent.setup()
    renderCards()
    await screen.findByText('「面试」还有 1 天')

    await user.click(screen.getAllByRole('button', { name: '今天不再提醒这条' })[0])

    expect(careService.dismiss).toHaveBeenCalledWith('countdown:c1:2026-09-09')
    expect(screen.queryByText('「面试」还有 1 天')).not.toBeInTheDocument()
    expect(screen.getByText('「喝水」今天还没打卡')).toBeInTheDocument()
  })

  it('renders nothing when empty or load fails', async () => {
    careService.list.mockResolvedValue({ touchpoints: [] })
    const { container } = renderCards()
    await waitFor(() => expect(careService.list).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()

    careService.list.mockRejectedValue(new Error('offline'))
    const { container: failed } = renderCards()
    await waitFor(() => expect(careService.list).toHaveBeenCalledTimes(2))
    expect(failed).toBeEmptyDOMElement()
  })

  it('limit=1 shows only the first card and no heading', async () => {
    renderCards({ limit: 1, heading: false })

    expect(await screen.findByText('「面试」还有 1 天')).toBeInTheDocument()
    expect(screen.queryByText('「喝水」今天还没打卡')).not.toBeInTheDocument()
    expect(screen.queryByText('她来想你')).not.toBeInTheDocument()
  })
})
