import { describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

import api from './api'
import { studyService } from './studyService'

describe('studyService', () => {
  it('uses active-session endpoints for the server-authoritative timer', async () => {
    api.get.mockResolvedValue({ data: null })
    api.post.mockResolvedValue({ data: { id: 'run-1' } })
    api.delete.mockResolvedValue({ data: { cancelled: true } })
    expect(await studyService.getActive()).toBe(null)
    expect(api.get).toHaveBeenCalledWith('/study/active')
    await studyService.start({ plannedMinutes: 25 })
    expect(api.post).toHaveBeenCalledWith('/study/active', { plannedMinutes: 25 })
    await studyService.finish('run-1')
    expect(api.post).toHaveBeenCalledWith('/study/active/run-1/finish')
    await studyService.cancel('run-1')
    expect(api.delete).toHaveBeenCalledWith('/study/active/run-1')
  })
  it('fetches the summary', async () => {
    api.get.mockResolvedValue({ data: { todayMinutes: 30, weekMinutes: 50, streak: 2, totalSessions: 3 } })

    const result = await studyService.getSummary()

    expect(api.get).toHaveBeenCalledWith('/study/summary')
    expect(result.streak).toBe(2)
  })

  it('lists sessions with a days param defaulting to 30', async () => {
    api.get.mockResolvedValue({ data: [] })

    await studyService.listSessions()
    expect(api.get).toHaveBeenCalledWith('/study/sessions', { params: { days: 30 } })

    await studyService.listSessions(7)
    expect(api.get).toHaveBeenCalledWith('/study/sessions', { params: { days: 7 } })
  })

  it('records a session', async () => {
    api.post.mockResolvedValue({ data: { id: 's1', actualMinutes: 25 } })

    const result = await studyService.recordSession({ plannedMinutes: 25, actualMinutes: 25, subject: '数学' })

    expect(api.post).toHaveBeenCalledWith('/study/sessions', { plannedMinutes: 25, actualMinutes: 25, subject: '数学' })
    expect(result.id).toBe('s1')
  })

  it('requests a session comment and propagates failures', async () => {
    api.post.mockResolvedValue({ data: { aiComment: '辛苦了', source: 'qwen', reused: false } })
    const comment = await studyService.requestSessionComment('s1')
    expect(api.post).toHaveBeenCalledWith('/study/sessions/s1/comment')
    expect(comment.aiComment).toBe('辛苦了')

    api.post.mockRejectedValue(new Error('offline'))
    await expect(studyService.requestSessionComment('s1')).rejects.toThrow('offline')
  })
})
