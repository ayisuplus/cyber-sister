import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const letters = vi.hoisted(() => ({
  listLetters: vi.fn(),
  getLetter: vi.fn(),
  scheduleDueLetter: vi.fn(),
  markLetterRead: vi.fn(),
}))
// 「同意采纳 / 不用」的动作矩阵在提议通道里测（services/memory/proposalService.test.js）；这里只看转交与错误透传
const proposal = vi.hoisted(() => ({ decideSuggestion: vi.fn() }))

vi.mock('../services/letterService.js', () => letters)
vi.mock('../services/memory/proposalService.js', () => proposal)
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

beforeEach(() => vi.clearAllMocks())

describe('来信读取与生成', () => {
  it('GET / 只读既有来信；POST /generate 原样返回生成结果', async () => {
    letters.listLetters.mockResolvedValue([{ id: 'l1' }])
    expect((await request(app).get('/')).body).toEqual({ letters: [{ id: 'l1' }] })
    expect(letters.listLetters).toHaveBeenCalledWith('user-1')
    expect(letters.scheduleDueLetter).not.toHaveBeenCalled()

    letters.scheduleDueLetter.mockResolvedValue({ letter: null, created: false, reason: 'quiet' })
    expect((await request(app).post('/generate')).body).toEqual({ letter: null, created: false, reason: 'quiet' })
    expect(letters.scheduleDueLetter).toHaveBeenCalledWith('user-1')
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

describe('来信建议的处置：交给提议通道（路线图 C23）', () => {
  it('按登录身份转交信、序号与请求体，原样返回整封更新后的信', async () => {
    proposal.decideSuggestion.mockResolvedValue({ letter: { id: 'l1', suggestions: [{ kind: 'merge_memories', decided: 'accepted' }] } })

    const { status, body } = await request(app).post('/l1/suggestions/0/decide').send({ decision: 'accept', keep: 'a' })

    expect(status).toBe(200)
    expect(proposal.decideSuggestion).toHaveBeenCalledWith('user-1', 'l1', '0', { decision: 'accept', keep: 'a' })
    expect(body.letter.suggestions[0].decided).toBe('accepted')
  })

  it('错误原样透传状态码与 code；没有状态码的给一句兜底', async () => {
    proposal.decideSuggestion.mockRejectedValueOnce(Object.assign(new Error('这条建议依据的记忆已经变了，先看看现在的样子再说'), { statusCode: 409, code: 'PROPOSAL_STALE' }))
    const stale = await request(app).post('/l1/suggestions/0/decide').send({ decision: 'accept' })
    expect(stale.status).toBe(409)
    expect(stale.body).toEqual({ error: '这条建议依据的记忆已经变了，先看看现在的样子再说', code: 'PROPOSAL_STALE' })

    proposal.decideSuggestion.mockRejectedValueOnce(Object.assign(new Error('信件不存在'), { statusCode: 404 }))
    expect((await request(app).post('/nope/suggestions/0/decide').send({ decision: 'accept' })).body).toEqual({ error: '信件不存在' })

    proposal.decideSuggestion.mockRejectedValueOnce(new Error('boom'))
    const crashed = await request(app).post('/l1/suggestions/0/decide').send({ decision: 'accept' })
    expect(crashed.status).toBe(500)
    expect(crashed.body).toEqual({ error: '来信建议处理失败' })
  })
})
