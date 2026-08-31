import { beforeEach, describe, expect, it, vi } from 'vitest'

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

    await useToolsStore.getState().loadTodos()

    expect(useToolsStore.getState().todos).toEqual([{ id: 'keep' }])
  })

  it('prepends a created todo and returns it', async () => {
    toolsService.createTodo.mockResolvedValue({ id: 't2', content: '新待办', isDone: false })
    useToolsStore.setState({ todos: [{ id: 't1' }] })

    const created = await useToolsStore.getState().addTodo('新待办', '2026-09-01')

    expect(toolsService.createTodo).toHaveBeenCalledWith('新待办', '2026-09-01')
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

    await useToolsStore.getState().toggleTodo('t1')

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

    await useToolsStore.getState().loadCountdowns()

    expect(useToolsStore.getState().countdowns).toEqual([{ id: 'keep' }])
  })
})

describe('toolsStore period records', () => {
  beforeEach(resetStore)

  it('returns no prediction without records', () => {
    expect(useToolsStore.getState().getNextPeriodDate()).toBeNull()
    expect(useToolsStore.getState().getDaysUntilPeriod()).toBeNull()
  })

  it('predicts the next period from the latest record and its cycle', () => {
    useToolsStore.setState({
      periodRecords: [
        { id: 'p-old', startDate: '2026-07-01', cycleDays: 28 },
        { id: 'p-new', startDate: '2026-08-01', cycleDays: 30 },
      ],
    })

    const next = useToolsStore.getState().getNextPeriodDate()

    // 与服务端一致按 ISO 日期解析（UTC 午夜），再顺延一个周期
    const expected = new Date('2026-08-01')
    expected.setDate(expected.getDate() + 30)
    expect(next).toEqual(expected)
  })

  it('never reports a negative countdown for overdue predictions', () => {
    useToolsStore.setState({
      periodRecords: [{ id: 'p1', startDate: '2000-01-01', cycleDays: 28 }],
    })

    expect(useToolsStore.getState().getDaysUntilPeriod()).toBe(0)
  })

  it('does not mutate the stored record order when computing the prediction', () => {
    const records = [
      { id: 'p-old', startDate: '2026-07-01', cycleDays: 28 },
      { id: 'p-new', startDate: '2026-08-01', cycleDays: 30 },
    ]
    useToolsStore.setState({ periodRecords: records })

    useToolsStore.getState().getNextPeriodDate()

    expect(useToolsStore.getState().periodRecords.map(r => r.id)).toEqual(['p-old', 'p-new'])
  })

  it('logs only a sanitized summary, never the axios error carrying credentials', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const axiosError = new Error('Request failed')
    axiosError.name = 'AxiosError'
    axiosError.response = { status: 500 }
    axiosError.config = { headers: { Authorization: 'Bearer secret-token' } }
    toolsService.getTodos.mockRejectedValue(axiosError)

    await useToolsStore.getState().loadTodos()

    expect(errorSpy).toHaveBeenCalledWith('加载待办列表失败:', 500)
    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).not.toContain('secret-token')
  })

  it('falls back to the error name when there is no response status', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const networkError = new Error('Network Error')
    networkError.name = 'AxiosError'
    toolsService.getTodos.mockRejectedValue(networkError)

    await useToolsStore.getState().loadTodos()

    expect(errorSpy).toHaveBeenCalledWith('加载待办列表失败:', 'AxiosError')
  })

  it('adds a record with the default 28-day cycle', async () => {
    toolsService.createPeriodRecord.mockResolvedValue({ id: 'p1', startDate: '2026-08-30', cycleDays: 28 })

    const record = await useToolsStore.getState().addPeriodRecord('2026-08-30', null)

    expect(toolsService.createPeriodRecord).toHaveBeenCalledWith('2026-08-30', null, 28)
    expect(useToolsStore.getState().periodRecords[0]).toEqual(record)
  })

  it('keeps records when loading fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    toolsService.getPeriodRecords.mockRejectedValue(new Error('offline'))
    useToolsStore.setState({ periodRecords: [{ id: 'keep' }] })

    await useToolsStore.getState().loadPeriodRecords()

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
