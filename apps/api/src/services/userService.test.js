import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userUpdate: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    user: { update: mocks.userUpdate },
  },
}))

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { clearRolePlay, updateRolePlay } from './userService.js'

describe('userService.updateRolePlay', () => {
  beforeEach(() => vi.clearAllMocks())

  it('角色名为空时抛 400', async () => {
    await expect(updateRolePlay('user-1', { name: '  ', setting: '设定' }))
      .rejects.toMatchObject({ message: '角色名必须为1到20个字符', statusCode: 400 })
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it('角色名超过20个字符时抛 400', async () => {
    await expect(updateRolePlay('user-1', { name: 'a'.repeat(21), setting: '设定' }))
      .rejects.toMatchObject({ message: '角色名必须为1到20个字符', statusCode: 400 })
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it('角色设定为空时抛 400', async () => {
    await expect(updateRolePlay('user-1', { name: '同桌的你', setting: '' }))
      .rejects.toMatchObject({ message: '角色设定必须为1到200个字符', statusCode: 400 })
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it('角色名为恋人称谓时抛 400 恋人红线，不落库', async () => {
    await expect(updateRolePlay('user-1', { name: '我的女朋友', setting: '温柔体贴' }))
      .rejects.toMatchObject({ message: '角色扮演不能设定为恋人或亲密关系——我是你姐妹，不是你对象', statusCode: 400 })
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it('角色设定含亲密关系描述时抛 400 恋人红线', async () => {
    await expect(updateRolePlay('user-1', { name: '小晴', setting: '她是我的灵魂伴侣，每天哄我睡觉' }))
      .rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it('非亲密的普通角色关系不受影响', async () => {
    mocks.userUpdate.mockImplementation(({ data }) => Promise.resolve(data))
    const result = await updateRolePlay('user-1', { name: '合租室友', setting: '爱做饭，经常喊我一起吃饭' })
    expect(result).toEqual({ roleName: '合租室友', roleSetting: '爱做饭，经常喊我一起吃饭' })
  })

  it('合法输入 trim 后落库并返回角色字段', async () => {
    mocks.userUpdate.mockImplementation(({ data }) => Promise.resolve(data))

    const result = await updateRolePlay('user-1', { name: ' 同桌的你 ', setting: ' 爱吐槽但会帮我讲题 ' })

    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { roleName: '同桌的你', roleSetting: '爱吐槽但会帮我讲题' },
      select: { roleName: true, roleSetting: true },
    })
    expect(result).toEqual({ roleName: '同桌的你', roleSetting: '爱吐槽但会帮我讲题' })
  })
})

describe('userService.clearRolePlay', () => {
  beforeEach(() => vi.clearAllMocks())

  it('清除时两个字段都写 null', async () => {
    mocks.userUpdate.mockResolvedValue({})

    await clearRolePlay('user-1')

    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { roleName: null, roleSetting: null },
    })
  })
})
