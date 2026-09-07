import prisma from '../prisma/client.js'
import { EXTERNAL_LLM_CONSENT_VERSION } from './userService.js'
import { isCloudProviderConfigured } from './llmService.js'

function getConsent(userId) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { externalLlmConsent: true, externalLlmConsentVersion: true },
  })
}

/**
 * 模型状态（云端切割后）：聊天只有一条云端路径，因此 mode 恒为 external_primary。
 * local 字段保留为 { configured:false, state:'removed' } 以兼容既有消费方读取，
 * 前端据此渲染同意门而非本地模型引导。
 */
export async function getLlmStatus(userId) {
  const consent = await getConsent(userId)
  return {
    mode: 'external_primary',
    local: { configured: false, state: 'removed' },
    externalFallback: {
      configured: isCloudProviderConfigured(),
      primary: true,
      consent: consent?.externalLlmConsentVersion === EXTERNAL_LLM_CONSENT_VERSION
        ? consent.externalLlmConsent
        : null,
      version: EXTERNAL_LLM_CONSENT_VERSION,
    },
  }
}
