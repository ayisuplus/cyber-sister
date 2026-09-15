import { afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const db = vi.hoisted(() => ({ create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() }))
vi.mock('../../src/prisma/client.js', () => ({ default: { conversation: db } }))
import app from '../../src/app.js'
import { generateToken } from '../../src/middleware/auth.js'
import { buildNativeTools, executeToolCall } from '../../src/services/agentService.js'
import { isLocalWorkRuntime } from '../../src/config/distribution.js'

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

describe('web distribution', () => {
  it('defaults closed and requires an explicitly local loopback runtime', () => {
    expect(isLocalWorkRuntime({})).toBe(false)
    expect(isLocalWorkRuntime({ APP_DISTRIBUTION: 'local', BIND_ADDRESS: '172.19.23.112' })).toBe(false)
    expect(isLocalWorkRuntime({ APP_DISTRIBUTION: 'local', BIND_ADDRESS: '127.0.0.1' })).toBe(true)
  })

  it('rejects work routes and conversation creation despite forged client headers', async () => {
    vi.stubEnv('APP_DISTRIBUTION', 'web')
    const token = generateToken({ userId: 'web-user' })
    for (const url of ['/api/work/tasks', '/api/work/media', '/api/tools/period', '/api/reminders/scheduled']) {
      const response = await request(app).get(url).set('Authorization', `Bearer ${token}`).set('X-App-Distribution', 'local')
      expect(response.status).toBe(403)
      expect(response.body.code).toBe('LOCAL_CLIENT_REQUIRED')
    }
    const response = await request(app).post('/api/chat/conversations').set('Authorization', `Bearer ${token}`).send({ mode: 'work' })
    expect(response.status).toBe(403)
    expect(db.create).not.toHaveBeenCalled()
  })

  it('offers no tools even when individual feature flags are enabled', async () => {
    vi.stubEnv('APP_DISTRIBUTION', 'web')
    vi.stubEnv('WORK_NATIVE_TOOLS', 'true')
    expect(buildNativeTools('work')).toEqual([])
    expect(await executeToolCall('web-user', { name: 'create_artifact', args: {} }, 'work')).toMatchObject({ ok: false })
  })
})
