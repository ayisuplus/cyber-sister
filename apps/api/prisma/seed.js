import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 开始初始化数据库...')

  // 创建测试用户
  const user = await prisma.user.upsert({
    where: { phone: '13800138000' },
    update: {},
    create: {
      phone: '13800138000',
      nickname: '小仙女',
      persona: 'toxic',
      isVip: false,
    },
  })

  console.log('✅ 创建用户:', user.phone)

  // 创建测试会话
  const conversation = await prisma.conversation.create({
    data: {
      userId: user.id,
      title: '赛博姐妹',
      persona: 'toxic',
    },
  })

  console.log('✅ 创建会话:', conversation.id)

  // 创建测试消息
  const messages = await prisma.message.createMany({
    data: [
      {
        conversationId: conversation.id,
        role: 'user',
        content: '你好',
        emotion: 'neutral',
      },
      {
        conversationId: conversation.id,
        role: 'assistant',
        content: '哟，来了？今天怎么样？',
        emotion: 'neutral',
      },
    ],
  })

  console.log('✅ 创建消息:', messages.count, '条')

  // 创建测试记忆
  const memories = await prisma.memory.createMany({
    data: [
      {
        userId: user.id,
        type: 'semantic',
        content: '用户叫小雨，在上海工作，做产品经理',
        entities: JSON.stringify({ name: '小雨', city: '上海', job: '产品经理' }),
        importance: 9,
        tags: JSON.stringify(['基本信息']),
      },
      {
        userId: user.id,
        type: 'semantic',
        content: '不吃香菜，对芒果过敏',
        entities: JSON.stringify({}),
        importance: 8,
        tags: JSON.stringify(['饮食', '健康']),
      },
      {
        userId: user.id,
        type: 'episodic',
        content: '上周和老板吵架了，因为项目方向问题',
        entities: JSON.stringify({}),
        importance: 6,
        tags: JSON.stringify(['工作', '情绪']),
      },
    ],
  })

  console.log('✅ 创建记忆:', memories.count, '条')

  // 创建测试待办
  const todos = await prisma.todo.createMany({
    data: [
      {
        userId: user.id,
        content: '完成项目报告',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      {
        userId: user.id,
        content: '买生日礼物',
        dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      },
    ],
  })

  console.log('✅ 创建待办:', todos.count, '条')

  console.log('🎉 数据库初始化完成！')
}

main()
  .catch((e) => {
    console.error('❌ 数据库初始化失败:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
