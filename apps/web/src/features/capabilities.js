// 能力注册表：导航与展示的唯一来源（local-first-capabilities §2）。
// 云端切割（2026-09-07）后虚拟试衣/化妆间随本机 ComfyUI 面删除下线；
// 现为化妆间（MediaPipe 本机处理 + 自定义预设）与 3D 衣柜（外部图生 3D，未配置时诚实 503）。
export const CAPABILITIES = [
  {
    id: 'makeup-room',
    title: '化妆间',
    description: '拍照或选照片，在这台设备上实时磨皮、美白、瘦脸、大眼；妆容预设随存随用。',
    status: 'available',
    href: '/tools/makeup-room',
    icon: 'wand',
    tone: 'sprout',
    privacyNote: '照片全在本机处理',
  },
  {
    id: 'wardrobe',
    title: '3D 衣柜',
    description: '上传单品照片，生成可以转着看的 3D 模型收进衣柜。',
    status: 'available',
    href: '/tools/wardrobe',
    icon: 'shirt',
    tone: 'mist',
    privacyNote: '3D 生成走外部服务',
  },
]
