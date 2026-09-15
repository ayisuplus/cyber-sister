// 能力注册表：导航与展示的唯一来源。媒体生成接口当前固定模拟，未连接云端服务。
export const CAPABILITIES = [
  {
    id: 'makeup-room',
    title: '化妆间',
    description: '选好照片和妆容参数，提交云端接口模拟预览；预设随存随用。',
    status: 'available',
    href: '/tools/makeup-room',
    icon: 'wand',
    tone: 'sprout',
    privacyNote: '云端接口 · 模拟',
  },
  {
    id: 'wardrobe',
    title: '3D 衣柜',
    description: '提交单品照片体验云端接口模拟预览，管理已有衣物和模型。',
    status: 'available',
    href: '/tools/wardrobe',
    icon: 'shirt',
    tone: 'mist',
    privacyNote: '云端接口 · 模拟',
  },
]
