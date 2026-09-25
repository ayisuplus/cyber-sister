/**
 * 向量身份的唯一一种写法（路线图 C23）：以前记忆存明文地址、书存地址哈希、评测夹具又是另一种，
 * 而且 127.0.0.1 与 localhost、末尾多一个 / 都被当成不同的模型。
 *
 * 一个向量能不能和另一个比，看两件事：
 * - 模型身份：规范化后的地址（只存哈希，不把地址写进仓库）+ 模型名 + 维度；
 * - 这类对象的规则版本：拿什么文字去算向量（记忆只算正文；书卡是章名 + 用途 + 正文；段落是章名 + 这一段，切段参数也算在内）。
 * 两者合成 identityKey。对象本身改没改，另看 contentVersion（算向量那段文字的 sha256）。
 */
import { createHash } from 'node:crypto'

const sha256 = (text) => createHash('sha256').update(String(text)).digest('hex')

/** 各类对象的规则版本：改了「拿什么文字去算」就升一版，旧向量自动作废、由补算任务重算。 */
export const SUBJECT_RULES = Object.freeze({
  memory: 1,
  card: 1,
  // 段落：600 字一段、重叠 80 字（bookIndexService 的 PASSAGE_SIZE / PASSAGE_OVERLAP）；改切法就改这里
  passage: '1:600/80',
})

/** 地址规范化：主机名小写、去掉末尾的 /、localhost 视同 127.0.0.1。 */
export function normalizeProvider(provider) {
  try {
    const url = new URL(String(provider))
    if (url.hostname === 'localhost') url.hostname = '127.0.0.1'
    return url.href.replace(/\/+$/, '')
  } catch {
    return String(provider ?? '').replace(/\/+$/, '')
  }
}

/** 地址的哈希（16 位）：已经记了哈希的（书架索引、评测夹具）直接用。 */
export const providerKeyOf = (identity) => identity?.providerHash
  ?? (identity?.provider ? sha256(normalizeProvider(identity.provider)).slice(0, 16) : null)

/** 模型身份（不含对象规则）：{ providerHash, model, dimensions, ruleVersion }，库里与评测夹具都这样记。 */
export const identityOf = (identity) => (identity
  ? { providerHash: providerKeyOf(identity), model: identity.model, dimensions: identity.dimensions, ruleVersion: identity.ruleVersion }
  : null)

/** 两边是不是同一个模型算的：地址、模型、维度、规则版本都对得上。 */
export const sameModel = (a, b) => Boolean(a && b && providerKeyOf(a) === providerKeyOf(b) && a.model === b.model
  && a.dimensions === b.dimensions && a.ruleVersion === b.ruleVersion)

/** 某类对象在这个模型下的身份键：存进 embeddings.identity_key，比较时两边都算这个。 */
export function identityKeyOf(identity, subjectType) {
  if (!identity || !Object.hasOwn(SUBJECT_RULES, subjectType)) return null
  const provider = providerKeyOf(identity)
  if (!provider || !identity.model || !Number.isInteger(identity.dimensions)) return null
  return sha256([provider, identity.model, identity.dimensions, identity.ruleVersion ?? 1, subjectType, SUBJECT_RULES[subjectType]].join('|')).slice(0, 32)
}

/** 算向量那段文字的版本：文字一变，旧向量就对不上。 */
export const contentVersion = (text) => sha256(String(text ?? ''))
