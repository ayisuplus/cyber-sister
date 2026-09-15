import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest'
import request from 'supertest'

vi.mock('../../src/prisma/client.js', () => ({ default: { $disconnect: vi.fn() } }))
vi.mock('../../src/services/memoryIndexService.js', () => ({
  startMemoryIndexWorker: vi.fn(), stopMemoryIndexWorker: vi.fn(),
  latestIndexJob: vi.fn(async (userId) => ({ id: 'test-job', userId, status: 'running' })),
  createIndexJob: vi.fn(async () => ({ id: 'test-job', status: 'queued' })),
}))
vi.mock('../../src/services/memoryService.js', () => ({
  listMemories: vi.fn(async () => ({ memories: [], total: 0 })),
}))
vi.mock('../../src/services/workTaskService.js', () => ({
  isWorkTasksEnabled: () => true, startWorkTaskWorker: vi.fn(), stopWorkTaskWorker: vi.fn(),
  listWorkTasks: vi.fn(async () => []), getWorkTask: vi.fn(), createWorkTask: vi.fn(), retryWorkTask: vi.fn(), cancelWorkTask: vi.fn(),
}))
vi.mock('../../src/utils/logger.js', () => ({ default: {
  requestLogger: () => (_req, _res, next) => next(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
} }))

import app from '../../src/app.js'
import { generateToken } from '../../src/middleware/auth.js'
let server
beforeAll(async () => {
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
})
afterAll(() => new Promise((resolve) => server.close(resolve)))

describe('index progress request budgets', () => {
  it('background polling has an authenticated budget separate from normal messages', async () => {
    const authorization = `Bearer ${generateToken({ userId: 'work-polling-user' })}`
    for (let index = 0; index < 120; index++) {
      const response = await request(server).get('/api/work/tasks').set('Authorization', authorization)
      expect(response.status).toBe(200)
    }
    expect((await request(server).get('/api/work/tasks').set('Authorization', authorization)).status).toBe(429)
    expect((await request(server).get('/api/memories').set('Authorization', authorization)).status).toBe(200)
    expect((await request(server).get('/api/work/tasks')).status).toBe(401)
  })
  it('keeps frequent authenticated polling separate from normal actions and other users', async () => {
    const authorization = `Bearer ${generateToken({ userId: 'polling-user' })}`
    for (let index = 0; index < 120; index++) {
      const response = await request(server).get('/api/memories/index-jobs/latest').set('Authorization', authorization)
      expect(response.status).toBe(200)
    }
    expect((await request(server).get('/api/memories/index-jobs/latest').set('Authorization', authorization)).status).toBe(429)
    expect((await request(server).get('/api/memories').set('Authorization', authorization)).status).toBe(200)
    expect((await request(server).post('/api/memories/index-jobs').set('Authorization', authorization).send({ mode: 'repair' })).status).toBe(202)
    expect((await request(server).get('/api/memories/index-jobs/latest').set('Authorization', `Bearer ${generateToken({ userId: 'other-user' })}`)).status).toBe(200)
    expect((await request(server).get('/api/memories/index-jobs/latest')).status).toBe(401)
  })
})
