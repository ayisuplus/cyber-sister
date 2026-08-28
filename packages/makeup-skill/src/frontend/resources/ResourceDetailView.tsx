import { useEffect, useRef } from 'react';
import type { TeachingResource } from '../../shared/types';
import { useSwipe } from '../hooks/useSwipe';
import { haptic } from '../utils/haptic';
import { Highlight } from './Highlight';
import { markdownToHtml } from './markdownToHtml';

export function ResourceDetailView({
  resource,
  isRead,
  bookmarked,
  onToggleBookmark,
  onBack,
}: {
  resource: TeachingResource;
  isRead?: boolean;
  bookmarked?: boolean;
  onToggleBookmark?: () => void;
  onBack: () => void;
}) {
  // 下滑关闭详情 (移动端) + Esc 关闭 (桌面)
  const detailRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        haptic('select');
        onBack();
      } else if (e.key === 'b' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        haptic('select');
        onBack();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);
  useSwipe(detailRef, {
    direction: 'vertical',
    threshold: 80,
    onSwipeDown: () => {
      haptic('select');
      onBack();
    },
  });
  return (
    <div className="space-y-4" ref={detailRef}>
      {/* 底部弹层风格的拖拽手柄: 顶部居中的 32px 细条 (WCAG: 至少 48dp 触摸区) */}
      <div className="flex justify-center -mt-2 mb-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="关闭详情"
          title="拖动下滑 / 点击关闭 / 按 Esc 关闭"
          className="w-12 min-h-[48px] flex items-center justify-center rounded-full active:bg-primary/10 transition-colors"
        >
          <span aria-hidden className="w-10 h-1.5 rounded-full bg-ink-soft/30" />
        </button>
      </div>
      {/* 顶部导航 */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={onBack}
          className="text-sm min-h-[44px] px-3 -ml-3 rounded-lg active:bg-primary/10 text-ink-soft/70 hover:text-primary transition-colors"
        >
          ← 返回
        </button>
        <h2 className="font-serif text-lg font-bold text-ink truncate px-2 flex-1">
          <Highlight text={resource.title} query="" />
        </h2>
        {onToggleBookmark && (
          <button
            type="button"
            onClick={onToggleBookmark}
            className={`text-xl min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full active:scale-90 transition-all flex-shrink-0 ${
              bookmarked ? 'text-amber-500' : 'text-ink-soft/40 hover:text-amber-400'
            }`}
            aria-label={bookmarked ? '取消收藏' : '收藏'}
            aria-pressed={bookmarked}
          >
            {bookmarked ? '★' : '☆'}
          </button>
        )}
        {isRead && <span className="text-xs text-emerald-600 flex-shrink-0">已读</span>}
      </div>

      {/* 标签 */}
      {resource.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-4">
          {resource.tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary/80"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* 视频预览 */}
      {resource.kind === 'video' && resource.videoUrl && (
        <div className="rounded-2xl overflow-hidden mb-4 bg-black/5">
          <iframe
            src={resource.videoUrl}
            className="w-full aspect-video"
            title={resource.title}
            allowFullScreen
          />
        </div>
      )}

      {/* 正文内容 */}
      {resource.body && (
        <div
          className="card-soft p-4 prose prose-sm max-w-none text-ink/85 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: markdownToHtml(resource.body) }}
        />
      )}

      {!resource.body && resource.kind === 'article' && (
        <div className="card-soft p-4 text-sm text-ink-soft/60">暂无详细内容</div>
      )}
    </div>
  );
}
