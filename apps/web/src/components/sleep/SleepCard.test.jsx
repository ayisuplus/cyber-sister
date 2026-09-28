import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/sleepService', () => ({ sleepService: { get: vi.fn(), save: vi.fn() } }))
vi.mock('../../features/sleep/chime', () => ({ canPlaySound: vi.fn(() => true), previewChime: vi.fn() }))
vi.mock('../../features/sleep/notify', () => ({ notificationState: vi.fn(() => 'default'), askNotificationPermission: vi.fn() }))

import { sleepService } from '../../services/sleepService'
import { previewChime } from '../../features/sleep/chime'
import { askNotificationPermission, notificationState } from '../../features/sleep/notify'
import { useSleepStore } from '../../stores/sleepStore'
import SleepCard from './SleepCard'

const WORKDAYS = [1, 2, 3, 4, 5]
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]

beforeEach(() => {
  vi.clearAllMocks()
  useSleepStore.setState({ bedtime: null, wake: null, due: [], loaded: false })
  notificationState.mockReturnValue('default')
  askNotificationPermission.mockResolvedValue('granted')
  sleepService.get.mockResolvedValue({ bedtime: null, wake: null, due: [] })
  sleepService.save.mockImplementation(async (payload) => ({
    bedtime: payload.bedtime ? { id: 'b1', ...payload.bedtime } : null,
    wake: payload.wake ? { id: 'w1', ...payload.wake } : null,
  }))
})
afterEach(() => vi.useRealTimers())

const row = (name) => screen.getByRole('region', { name })

describe('睡眠卡', () => {
  it('没设过：晚安每天 23:30、早安工作日 07:30，都先关着；如实写着浏览器开着才会响', async () => {
    render(<SleepCard />)
    const bedtime = await screen.findByRole('region', { name: '晚安提醒' })
    expect(within(bedtime).getByRole('switch', { name: '晚安提醒' })).toHaveAttribute('aria-checked', 'false')
    expect(within(bedtime).getByLabelText('晚安提醒的时间')).toHaveValue('23:30')
    expect(within(bedtime).getByRole('button', { name: '晚安提醒：每天' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(bedtime).getByText(/到点不出声/)).toBeInTheDocument()

    const wake = row('早安闹钟')
    expect(within(wake).getByLabelText('早安闹钟的时间')).toHaveValue('07:30')
    expect(within(wake).getByRole('button', { name: '早安闹钟：周一' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(wake).getByRole('button', { name: '早安闹钟：周六' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(wake).getByText('明早会有一句话等你。')).toBeInTheDocument()
    expect(within(wake).getByText(/浏览器里开着 Amie 才会响/)).toHaveTextContent('手机上也不响')
  })

  it('打开早安闹钟：顺便问一次系统通知，再保存；之后显示通知已开', async () => {
    render(<SleepCard />)
    const wake = await screen.findByRole('region', { name: '早安闹钟' })
    fireEvent.click(within(wake).getByRole('switch', { name: '早安闹钟' }))
    await vi.waitFor(() => expect(sleepService.save).toHaveBeenCalledWith({ wake: { enabled: true, time: '07:30', weekdays: WORKDAYS } }))
    expect(askNotificationPermission).toHaveBeenCalledTimes(1)
    expect(await within(wake).findByText(/系统通知已开/)).toBeInTheDocument()
    expect(within(wake).getByRole('switch', { name: '早安闹钟' })).toHaveAttribute('aria-checked', 'true')
  })

  it('打开晚安提醒不问通知；选「每天」存成七天；改钟点离开输入框才存', async () => {
    render(<SleepCard />)
    const bedtime = await screen.findByRole('region', { name: '晚安提醒' })
    fireEvent.click(within(bedtime).getByRole('switch', { name: '晚安提醒' }))
    await vi.waitFor(() => expect(sleepService.save).toHaveBeenCalledTimes(1))
    expect(askNotificationPermission).not.toHaveBeenCalled()

    const time = within(bedtime).getByLabelText('晚安提醒的时间')
    // 保存中整行不可点；存好了再改
    await vi.waitFor(() => expect(time).not.toBeDisabled())
    fireEvent.change(time, { target: { value: '00:30' } })
    expect(sleepService.save).toHaveBeenCalledTimes(1)
    fireEvent.blur(time)
    await vi.waitFor(() => expect(sleepService.save).toHaveBeenLastCalledWith({ bedtime: { enabled: true, time: '00:30', weekdays: EVERY_DAY } }))

    await vi.waitFor(() => expect(time).not.toBeDisabled())
    fireEvent.click(within(bedtime).getByRole('button', { name: '晚安提醒：周六' }))
    await vi.waitFor(() => expect(sleepService.save).toHaveBeenLastCalledWith({ bedtime: { enabled: true, time: '00:30', weekdays: [0, 1, 2, 3, 4, 5] } }))
  })

  it('一天都不选等于没法响：最后一天点不掉，要关就用开关', async () => {
    useSleepStore.setState({ loaded: true })
    sleepService.get.mockResolvedValue({ bedtime: null, wake: { id: 'w1', enabled: true, time: '07:30', weekdays: [1] }, due: [] })
    render(<SleepCard />)
    const wake = await screen.findByRole('region', { name: '早安闹钟' })
    await vi.waitFor(() => expect(within(wake).getByRole('button', { name: '早安闹钟：周一' })).toHaveAttribute('aria-pressed', 'true'))
    fireEvent.click(within(wake).getByRole('button', { name: '早安闹钟：周一' }))
    expect(sleepService.save).not.toHaveBeenCalled()
  })

  it('保存失败：如实说没保存上，开关退回原样', async () => {
    sleepService.save.mockRejectedValue({ response: { data: { error: '提醒时间必须是 HH:mm 格式' } } })
    render(<SleepCard />)
    const bedtime = await screen.findByRole('region', { name: '晚安提醒' })
    fireEvent.click(within(bedtime).getByRole('switch', { name: '晚安提醒' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('提醒时间必须是 HH:mm 格式')
    expect(within(bedtime).getByRole('switch', { name: '晚安提醒' })).toHaveAttribute('aria-checked', 'false')
  })

  it('试听一句；浏览器不让出声时如实说；通知被拦了也如实说', async () => {
    previewChime.mockResolvedValue(null)
    notificationState.mockReturnValue('denied')
    render(<SleepCard />)
    const wake = await screen.findByRole('region', { name: '早安闹钟' })
    expect(within(wake).getByText(/系统通知被浏览器关了/)).toBeInTheDocument()
    expect(within(wake).queryByRole('button', { name: '打开系统通知' })).not.toBeInTheDocument()
    fireEvent.click(within(wake).getByRole('button', { name: '试听铃声' }))
    expect(await within(wake).findByText(/这个页面现在出不了声/)).toBeInTheDocument()
    expect(previewChime).toHaveBeenCalledTimes(1)
  })

  it('加载失败时说一声，不假装没设过', async () => {
    sleepService.get.mockRejectedValue(new Error('offline'))
    render(<SleepCard />)
    expect(await screen.findByRole('alert')).toHaveTextContent('睡眠卡没加载出来')
    expect(screen.queryByRole('region', { name: '早安闹钟' })).not.toBeInTheDocument()
  })
})
