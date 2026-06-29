// 教学资源导航页 — 图文/视频 tab 切换, 资源列表 + 详情.
// 由 looks_ready / tutorial_done 阶段进入.
// 管理模式: 可增删资源, 触发方式为底部长按或按钮切换.

import { useState, useEffect, useTransition, useDeferredValue, useCallback, useRef } from 'react';
import type { TeachingResource, TeachingResourceKind } from '../../shared/types';
import { fetchJson } from '../utils/fetch';
import { haptic } from '../utils/haptic';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import AdminPanel from './AdminPanel';
import {
  isBookmarked,
  isRead,
  markRead,
  toggleBookmark,
} from './userPrefs';

// ---------- 类型 ----------

interface ResourcesListResponse {
  resources: TeachingResource[];
}

// ---------- 主组件 ----------

export default function ResourcesView({
  lookId,
  onBack,
}: {
  lookId: string;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<TeachingResourceKind>('article');
  const [showBookmarks, setShowBookmarks] = useState(false);
  // useTransition 让 tab/收藏过滤切换非阻塞: 视觉立即响应, 列表过滤可稍后完成
  const [, startTabTransition] = useTransition();
  const [bookmarkTick, setBookmarkTick] = useState(0);
  const [readTick, setReadTick] = useState(0);
  const [resources, setResources] = useState<TeachingResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedResource, setSelectedResource] = useState<TeachingResource | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // 获取资源列表
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedResource(null);

    function onStorage(e: StorageEvent) {
      if (e.key === 'zw:bookmarks') setBookmarkTick((n) => n + 1);
      if (e.key === 'zw:read') setReadTick((n) => n + 1);
    }
    window.addEventListener('storage', onStorage);

    const params = new URLSearchParams({ lookId: lookId || '' });
    fetchJson<ResourcesListResponse>(`/api/teaching-resources?${params}`)
      .then((data) => {
        if (!cancelled) {
          setResources(data.resources ?? []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载失败');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      window.removeEventListener('storage', onStorage);
    };
  }, [lookId]);

  // 手动刷新 (供下拉刷新 / 标签页切回 时调用)
  const refreshList = useCallback(async () => {
    try {
      const params = new URLSearchParams({ lookId: lookId || '' });
      const data = await fetchJson<ResourcesListResponse>(`/api/teaching-resources?${params}`);
      setResources(data.resources ?? []);
    } catch (err) {
      console.warn('refresh failed', err);
    }
  }, [lookId]);

  // 下拉刷新 (移动端)
  const pull = usePullToRefresh({
    onRefresh: async () => {
      haptic('success');
      await refreshList();
    },
    disabled: loading,
  });

  // 读 bookmarkTick / readTick 触发 React re-render 同步 localStorage 状态.
  void bookmarkTick; void readTick;
  // useDeferredValue: 资源量大时过滤计算推迟到空闲时间, 不阻塞切换动画
  const filterInputs = { tab, showBookmarks, n: resources.length };
  const deferredFilter = useDeferredValue(filterInputs);
  const filtered = resources.filter((r) => {
    if (r.kind !== deferredFilter.tab) return false;
    if (deferredFilter.showBookmarks && !isBookmarked(r.id)) return false;
    return true;
  });

  if (selectedResource) {
    return (
      <ResourceDetailView
        resource={selectedResource}
        bookmarked={isBookmarked(selectedResource.id)}
        isRead={isRead(selectedResource.id)}
        onToggleBookmark={() => {
          const added = toggleBookmark(selectedResource.id);
          haptic(added ? 'success' : 'tap');
          setBookmarkTick((n) => n + 1);
        }}
        onBack={() => setSelectedResource(null)}
      />
    );
  }

  return (
    <div
      className="space-y-4 overflow-y-auto overscroll-y-contain"
      ref={pull.ref}
      style={{ maxHeight: 'calc(100vh - 200px)' }}
    >
      {/* 下拉刷新指示器 */}
      {pull.pullDistance > 0 && (
        <div
          className="flex items-center justify-center text-ink-soft/60 text-xs select-none"
          style={{
            height: pull.pullDistance,
            opacity: Math.min(1, pull.pullDistance / 40),
            transition: pull.isRefreshing ? 'height 200ms ease-out' : 'none',
          }}
          aria-live="polite"
        >
          {pull.isRefreshing ? (
            <span>刷新中…</span>
          ) : pull.pullDistance >= 70 ? (
            <span>松开刷新</span>
          ) : (
            <span>↓ 继续下拉</span>
          )}
        </div>
      )}
      {/* 顶部导航 */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={onBack}
          className="text-sm min-h-[44px] px-3 -ml-3 rounded-lg active:bg-primary/10 text-ink-soft/70 hover:text-primary transition-colors"
        >
          ← 返回
        </button>
        <h2 className="font-serif text-lg font-bold text-ink">教学资源</h2>
        <button
          type="button"
          onClick={() => { setIsAdmin((v) => !v); haptic('select'); }}
          className={`text-xs px-2 py-1 rounded-lg transition-colors ${
            isAdmin
              ? 'bg-primary text-white'
              : 'text-ink-soft/50 hover:text-ink-soft/80'
          }`}
          title="长按可进入管理模式"
        >
          {isAdmin ? '管理中' : '⚙'}
        </button>
      </div>

      {/* 管理面板 */}
      {isAdmin && (
        <AdminPanel
          onRefresh={() => {
            // 刷新列表
            setLoading(true);
            const params = new URLSearchParams({ lookId: lookId || '' });
            fetchJson<ResourcesListResponse>(`/api/teaching-resources?${params}`)
              .then((data) => {
                setResources(data.resources ?? []);
                setLoading(false);
              })
              .catch(() => { setLoading(false); });
          }}
          onClose={() => setIsAdmin(false)}
        />
      )}

      {/* 分类切换 + 收藏过滤 */}
      <div className="flex items-center justify-between gap-2 mb-4" role="tablist" aria-label="资源分类">
        <div className="flex gap-2">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'article'}
            onClick={() => { startTabTransition(() => { setTab('article'); setSelectedResource(null); }); haptic('select'); }}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              tab === 'article'
                ? 'bg-primary text-white shadow-sm'
                : 'bg-white/60 text-ink-soft/70 hover:bg-white/80'
            }`}
          >
            📖 图文
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'video'}
            onClick={() => { startTabTransition(() => { setTab('video'); setSelectedResource(null); }); haptic('select'); }}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              tab === 'video'
                ? 'bg-primary text-white shadow-sm'
                : 'bg-white/60 text-ink-soft/70 hover:bg-white/80'
            }`}
          >
            🎬 视频
          </button>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={showBookmarks}
          aria-label="只显示收藏的资源"
          onClick={() => { startTabTransition(() => { setShowBookmarks((v) => !v); }); haptic('select'); }}
          className={`px-3 py-2 rounded-xl text-sm transition-colors ${
            showBookmarks
              ? 'bg-primary text-white shadow-sm'
              : 'bg-white/60 text-ink-soft/70 hover:bg-white/80'
          }`}
        >
          {showBookmarks ? '★ 仅收藏' : '☆ 仅收藏'}
        </button>
      </div>

      {/* 资源列表 */}
      {loading && (
        <div className="text-center py-12 text-ink-soft/60">加载中...</div>
      )}

      {error && (
        <div className="text-center py-8 text-sm text-red-500">{error}</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-12 text-ink-soft/60">
          暂无{tab === 'article' ? '图文' : '视频'}资源
          {isAdmin && <span className="text-primary"> (点击上方 + 添加)</span>}
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((resource) => (
            <ResourceCard
              key={resource.id}
              resource={resource}
              isAdmin={isAdmin}
              bookmarked={isBookmarked(resource.id)}
              isRead={isRead(resource.id)}
              onClick={() => {
                if (!isAdmin) {
                  markRead(resource.id);
                  setReadTick((n) => n + 1);
                  setSelectedResource(resource);
                }
              }}
              onToggleBookmark={() => {
                const added = toggleBookmark(resource.id);
                haptic(added ? 'success' : 'tap');
                setBookmarkTick((n) => n + 1);
              }}
              onDelete={isAdmin ? async () => {
                if (!window.confirm(`确定删除「${resource.title}」?`)) return;
                haptic('tap');
                try {
                  await fetchJson(`/api/teaching-resources/${resource.id}`, { method: 'DELETE' });
                  haptic('success');
                  setResources((prev) => prev.filter((r) => r.id !== resource.id));
                } catch (err) {
                  haptic('error');
                  console.error('删除失败:', err);
                }
              } : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- 资源卡片 ----------

function ResourceCard({
  resource,
  isAdmin,
  bookmarked,
  isRead,
  onClick,
  onToggleBookmark,
  onDelete,
}: {
  resource: TeachingResource;
  isAdmin?: boolean;
  bookmarked?: boolean;
  isRead?: boolean;
  onClick: () => void;
  onToggleBookmark?: () => void;
  onDelete?: () => void;
}) {
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
          {isRead && (
            <span
              className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-white"
              aria-label="已读"
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium text-ink text-sm truncate flex-1">{resource.title}</div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {!isAdmin && onToggleBookmark && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onToggleBookmark(); }}
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
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="text-sm min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full active:scale-90 text-red-400 hover:text-red-600 transition-all flex-shrink-0"
                  aria-label={`删除 ${resource.title}`}
                >
                  🗑️
                </button>
              )}
            </div>
          </div>
          <div className="text-xs text-ink-soft/60 mt-1 line-clamp-2">
            {resource.summary}
          </div>
          {resource.author && (
            <div className="text-[10px] text-ink-soft/50 mt-2">
              {resource.author}
              {resource.durationSec != null && resource.durationSec > 0 && (
                <span> · {Math.floor(resource.durationSec / 60)}:{String(resource.durationSec % 60).padStart(2, '0')}</span>
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

// ---------- 资源详情 ----------

function ResourceDetailView({
  resource,
  isRead,
  onToggleBookmark,
  bookmarked,
  onBack,
}: {
  resource: TeachingResource;
  isRead?: boolean;
  bookmarked?: boolean;
  onToggleBookmark?: () => void;
  onBack: () => void;
}) {
  // 下滑关闭详情 (移动端)
  const detailRef = useRef<HTMLDivElement | null>(null);
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
          {resource.title}
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
        {isRead && (
          <span className="text-xs text-emerald-600 flex-shrink-0">已读</span>
        )}
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
        <div className="card-soft p-4 text-sm text-ink-soft/60">
          暂无详细内容
        </div>
      )}
    </div>
  );
}

// ---------- 简易 Markdown → HTML 转换 ----------

function markdownToHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3 class="font-semibold text-ink mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="font-serif font-bold text-ink text-lg mb-3">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="font-serif font-bold text-ink text-xl mb-4">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 mb-1 list-disc">$1</li>')
    .replace(/(<li[^>]*>.*<\/li>\n?)+/g, (m) => `<ul class="my-2">${m}</ul>`)
    .replace(/\n\n+/g, '</p><p class="mb-2">')
    .replace(/\n/g, '<br/>');
}
