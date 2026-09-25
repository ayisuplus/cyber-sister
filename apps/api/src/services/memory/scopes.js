/**
 * 记忆的读取范围（叶子模块，不引用任何服务，谁都能用而不绕成循环依赖）。
 */

/** 未过期的记忆（根）。聊天、回想、写信、关系推断与她的工具都只看这些。 */
export const liveMemoryWhere = (userId, now = new Date()) => ({
  userId,
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
})
