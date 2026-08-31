import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  findFirst: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    widget: { findFirst: db.findFirst, delete: db.delete },
  },
}))

import { HttpError, deleteOwned, findOwned } from './dbHelpers.js'

describe('findOwned', () => {
  beforeEach(() => vi.clearAllMocks())

  it('找到属于用户的资源并返回', async () => {
    const record = { id: 'w1', userId: 'u1' }
    db.findFirst.mockResolvedValue(record)

    const result = await findOwned('widget', 'w1', 'u1', '部件')
    expect(result).toBe(record)
    expect(db.findFirst).toHaveBeenCalledWith({ where: { id: 'w1', userId: 'u1' } })
  })

  it('资源不存在或不属于该用户时抛出 404', async () => {
    db.findFirst.mockResolvedValue(null)

    const error = await findOwned('widget', 'w1', 'u2', '部件').catch((e) => e)
    expect(error.message).toBe('部件不存在')
    expect(error.statusCode).toBe(404)
  })
})

describe('deleteOwned', () => {
  beforeEach(() => vi.clearAllMocks())

  it('确认归属后删除资源', async () => {
    db.findFirst.mockResolvedValue({ id: 'w1', userId: 'u1' })
    db.delete.mockResolvedValue({ id: 'w1' })

    const result = await deleteOwned('widget', 'w1', 'u1', '部件')
    expect(db.delete).toHaveBeenCalledWith({ where: { id: 'w1' } })
    expect(result).toEqual({ id: 'w1' })
  })

  it('无权访问时不执行删除', async () => {
    db.findFirst.mockResolvedValue(null)

    await expect(deleteOwned('widget', 'w1', 'u2', '部件')).rejects.toMatchObject({
      statusCode: 404,
    })
    expect(db.delete).not.toHaveBeenCalled()
  })
})

describe('HttpError', () => {
  it('默认状态码为 400 且保留 message', () => {
    const error = new HttpError('请求有误')
    expect(error.statusCode).toBe(400)
    expect(error.message).toBe('请求有误')
    expect(error.name).toBe('HttpError')
    expect(error).toBeInstanceOf(Error)
  })

  it('支持自定义状态码', () => {
    expect(new HttpError('不存在', 404).statusCode).toBe(404)
  })
})
