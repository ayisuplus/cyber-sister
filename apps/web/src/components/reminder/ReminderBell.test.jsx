import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/reminderService', () => ({
  reminderService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    listDue: vi.fn(),
    ack: vi.fn(),
  },
}))

import { reminderService } from '../../services/reminderService'
import { useToolsStore } from '../../stores/toolsStore'
import ReminderBell from './ReminderBell'

const renderBell = () => render(<MemoryRouter><ReminderBell /></MemoryRouter>)

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

  it('任务投递展示执行产出', async () => {
    const delivery = {
      id: 'd1', fireAt: '2026-09-10T00:00:00.000Z', status: 'pending',
      result: '你这周写了 3 篇日记，都很棒……',
      reminder: { id: 'r1', content: '每周日记总结', freq: 'weekly', time: '20:00', instruction: '总结我这周的日记' },
    }
    reminderService.listDue.mockResolvedValue([delivery])
    renderBell()
    fireEvent.click(await screen.findByRole('button', { name: /1 条待处理/ }))
    expect(await screen.findByText(/你这周写了 3 篇日记/)).toBeInTheDocument()
    expect(screen.getByText(/Amie 完成的任务/)).toBeInTheDocument()
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

  it('「管理提醒」入口指向合并后的日程与提醒页', async () => {
    renderBell()
    fireEvent.click(screen.getByRole('button', { name: '提醒' }))
    expect(await screen.findByRole('link', { name: '管理提醒' })).toHaveAttribute('href', '/tools/planner?tab=reminders')
  })
})
