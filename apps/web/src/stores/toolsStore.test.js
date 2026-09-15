import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSession } from '../services/sessionLifecycle'
import { parseISO, startOfDay } from 'date-fns'

vi.mock('../services/toolsService', () => ({
  toolsService: {
    getTodos: vi.fn(),
    createTodo: vi.fn(),
    updateTodo: vi.fn(),
    deleteTodo: vi.fn(),
    getCountdowns: vi.fn(),
    createCountdown: vi.fn(),
    deleteCountdown: vi.fn(),
    getPeriodRecords: vi.fn(),
    createPeriodRecord: vi.fn(),
    updatePeriodRecord: vi.fn(),
    deletePeriodRecord: vi.fn(),
    getReminders: vi.fn(),
    updateReminder: vi.fn(),
    getWeather: vi.fn(),
  },
}))

import { toolsService } from '../services/toolsService'
import { useToolsStore } from './toolsStore'

const resetStore = () => useToolsStore.setState({
  todos: [],
  countdowns: [],
  periodRecords: [],
  reminders: [],
  weather: null,
})

describe('toolsStore account ownership', () => {
  beforeEach(resetStore)

  it('clears private tool data at an account boundary', () => {
    useToolsStore.setState({
      todos: [{ id: 'old-todo' }], countdowns: [{ id: 'old-countdown' }],
      periodRecords: [{ id: 'old-period' }], reminders: [{ id: 'old-reminder' }],
      scheduledReminders: [{ id: 'old-scheduled' }], dueDeliveries: [{ id: 'old-delivery' }], weather: { city: 'old-city' },
    })
    resetSession()
    expect(useToolsStore.getState()).toMatchObject({
      todos: [], countdowns: [], periodRecords: [], reminders: [], scheduledReminders: [], dueDeliveries: [], weather: null,
    })
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

describe('toolsStore todos', () => {
  beforeEach(resetStore)

  it('loads todos into state', async () => {
    toolsService.getTodos.mockResolvedValue([{ id: 't1', content: '喝水', isDone: false }])

    await useToolsStore.getState().loadTodos()

    expect(useToolsStore.getState().todos).toEqual([{ id: 't1', content: '喝水', isDone: false }])
  })

  it('keeps existing todos when loading fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    toolsService.getTodos.mockRejectedValue(new Error('offline'))
    useToolsStore.setState({ todos: [{ id: 'keep' }] })

    await expect(useToolsStore.getState().loadTodos()).rejects.toThrow('offline')

    expect(useToolsStore.getState().todos).toEqual([{ id: 'keep' }])
  })

  it('prepends a created todo and returns it', async () => {
    toolsService.createTodo.mockResolvedValue({ id: 't2', content: '新待办', isDone: false })
    useToolsStore.setState({ todos: [{ id: 't1' }] })

    const created = await useToolsStore.getState().addTodo('新待办', '2026-09-01')

    expect(toolsService.createTodo).toHaveBeenCalledWith('新待办', '2026-09-01', undefined)
    expect(created.id).toBe('t2')
    expect(useToolsStore.getState().todos.map(t => t.id)).toEqual(['t2', 't1'])
  })

  it('rethrows creation failures so the page can keep the draft', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    toolsService.createTodo.mockRejectedValue(new Error('server error'))

    await expect(useToolsStore.getState().addTodo('新待办')).rejects.toThrow('server error')
    expect(useToolsStore.getState().todos).toEqual([])
  })

  it('toggles a todo done state through the server', async () => {
    toolsService.updateTodo.mockResolvedValue({ id: 't1', isDone: true })
    useToolsStore.setState({ todos: [{ id: 't1', isDone: false }] })

    await useToolsStore.getState().toggleTodo('t1')

    expect(toolsService.updateTodo).toHaveBeenCalledWith('t1', { isDone: true })
    expect(useToolsStore.getState().todos[0].isDone).toBe(true)
  })

  it('ignores toggle requests for unknown todos', async () => {
    useToolsStore.setState({ todos: [{ id: 't1', isDone: false }] })

    await useToolsStore.getState().toggleTodo('missing')

    expect(toolsService.updateTodo).not.toHaveBeenCalled()
  })

  it('keeps the todo when the toggle request fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    toolsService.updateTodo.mockRejectedValue(new Error('offline'))
    useToolsStore.setState({ todos: [{ id: 't1', isDone: false }] })

    await expect(useToolsStore.getState().toggleTodo('t1')).rejects.toThrow('offline')

    expect(useToolsStore.getState().todos[0].isDone).toBe(false)
  })

  it('deletes a todo from state', async () => {
    toolsService.deleteTodo.mockResolvedValue({})
    useToolsStore.setState({ todos: [{ id: 't1' }, { id: 't2' }] })

    await useToolsStore.getState().deleteTodo('t1')

    expect(useToolsStore.getState().todos.map(t => t.id)).toEqual(['t2'])
  })
})

describe('toolsStore countdowns', () => {
  beforeEach(resetStore)

  it('loads, adds and deletes countdowns', async () => {
    toolsService.getCountdowns.mockResolvedValue([{ id: 'c1', title: '生日' }])
    await useToolsStore.getState().loadCountdowns()
    expect(useToolsStore.getState().countdowns).toEqual([{ id: 'c1', title: '生日' }])

    toolsService.createCountdown.mockResolvedValue({ id: 'c2', title: '纪念日' })
    const created = await useToolsStore.getState().addCountdown('纪念日', '2026-12-31')
    expect(created.id).toBe('c2')
    expect(useToolsStore.getState().countdowns.map(c => c.id)).toEqual(['c2', 'c1'])

    toolsService.deleteCountdown.mockResolvedValue({})
    await useToolsStore.getState().deleteCountdown('c1')
    expect(useToolsStore.getState().countdowns.map(c => c.id)).toEqual(['c2'])
  })

  it('keeps countdowns when loading fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    toolsService.getCountdowns.mockRejectedValue(new Error('offline'))
    useToolsStore.setState({ countdowns: [{ id: 'keep' }] })

    await expect(useToolsStore.getState().loadCountdowns()).rejects.toThrow('offline')

    expect(useToolsStore.getState().countdowns).toEqual([{ id: 'keep' }])
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
    toolsService.getTodos.mockRejectedValue(axiosError)

    await useToolsStore.getState().loadTodos().catch(() => {})

    expect(errorSpy).toHaveBeenCalledWith('加载待办列表失败:', 500)
    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).not.toContain('secret-token')
  })

  it('falls back to the error name when there is no response status', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const networkError = new Error('Network Error')
    networkError.name = 'AxiosError'
    toolsService.getTodos.mockRejectedValue(networkError)

    await useToolsStore.getState().loadTodos().catch(() => {})

    expect(errorSpy).toHaveBeenCalledWith('加载待办列表失败:', 'AxiosError')
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

describe('toolsStore reminders and weather', () => {
  beforeEach(resetStore)

  it('toggles a reminder through the server', async () => {
    toolsService.getReminders.mockResolvedValue([{ id: 'r1', isActive: true }])
    await useToolsStore.getState().loadReminders()

    toolsService.updateReminder.mockResolvedValue({ id: 'r1', isActive: false })
    await useToolsStore.getState().toggleReminder('r1')

    expect(toolsService.updateReminder).toHaveBeenCalledWith('r1', { isActive: false })
    expect(useToolsStore.getState().reminders[0].isActive).toBe(false)
  })

  it('ignores toggle requests for unknown reminders', async () => {
    useToolsStore.setState({ reminders: [{ id: 'r1', isActive: true }] })

    await useToolsStore.getState().toggleReminder('missing')

    expect(toolsService.updateReminder).not.toHaveBeenCalled()
  })

  it('loads weather and keeps it null on failure', async () => {
    toolsService.getWeather.mockResolvedValue({ text: '晴', temperature: 30 })
    await useToolsStore.getState().loadWeather()
    expect(useToolsStore.getState().weather).toEqual({ text: '晴', temperature: 30 })

    vi.spyOn(console, 'error').mockImplementation(() => {})
    toolsService.getWeather.mockRejectedValue(new Error('offline'))
    useToolsStore.setState({ weather: null })
    await useToolsStore.getState().loadWeather()
    expect(useToolsStore.getState().weather).toBeNull()
  })
})
