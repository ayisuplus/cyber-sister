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

import * as userService from './userService.js'

const { updateProfile } = userService

describe('userService.updateProfile：careEnabled 关怀开关', () => {
  beforeEach(() => vi.clearAllMocks())

  it('布尔值透传落库', async () => {
    mocks.userUpdate.mockImplementation(({ data }) => Promise.resolve(data))

    expect(await updateProfile('user-1', { careEnabled: false })).toEqual({ careEnabled: false })
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1' },
      data: { careEnabled: false },
    }))
  })

  it('非布尔值抛 400，不落库', async () => {
    await expect(updateProfile('user-1', { careEnabled: 'yes' }))
      .rejects.toMatchObject({ statusCode: 400, message: 'careEnabled必须是布尔值' })
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it('资料返回值不再带角色扮演字段', async () => {
    mocks.userUpdate.mockResolvedValue({})

    await updateProfile('user-1', { nickname: '小晴' })

    const { select } = mocks.userUpdate.mock.calls[0][0]
    expect(select).not.toHaveProperty('roleName')
    expect(select).not.toHaveProperty('roleSetting')
  })
})

describe('角色扮演已取消', () => {
  it('不再导出任何角色扮演写入函数', () => {
    expect(userService).not.toHaveProperty('updateRolePlay')
    expect(userService).not.toHaveProperty('clearRolePlay')
    expect(userService).not.toHaveProperty('assertRolePlayAllowed')
  })
})
