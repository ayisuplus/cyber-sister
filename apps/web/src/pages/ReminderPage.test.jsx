import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/reminderService', () => ({
  reminderService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    listDue: vi.fn(),
    ack: vi.fn(),
  },
}))

import { reminderService } from '../services/reminderService'
import { useToolsStore } from '../stores/toolsStore'
import ReminderPage from './ReminderPage'
import ReminderBell from '../components/reminder/ReminderBell'

const renderPage = () => render(<MemoryRouter><ReminderPage /></MemoryRouter>)
const renderBell = () => render(<MemoryRouter><ReminderBell /></MemoryRouter>)

const makeReminder = (overrides) => ({
  id: 'r1',
  content: '取快递',
  freq: 'once',
  time: '18:00',
  weekdays: [],
  monthDay: null,
  nextFireAt: '2026-09-12T10:00:00.000Z',
  status: 'active',
  ...overrides,
})

describe('ReminderPage（自定义提醒）', () => {
  beforeEach(() => {
    useToolsStore.setState({ scheduledReminders: [], dueDeliveries: [] })
    reminderService.list.mockResolvedValue([])
    reminderService.create.mockImplementation(async (payload) => makeReminder({ id: 'new-1', ...payload }))
    reminderService.update.mockImplementation(async (id, payload) => makeReminder({ id, ...payload }))
    reminderService.remove.mockResolvedValue({ ok: true })
  })

  it('空列表展示空状态引导', async () => {
    renderPage()
    expect(await screen.findByText('还没有自定义提醒')).toBeInTheDocument()
  })

  it('一次性提醒缺日期时前端拦截，不调接口', async () => {
    renderPage()
    fireEvent.change(await screen.findByLabelText('提醒内容'), { target: { value: '取快递' } })
    fireEvent.change(screen.getByLabelText('提醒时间'), { target: { value: '18:00' } })
    fireEvent.click(screen.getByRole('button', { name: /添加提醒/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('一次性提醒要选日期')
    expect(reminderService.create).not.toHaveBeenCalled()
  })

  it('创建每天提醒成功并写入 store', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '每天' }))
    fireEvent.change(screen.getByLabelText('提醒内容'), { target: { value: '放下手机' } })
    fireEvent.change(screen.getByLabelText('提醒时间'), { target: { value: '23:00' } })
    fireEvent.click(screen.getByRole('button', { name: /添加提醒/ }))
    expect(await screen.findByText('放下手机')).toBeInTheDocument()
    expect(reminderService.create).toHaveBeenCalledWith({ content: '放下手机', freq: 'daily', time: '23:00' })
  })

  it('暂停/恢复与删除走 store 动作', async () => {
    reminderService.list.mockResolvedValue([makeReminder({})])
    renderPage()
    fireEvent.click(await screen.findByLabelText('暂停提醒：取快递'))
    await screen.findByText('取快递')
    await vi.waitFor(() => expect(reminderService.update).toHaveBeenCalledWith('r1', { status: 'paused' }))
    fireEvent.click(screen.getByLabelText('删除提醒：取快递'))
    await vi.waitFor(() => expect(reminderService.remove).toHaveBeenCalledWith('r1'))
  })
})

describe('ReminderBell（到点通知）', () => {
  beforeEach(() => {
    useToolsStore.setState({ scheduledReminders: [], dueDeliveries: [] })
    reminderService.listDue.mockResolvedValue([])
    reminderService.ack.mockResolvedValue({})
  })

  it('无到期提醒时不显示 badge', () => {
    renderBell()
    expect(screen.getByRole('button', { name: '提醒' })).toBeInTheDocument()
  })

  it('有待处理投递时显示角标，打开后可「知道了」', async () => {
    const delivery = {
      id: 'd1', fireAt: '2026-09-10T00:00:00.000Z', status: 'pending',
      reminder: { id: 'r1', content: '喝水', freq: 'daily', time: '08:00' },
    }
    reminderService.listDue.mockResolvedValue([delivery])
    renderBell()
    const btn = await screen.findByRole('button', { name: /1 条待处理/ })
    fireEvent.click(btn)
    fireEvent.click(await screen.findByRole('button', { name: '知道了' }))
    expect(reminderService.ack).toHaveBeenCalledWith('d1', 'shown')
  })
})
