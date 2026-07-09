export function ReadyView({
  previewUrl,
  onRetake,
  onAnalyze,
}: {
  previewUrl: string;
  onRetake: () => void;
  onAnalyze: () => void;
}) {
  return (
    <div>
      <div className="text-center mb-4">
        <h2 className="font-serif text-xl text-ink">确认这张照片 ✨</h2>
        <p className="text-sm text-ink-soft/70 mt-1">光线清晰、脸部可见,效果更好</p>
      </div>
      <div className="relative mb-6">
        <div className="card-soft p-2 inline-block w-full">
          <img
            src={previewUrl}
            alt="自拍预览"
            className="mx-auto rounded-[20px] max-h-80 w-full object-contain"
          />
        </div>
      </div>
      <div className="space-y-3">
        <button
          type="button"
          onClick={onAnalyze}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          <span>开始分析</span>
          <span>✨</span>
        </button>
        <button type="button" onClick={onRetake} className="btn-secondary w-full">
          重选一张
        </button>
      </div>
    </div>
  );
}
