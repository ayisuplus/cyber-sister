import { useRef, useState, type ChangeEvent, type DragEvent, type ClipboardEvent } from 'react';
import { track } from '../../shared/analytics';
import { haptic } from '../utils/haptic';

const ACCEPT_TYPES = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function OnboardingView({ onImagePicked }: { onImagePicked: (file: File) => void }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      track('upload_reject', { reason: 'too_large', size: file.size });
      setError('图片太大啦，换个 10MB 以内的吧～');
      return;
    }
    const ok =
      file.type === 'image/jpeg' ||
      file.type === 'image/jpg' ||
      file.type === 'image/png' ||
      file.type === 'image/webp' ||
      /\.(jpe?g|png|webp)$/i.test(file.name);
    if (!ok) {
      track('upload_reject', { reason: 'wrong_type', type: file.type });
      setError('只支持 JPG / PNG / WebP 哦');
      return;
    }
    setError(null);
    onImagePicked(file);
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    pick(e.target.files?.[0]);
    e.target.value = '';
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    // 仅在离开整个 drop zone 时清除高亮
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragging(false);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      track('upload_via', { method: 'drop' });
      pick(file);
    }
  }

  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    const file = Array.from(e.clipboardData?.files ?? [])[0];
    if (!file) return;
    e.preventDefault();
    track('upload_via', { method: 'paste' });
    pick(file);
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPaste={onPaste}
      tabIndex={0}
      role="region"
      aria-label="上传自拍图片"
      aria-describedby="onboarding-help"
    >
      {/* Hero */}
      <div className="text-center mb-8">
        <div className="inline-flex chip-rose-solid mb-4 animate-pulse-soft">✨ AI 智能美妆</div>
        <h2 className="font-serif text-[28px] sm:text-[32px] font-bold text-ink leading-tight">
          找到最适合你的妆容
        </h2>
        <p className="text-ink-soft/80 mt-2 text-sm">三步拥有你的专属妆容方案</p>
      </div>

      {/* 三步骤预览 */}
      <ol className="space-y-4 mb-8" aria-label="使用流程">
        <Step n={1} title="拍一张正面照" desc="光线充足、表情自然，效果最好" />
        <Step n={2} title="AI 分析你的脸型" desc="三庭五眼、肤色、轮廓，一键读取" />
        <Step n={3} title="手把手教你画" desc="从底妆到唇色，跟着步骤一步步来" />
      </ol>

      {/* 上传按钮 + 拖拽/粘贴提示 */}
      <div
        className={`relative rounded-2xl border-2 border-dashed p-5 mb-4 transition-colors ${
          isDragging ? 'border-primary bg-primary/10' : 'border-ink-soft/30 bg-white/40'
        }`}
        aria-label={isDragging ? '松开以上传' : '拖拽图片到这里上传'}
      >
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => {
              haptic('select');
              cameraRef.current?.click();
            }}
            className="btn-primary w-full flex items-center justify-center gap-2 min-h-[48px] active:scale-[0.98] transition-transform"
            aria-label="拍照上传 (调用相机)"
          >
            <span aria-hidden>📷</span>
            <span>开始拍照</span>
          </button>
          <button
            type="button"
            onClick={() => {
              haptic('select');
              galleryRef.current?.click();
            }}
            className="btn-secondary w-full flex items-center justify-center gap-2 min-h-[48px] active:scale-[0.98] transition-transform"
            aria-label="从相册选择图片"
          >
            <span aria-hidden>🖼️</span>
            <span>从相册选择</span>
          </button>
        </div>
        <p id="onboarding-help" className="mt-4 text-xs text-ink-soft/60 text-center">
          也可以 <strong>拖拽</strong>图片到此处,或 <strong>Ctrl/⌘ + V</strong> 粘贴
        </p>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept={ACCEPT_TYPES}
        capture="user"
        onChange={onChange}
        className="hidden"
        aria-hidden
        tabIndex={-1}
      />
      <input
        ref={galleryRef}
        type="file"
        accept={ACCEPT_TYPES}
        onChange={onChange}
        className="hidden"
        aria-hidden
        tabIndex={-1}
      />

      {error && (
        <p
          role="alert"
          className="mt-4 text-sm text-primary text-center bg-primary/10 rounded-2xl py-2"
        >
          {error}
        </p>
      )}

      <p className="mt-6 text-xs text-ink-soft/60 text-center">
        🔒 图片仅在浏览器内分析，不会上传到服务器
      </p>
    </div>
  );
}

function Step({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <li className="flex items-start gap-3 relative">
      <div className="relative">
        <span className="step-num">{n}</span>
      </div>
      <div className="pt-1">
        <div className="font-semibold text-ink">{title}</div>
        <div className="text-sm text-ink-soft/70 mt-0.5">{desc}</div>
      </div>
      {n < 3 && (
        <div
          className="absolute left-[1.2rem] top-[2.5rem] bottom-[-1rem] w-px border-l-2 border-dashed"
          style={{ borderColor: 'rgba(200,107,119,0.25)' }}
        />
      )}
    </li>
  );
}
