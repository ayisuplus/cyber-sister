import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
import SchedulePage from './SchedulePage'

// 固定本地时间：2026-09-15（周二）10:00；只伪造 Date，不影响 RTL 的等待计时
const NOW = new Date(2026, 8, 15, 10, 0)
const at = (day, hour, minute = 0) => new Date(2026, 8, day, hour, minute).toISOString()

const makeTask = (overrides) => ({
  id: 't1', content: '取快递', freq: 'once', time: '18:00', weekdays: [], monthDay: null,
  nextFireAt: at(15, 18), status: 'active', instruction: null,
  ...overrides,
})

const renderPage = () => render(<MemoryRouter><SchedulePage /></MemoryRouter>)
const openForm = () => fireEvent.click(screen.getByRole('button', { name: /新安排/ }))
const save = () => fireEvent.click(screen.getByRole('button', { name: '保存安排' }))
// 上一个改动收尾前按钮保持禁用：等它可点再点
const clickWhenReady = async (label) => {
  await vi.waitFor(() => expect(screen.getByLabelText(label)).toBeEnabled())
  fireEvent.click(screen.getByLabelText(label))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  useToolsStore.setState({ scheduledReminders: [], dueDeliveries: [] })
  reminderService.list.mockResolvedValue([])
  reminderService.create.mockImplementation(async (payload) => makeTask({ id: 'new-1', nextFireAt: at(16, 9), ...payload }))
  reminderService.update.mockImplementation(async (id, payload) => makeTask({ id, ...payload }))
  reminderService.remove.mockResolvedValue({ ok: true })
})

afterEach(() => vi.useRealTimers())

describe('SchedulePage（安排）', () => {
  it('空列表给出安静的引导，也提示可以在对话里说', async () => {
    renderPage()
    expect(await screen.findByText('还没有安排')).toBeInTheDocument()
    expect(screen.getByText(/明天九点提醒我复诊/)).toBeInTheDocument()
  })

  it('按今天 / 接下来 / 重复 / 已暂停分组，接下来显示还有几天，已完成默认收起', async () => {
    reminderService.list.mockResolvedValue([
      makeTask({ id: 'a', content: '复诊', nextFireAt: at(15, 18) }),
      makeTask({ id: 'b', content: '面试', nextFireAt: at(16, 9) }),
      makeTask({ id: 'c', content: '妈妈生日', freq: 'yearly', time: '09:00', nextFireAt: at(20, 9) }),
      makeTask({ id: 'd', content: '打卡：喝水', freq: 'daily', time: '21:00', nextFireAt: at(15, 21) }),
      makeTask({ id: 'e', content: '交房租', freq: 'monthly', monthDay: 1, time: '09:00', status: 'paused', nextFireAt: at(30, 9) }),
      makeTask({ id: 'f', content: '寄快递', status: 'done', nextFireAt: at(14, 9) }),
    ])
    renderPage()

    const today = await screen.findByRole('region', { name: '今天' })
    expect(within(today).getByText('复诊')).toBeInTheDocument()
    expect(within(today).getByText('今天 18:00')).toBeInTheDocument()

    const upcoming = screen.getByRole('region', { name: '接下来' })
    expect(within(upcoming).getByText('明天')).toBeInTheDocument()
    expect(within(upcoming).getByText('还有 5 天')).toBeInTheDocument()
    expect(within(upcoming).getByText('每年 9月20日 09:00')).toBeInTheDocument()

    expect(within(screen.getByRole('region', { name: '重复' })).getByText('每天 21:00')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '已暂停' })).getByText('交房租')).toBeInTheDocument()

    expect(screen.queryByText('寄快递')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /已完成 · 1/ }))
    expect(screen.getByText('寄快递')).toBeInTheDocument()
  })

  it('一次性的安排缺日期或时间已过时前端拦截，不调接口', async () => {
    renderPage()
    await screen.findByText('还没有安排')
    openForm()
    fireEvent.change(screen.getByLabelText('要安排的事'), { target: { value: '取快递' } })
    fireEvent.change(screen.getByLabelText('时间'), { target: { value: '18:00' } })
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('一次性的安排要选日期')

    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-09-15' } })
    fireEvent.change(screen.getByLabelText('时间'), { target: { value: '08:00' } })
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('这个时间已经过去了')
    expect(reminderService.create).not.toHaveBeenCalled()
  })

  it('每天的小习惯：保存后收起表单并出现在「重复」里', async () => {
    renderPage()
    await screen.findByText('还没有安排')
    openForm()
    fireEvent.click(screen.getByRole('button', { name: '每天' }))
    fireEvent.change(screen.getByLabelText('要安排的事'), { target: { value: '放下手机' } })
    fireEvent.change(screen.getByLabelText('时间'), { target: { value: '23:00' } })
    save()
    const repeating = await screen.findByRole('region', { name: '重复' })
    expect(within(repeating).getByText('放下手机')).toBeInTheDocument()
    expect(reminderService.create).toHaveBeenCalledWith({ content: '放下手机', freq: 'daily', time: '23:00' })
    expect(screen.queryByRole('form', { name: '新安排' })).not.toBeInTheDocument()
  })

  it('每年的日子带上日期，适合生日和纪念日', async () => {
    renderPage()
    await screen.findByText('还没有安排')
    openForm()
    fireEvent.click(screen.getByRole('button', { name: '每年' }))
    expect(screen.getByText(/适合生日和纪念日/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('要安排的事'), { target: { value: '妈妈生日' } })
    fireEvent.change(screen.getByLabelText('时间'), { target: { value: '09:00' } })
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('每年的安排要选日期')
    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '1970-10-01' } })
    save()
    await vi.waitFor(() => expect(reminderService.create).toHaveBeenCalledWith({ content: '妈妈生日', freq: 'yearly', time: '09:00', date: '1970-10-01' }))
  })

  it('交给她：缺指令拦截；保存后如实标注云端执行未接通', async () => {
    reminderService.create.mockRejectedValueOnce(new Error('offline'))
    renderPage()
    await screen.findByText('还没有安排')
    openForm()
    fireEvent.click(screen.getByRole('button', { name: '交给她去做' }))
    expect(screen.getByText(/云端执行还没接通，到点不会自动去做/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '每天' }))
    fireEvent.change(screen.getByLabelText('这件事叫什么'), { target: { value: '早安打气' } })
    fireEvent.change(screen.getByLabelText('时间'), { target: { value: '08:00' } })
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('告诉她具体要做什么')

    fireEvent.change(screen.getByLabelText('要她做什么'), { target: { value: '给我一句带劲的早安加油' } })
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败')
    expect(screen.getByLabelText('要她做什么')).toHaveValue('给我一句带劲的早安加油')

    save()
    expect(await screen.findByText('云端执行未接通 · 到点暂不执行')).toBeInTheDocument()
    expect(reminderService.create).toHaveBeenLastCalledWith({ content: '早安打气', freq: 'daily', time: '08:00', instruction: '给我一句带劲的早安加油' })
  })

  it('完成、暂停、继续与删除都走 store 动作', async () => {
    const tasks = [
      makeTask({}),
      makeTask({ id: 't2', content: '打卡：喝水', freq: 'daily', time: '21:00', status: 'paused', nextFireAt: at(15, 21) }),
    ]
    reminderService.list.mockResolvedValue(tasks)
    reminderService.update.mockImplementation(async (id, payload) => ({ ...tasks.find(task => task.id === id), ...payload }))
    renderPage()
    await screen.findByText('取快递')
    await clickWhenReady('完成：取快递')
    expect(await screen.findByRole('button', { name: /已完成 · 1/ })).toBeInTheDocument()
    expect(reminderService.update).toHaveBeenCalledWith('t1', { status: 'done' })

    expect(screen.queryByLabelText('完成：打卡：喝水')).not.toBeInTheDocument()
    await clickWhenReady('继续：打卡：喝水')
    await screen.findByLabelText('暂停：打卡：喝水')
    expect(reminderService.update).toHaveBeenCalledWith('t2', { status: 'active' })

    await clickWhenReady('暂停：打卡：喝水')
    await screen.findByLabelText('继续：打卡：喝水')
    expect(reminderService.update).toHaveBeenCalledWith('t2', { status: 'paused' })

    await clickWhenReady('删除：打卡：喝水')
    await vi.waitFor(() => expect(screen.queryByText('打卡：喝水')).not.toBeInTheDocument())
    expect(reminderService.remove).toHaveBeenCalledWith('t2')
  })

  it('删除失败保留记录并可再次提交', async () => {
    reminderService.list.mockResolvedValue([makeTask({})])
    reminderService.remove.mockRejectedValueOnce(new Error('offline'))
    renderPage()
    await screen.findByText('取快递')
    await clickWhenReady('删除：取快递')
    expect(await screen.findByRole('alert')).toHaveTextContent('记录还在')
    expect(screen.getByText('取快递')).toBeInTheDocument()
    await clickWhenReady('删除：取快递')
    expect(await screen.findByText('还没有安排')).toBeInTheDocument()
  })

  it('加载失败时给出重试', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    reminderService.list.mockRejectedValueOnce(new Error('offline'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('安排没加载出来')
    reminderService.list.mockResolvedValue([makeTask({})])
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findByText('取快递')).toBeInTheDocument()
  })
})
