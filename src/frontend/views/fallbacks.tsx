/** TutorialView 懒加载的占位 — 显示一个静态的画布 + 加载文案. */
export function TutorialLoadingFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="card-soft p-2">
        <div
          className="w-full h-[480px] bg-secondary/30 rounded-card flex items-center justify-center text-ink-soft/60 text-sm"
          role="status"
        >
          正在加载教学模块…
        </div>
      </div>
      <div
        className="rounded-3xl p-5 space-y-3 animate-pulse-soft"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.95), rgba(253,242,243,0.7))',
        }}
      >
        <div className="h-4 w-1/3 bg-ink-soft/10 rounded" />
        <div className="h-3 w-2/3 bg-ink-soft/10 rounded" />
        <div className="h-3 w-1/2 bg-ink-soft/10 rounded" />
      </div>
    </div>
  );
}

/** 教学资源页 ResourcesView 懒加载的占位. */
export function ResourcesLoadingFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="flex items-center justify-between mb-4">
        <div className="h-4 w-16 bg-ink-soft/10 rounded animate-pulse-soft" />
        <div className="h-5 w-20 bg-ink-soft/10 rounded animate-pulse-soft" />
        <div className="h-4 w-8 bg-ink-soft/10 rounded animate-pulse-soft" />
      </div>
      <div className="flex gap-2 mb-4">
        <div className="h-9 w-16 bg-ink-soft/10 rounded-xl animate-pulse-soft" />
        <div className="h-9 w-16 bg-ink-soft/10 rounded-xl animate-pulse-soft" />
        <div className="h-9 w-20 bg-ink-soft/10 rounded-xl animate-pulse-soft ml-auto" />
      </div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-2xl p-4 bg-white/60 border border-primary/10 flex items-start gap-3 animate-pulse-soft"
          style={{ animationDelay: `${i * 150}ms` }}
        >
          <div className="w-10 h-10 rounded-xl bg-ink-soft/10 flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-3/4 bg-ink-soft/10 rounded" />
            <div className="h-3 w-full bg-ink-soft/10 rounded" />
            <div className="h-3 w-5/6 bg-ink-soft/10 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** ResultCard 懒加载的占位. */
export function ResultLoadingFallback() {
  return (
    <div className="text-center py-12" role="status" aria-live="polite">
      <div
        className="w-20 h-20 rounded-full mx-auto mb-5 animate-pulse-soft"
        style={{ background: 'linear-gradient(135deg,#EAB6BC,#C86B77)' }}
        aria-hidden
      />
      <p className="text-ink-soft/70">正在生成你的分享卡…</p>
    </div>
  );
}
