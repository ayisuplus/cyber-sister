import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    user: { findUnique: db.userFindUnique, update: db.userUpdate },
  },
}))

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  EXTERNAL_LLM_CONSENT_VERSION,
  getExternalLlmConsent,
  getMembership,
  getProfile,
  subscribeMembership,
  switchPersona,
  updateExternalLlmConsent,
  updateProfile,
} from './userService.js'

beforeEach(() => vi.clearAllMocks())

describe('getProfile', () => {
  it('返回用户资料', async () => {
    const user = { id: 'u1', phone: '13800138000', nickname: '姐妹' }
    db.userFindUnique.mockResolvedValue(user)
    expect(await getProfile('u1')).toBe(user)
  })

  it('用户不存在抛 404', async () => {
    db.userFindUnique.mockResolvedValue(null)
    await expect(getProfile('ghost')).rejects.toMatchObject({
      statusCode: 404,
      message: '用户不存在',
    })
  })
})

describe('updateProfile', () => {
  beforeEach(() => {
    db.userUpdate.mockImplementation(({ data }) => Promise.resolve({ id: 'u1', ...data }))
  })

  it('只更新传入的字段，昵称去除首尾空格', async () => {
    await updateProfile('u1', { nickname: '  新昵称  ' })
    expect(db.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { nickname: '新昵称' },
    }))
  })

  it('昵称超过 50 字符或非字符串被拒绝', async () => {
    await expect(updateProfile('u1', { nickname: 'x'.repeat(51) })).rejects.toMatchObject({
      statusCode: 400,
      message: '昵称不能超过50个字符',
    })
    await expect(updateProfile('u1', { nickname: 123 })).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(db.userUpdate).not.toHaveBeenCalled()
  })

  it('头像地址超长被拒，空字符串归一化为 null', async () => {
    await expect(updateProfile('u1', { avatarUrl: `https://x.test/${'a'.repeat(500)}` }))
      .rejects.toMatchObject({ statusCode: 400, message: '头像地址过长' })

    await updateProfile('u1', { avatarUrl: '' })
    expect(db.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { avatarUrl: null },
    }))
  })

  it('非法出生日期被拒，空值表示清除', async () => {
    await expect(updateProfile('u1', { birthDate: 'not-a-date' })).rejects.toMatchObject({
      statusCode: 400,
      message: '出生日期格式不正确',
    })

    await updateProfile('u1', { birthDate: null })
    expect(db.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { birthDate: null },
    }))

    await updateProfile('u1', { birthDate: '2000-01-01' })
    expect(db.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { birthDate: new Date('2000-01-01') },
    }))
  })
})

describe('switchPersona', () => {
  it('非法人格抛 400', async () => {
    await expect(switchPersona('u1', 'wild')).rejects.toMatchObject({
      statusCode: 400,
      message: '人格必须是以下值之一: toxic, gentle, rational',
    })
    expect(db.userUpdate).not.toHaveBeenCalled()
  })

  it('合法人格更新成功', async () => {
    db.userUpdate.mockResolvedValue({ persona: 'gentle' })
    expect(await switchPersona('u1', 'gentle')).toEqual({ persona: 'gentle' })
    expect(db.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { persona: 'gentle' },
    }))
  })
})

describe('外部模型同意状态', () => {
  it('版本匹配时返回当前同意状态', async () => {
    const updatedAt = new Date('2026-08-01')
    db.userFindUnique.mockResolvedValue({
      externalLlmConsent: true,
      externalLlmConsentVersion: EXTERNAL_LLM_CONSENT_VERSION,
      externalLlmConsentUpdatedAt: updatedAt,
    })
    expect(await getExternalLlmConsent('u1')).toEqual({
      accepted: true,
      version: EXTERNAL_LLM_CONSENT_VERSION,
      updatedAt,
    })
  })

  it('版本过旧时视为未选择', async () => {
    db.userFindUnique.mockResolvedValue({
      externalLlmConsent: true,
      externalLlmConsentVersion: 'old-version',
      externalLlmConsentUpdatedAt: new Date(),
    })
    expect(await getExternalLlmConsent('u1')).toEqual({
      accepted: null,
      version: EXTERNAL_LLM_CONSENT_VERSION,
      updatedAt: null,
    })
  })

  it('用户不存在抛 404', async () => {
    db.userFindUnique.mockResolvedValue(null)
    await expect(getExternalLlmConsent('ghost')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('更新时写入当前版本，accepted 必须是布尔值', async () => {
    db.userUpdate.mockResolvedValue({})
    const result = await updateExternalLlmConsent('u1', false)
    expect(result.accepted).toBe(false)
    expect(result.version).toBe(EXTERNAL_LLM_CONSENT_VERSION)
    expect(db.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        externalLlmConsent: false,
        externalLlmConsentVersion: EXTERNAL_LLM_CONSENT_VERSION,
      }),
    }))

    await expect(updateExternalLlmConsent('u1', 'yes')).rejects.toMatchObject({
      statusCode: 400,
      message: 'accepted必须是布尔值',
    })
  })
})

describe('会员', () => {
  it('返回会员状态，用户不存在抛 404', async () => {
    db.userFindUnique.mockResolvedValue({ isVip: true, vipExpireAt: new Date('2027-01-01') })
    const status = await getMembership('u1')
    expect(status.isVip).toBe(true)

    db.userFindUnique.mockResolvedValue(null)
    await expect(getMembership('ghost')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('订阅入口固定返回未开放', () => {
    try {
      subscribeMembership('u1')
      expect.unreachable()
    } catch (error) {
      expect(error.statusCode).toBe(409)
      expect(error.code).toBe('FEATURE_NOT_AVAILABLE')
      expect(error.message).toBe('会员功能暂未开放')
    }
  })
})
