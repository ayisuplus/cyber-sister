import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const letters = vi.hoisted(() => ({
  listLetters: vi.fn(),
  getLetter: vi.fn(),
  generateDueLetter: vi.fn(),
  markLetterRead: vi.fn(),
  saveSuggestions: vi.fn(),
}))
const memoryService = vi.hoisted(() => ({ updateMemory: vi.fn(), deleteMemory: vi.fn() }))
const reminderService = vi.hoisted(() => ({ createScheduledReminder: vi.fn() }))

vi.mock('../services/letterService.js', () => letters)
vi.mock('../services/memoryService.js', () => memoryService)
vi.mock('../services/reminderService.js', () => reminderService)
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import letterRoutes from './letters.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', letterRoutes)

const EDIT = {
  kind: 'edit_memory', title: '改一改', memoryId: 'm1', memoryRevision: 3,
  quote: '桂花味', suggestText: '喜欢桂花味的拿铁', instruction: null, planDate: null,
  chatText: null, decided: null,
}
const REMOVE = { ...EDIT, kind: 'delete_memory', title: '删掉', suggestText: '' }
const PLAN = {
  kind: 'plan', title: '安排复诊', memoryId: null, memoryRevision: null, quote: null,
  suggestText: '去交稿', instruction: '到点提醒她', planDate: null, chatText: null, decided: null,
}

const loadLetter = (suggestions) => {
  const letter = { id: 'l1', content: '见信好。', suggestions }
  letters.getLetter.mockResolvedValue(letter)
  letters.saveSuggestions.mockImplementation((id, next) => Promise.resolve({ ...letter, id, suggestions: next }))
  return letter
}

beforeEach(() => {
  vi.clearAllMocks()
  letters.saveSuggestions.mockImplementation((id, suggestions) => Promise.resolve({ id, suggestions }))
})

describe('来信读取与生成', () => {
  it('GET / 只读既有来信；POST /generate 原样返回生成结果', async () => {
    letters.listLetters.mockResolvedValue([{ id: 'l1' }])
    expect((await request(app).get('/')).body).toEqual({ letters: [{ id: 'l1' }] })
    expect(letters.listLetters).toHaveBeenCalledWith('user-1')
    expect(letters.generateDueLetter).not.toHaveBeenCalled()

    letters.generateDueLetter.mockResolvedValue({ letter: null, created: false, reason: 'quiet' })
    expect((await request(app).post('/generate')).body).toEqual({ letter: null, created: false, reason: 'quiet' })
    expect(letters.generateDueLetter).toHaveBeenCalledWith('user-1')
  })

  it('非本人的信一律 404', async () => {
    letters.getLetter.mockRejectedValue(Object.assign(new Error('信件不存在'), { statusCode: 404 }))
    const missing = await request(app).post('/nope/suggestions/0/decide').send({ decision: 'accept' })
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '信件不存在' })
    expect(memoryService.updateMemory).not.toHaveBeenCalled()
  })

  it('POST /:id/read 幂等', async () => {
    letters.markLetterRead.mockResolvedValue({ success: true })
    const first = await request(app).post('/l1/read')
    const second = await request(app).post('/l1/read')
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body).toEqual({ success: true })
  })
})

describe('来信建议的动作矩阵', () => {
  it('accept × edit_memory：改成 suggestText，版本用信里那条的当前版本', async () => {
    loadLetter([EDIT])

    const { status, body } = await request(app).post('/l1/suggestions/0/decide').send({ decision: 'accept' })

    expect(status).toBe(200)
    expect(memoryService.updateMemory).toHaveBeenCalledWith('user-1', 'm1', {
      content: '喜欢桂花味的拿铁', expectedRevision: 3,
    })
    expect(body.letter.suggestions[0].decided).toBe('accepted')
  })

  it('accept × edit_memory：用户改过的正文优先，版本冲突 409 原样透传且不写回 decided', async () => {
    loadLetter([EDIT])
    memoryService.updateMemory.mockRejectedValue(
      Object.assign(new Error('内容已经变化，请刷新后核对再保存'), { statusCode: 409, code: 'MEMORY_CONFLICT' }),
    )

    const { status, body } = await request(app).post('/l1/suggestions/0/decide')
      .send({ decision: 'accept', content: '  我改过的说法  ', expectedRevision: 2 })

    expect(status).toBe(409)
    expect(body).toEqual({ error: '内容已经变化，请刷新后核对再保存', code: 'MEMORY_CONFLICT' })
    expect(memoryService.updateMemory).toHaveBeenCalledWith('user-1', 'm1', { content: '我改过的说法', expectedRevision: 2 })
    expect(letters.saveSuggestions).not.toHaveBeenCalled()
  })

  it('accept × edit_memory：记忆已不在 → 404 这条记忆已经不在了', async () => {
    loadLetter([EDIT])
    memoryService.updateMemory.mockRejectedValue(Object.assign(new Error('记忆不存在'), { statusCode: 404 }))

    const { status, body } = await request(app).post('/l1/suggestions/0/decide').send({ decision: 'accept' })

    expect(status).toBe(404)
    expect(body).toEqual({ error: '这条记忆已经不在了' })
  })

  it('accept × delete_memory：删掉；已删过 → { success: true, already: true } 且照样置 decided', async () => {
    loadLetter([REMOVE])
    memoryService.deleteMemory.mockResolvedValue(undefined)
    const ok = await request(app).post('/l1/suggestions/0/decide').send({ decision: 'accept' })
    expect(ok.status).toBe(200)
    expect(memoryService.deleteMemory).toHaveBeenCalledWith('user-1', 'm1')
    expect(ok.body.letter.suggestions[0].decided).toBe('accepted')

    loadLetter([REMOVE])
    memoryService.deleteMemory.mockRejectedValue(Object.assign(new Error('记忆不存在'), { statusCode: 404 }))
    const already = await request(app).post('/l1/suggestions/0/decide').send({ decision: 'accept' })
    expect(already.status).toBe(200)
    expect(already.body).toMatchObject({ success: true, already: true })
    expect(already.body.letter.suggestions[0].decided).toBe('accepted')
  })

  it('accept × plan：建一条 once 的安排，缺省明天（北京时间）09:00，instruction 透传', async () => {
    loadLetter([PLAN])

    const { status, body } = await request(app).post('/l1/suggestions/0/decide').send({ decision: 'accept' })

    expect(status).toBe(200)
    expect(reminderService.createScheduledReminder).toHaveBeenCalledWith('user-1', {
      content: '去交稿', freq: 'once', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), time: '09:00', instruction: '到点提醒她',
    })
    expect(memoryService.updateMemory).not.toHaveBeenCalled()
    expect(body.letter.suggestions[0].decided).toBe('accepted')
  })

  it('accept × plan：信里写了日子就用它', async () => {
    loadLetter([{ ...PLAN, planDate: '2026-10-01' }])

    await request(app).post('/l1/suggestions/0/decide').send({ decision: 'accept' })

    expect(reminderService.createScheduledReminder).toHaveBeenCalledWith('user-1', expect.objectContaining({
      freq: 'once', date: '2026-10-01', time: '09:00',
    }))
  })

  it('dismiss：不触达记忆与安排，只置 decided: dismissed', async () => {
    loadLetter([EDIT])

    const { status, body } = await request(app).post('/l1/suggestions/0/decide').send({ decision: 'dismiss' })

    expect(status).toBe(200)
    expect(memoryService.updateMemory).not.toHaveBeenCalled()
    expect(memoryService.deleteMemory).not.toHaveBeenCalled()
    expect(reminderService.createScheduledReminder).not.toHaveBeenCalled()
    expect(letters.saveSuggestions).toHaveBeenCalledWith('l1', [{ ...EDIT, decided: 'dismissed' }])
    expect(body.letter.suggestions[0].decided).toBe('dismissed')
  })

  it('重复 decide → 409 这条建议已经处理过了；index 越界或非整数 → 404；decision 非法 → 400', async () => {
    loadLetter([{ ...EDIT, decided: 'accepted' }])
    const repeat = await request(app).post('/l1/suggestions/0/decide').send({ decision: 'dismiss' })
    expect(repeat.status).toBe(409)
    expect(repeat.body).toEqual({ error: '这条建议已经处理过了' })

    loadLetter([EDIT])
    for (const index of ['1', 'nope', '-1']) {
      const gone = await request(app).post(`/l1/suggestions/${index}/decide`).send({ decision: 'accept' })
      expect(gone.status).toBe(404)
      expect(gone.body).toEqual({ error: '这条建议已经不在了' })
    }

    const bad = await request(app).post('/l1/suggestions/0/decide').send({ decision: 'maybe' })
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: 'decision只能是accept或dismiss' })
    expect(letters.saveSuggestions).not.toHaveBeenCalled()
  })
})
