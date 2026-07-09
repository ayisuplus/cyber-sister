export function LoadingModelView({ progress }: { progress: number }) {
  return (
    <div className="py-10 text-center">
      <div className="relative w-24 h-24 mx-auto mb-6">
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary-soft to-primary animate-pulse-soft" />
        <div className="absolute inset-2 rounded-full bg-white/80 backdrop-blur flex items-center justify-center text-3xl">
          💄
        </div>
        <div
          className="absolute inset-0 rounded-full border-2 border-dashed animate-spin-slow"
          style={{ borderColor: 'rgba(200,107,119,0.3)' }}
        />
      </div>
      <p className="font-serif text-xl text-ink mb-2">正在准备化妆台…</p>
      <p className="text-xs text-ink-soft/60 mb-6">首次加载会下载 AI 模型,请稍等</p>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <p className="text-xs text-primary mt-2 font-medium">{Math.round(progress * 100)}%</p>
    </div>
  );
}
