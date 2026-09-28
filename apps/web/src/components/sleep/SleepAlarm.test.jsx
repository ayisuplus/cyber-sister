import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/sleepService', () => ({ sleepService: { get: vi.fn(), save: vi.fn() } }))
vi.mock('../../services/nudgeService', () => ({ nudgeService: { list: vi.fn(), ack: vi.fn() } }))
vi.mock('../../features/sleep/chime', () => ({ installAudioUnlock: vi.fn(() => () => {}), startChime: vi.fn() }))
vi.mock('../../features/sleep/notify', () => ({ notifyWake: vi.fn() }))

import { sleepService } from '../../services/sleepService'
import { nudgeService } from '../../services/nudgeService'
import { startChime } from '../../features/sleep/chime'
import { notifyWake } from '../../features/sleep/notify'
import { NUDGE_ACKED_EVENT, useSleepStore } from '../../stores/sleepStore'
import SleepAlarm from './SleepAlarm'

const at = (h, m, s = 0) => new Date(2026, 8, 29, h, m, s)
const WAKE_AT = at(7, 40)
const TOMORROW = new Date(2026, 8, 30, 7, 40)
const wake = (nextFireAt) => ({ id: 'w1', enabled: true, time: '07:40', weekdays: [1, 2, 3, 4, 5], nextFireAt: nextFireAt.toISOString() })
const wakeNote = { id: 'reminder:d1', kind: 'wake', fireAt: WAKE_AT.toISOString(), line: { text: '知否，知否？应是绿肥红瘦。', source: '李清照《如梦令·昨夜雨疏风骤》' } }

const flush = () => act(() => vi.advanceTimersByTimeAsync(0))
const pass = (ms) => act(() => vi.advanceTimersByTimeAsync(ms))
const renderAlarm = (path = '/tools/notes') => render(<MemoryRouter initialEntries={[path]}><SleepAlarm /></MemoryRouter>)

let stop
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  useSleepStore.setState({ bedtime: null, wake: null, due: [], loaded: false })
  stop = vi.fn()
  startChime.mockResolvedValue(stop)
  notifyWake.mockReturnValue({ close: vi.fn() })
  nudgeService.ack.mockResolvedValue({ success: true })
})
afterEach(() => vi.useRealTimers())

describe('早安闹钟', () => {
  it('页面开着、到点：响铃、弹通知、盖一张早安卡；「起来了」停铃并收起那张便签', async () => {
    vi.setSystemTime(at(7, 39))
    sleepService.get
      .mockResolvedValueOnce({ bedtime: null, wake: wake(WAKE_AT), due: [] })
      .mockResolvedValue({ bedtime: null, wake: wake(TOMORROW), due: [wakeNote] })
    renderAlarm()
    await flush()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await pass(75_000)
    const card = screen.getByRole('dialog', { name: '早安' })
    expect(card).toHaveTextContent('07:40')
    expect(card).toHaveTextContent('知否，知否？应是绿肥红瘦。')
    expect(card).toHaveTextContent('——李清照《如梦令·昨夜雨疏风骤》')
    expect(startChime).toHaveBeenCalledTimes(1)
    expect(notifyWake).toHaveBeenCalledWith('知否，知否？应是绿肥红瘦。')

    const acked = vi.fn()
    window.addEventListener(NUDGE_ACKED_EVENT, acked)
    fireEvent.click(screen.getByRole('button', { name: '起来了' }))
    window.removeEventListener(NUDGE_ACKED_EVENT, acked)
    expect(stop).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(nudgeService.ack).toHaveBeenCalledWith('reminder:d1')
    // 对话里那张同样的早安便签也跟着收起
    expect(acked).toHaveBeenCalled()
  })

  it('过了点才打开页面：不响、不弹（对话里安静地留着早安便签）', async () => {
    vi.setSystemTime(at(7, 45))
    sleepService.get.mockResolvedValue({ bedtime: null, wake: wake(TOMORROW), due: [wakeNote] })
    renderAlarm()
    await pass(60_000)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(startChime).not.toHaveBeenCalled()
  })

  it('再躺五分钟：停铃，五分钟后再响；最多躺两次', async () => {
    vi.setSystemTime(at(7, 39))
    sleepService.get
      .mockResolvedValueOnce({ bedtime: null, wake: wake(WAKE_AT), due: [] })
      .mockResolvedValue({ bedtime: null, wake: wake(TOMORROW), due: [wakeNote] })
    renderAlarm()
    await flush()
    await pass(75_000)

    fireEvent.click(screen.getByRole('button', { name: '再躺五分钟' }))
    expect(stop).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await pass(4 * 60_000)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await pass(75_000)
    expect(screen.getByRole('dialog', { name: '早安' })).toBeInTheDocument()
    expect(startChime).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: '再躺五分钟' }))
    await pass(5 * 60_000 + 15_000)
    expect(screen.getByRole('dialog', { name: '早安' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '再躺五分钟' })).not.toBeInTheDocument()
    // 躺够了还是只 ack 一次
    expect(nudgeService.ack).not.toHaveBeenCalled()
  })

  it('到点时取不到那句话：照样响，卡片上只写时间和一句兜底的话', async () => {
    vi.setSystemTime(at(7, 39))
    sleepService.get
      .mockResolvedValueOnce({ bedtime: null, wake: wake(WAKE_AT), due: [] })
      .mockRejectedValue(new Error('offline'))
    renderAlarm()
    await flush()
    await pass(75_000)
    const card = screen.getByRole('dialog', { name: '早安' })
    expect(card).toHaveTextContent('天亮了，慢慢醒。')
    expect(startChime).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '起来了' }))
    // 没有便签可收
    expect(nudgeService.ack).not.toHaveBeenCalled()
  })

  it('浏览器不让出声时，早安卡上如实写着', async () => {
    vi.setSystemTime(at(7, 39))
    startChime.mockResolvedValue(null)
    sleepService.get
      .mockResolvedValueOnce({ bedtime: null, wake: wake(WAKE_AT), due: [] })
      .mockResolvedValue({ bedtime: null, wake: wake(TOMORROW), due: [wakeNote] })
    renderAlarm()
    await flush()
    await pass(75_000)
    expect(screen.getByRole('dialog', { name: '早安' })).toHaveTextContent('这次没能出声')
  })
})

describe('晚安提醒', () => {
  const bedNote = { id: 'reminder:d2', kind: 'bedtime', fireAt: at(23, 30).toISOString(), line: { text: '月亮上班了，你可以下班了。明早 07:40 叫你。', source: '' } }

  it('在别的页面：底部浮一张静音小便签，不响铃不弹通知；「知道了」收起', async () => {
    vi.setSystemTime(at(23, 31))
    sleepService.get.mockResolvedValue({ bedtime: null, wake: null, due: [bedNote] })
    renderAlarm('/tools/reading')
    await flush()
    const note = screen.getByRole('complementary', { name: '晚安便签' })
    expect(note).toHaveTextContent('月亮上班了，你可以下班了。明早 07:40 叫你。')
    expect(startChime).not.toHaveBeenCalled()
    expect(notifyWake).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '知道了' }))
    expect(screen.queryByRole('complementary', { name: '晚安便签' })).not.toBeInTheDocument()
    expect(nudgeService.ack).toHaveBeenCalledWith('reminder:d2')
  })

  it('在对话页：由对话里那张便签来说，这里不再浮一张', async () => {
    vi.setSystemTime(at(23, 31))
    sleepService.get.mockResolvedValue({ bedtime: null, wake: null, due: [bedNote] })
    renderAlarm('/chat')
    await flush()
    expect(screen.queryByRole('complementary', { name: '晚安便签' })).not.toBeInTheDocument()
  })
})
