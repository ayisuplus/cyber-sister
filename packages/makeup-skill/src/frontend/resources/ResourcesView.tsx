// 教学资源导航页 — 图文/视频 tab 切换, 资源列表 + 详情.
// 由 looks_ready / tutorial_done 阶段进入.
// 管理模式: 可增删资源, 触发方式为底部长按或按钮切换.

import { useState, useEffect, useTransition, useDeferredValue, useCallback } from 'react';
import type { TeachingResource, TeachingResourceKind } from '../../shared/types';
import { fetchJson } from '../utils/fetch';
import { haptic } from '../utils/haptic';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { isBookmarked, isRead, markRead, toggleBookmark } from './userPrefs';
import { ResourceCard } from './ResourceCard';
import { ResourceDetailView } from './ResourceDetailView';

// ---------- 类型 ----------

interface ResourcesListResponse {
  resources: TeachingResource[];
}

// ---------- 主组件 ----------

export default function ResourcesView({ lookId, onBack }: { lookId: string; onBack: () => void }) {
  const [tab, setTab] = useState<TeachingResourceKind>('article');
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // useTransition 让 tab/收藏过滤切换非阻塞: 视觉立即响应, 列表过滤可稍后完成
  const [, startTabTransition] = useTransition();
  const [bookmarkTick, setBookmarkTick] = useState(0);
  const [readTick, setReadTick] = useState(0);
  const [resources, setResources] = useState<TeachingResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedResource, setSelectedResource] = useState<TeachingResource | null>(null);

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
    } catch {
      // 保留现有列表，避免记录可能含请求配置的错误对象。
    }
  }, [lookId]);

  // 下拉刷新 (移动端)
  const pull = usePullToRefresh<HTMLDivElement>({
    onRefresh: async () => {
      haptic('success');
      await refreshList();
    },
    disabled: loading,
  });

  // 读 bookmarkTick / readTick 触发 React re-render 同步 localStorage 状态.
  void bookmarkTick;
  void readTick;
  // useDeferredValue: 资源量大时过滤计算推迟到空闲时间, 不阻塞切换动画 + 搜索
  const filterInputs = { tab, showBookmarks, searchQuery, n: resources.length };
  const deferredFilter = useDeferredValue(filterInputs);
  // 搜索词预先 trim + 转小写, 避免每个资源都做
  const q = deferredFilter.searchQuery.trim().toLowerCase();
  const filtered = resources.filter((r) => {
    if (r.kind !== deferredFilter.tab) return false;
    if (deferredFilter.showBookmarks && !isBookmarked(r.id)) return false;
    if (q) {
      // 搜索 title / summary / tags
      if (
        !r.title.toLowerCase().includes(q) &&
        !r.summary.toLowerCase().includes(q) &&
        !r.tags.some((t) => t.toLowerCase().includes(q))
      ) {
        return false;
      }
    }
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
        <h2 className="font-serif text-lg font-bold text-ink px-2">教学资源</h2>
        <span className="min-w-[44px]" aria-hidden="true" />
      </div>

      {/* 搜索框 */}
      <div className="mb-3 relative">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索标题、摘要、标签…"
          aria-label="搜索资源"
          className="w-full min-h-[44px] pl-10 pr-10 rounded-xl bg-white/60 border border-primary/20 text-sm text-ink placeholder:text-ink-soft/50 focus:outline-none focus:border-primary focus:bg-white/80 transition-colors"
        />
        <span
          className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft/50 pointer-events-none"
          aria-hidden
        >
          🔍
        </span>
        {searchQuery && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              haptic('tap');
            }}
            aria-label="清空搜索"
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full text-ink-soft/60 hover:bg-primary/10 active:scale-90 transition-all"
          >
            ✕
          </button>
        )}
      </div>

      {/* 分类切换 + 收藏过滤 */}
      <div
        className="flex items-center justify-between gap-2 mb-4"
        role="tablist"
        aria-label="资源分类"
      >
        <div className="flex gap-2">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'article'}
            onClick={() => {
              startTabTransition(() => {
                setTab('article');
                setSelectedResource(null);
              });
              haptic('select');
            }}
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
            onClick={() => {
              startTabTransition(() => {
                setTab('video');
                setSelectedResource(null);
              });
              haptic('select');
            }}
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
          onClick={() => {
            startTabTransition(() => {
              setShowBookmarks((v) => !v);
            });
            haptic('select');
          }}
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
      {loading && <div className="text-center py-12 text-ink-soft/60">加载中...</div>}

      {error && <div className="text-center py-8 text-sm text-red-500">{error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-12 text-ink-soft/60">
          {searchQuery ? (
            <>
              没找到匹配「{searchQuery}」的资源
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  haptic('tap');
                }}
                className="block mx-auto mt-3 text-xs text-primary hover:underline active:scale-95 transition-transform"
              >
                清空搜索
              </button>
            </>
          ) : (
            <>
              暂无{tab === 'article' ? '图文' : '视频'}资源
            </>
          )}
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((resource) => (
            <ResourceCard
              key={resource.id}
              resource={resource}
              searchQuery={searchQuery}
              onClick={() => {
                markRead(resource.id);
                setReadTick((n) => n + 1);
                setSelectedResource(resource);
              }}
              onBookmarkTick={() => setBookmarkTick((n) => n + 1)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
