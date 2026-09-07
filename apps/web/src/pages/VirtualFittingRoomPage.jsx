import { Shirt } from 'lucide-react'
import VirtualRoomShell from '../components/virtualRoom/VirtualRoomShell'
import { FITTING_ITEMS } from '../features/virtualStudio/catalogs'

export default function VirtualFittingRoomPage() {
  return (
    <VirtualRoomShell
      title="虚拟试衣间"
      intro="在这台设备上选一张照片和一件单品，由本机 ComfyUI 生成穿搭预览，照片不出这台设备。"
      scene="fitting"
      items={FITTING_ITEMS}
      itemNoun="单品"
      pickerLabel="选一件想试的单品"
      icon={Shirt}
      toneClass="bg-pastel-mist"
    />
  )
}
