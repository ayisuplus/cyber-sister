import { afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const db = vi.hoisted(() => ({ create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() }))
vi.mock('../../src/prisma/client.js', () => ({ default: { conversation: db } }))
const letters = vi.hoisted(() => ({ listLetters: vi.fn(), getLetter: vi.fn(), scheduleDueLetter: vi.fn(), markLetterRead: vi.fn(), saveSuggestions: vi.fn(), findLatestLetter: vi.fn() }))
const memoryService = vi.hoisted(() => ({ createMemory: vi.fn(), updateMemory: vi.fn(), deleteMemory: vi.fn(), validateMemoryInput: vi.fn(), MEMORY_TYPES: ['semantic', 'episodic', 'procedural'] }))
const reminderService = vi.hoisted(() => ({ createScheduledReminder: vi.fn(), ackDelivery: vi.fn(), listDueReminders: vi.fn(), listTodaysDeliveries: vi.fn(), buildTaskFields: vi.fn() }))
vi.mock('../../src/services/letterService.js', () => letters)
vi.mock('../../src/services/memoryService.js', () => memoryService)
vi.mock('../../src/services/reminderService.js', () => reminderService)
// 来信建议的处置在提议通道里（路线图 C23）
const proposal = vi.hoisted(() => ({ decideSuggestion: vi.fn() }))
vi.mock('../../src/services/memory/proposalService.js', () => proposal)
import app from '../../src/app.js'
import { generateToken } from '../../src/middleware/auth.js'
import { buildNativeTools, executeToolCall } from '../../src/services/agentService.js'
import { isLocalWorkRuntime } from '../../src/config/distribution.js'

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

describe('web distribution', () => {
  it.each(['web', 'local'])('allows authenticated letter decisions in %s while keeping the caller identity', async distribution => {
    vi.stubEnv('APP_DISTRIBUTION', distribution)
    const token = generateToken({ userId: 'memory-owner' })
    letters.listLetters.mockResolvedValue([{ id: 'l1' }])
    proposal.decideSuggestion.mockResolvedValue({ letter: { id: 'l1', suggestions: [{ kind: 'edit_memory', decided: 'accepted' }] } })
    const listed = await request(app).get('/api/letters').set('Authorization', `Bearer ${token}`)
    expect(listed.status).toBe(200)
    expect(letters.listLetters).toHaveBeenCalledWith('memory-owner')
    // 伪造的 userId 不生效：处置永远按登录身份执行
    const decided = await request(app).post('/api/letters/l1/suggestions/0/decide').set('Authorization', `Bearer ${token}`).send({ decision: 'accept', userId: 'forged' })
    expect(decided.status).toBe(200)
    expect(proposal.decideSuggestion).toHaveBeenCalledWith('memory-owner', 'l1', '0', { decision: 'accept', userId: 'forged' })
  })

  it('still rejects unauthenticated letter actions in web distribution', async () => {
    vi.stubEnv('APP_DISTRIBUTION', 'web')
    expect((await request(app).get('/api/letters')).status).toBe(401)
    expect((await request(app).post('/api/letters/l1/suggestions/0/decide').send({})).status).toBe(401)
    expect(letters.listLetters).not.toHaveBeenCalled()
    expect(proposal.decideSuggestion).not.toHaveBeenCalled()
  })

  it('defaults closed and requires an explicitly local loopback runtime', () => {
    expect(isLocalWorkRuntime({})).toBe(false)
    expect(isLocalWorkRuntime({ APP_DISTRIBUTION: 'local', BIND_ADDRESS: '172.19.23.112' })).toBe(false)
    expect(isLocalWorkRuntime({ APP_DISTRIBUTION: 'local', BIND_ADDRESS: '127.0.0.1' })).toBe(true)
  })

  it('keeps local-machine routes closed despite forged client headers, while life features pass the gate', async () => {
    vi.stubEnv('APP_DISTRIBUTION', 'web')
    const token = generateToken({ userId: 'web-user' })
    for (const url of ['/api/work/tasks', '/api/work/status', '/api/work/artifacts']) {
      const response = await request(app).get(url).set('Authorization', `Bearer ${token}`).set('X-App-Distribution', 'local')
      expect(response.status).toBe(403)
      expect(response.body.code).toBe('LOCAL_CLIENT_REQUIRED')
    }
    // 安排、手记、经期、装扮不再按分发拦截（只剩鉴权与领域校验）。
    for (const url of ['/api/tools/period', '/api/reminders/scheduled', '/api/diary?month=2026-09', '/api/letters', '/api/care', '/api/collection?shelf=wardrobe']) {
      const response = await request(app).get(url).set('Authorization', `Bearer ${token}`)
      expect(response.body.code).not.toBe('LOCAL_CLIENT_REQUIRED')
    }
    // 只有一段对话：新建会话的接口已经不存在
    const response = await request(app).post('/api/chat/conversations').set('Authorization', `Bearer ${token}`).send({ mode: 'work' })
    expect(response.status).toBe(404)
    expect(db.create).not.toHaveBeenCalled()
  })

  it('offers life tools but never local-machine tools, even when their feature flags are enabled', async () => {
    vi.stubEnv('APP_DISTRIBUTION', 'web')
    vi.stubEnv('WORK_NATIVE_TOOLS', 'true')
    vi.stubEnv('WORK_BROWSER_ENABLED', 'true')
    const names = buildNativeTools().map(tool => tool.function.name)
    expect(names).toEqual(expect.arrayContaining(['add_task', 'record_period', 'add_diary']))
    for (const name of ['create_artifact', 'execute_python', 'browser_open', 'generate_image', 'update_plan']) expect(names).not.toContain(name)
    expect(await executeToolCall('web-user', { name: 'create_artifact', args: {} })).toMatchObject({ ok: false, summary: '没有连接你的电脑' })
  })
})
