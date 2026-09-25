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

import { EXTERNAL_LLM_CONSENT_VERSION } from './consents.js'

// 同意门的唯一来源在 consents.js；这里转出，老调用方不用改
export { EXTERNAL_LLM_CONSENT_VERSION, loadExternalConsent } from './consents.js'
export const PERSONAS = [...VALID_PERSONA_IDS]

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
      careEnabled: true,
      letterFreqDays: true,
      citeBooks: true,
      createdAt: true,
    },
  })
  if (!user) throw new HttpError('用户不存在', 404)

  return user
}

/** 开关类字段：没传不动，传了必须是布尔值。 */
function setBoolean(updateData, name, value) {
  if (value === undefined) return
  if (typeof value !== 'boolean') throw new HttpError(`${name}必须是布尔值`, 400)
  updateData[name] = value
}

export async function updateProfile(userId, { nickname, avatarUrl, birthDate, careEnabled, letterFreqDays, citeBooks }) {
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
  setBoolean(updateData, 'careEnabled', careEnabled)
  // 「回答里提到书」：跟着账户走，换设备也一样
  setBoolean(updateData, 'citeBooks', citeBooks)
  if (letterFreqDays !== undefined) {
    if (letterFreqDays !== null && letterFreqDays !== 3 && letterFreqDays !== 7) {
      throw new HttpError('letterFreqDays只能是3、7或空', 400)
    }
    updateData.letterFreqDays = letterFreqDays
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: {
      id: true,
      phone: true,
      nickname: true,
      persona: true,
      birthDate: true,
      careEnabled: true,
      letterFreqDays: true,
      citeBooks: true,
      isVip: true,
      vipExpireAt: true,
      avatarUrl: true,
    },
  })

  logger.info('用户信息更新', { userId })
  return user
}

export async function switchPersona(userId, persona, database = prisma) {
  if (!PERSONAS.includes(persona)) {
    throw new HttpError(`人格必须是以下值之一: ${PERSONAS.join(', ')}`, 400)
  }

  const user = await database.user.update({
    where: { id: userId },
    data: { persona },
    select: { persona: true },
  })
  logger.info('人格切换', { userId, persona })
  return user
}

// 角色扮演已取消（2026-09 功能收拢）：一个 Amie、三种说话方式。
// users.role_name/role_setting 列保留且只随数据导出带出旧值，聊天不再读取。

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
