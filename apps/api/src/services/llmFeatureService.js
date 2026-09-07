import prisma from '../prisma/client.js'
import { EXTERNAL_LLM_CONSENT_VERSION } from './userService.js'
import {
  checkLocalLlmState,
  getStoredLocalConfig,
  isQwenConfigured,
} from './localLlmConfigService.js'
import { isExternalChatPrimary } from './llmService.js'

function getConsent(userId) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { externalLlmConsent: true, externalLlmConsentVersion: true },
  })
}

export async function getLlmStatus(userId) {
  const [config, consent] = await Promise.all([getStoredLocalConfig(), getConsent(userId)])
  const externalPrimary = isExternalChatPrimary()
  return {
    mode: externalPrimary ? 'external_primary' : 'local_first',
    local: {
      configured: Boolean(config?.enabled),
      state: await checkLocalLlmState(config),
    },
    externalFallback: {
      configured: isQwenConfigured(),
      primary: externalPrimary,
      consent: consent?.externalLlmConsentVersion === EXTERNAL_LLM_CONSENT_VERSION
        ? consent.externalLlmConsent
        : null,
      version: EXTERNAL_LLM_CONSENT_VERSION,
    },
  }
}
