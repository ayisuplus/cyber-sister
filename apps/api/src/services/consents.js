/**
 * 同意门的唯一来源（路线图 C23）：以前这几项判断在聊天、用户、向量服务里各写一份，
 * 经期的两项只在一条路上一起判断，别的路就漏了。
 *
 * - 云端模型同意（当前版本 cloud-primary-v4）：聊天、照片、记忆向量、她的书、回想与写信都要它；
 *   每次真正调用前还要重读一次，撤回授权会拦下尚未发出的请求。
 * - 经期记录（periodConsentAt）：记下、推算、到时候提醒、她问起时读取。
 * - 聊天时顾及周期（periodToneAt）：记录同意之外单独的一项，两项都在才让模型知道「这几天在经期」。
 */
import prisma from '../prisma/client.js'

export const EXTERNAL_LLM_CONSENT_VERSION = 'cloud-primary-v4'

export const CONSENT_FIELDS = { externalLlmConsent: true, externalLlmConsentVersion: true, periodConsentAt: true, periodToneAt: true }
const CLOUD_FIELDS = { externalLlmConsent: true, externalLlmConsentVersion: true }

/** 这一行用户数据上，云端同意是否有效：同意了，而且是当前版本。 */
export const cloudConsentOf = (user) => user?.externalLlmConsent === true
  && user.externalLlmConsentVersion === EXTERNAL_LLM_CONSENT_VERSION

/** 经期两项：顾及周期只有在记录同意还在时才算数（撤回记录同意时服务端一并关掉）。 */
export const periodConsentsOf = (user) => ({
  record: Boolean(user?.periodConsentAt),
  tone: Boolean(user?.periodConsentAt && user?.periodToneAt),
})

/** 重读一次云端同意（调用前复查、后台任务逐条复查都用它）；可传事务。 */
export async function hasCloudConsent(userId, database = prisma) {
  return cloudConsentOf(await database.user.findUnique({ where: { id: userId }, select: CLOUD_FIELDS }))
}

/** 云端调用授权：allowExternal 是此刻的判断，authorizeExternal 在每次真正调用前再读一次。 */
export function cloudAuthorization(userId, user) {
  const allowExternal = cloudConsentOf(user)
  return allowExternal
    ? { allowExternal, authorizeExternal: () => hasCloudConsent(userId) }
    : { allowExternal, authorizeExternal: undefined }
}

/** 由已读出的用户行装配全部同意（行里要有 CONSENT_FIELDS）。 */
export const consentsOf = (userId, user) => ({ cloud: cloudAuthorization(userId, user), period: periodConsentsOf(user) })

/** 读出并装配全部同意。 */
export async function loadConsents(userId) {
  return consentsOf(userId, await prisma.user.findUnique({ where: { id: userId }, select: CONSENT_FIELDS }))
}

/** 只要云端授权（回想、写信、记忆建议）。 */
export async function loadExternalConsent(userId) {
  return cloudAuthorization(userId, await prisma.user.findUnique({ where: { id: userId }, select: CLOUD_FIELDS }))
}
