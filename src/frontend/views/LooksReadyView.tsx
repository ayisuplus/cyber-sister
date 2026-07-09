import type { MakeupLook } from '../../shared/types';
import { track } from '../../shared/analytics';

export function LooksReadyView({
  looks,
  selected,
  onSelect,
  onStart,
  onRetake,
  onOpenTeaching,
}: {
  looks: MakeupLook[];
  selected: number;
  onSelect: (i: number) => void;
  onStart: () => void;
  onRetake: () => void;
  onOpenTeaching: (lookId: string) => void;
}) {
  const selectedLook = looks[selected] ?? null;

  return (
    <div>
      <div className="text-center mb-5">
        <div className="inline-flex chip-rose-solid mb-2">💄 为你推荐</div>
        <h2 className="font-serif text-2xl font-bold text-ink">3 套妆容方案</h2>
        <p className="text-xs text-ink-soft/60 mt-1">横向滑动浏览 · 点击选择</p>
      </div>

      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 -mx-2 px-2 mb-5">
        {looks.map((look, i) => (
          <LookCard
            key={look.id}
            look={look}
            selected={i === selected}
            onClick={() => {
              track('look_select', { look_id: look.id, index: i });
              onSelect(i);
            }}
          />
        ))}
      </div>

      <div className="flex gap-2 mb-5">
        {looks.map((_, i) => (
          <div
            key={i}
            className="h-1.5 rounded-full transition-all"
            style={{
              width: i === selected ? 24 : 6,
              background:
                i === selected ? 'linear-gradient(90deg,#EAB6BC,#C86B77)' : 'rgba(234,182,188,0.4)',
            }}
          />
        ))}
      </div>

      <div className="space-y-2">
        <button type="button" onClick={onStart} className="btn-primary w-full">
          开始跟妆教程 →
        </button>
        <button type="button" onClick={onRetake} className="btn-secondary w-full text-sm py-2">
          换一张照片
        </button>
        <button
          type="button"
          onClick={() => onOpenTeaching(selectedLook?.id ?? '')}
          className="btn-secondary w-full text-sm py-2 flex items-center justify-center gap-2"
        >
          📚 查看教学资源
        </button>
      </div>
    </div>
  );
}

function LookCard({
  look,
  selected,
  onClick,
}: {
  look: MakeupLook;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left flex-shrink-0 w-[260px] rounded-3xl p-4 transition-all"
      style={{
        background: selected ? 'linear-gradient(135deg,#FFFFFF,#FDF2F3)' : 'rgba(255,255,255,0.6)',
        border: selected ? '2px solid #C86B77' : '1.5px solid rgba(234,182,188,0.4)',
        boxShadow: selected
          ? '0 12px 32px rgba(200,107,119,0.18)'
          : '0 4px 12px rgba(200,107,119,0.06)',
        transform: selected ? 'translateY(-2px)' : 'none',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg"
          style={{
            background: 'linear-gradient(135deg,#EAB6BC,#C86B77)',
            boxShadow: '0 4px 12px rgba(200,107,119,0.3)',
          }}
        >
          💄
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-serif font-bold text-ink truncate">{look.name}</div>
          <div className="chip-tag mt-1">{look.scenario}</div>
        </div>
        {selected && (
          <div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs">
            ✓
          </div>
        )}
      </div>
      <p className="text-sm text-ink-soft/80 leading-relaxed mt-2 line-clamp-3">{look.reason}</p>
    </button>
  );
}
