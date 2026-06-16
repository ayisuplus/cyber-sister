// Placeholder — full canvas overlay lands in Task 7.
import type { OverlayZone } from '../../shared/types';

interface Props {
  imageUrl: string;
  zones: OverlayZone[];
}

export default function MakeupCanvas({ imageUrl, zones }: Props) {
  return (
    <div className="relative inline-block">
      <img src={imageUrl} alt="用户自拍" className="max-w-full rounded-card" />
      <div className="absolute top-2 left-2 bg-white/80 text-xs px-2 py-1 rounded-full">
        {zones.length} 个分区待标注
      </div>
    </div>
  );
}
