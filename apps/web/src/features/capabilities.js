// 能力注册表：导航与展示的唯一来源（local-first-capabilities §2）。
// 云端切割（2026-09-07）后虚拟试衣/化妆间随本机 ComfyUI 面删除下线；
// 美颜相机保留——它全程在浏览器内用 MediaPipe WASM 处理，照片不上传。
export const CAPABILITIES = [
  {
    id: 'beauty-camera',
    title: '美颜相机',
    description: '拍照或选照片，在这台设备上实时磨皮、美白、瘦脸、大眼。',
    status: 'available',
    href: '/tools/beauty-camera',
    icon: 'camera',
    tone: 'sprout',
    privacyNote: '全在本机处理',
  },
]
