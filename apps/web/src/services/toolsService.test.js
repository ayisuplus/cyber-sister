import { describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

import api from './api'
import { toolsService } from './toolsService'

describe('toolsService todos', () => {
  it('lists todos', async () => {
    api.get.mockResolvedValue({ data: [{ id: 't1' }] })

    const result = await toolsService.getTodos()

    expect(api.get).toHaveBeenCalledWith('/tools/todos')
    expect(result).toEqual([{ id: 't1' }])
  })

  it('creates a todo with content and due date', async () => {
    api.post.mockResolvedValue({ data: { id: 't1', content: '喝水' } })

    const result = await toolsService.createTodo('喝水', '2026-09-01')

    expect(api.post).toHaveBeenCalledWith('/tools/todos', { content: '喝水', dueDate: '2026-09-01' })
    expect(result).toEqual({ id: 't1', content: '喝水' })
  })

  it('updates and deletes a todo by id', async () => {
    api.put.mockResolvedValue({ data: { id: 't1', isDone: true } })
    api.delete.mockResolvedValue({ data: {} })

    const updated = await toolsService.updateTodo('t1', { isDone: true })
    await toolsService.deleteTodo('t1')

    expect(api.put).toHaveBeenCalledWith('/tools/todos/t1', { isDone: true })
    expect(updated).toEqual({ id: 't1', isDone: true })
    expect(api.delete).toHaveBeenCalledWith('/tools/todos/t1')
  })
})

describe('toolsService countdowns', () => {
  it('lists countdowns', async () => {
    api.get.mockResolvedValue({ data: [{ id: 'c1' }] })

    const result = await toolsService.getCountdowns()

    expect(api.get).toHaveBeenCalledWith('/tools/countdowns')
    expect(result).toEqual([{ id: 'c1' }])
  })

  it('creates and deletes a countdown', async () => {
    api.post.mockResolvedValue({ data: { id: 'c1', title: '纪念日' } })
    api.delete.mockResolvedValue({ data: {} })

    const created = await toolsService.createCountdown('纪念日', '2026-12-31')
    await toolsService.deleteCountdown('c1')

    expect(api.post).toHaveBeenCalledWith('/tools/countdowns', { title: '纪念日', targetDate: '2026-12-31' })
    expect(created).toEqual({ id: 'c1', title: '纪念日' })
    expect(api.delete).toHaveBeenCalledWith('/tools/countdowns/c1')
  })
})

describe('toolsService period records', () => {
  it('lists period records', async () => {
    api.get.mockResolvedValue({ data: [{ id: 'p1' }] })

    const result = await toolsService.getPeriodRecords()

    expect(api.get).toHaveBeenCalledWith('/tools/period')
    expect(result).toEqual([{ id: 'p1' }])
  })

  it('creates a period record with cycle length', async () => {
    api.post.mockResolvedValue({ data: { id: 'p1' } })

    await toolsService.createPeriodRecord('2026-08-01', '2026-08-05', 30)

    expect(api.post).toHaveBeenCalledWith('/tools/period', {
      startDate: '2026-08-01',
      endDate: '2026-08-05',
      cycleDays: 30,
    })
  })
})

describe('toolsService reminders and weather', () => {
  it('lists reminders and toggles one by id', async () => {
    api.get.mockResolvedValue({ data: [{ id: 'r1', isActive: true }] })
    api.put.mockResolvedValue({ data: { id: 'r1', isActive: false } })

    const reminders = await toolsService.getReminders()
    const updated = await toolsService.updateReminder('r1', { isActive: false })

    expect(api.get).toHaveBeenCalledWith('/tools/reminders')
    expect(reminders).toEqual([{ id: 'r1', isActive: true }])
    expect(api.put).toHaveBeenCalledWith('/tools/reminders/r1', { isActive: false })
    expect(updated).toEqual({ id: 'r1', isActive: false })
  })

  it('fetches the weather widget payload', async () => {
    api.get.mockResolvedValue({ data: { text: '晴' } })

    const result = await toolsService.getWeather()

    expect(api.get).toHaveBeenCalledWith('/tools/weather')
    expect(result).toEqual({ text: '晴' })
  })

  it('propagates request failures to the caller', async () => {
    api.get.mockRejectedValue(new Error('server error'))

    await expect(toolsService.getTodos()).rejects.toThrow('server error')
  })
})
