// 教学资源导航页 — 图文/视频 tab 切换, 资源列表 + 详情.
// 由 looks_ready / tutorial_done 阶段进入.
// 管理模式: 可增删资源, 触发方式为底部长按或按钮切换.

import { useState, useEffect } from 'react';
import type { TeachingResource, TeachingResourceKind } from '../../shared/types';
import { fetchJson } from '../utils/fetch';
import AdminPanel from './AdminPanel';

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

    return () => { cancelled = true; };
  }, [lookId]);

  const filtered = resources.filter((r) => r.kind === tab);

  if (selectedResource) {
    return (
      <ResourceDetailView
        resource={selectedResource}
        onBack={() => setSelectedResource(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* 顶部导航 */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-ink-soft/70 hover:text-primary transition-colors"
        >
          ← 返回
        </button>
        <h2 className="font-serif text-lg font-bold text-ink">教学资源</h2>
        <button
          type="button"
          onClick={() => setIsAdmin((v) => !v)}
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

      {/* Tab 切换 */}
      <div className="flex gap-2 mb-4" role="tablist" aria-label="资源分类">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'article'}
          onClick={() => { setTab('article'); setSelectedResource(null); }}
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
          onClick={() => { setTab('video'); setSelectedResource(null); }}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            tab === 'video'
              ? 'bg-primary text-white shadow-sm'
              : 'bg-white/60 text-ink-soft/70 hover:bg-white/80'
          }`}
        >
          🎬 视频
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
              onClick={() => { if (!isAdmin) setSelectedResource(resource); }}
              onDelete={isAdmin ? async () => {
                try {
                  await fetchJson(`/api/teaching-resources/${resource.id}`, { method: 'DELETE' });
                  setResources((prev) => prev.filter((r) => r.id !== resource.id));
                } catch (err) {
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
  onClick,
  onDelete,
}: {
  resource: TeachingResource;
  isAdmin?: boolean;
  onClick: () => void;
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
          className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
          style={{ background: 'linear-gradient(135deg,#EAB6BC,#C86B77)' }}
        >
          {resource.kind === 'article' ? '📖' : '🎬'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium text-ink text-sm truncate flex-1">{resource.title}</div>
            {isAdmin && onDelete && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="text-xs text-red-400 hover:text-red-600 transition-colors flex-shrink-0"
                aria-label={`删除 ${resource.title}`}
              >
                🗑️
              </button>
            )}
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
  onBack,
}: {
  resource: TeachingResource;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* 顶部导航 */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-ink-soft/70 hover:text-primary transition-colors"
        >
          ← 返回
        </button>
        <h2 className="font-serif text-lg font-bold text-ink truncate px-2">
          {resource.title}
        </h2>
        <div className="w-10" />
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
