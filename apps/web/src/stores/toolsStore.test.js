import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSession } from '../services/sessionLifecycle'
import { parseISO, startOfDay } from 'date-fns'

vi.mock('../services/toolsService', () => ({
  toolsService: {
    getPeriodRecords: vi.fn(),
    createPeriodRecord: vi.fn(),
    updatePeriodRecord: vi.fn(),
    deletePeriodRecord: vi.fn(),
  },
}))
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

import { toolsService } from '../services/toolsService'
import { reminderService } from '../services/reminderService'
import { useToolsStore } from './toolsStore'

const resetStore = () => useToolsStore.setState({
  periodRecords: [],
  scheduledReminders: [],
})

describe('toolsStore account ownership', () => {
  beforeEach(resetStore)

  it('clears private tool data at an account boundary', () => {
    useToolsStore.setState({ periodRecords: [{ id: 'old-period' }], scheduledReminders: [{ id: 'old-scheduled' }] })
    resetSession()
    expect(useToolsStore.getState()).toMatchObject({ periodRecords: [], scheduledReminders: [] })
  })

  it('only exposes period records and 安排 — the retired todo, countdown, legacy reminder and weather state is gone', () => {
    const state = useToolsStore.getState()
    for (const key of ['todos', 'loadTodos', 'countdowns', 'loadCountdowns', 'reminders', 'toggleReminder', 'weather', 'loadWeather', 'dueDeliveries', 'pollDueDeliveries', 'ackDelivery']) {
      expect(state).not.toHaveProperty(key)
    }
  })

  it('rejects previous account period records that arrive after reset', async () => {
    let resolveRecords
    toolsService.getPeriodRecords.mockImplementation(() => new Promise((resolve) => { resolveRecords = resolve }))
    const pending = useToolsStore.getState().loadPeriodRecords()
    resetSession()
    resolveRecords([{ id: 'old-period', startDate: '2026-01-01' }])
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
    expect(useToolsStore.getState().periodRecords).toEqual([])
  })
})

describe('toolsStore 安排', () => {
  beforeEach(resetStore)

  it('loads, adds, updates and removes tasks only after the server acknowledges', async () => {
    reminderService.list.mockResolvedValue([{ id: 't1', content: '复诊', status: 'active' }])
    await useToolsStore.getState().loadScheduledReminders()
    expect(useToolsStore.getState().scheduledReminders).toEqual([{ id: 't1', content: '复诊', status: 'active' }])

    reminderService.create.mockResolvedValue({ id: 't2', content: '妈妈生日', freq: 'yearly' })
    const created = await useToolsStore.getState().addScheduledReminder({ content: '妈妈生日', freq: 'yearly', date: '1970-10-01', time: '09:00' })
    expect(created.id).toBe('t2')
    expect(useToolsStore.getState().scheduledReminders.map(t => t.id)).toEqual(['t1', 't2'])

    reminderService.update.mockResolvedValue({ id: 't1', content: '复诊', status: 'done' })
    await useToolsStore.getState().updateScheduledReminder('t1', { status: 'done' })
    expect(reminderService.update).toHaveBeenCalledWith('t1', { status: 'done' })
    expect(useToolsStore.getState().scheduledReminders[0].status).toBe('done')

    reminderService.remove.mockRejectedValueOnce(new Error('offline'))
    await expect(useToolsStore.getState().removeScheduledReminder('t1')).rejects.toThrow('offline')
    expect(useToolsStore.getState().scheduledReminders).toHaveLength(2)
    reminderService.remove.mockResolvedValue({ ok: true })
    await useToolsStore.getState().removeScheduledReminder('t1')
    expect(useToolsStore.getState().scheduledReminders.map(t => t.id)).toEqual(['t2'])
  })

  it('keeps tasks when loading fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    reminderService.list.mockRejectedValue(new Error('offline'))
    useToolsStore.setState({ scheduledReminders: [{ id: 'keep' }] })

    await expect(useToolsStore.getState().loadScheduledReminders()).rejects.toThrow('offline')
    expect(useToolsStore.getState().scheduledReminders).toEqual([{ id: 'keep' }])
  })
})

describe('toolsStore period records', () => {
  beforeEach(resetStore)

  it('updates and deletes records only after the server acknowledges', async () => {
    useToolsStore.setState({ periodRecords: [{ id: 'p1', startDate: '2026-09-01' }] })
    toolsService.updatePeriodRecord.mockResolvedValue({ id: 'p1', startDate: '2026-09-01', endDate: '2026-09-05', cycleDays: 28 })
    await useToolsStore.getState().updatePeriodRecord('p1', { endDate: '2026-09-05' })
    expect(useToolsStore.getState().periodRecords[0].endDay).toEqual(startOfDay(parseISO('2026-09-05')))
    toolsService.deletePeriodRecord.mockRejectedValueOnce(new Error('offline'))
    await expect(useToolsStore.getState().deletePeriodRecord('p1')).rejects.toThrow('offline')
    expect(useToolsStore.getState().periodRecords).toHaveLength(1)
    toolsService.deletePeriodRecord.mockResolvedValue({ success: true })
    await useToolsStore.getState().deletePeriodRecord('p1')
    expect(useToolsStore.getState().periodRecords).toEqual([])
  })

  it('rejects an edit response after the account changes', async () => {
    let resolveUpdate
    toolsService.updatePeriodRecord.mockImplementation(() => new Promise(resolve => { resolveUpdate = resolve }))
    const pending = useToolsStore.getState().updatePeriodRecord('p1', { cycleDays: 30 })
    resetSession()
    resolveUpdate({ id: 'p1', startDate: '2026-09-01' })
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
    expect(useToolsStore.getState().periodRecords).toEqual([])
  })

  it('logs only a sanitized summary, never the axios error carrying credentials', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const axiosError = new Error('Request failed')
    axiosError.name = 'AxiosError'
    axiosError.response = { status: 500 }
    axiosError.config = { headers: { Authorization: 'Bearer secret-token' } }
    toolsService.getPeriodRecords.mockRejectedValue(axiosError)

    await useToolsStore.getState().loadPeriodRecords().catch(() => {})

    expect(errorSpy).toHaveBeenCalledWith('加载经期记录失败:', 500)
    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).not.toContain('secret-token')
  })

  it('falls back to the error name when there is no response status', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const networkError = new Error('Network Error')
    networkError.name = 'AxiosError'
    toolsService.getPeriodRecords.mockRejectedValue(networkError)

    await useToolsStore.getState().loadPeriodRecords().catch(() => {})

    expect(errorSpy).toHaveBeenCalledWith('加载经期记录失败:', 'AxiosError')
  })

  it('adds a record with the default 28-day cycle', async () => {
    toolsService.createPeriodRecord.mockResolvedValue({ id: 'p1', startDate: '2026-08-30', endDate: null, cycleDays: 28 })

    const record = await useToolsStore.getState().addPeriodRecord('2026-08-30', null)

    expect(toolsService.createPeriodRecord).toHaveBeenCalledWith('2026-08-30', null, 28)
    // 服务端原样记录入列，并在加载边界归一化出本地日历日字段
    expect(useToolsStore.getState().periodRecords[0]).toMatchObject(record)
    expect(useToolsStore.getState().periodRecords[0].startDay).toEqual(startOfDay(parseISO('2026-08-30')))
    expect(useToolsStore.getState().periodRecords[0].endDay).toBeNull()
  })

  it('normalizes loaded records to local calendar days', async () => {
    toolsService.getPeriodRecords.mockResolvedValue([
      { id: 'p1', startDate: '2026-08-29T00:00:00.000Z', endDate: '2026-08-31T00:00:00.000Z', cycleDays: 28 },
    ])

    await useToolsStore.getState().loadPeriodRecords()

    const [record] = useToolsStore.getState().periodRecords
    expect(record.startDay).toEqual(startOfDay(parseISO('2026-08-29')))
    expect(record.endDay).toEqual(startOfDay(parseISO('2026-08-31')))
  })

  it('keeps records when loading fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    toolsService.getPeriodRecords.mockRejectedValue(new Error('offline'))
    useToolsStore.setState({ periodRecords: [{ id: 'keep' }] })

    await expect(useToolsStore.getState().loadPeriodRecords()).rejects.toThrow('offline')

    expect(useToolsStore.getState().periodRecords).toEqual([{ id: 'keep' }])
  })
})
