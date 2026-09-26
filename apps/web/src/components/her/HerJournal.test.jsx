import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/companionService', () => ({ companionService: { journal: vi.fn() } }))

import { companionService } from '../../services/companionService'
import HerJournal from './HerJournal'

const JOURNAL = {
  windowDays: 7,
  lettersOn: true,
  days: [
    { date: '2026-09-26', entries: [{ kind: 'remember', at: '2026-09-26T01:00:00.000Z', text: '记住了你说的「我对芒果过敏」。' }] },
    { date: '2026-09-25', entries: [
      { kind: 'reflect', at: '2026-09-25T14:00:00.000Z', text: '回想了你最近说的话，猜了 2 件事。' },
      { kind: 'letter', at: '2026-09-25T14:01:00.000Z', text: '给你写了一封信，里面有 1 条建议。' },
    ] },
    { date: '2026-09-23', entries: [
      { kind: 'book', at: '2026-09-23T12:00:00.000Z', text: '聊天时翻了《情绪急救》「失败」。' },
      { kind: 'plant', at: '2026-09-23T13:00:00.000Z', text: '帮你认了「栀子花」，你把它收进了图鉴。' },
    ] },
  ],
}

describe('「她这几天」手账', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 北京时间 2026-09-26 上午十点
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-26T02:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('按天写：今天、昨天、再早的写日子和星期；每行前一个小插画，文字照原样', async () => {
    companionService.journal.mockResolvedValue(JOURNAL)
    render(<HerJournal />)

    const section = screen.getByRole('region', { name: '她这几天' })
    expect(await within(section).findByText('记住了你说的「我对芒果过敏」。')).toBeInTheDocument()
    expect(within(section).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['今天', '昨天', '9月23日 周三'])
    expect(within(section).getByText('最近 7 天')).toBeInTheDocument()
    expect(section.querySelectorAll('[data-doodle]')).toHaveLength(5)
    expect(section.querySelector('[data-doodle="reflect"]')).toHaveAttribute('aria-hidden', 'true')
    // 认了一株花草有自己的小画，不借「记下了」那支铅笔
    expect(section.querySelector('[data-doodle="plant"] .fill-rose')).not.toBeNull()
    // 写信开着，不需要说明
    expect(within(section).queryByText(/写信关着的时候/)).not.toBeInTheDocument()
  })

  it('写信关着时如实说明她不在你不在时回想，并指到写信频率', async () => {
    companionService.journal.mockResolvedValue({ ...JOURNAL, lettersOn: false })
    render(<HerJournal />)

    expect(await screen.findByText(/写信关着的时候，她不会在你不在时回想/)).toHaveTextContent('选个写信频率')
  })

  it('这几天什么都没有：一句邀请，不空着', async () => {
    companionService.journal.mockResolvedValue({ windowDays: 7, lettersOn: true, days: [] })
    render(<HerJournal />)

    expect(await screen.findByText(/这几天还没有可以记下的事/)).toBeInTheDocument()
  })

  it('读不到时说一句，不挡住「她」页别的内容', async () => {
    companionService.journal.mockRejectedValue(new Error('offline'))
    render(<HerJournal />)

    expect(await screen.findByRole('alert')).toHaveTextContent('她这几天的手账暂时读不到')
  })
})
