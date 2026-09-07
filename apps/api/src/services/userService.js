/**
 * 用户资料、人格和外部模型同意服务。
 */
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'
// 人格 id 的唯一权威是 llm-gateway 的 personas.js（其导出面冻结，勿改网关包；
// 网关 exports 仅暴露包根，故按相对路径直连 personas.js）。
// 本服务只消费 id 集合，无附加 UI 文案字段。
import { VALID_PERSONA_IDS } from '../../../../packages/llm-gateway/src/personas.js'

export const PERSONAS = [...VALID_PERSONA_IDS]
export const EXTERNAL_LLM_CONSENT_VERSION = 'cloud-primary-v1'

export async function getProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      phone: true,
      nickname: true,
      persona: true,
      isVip: true,
      vipExpireAt: true,
      avatarUrl: true,
      birthDate: true,
      roleName: true,
      roleSetting: true,
      createdAt: true,
    },
  })
  if (!user) throw new HttpError('用户不存在', 404)

  return user
}

export async function updateProfile(userId, { nickname, avatarUrl, birthDate }) {
  const updateData = {}
  if (nickname !== undefined) {
    if (typeof nickname !== 'string' || nickname.trim().length > 50) {
      throw new HttpError('昵称不能超过50个字符', 400)
    }
    updateData.nickname = nickname.trim()
  }
  if (avatarUrl !== undefined) {
    if (typeof avatarUrl === 'string' && avatarUrl.length > 500) {
      throw new HttpError('头像地址过长', 400)
    }
    updateData.avatarUrl = avatarUrl || null
  }
  if (birthDate !== undefined) {
    const parsedDate = birthDate ? new Date(birthDate) : null
    if (parsedDate && Number.isNaN(parsedDate.getTime())) {
      throw new HttpError('出生日期格式不正确', 400)
    }
    updateData.birthDate = parsedDate
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: {
      id: true,
      phone: true,
      nickname: true,
      persona: true,
      isVip: true,
      vipExpireAt: true,
      avatarUrl: true,
      birthDate: true,
      roleName: true,
      roleSetting: true,
    },
  })

  logger.info('用户信息更新', { userId })
  return user
}

export async function switchPersona(userId, persona) {
  if (!PERSONAS.includes(persona)) {
    throw new HttpError(`人格必须是以下值之一: ${PERSONAS.join(', ')}`, 400)
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { persona },
    select: { persona: true },
  })
  logger.info('人格切换', { userId, persona })
  return user
}

export async function updateRolePlay(userId, { name, setting }) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 20) {
    throw new HttpError('角色名必须为1到20个字符', 400)
  }
  if (typeof setting !== 'string' || !setting.trim() || setting.trim().length > 200) {
    throw new HttpError('角色设定必须为1到200个字符', 400)
  }
  const user = await prisma.user.update({
    where: { id: userId },
    data: { roleName: name.trim(), roleSetting: setting.trim() },
    select: { roleName: true, roleSetting: true },
  })
  logger.info('设置角色扮演', { userId })
  return user
}

export async function clearRolePlay(userId) {
  await prisma.user.update({
    where: { id: userId },
    data: { roleName: null, roleSetting: null },
  })
  logger.info('清除角色扮演', { userId })
}

export async function getExternalLlmConsent(userId) {
  const consent = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      externalLlmConsent: true,
      externalLlmConsentVersion: true,
      externalLlmConsentUpdatedAt: true,
    },
  })
  if (!consent) throw new HttpError('用户不存在', 404)

  const isCurrentVersion = consent.externalLlmConsentVersion === EXTERNAL_LLM_CONSENT_VERSION
  return {
    accepted: isCurrentVersion ? consent.externalLlmConsent : null,
    version: EXTERNAL_LLM_CONSENT_VERSION,
    updatedAt: isCurrentVersion ? consent.externalLlmConsentUpdatedAt : null,
  }
}

export async function updateExternalLlmConsent(userId, accepted) {
  if (typeof accepted !== 'boolean') {
    throw new HttpError('accepted必须是布尔值', 400)
  }

  const updatedAt = new Date()
  await prisma.user.update({
    where: { id: userId },
    data: {
      externalLlmConsent: accepted,
      externalLlmConsentVersion: EXTERNAL_LLM_CONSENT_VERSION,
      externalLlmConsentUpdatedAt: updatedAt,
    },
  })

  logger.info('外部模型同意状态更新', { userId, accepted, version: EXTERNAL_LLM_CONSENT_VERSION })
  return { accepted, version: EXTERNAL_LLM_CONSENT_VERSION, updatedAt }
}

export async function getMembership(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isVip: true, vipExpireAt: true },
  })
  if (!user) throw new HttpError('用户不存在', 404)
  return { isVip: user.isVip, vipExpireAt: user.vipExpireAt }
}

export function subscribeMembership() {
  const error = new HttpError('会员功能暂未开放', 409)
  error.code = 'FEATURE_NOT_AVAILABLE'
  throw error
}
