export function TutorialDoneView({ lookName }: { lookName: string }) {
  return (
    <div className="py-12 text-center">
      <div
        className="w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center text-4xl animate-glow"
        style={{ background: 'linear-gradient(135deg,#EAB6BC,#C86B77)' }}
      >
        🎉
      </div>
      <h2 className="font-serif text-2xl font-bold text-ink mb-2">恭喜完成 {lookName}！</h2>
      <p className="text-ink-soft/70">正在准备你的专属分享卡…</p>
      <div className="mt-6 mx-auto w-32 progress-track">
        <div
          className="progress-fill animate-shimmer"
          style={{
            background: 'linear-gradient(90deg,#EAB6BC 0%,#C86B77 50%,#EAB6BC 100%)',
            backgroundSize: '200% 100%',
            width: '100%',
          }}
        />
      </div>
    </div>
  );
}
