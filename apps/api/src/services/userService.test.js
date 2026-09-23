import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userUpdate: vi.fn(),
  userFindUnique: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    user: { update: mocks.userUpdate, findUnique: mocks.userFindUnique },
  },
}))

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import * as userService from './userService.js'

const { updateProfile } = userService

describe('云端用途版本门', () => {
  beforeEach(() => vi.clearAllMocks())

  it('旧版 v3 已同意也不能调用云端，v4 才允许且调用前复查', async () => {
    mocks.userFindUnique.mockResolvedValue({ externalLlmConsent: true, externalLlmConsentVersion: 'cloud-primary-v3' })
    expect(await userService.loadExternalConsent('user-1')).toEqual({ allowExternal: false, authorizeExternal: undefined })

    mocks.userFindUnique.mockResolvedValue({ externalLlmConsent: true, externalLlmConsentVersion: 'cloud-primary-v4' })
    const consent = await userService.loadExternalConsent('user-1')
    expect(consent.allowExternal).toBe(true)
    expect(await consent.authorizeExternal()).toBe(true)
    mocks.userFindUnique.mockResolvedValue({ externalLlmConsent: false, externalLlmConsentVersion: 'cloud-primary-v4' })
    expect(await consent.authorizeExternal()).toBe(false)
  })
})

describe('userService.updateProfile：letterFreqDays 写信频率', () => {
  beforeEach(() => vi.clearAllMocks())

  it('只收 3、7 或空，其余 400 且不落库', async () => {
    mocks.userUpdate.mockImplementation(({ data }) => Promise.resolve(data))
    expect(await updateProfile('user-1', { letterFreqDays: 3 })).toEqual({ letterFreqDays: 3 })
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' }, data: { letterFreqDays: 3 } }))
    expect(mocks.userUpdate.mock.calls[0][0].select).toHaveProperty('letterFreqDays', true)

    mocks.userUpdate.mockClear()
    expect(await updateProfile('user-1', { letterFreqDays: null })).toEqual({ letterFreqDays: null })

    mocks.userUpdate.mockClear()
    await expect(updateProfile('user-1', { letterFreqDays: 5 })).rejects.toMatchObject({ statusCode: 400, message: 'letterFreqDays只能是3、7或空' })
    await expect(updateProfile('user-1', { letterFreqDays: '7' })).rejects.toMatchObject({ statusCode: 400, message: 'letterFreqDays只能是3、7或空' })
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it('profile 不再有做梦开关字段', async () => {
    mocks.userUpdate.mockResolvedValue({})

    await updateProfile('user-1', { letterFreqDays: 7 })

    const { select } = mocks.userUpdate.mock.calls[0][0]
    expect(select).not.toHaveProperty('dreamEnabled')
    expect(select).toHaveProperty('letterFreqDays', true)
  })
})

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
