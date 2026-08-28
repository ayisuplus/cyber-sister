export function ErrorView({
  message,
  recoverable,
  onRetry,
}: {
  message: string;
  recoverable: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="py-10 text-center">
      <div
        className="w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center text-4xl"
        style={{ background: 'rgba(234,182,188,0.4)' }}
      >
        🥺
      </div>
      <p className="font-serif text-lg text-ink mb-6 px-4">{message}</p>
      {recoverable && (
        <button type="button" onClick={onRetry} className="btn-primary">
          再试一次
        </button>
      )}
    </div>
  );
}
