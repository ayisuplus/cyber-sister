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
import RemindersPanel from './RemindersPanel'

const renderPanel = () => render(<MemoryRouter><RemindersPanel /></MemoryRouter>)

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

describe('RemindersPanel（自定义提醒）', () => {
  beforeEach(() => {
    useToolsStore.setState({ scheduledReminders: [], dueDeliveries: [] })
    reminderService.list.mockResolvedValue([])
    reminderService.create.mockImplementation(async (payload) => makeReminder({ id: 'new-1', ...payload }))
    reminderService.update.mockImplementation(async (id, payload) => makeReminder({ id, ...payload }))
    reminderService.remove.mockResolvedValue({ ok: true })
  })

  it('空列表展示空状态引导', async () => {
    renderPanel()
    expect(await screen.findByText('还没有自定义提醒')).toBeInTheDocument()
  })

  it('一次性提醒缺日期时前端拦截，不调接口', async () => {
    renderPanel()
    fireEvent.change(await screen.findByLabelText('提醒内容'), { target: { value: '取快递' } })
    fireEvent.change(screen.getByLabelText('提醒时间'), { target: { value: '18:00' } })
    fireEvent.click(screen.getByRole('button', { name: /添加提醒/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('一次性提醒要选日期')
    expect(reminderService.create).not.toHaveBeenCalled()
  })

  it('创建每天提醒成功并写入 store', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '每天' }))
    fireEvent.change(screen.getByLabelText('提醒内容'), { target: { value: '放下手机' } })
    fireEvent.change(screen.getByLabelText('提醒时间'), { target: { value: '23:00' } })
    fireEvent.click(screen.getByRole('button', { name: /添加提醒/ }))
    expect(await screen.findByText('放下手机')).toBeInTheDocument()
    expect(reminderService.create).toHaveBeenCalledWith({ content: '放下手机', freq: 'daily', time: '23:00' })
  })

  it('任务形态：填指令后按任务创建，缺指令前端拦截', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '任务（Amie 到点去做）' }))
    fireEvent.click(screen.getByRole('button', { name: '每天' }))
    fireEvent.change(screen.getByLabelText('任务名'), { target: { value: '早安打气' } })
    fireEvent.change(screen.getByLabelText('提醒时间'), { target: { value: '08:00' } })

    // 缺指令拦截
    fireEvent.click(screen.getByRole('button', { name: /添加提醒/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('任务要告诉 Amie 具体做什么')
    expect(reminderService.create).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('任务指令'), { target: { value: '给我一句带劲的早安加油' } })
    fireEvent.click(screen.getByRole('button', { name: /添加提醒/ }))
    await vi.waitFor(() => expect(reminderService.create).toHaveBeenCalledWith({
      content: '早安打气', freq: 'daily', time: '08:00', instruction: '给我一句带劲的早安加油',
    }))
  })

  it('暂停/恢复与删除走 store 动作', async () => {
    reminderService.list.mockResolvedValue([makeReminder({})])
    renderPanel()
    fireEvent.click(await screen.findByLabelText('暂停提醒：取快递'))
    await screen.findByText('取快递')
    await vi.waitFor(() => expect(reminderService.update).toHaveBeenCalledWith('r1', { status: 'paused' }))
    fireEvent.click(screen.getByLabelText('删除提醒：取快递'))
    await vi.waitFor(() => expect(reminderService.remove).toHaveBeenCalledWith('r1'))
  })

  it('任务保存失败保留指令，重试成功后如实标记暂不执行', async () => {
    reminderService.create.mockRejectedValueOnce(new Error('offline'))
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '任务（Amie 到点去做）' }))
    fireEvent.click(screen.getByRole('button', { name: '每天' }))
    fireEvent.change(screen.getByLabelText('任务名'), { target: { value: '整理学习计划' } })
    fireEvent.change(screen.getByLabelText('任务指令'), { target: { value: '整理明天的复习安排' } })
    fireEvent.change(screen.getByLabelText('提醒时间'), { target: { value: '08:00' } })
    fireEvent.click(screen.getByRole('button', { name: /添加提醒/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败')
    expect(screen.getByLabelText('任务指令')).toHaveValue('整理明天的复习安排')
    expect(useToolsStore.getState().scheduledReminders).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /添加提醒/ }))
    expect(await screen.findByText('云端执行未接通 · 暂不执行')).toBeInTheDocument()
    expect(useToolsStore.getState().scheduledReminders).toHaveLength(1)
  })

  it('删除失败保留提醒并可再次提交', async () => {
    reminderService.list.mockResolvedValue([makeReminder({})])
    reminderService.remove.mockRejectedValueOnce(new Error('offline'))
    renderPanel()
    fireEvent.click(await screen.findByLabelText('删除提醒：取快递'))
    expect(await screen.findByRole('alert')).toHaveTextContent('记录已保留')
    expect(screen.getByText('取快递')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('删除提醒：取快递'))
    expect(await screen.findByText('还没有自定义提醒')).toBeInTheDocument()
  })
})
