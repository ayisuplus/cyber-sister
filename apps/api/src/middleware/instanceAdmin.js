import prisma from '../prisma/client.js'

function phoneSet(value) {
  return new Set((value || '').split(',').map((phone) => phone.trim()).filter(Boolean))
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
        error: '仅安装实例管理员可修改本地模型配置',
        code: 'INSTANCE_ADMIN_REQUIRED',
      })
    }
    next()
  } catch {
    res.status(503).json({ error: '暂时无法验证管理员权限', code: 'ADMIN_AUTH_UNAVAILABLE' })
  }
}
