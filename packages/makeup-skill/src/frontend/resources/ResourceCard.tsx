import type { TeachingResource } from '../../shared/types';
import { haptic } from '../utils/haptic';
import { Highlight } from './Highlight';
import { isBookmarked, isRead, toggleBookmark } from './userPrefs';

export function ResourceCard({
  resource,
  isAdmin,
  searchQuery,
  onClick,
  onDelete,
  onBookmarkTick,
}: {
  resource: TeachingResource;
  isAdmin?: boolean;
  searchQuery?: string;
  onClick: () => void;
  onDelete?: () => void;
  onBookmarkTick?: () => void;
}) {
  const bookmarked = isBookmarked(resource.id);
  const read = isRead(resource.id);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left p-4 rounded-2xl bg-white/60 backdrop-blur
                 border border-primary/10 hover:border-primary/30
                 transition-all hover:shadow-sm relative"
    >
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 relative"
          style={{ background: 'linear-gradient(135deg,#EAB6BC,#C86B77)' }}
        >
          {resource.kind === 'article' ? '📖' : '🎬'}
          {read && (
            <span
              className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-white"
              aria-label="已读"
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium text-ink text-sm truncate flex-1">
              <Highlight text={resource.title} query={searchQuery ?? ''} />
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {!isAdmin && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const added = toggleBookmark(resource.id);
                    haptic(added ? 'success' : 'tap');
                    onBookmarkTick?.();
                  }}
                  className={`text-base min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full active:scale-90 transition-all ${
                    bookmarked ? 'text-amber-500' : 'text-ink-soft/30 hover:text-amber-400'
                  }`}
                  aria-label={bookmarked ? '取消收藏' : '收藏'}
                  aria-pressed={bookmarked}
                >
                  {bookmarked ? '★' : '☆'}
                </button>
              )}
              {isAdmin && onDelete && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="text-sm min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full active:scale-90 text-red-400 hover:text-red-600 transition-all flex-shrink-0"
                  aria-label={`删除 ${resource.title}`}
                >
                  🗑️
                </button>
              )}
            </div>
          </div>
          <div className="text-xs text-ink-soft/60 mt-1 line-clamp-2">
            <Highlight text={resource.summary} query={searchQuery ?? ''} />
          </div>
          {resource.author && (
            <div className="text-[10px] text-ink-soft/50 mt-2">
              {resource.author}
              {resource.durationSec != null && resource.durationSec > 0 && (
                <span>
                  {' '}
                  · {Math.floor(resource.durationSec / 60)}:
                  {String(resource.durationSec % 60).padStart(2, '0')}
                </span>
              )}
            </div>
          )}
        </div>
        {!isAdmin && <div className="text-ink-soft/40 text-lg flex-shrink-0 pt-1">›</div>}
      </div>
      {resource.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
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
    </button>
  );
}
