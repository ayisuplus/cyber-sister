import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/nudgeService', () => ({ nudgeService: { list: vi.fn(), ack: vi.fn() } }))
vi.mock('../../services/letterService', () => ({ letterService: { decide: vi.fn() } }))

import { nudgeService } from '../../services/nudgeService'
import { letterService } from '../../services/letterService'
import HerNudges from './HerNudges'

const renderNudges = (props = {}) => render(<MemoryRouter><HerNudges {...props} /></MemoryRouter>)

describe('HerNudges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nudgeService.ack.mockResolvedValue({ success: true })
  })

  it('says nothing when there is nothing to say, and stays quiet when the request fails', async () => {
    nudgeService.list.mockResolvedValue({ nudges: [] })
    const { container, unmount } = renderNudges()
    await vi.waitFor(() => expect(nudgeService.list).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    unmount()

    nudgeService.list.mockRejectedValue(new Error('offline'))
    const offline = renderNudges()
    await vi.waitFor(() => expect(nudgeService.list).toHaveBeenCalledTimes(2))
    expect(offline.container).toBeEmptyDOMElement()
  })

  it('shows the reminder, her care and the weekly letter in one place, each with a reason', async () => {
    nudgeService.list.mockResolvedValue({
      nudges: [
        { id: 'reminder:d1', kind: 'reminder', content: '该喝水啦', reason: '你在日历上定的（每天 10:00）' },
        { id: 'care:mood:2026-09-20', kind: 'care', content: '昨天不太好过', reason: '昨天的心情', action: { to: '/tools/notes', label: '去写两句' } },
        { id: 'letter:l1', kind: 'letter', content: '见信好。\n这周你们聊了 23 轮。', reason: '她每周写给你的信' },
      ],
    })

    renderNudges()

    expect(await screen.findByText('该喝水啦')).toBeInTheDocument()
    expect(screen.getByText('为什么看到这条：你在日历上定的（每天 10:00）')).toBeInTheDocument()
    expect(screen.getByText(/这周你们聊了 23 轮/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去写两句 →' })).toHaveAttribute('href', '/tools/notes')
    expect(screen.getAllByRole('button', { name: '知道了' })).toHaveLength(3)
  })

  it('takes one away as soon as the user says 知道了, and keeps the rest', async () => {
    const user = userEvent.setup()
    nudgeService.list.mockResolvedValue({
      nudges: [
        { id: 'reminder:d1', kind: 'reminder', content: '该喝水啦', reason: '你在日历上定的' },
        { id: 'letter:l1', kind: 'letter', content: '见信好。', reason: '她每周写给你的信' },
      ],
    })
    renderNudges()

    await user.click((await screen.findAllByRole('button', { name: '知道了' }))[0])

    expect(nudgeService.ack).toHaveBeenCalledWith('reminder:d1')
    expect(screen.queryByText('该喝水啦')).not.toBeInTheDocument()
    expect(screen.getByText('见信好。')).toBeInTheDocument()
  })

  it('shows the result of something she did for you under the reminder', async () => {
    nudgeService.list.mockResolvedValue({
      nudges: [{ id: 'reminder:d2', kind: 'reminder', content: '总结这周的日记', reason: '你交给她的事', detail: '这周你写了三天。' }],
    })

    renderNudges()

    expect(await screen.findByText('总结这周的日记')).toBeInTheDocument()
    expect(screen.getByText('这周你写了三天。')).toBeInTheDocument()
  })
})

// 来信便签里的建议就地处置：与看信页同一个 SuggestionActions，同一套 decide 语义
const LETTER_SUGGESTIONS = [
  { kind: 'edit_memory', title: '把这条改准确', quote: '喜欢桂花味', chatText: '就按你信里说的改吧', decided: null },
  { kind: 'plan', title: '把复诊安排上', planDate: '2026-10-01', chatText: null, decided: null },
]
const letterNudge = { id: 'letter:l1', kind: 'letter', letterId: 'l1', content: '见信好。', reason: '她写给你的信', suggestions: LETTER_SUGGESTIONS }

describe('来信便签里的建议', () => {
  beforeEach(() => {
    nudgeService.list.mockResolvedValue({ nudges: [letterNudge] })
  })

  it('「同意采纳」走 decide（accept），条目就地变成「已采纳」', async () => {
    const user = userEvent.setup()
    letterService.decide.mockResolvedValue({ letter: { id: 'l1', suggestions: [{ ...LETTER_SUGGESTIONS[0], decided: 'accepted' }] } })
    renderNudges()

    const section = await screen.findByRole('region', { name: '把这条改准确' })
    await user.click(within(section).getByRole('button', { name: '同意采纳' }))

    expect(letterService.decide).toHaveBeenCalledWith('l1', 0, { decision: 'accept' })
    expect(await within(screen.getByRole('region', { name: '把这条改准确' })).findByText('已采纳')).toBeInTheDocument()
  })

  it('「不用」走 decide（dismiss），条目就地变成「没采纳」', async () => {
    const user = userEvent.setup()
    letterService.decide.mockResolvedValue({ letter: { id: 'l1' } })
    renderNudges()

    await user.click(within(await screen.findByRole('region', { name: '把复诊安排上' })).getByRole('button', { name: '不用' }))

    expect(letterService.decide).toHaveBeenCalledWith('l1', 1, { decision: 'dismiss' })
    expect(await within(screen.getByRole('region', { name: '把复诊安排上' })).findByText('没采纳')).toBeInTheDocument()
  })

  it('「带去对话」交给聊天输入框：优先 chatText，没有就拼回退引导句', async () => {
    const user = userEvent.setup()
    const onComposeDraft = vi.fn()
    renderNudges({ onComposeDraft })

    await user.click(within(await screen.findByRole('region', { name: '把这条改准确' })).getByRole('button', { name: '带去对话' }))
    expect(onComposeDraft).toHaveBeenCalledWith('就按你信里说的改吧')

    await user.click(within(screen.getByRole('region', { name: '把复诊安排上' })).getByRole('button', { name: '带去对话' }))
    expect(onComposeDraft).toHaveBeenCalledWith('你信里说「把复诊安排上」，')
    expect(letterService.decide).not.toHaveBeenCalled()
  })
})
