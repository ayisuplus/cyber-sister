/**
 * 向量计算的唯一一份（路线图 C23）：以前记忆与书卡的余弦、她的书的单位向量点积各写在各的文件里。
 *
 * 精度照旧、不改评测结果：记忆和书卡数量少，用 Float64 算余弦（与书架选章评测标定时同一种算法）；
 * 她的书段落多、常驻缓存，先归一化成 Float32 单位向量，之后只做点积（与「她的书」阈值标定时相同）。
 */

/** 长度对、每一维是有限数、不全是零：才算一个能用的向量。 */
export const validVector = (vector, dimensions = vector?.length) => Array.isArray(vector) && vector.length > 0
  && vector.length === dimensions && vector.every(Number.isFinite) && vector.some((value) => value !== 0)

/** 余弦相似度（Float64）：长度不等或任一向量零范数 → 0（维度不一致的旧向量自然沉底）。 */
export function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0
  let product = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index++) {
    const x = a[index]
    const y = b[index]
    product += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  return product / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** 归一化成 Float32 单位向量；零向量返回 null。她的书段落用它常驻缓存。 */
export function unit32(vector) {
  if (!vector?.length) return null
  const out = Float32Array.from(vector)
  let norm = 0
  for (const value of out) norm += value * value
  norm = Math.sqrt(norm)
  if (!norm) return null
  for (let index = 0; index < out.length; index += 1) out[index] /= norm
  return out
}

/** 点积；长度不等返回 0。两边都是单位向量时就是余弦相似度。 */
export function dot(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let sum = 0
  for (let index = 0; index < a.length; index += 1) sum += a[index] * b[index]
  return sum
}
