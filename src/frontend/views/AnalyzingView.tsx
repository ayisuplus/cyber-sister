export function AnalyzingView() {
  return (
    <div className="py-12 text-center">
      <div className="relative w-24 h-24 mx-auto mb-6">
        <div
          className="absolute inset-0 rounded-full animate-spin-slow"
          style={{
            background: 'conic-gradient(from 0deg, #EAB6BC, #C86B77, #EAB6BC)',
            mask: 'radial-gradient(circle, transparent 55%, black 56%)',
            WebkitMask: 'radial-gradient(circle, transparent 55%, black 56%)',
          }}
        />
        <div className="absolute inset-2 rounded-full bg-white/80 backdrop-blur flex items-center justify-center text-3xl">
          🪞
        </div>
      </div>
      <p className="font-serif text-xl text-ink">正在分析你的五官…</p>
      <p className="text-xs text-ink-soft/60 mt-2">AI 在仔细看每一处细节</p>
    </div>
  );
}
