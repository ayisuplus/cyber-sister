import { WandSparkles } from 'lucide-react'
import VirtualRoomShell from '../components/virtualRoom/VirtualRoomShell'
import { MAKEUP_LOOKS } from '../features/virtualStudio/catalogs'

export default function VirtualMakeupRoomPage() {
  return (
    <VirtualRoomShell
      title="虚拟化妆间"
      intro="在这台设备上选一张照片和一款妆容，由本机 ComfyUI 生成上妆预览，照片不出这台设备。"
      scene="makeup"
      items={MAKEUP_LOOKS}
      itemNoun="妆容"
      pickerLabel="选一款想试的妆容"
      icon={WandSparkles}
      toneClass="bg-pastel-blush"
    />
  )
}
