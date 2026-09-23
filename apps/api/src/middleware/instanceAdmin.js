import prisma from '../prisma/client.js'

function phoneSet(value) {
  return new Set((value || '').split(',').map((phone) => phone.trim()).filter(Boolean))
}

/**
 * 实例管理员：数据库里的手机号同时在本实例管理员名单与内测白名单里。
 * 界面据此决定「模型供应商」卡片是否出现；服务端权限仍由下面的中间件强制。
 */
export async function isInstanceAdmin(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true },
  })
  const admins = phoneSet(process.env.INSTANCE_ADMIN_PHONES)
  const whitelist = phoneSet(process.env.INTERNAL_TEST_PHONES)
  return Boolean(user && admins.has(user.phone) && whitelist.has(user.phone))
}

export async function instanceAdminMiddleware(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { phone: true },
    })
    const admins = phoneSet(process.env.INSTANCE_ADMIN_PHONES)
    const whitelist = phoneSet(process.env.INTERNAL_TEST_PHONES)
    if (!user || !admins.has(user.phone) || !whitelist.has(user.phone)) {
      return res.status(403).json({
        error: '仅实例管理员可修改模型供应商配置',
        code: 'INSTANCE_ADMIN_REQUIRED',
      })
    }
    next()
  } catch {
    res.status(503).json({ error: '暂时无法验证管理员权限', code: 'ADMIN_AUTH_UNAVAILABLE' })
  }
}
