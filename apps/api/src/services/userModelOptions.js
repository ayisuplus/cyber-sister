/**
 * 用户级模型选项装配：人格 + 外部模型同意门（与 chatService 同款语义）。
 * 日记回应、手帐鼓励等非聊天主链路的 AI 调用共用。
 */
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import { EXTERNAL_LLM_CONSENT_VERSION } from './userService.js'

export async function buildUserModelOptions(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      persona: true,
      externalLlmConsent: true,
      externalLlmConsentVersion: true,
    },
  })
  if (!user) throw new HttpError('用户不存在', 404)

  const allowExternal = user.externalLlmConsent === true
    && user.externalLlmConsentVersion === EXTERNAL_LLM_CONSENT_VERSION
  const modelOptions = { allowExternal }
  if (allowExternal) {
    modelOptions.authorizeExternal = async () => {
      const currentConsent = await prisma.user.findUnique({
        where: { id: userId },
        select: { externalLlmConsent: true, externalLlmConsentVersion: true },
      })
      return currentConsent?.externalLlmConsent === true
        && currentConsent.externalLlmConsentVersion === EXTERNAL_LLM_CONSENT_VERSION
    }
  }
  return { user, modelOptions }
}
