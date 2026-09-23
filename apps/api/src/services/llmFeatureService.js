import prisma from '../prisma/client.js'
import { EXTERNAL_LLM_CONSENT_VERSION } from './userService.js'
import { activeChatProviders, isCloudProviderConfigured } from './llmService.js'
import { isInstanceAdmin } from '../middleware/instanceAdmin.js'
import { embeddingStatus } from './embeddingConfig.js'
import { WORK_CLOUD_EXECUTION } from './workCloudService.js'

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
 * isInstanceAdmin 决定设置页「模型供应商」卡片是否出现；providers 是启用且承接对话的
 * 供应商显示名（按优先级），只说「现在用的是哪家」，不含地址与密钥。
 */
export async function getLlmStatus(userId) {
  const [consent, instanceAdmin] = await Promise.all([getConsent(userId), isInstanceAdmin(userId)])
  return {
    mode: 'external_primary',
    embedding: embeddingStatus(),
    workGeneration: { ...WORK_CLOUD_EXECUTION },
    local: { configured: false, state: 'removed' },
    isInstanceAdmin: instanceAdmin,
    externalFallback: {
      configured: isCloudProviderConfigured(),
      primary: true,
      consent: consent?.externalLlmConsentVersion === EXTERNAL_LLM_CONSENT_VERSION
        ? consent.externalLlmConsent
        : null,
      version: EXTERNAL_LLM_CONSENT_VERSION,
      providers: activeChatProviders(),
    },
  }
}
