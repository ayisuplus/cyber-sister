/**
 * 数据库操作辅助函数
 * 提取路由中重复出现的模式，减少样板代码
 */
import prisma from '../prisma/client.js'

/**
 * 查找属于当前用户的资源，不存在则抛出 404 错误
 * @param {string} model - Prisma 模型名（小驼峰，如 'conversation'）
 * @param {string} id - 资源 ID
 * @param {string} userId - 用户 ID
 * @param {string} errorName - 资源中文名，用于错误消息
 * @returns {Promise<object>} 找到的资源
 */
export async function findOwned(model, id, userId, errorName) {
  const item = await prisma[model].findFirst({
    where: { id, userId },
  })
  if (!item) {
    const error = new Error(`${errorName}不存在`)
    error.statusCode = 404
    throw error
  }
  return item
}

/**
 * 删除属于当前用户的资源，不存在则抛出 404
 * @param {string} model - Prisma 模型名
 * @param {string} id - 资源 ID
 * @param {string} userId - 用户 ID
 * @param {string} errorName - 资源中文名
 */
export async function deleteOwned(model, id, userId, errorName) {
  await findOwned(model, id, userId, errorName)
  return prisma[model].delete({ where: { id } })
}

/**
 * HttpError - 带状态码的错误，方便在路由层统一处理
 */
export class HttpError extends Error {
  constructor(message, statusCode = 400) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
  }
}
