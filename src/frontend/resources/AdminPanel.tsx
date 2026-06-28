// 教学资源管理面板 — 用于添加和删除教学资源.
// 触发方式: 在 ResourcesView 中长按 "妆语" logo 触发.

import { useState } from 'react';
import type { TeachingResource, TeachingResourceKind } from '../../shared/types';
import { fetchJson } from '../utils/fetch';

// ---------- 类型 ----------

interface CreateResourcePayload {
  lookId: string;
  kind: TeachingResourceKind;
  title: string;
  summary: string;
  body?: string;
  coverImage?: string;
  videoUrl?: string;
  durationSec?: number;
  author?: string;
  tags: string[];
}

// ---------- 组件 ----------

export default function AdminPanel({
  onRefresh,
  onClose,
}: {
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [addingError, setAddingError] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateResourcePayload>({
    lookId: '',
    kind: 'article',
    title: '',
    summary: '',
    tags: [],
  });
  const [tagsInput, setTagsInput] = useState('');

  // 添加资源
  async function handleAdd() {
    setIsAdding(true);
    setAddingError(null);

    try {
      await fetchJson<TeachingResource>('/api/teaching-resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, tags: tagsInput }),
      });

      // 清空表单
      setFormData({
        lookId: '',
        kind: 'article',
        title: '',
        summary: '',
        tags: [],
      });
      setTagsInput('');
      onRefresh();
    } catch (err) {
      setAddingError(err instanceof Error ? err.message : '添加失败');
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-serif text-lg font-bold text-primary">资源管理</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-ink-soft/70 hover:text-primary"
        >
          ✕ 退出管理
        </button>
      </div>

      {/* 添加资源表单 */}
      <div className="card-soft p-4 space-y-3">
        <h4 className="font-medium text-ink text-sm">添加新资源</h4>

        {/* 资源类型 */}
        <div>
          <label className="block text-xs text-ink-soft/60 mb-1">资源类型</label>
          <select
            value={formData.kind}
            onChange={(e) => setFormData((prev) => ({ ...prev, kind: e.target.value as TeachingResourceKind }))}
            className="w-full px-3 py-2 rounded-xl text-sm bg-white/80 border border-primary/20 focus:outline-none focus:border-primary"
          >
            <option value="article">📖 图文</option>
            <option value="video">🎬 视频</option>
          </select>
        </div>

        {/* 标题 */}
        <div>
          <label className="block text-xs text-ink-soft/60 mb-1">标题</label>
          <input
            type="text"
            value={formData.title}
            onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="资源标题"
            className="w-full px-3 py-2 rounded-xl text-sm bg-white/80 border border-primary/20 focus:outline-none focus:border-primary"
          />
        </div>

        {/* 摘要 */}
        <div>
          <label className="block text-xs text-ink-soft/60 mb-1">摘要</label>
          <input
            type="text"
            value={formData.summary}
            onChange={(e) => setFormData((prev) => ({ ...prev, summary: e.target.value }))}
            placeholder="简短描述"
            className="w-full px-3 py-2 rounded-xl text-sm bg-white/80 border border-primary/20 focus:outline-none focus:border-primary"
          />
        </div>

        {/* 视频 URL */}
        {formData.kind === 'video' && (
          <div>
            <label className="block text-xs text-ink-soft/60 mb-1">视频 URL</label>
            <input
              type="url"
              value={formData.videoUrl ?? ''}
              onChange={(e) => setFormData((prev) => ({ ...prev, videoUrl: e.target.value }))}
              placeholder="https://..."
              className="w-full px-3 py-2 rounded-xl text-sm bg-white/80 border border-primary/20 focus:outline-none focus:border-primary"
            />
          </div>
        )}

        {/* 正文内容 (图文) */}
        {formData.kind === 'article' && (
          <div>
            <label className="block text-xs text-ink-soft/60 mb-1">正文内容 (支持 Markdown)</label>
            <textarea
              value={formData.body ?? ''}
              onChange={(e) => setFormData((prev) => ({ ...prev, body: e.target.value }))}
              placeholder="## 标题\n\n正文内容..."
              rows={6}
              className="w-full px-3 py-2 rounded-xl text-sm bg-white/80 border border-primary/20 focus:outline-none focus:border-primary font-mono"
            />
          </div>
        )}

        {/* 标签 */}
        <div>
          <label className="block text-xs text-ink-soft/60 mb-1">标签 (逗号分隔)</label>
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="底妆, 通勤, 韩系"
            className="w-full px-3 py-2 rounded-xl text-sm bg-white/80 border border-primary/20 focus:outline-none focus:border-primary"
          />
        </div>

        {/* 作者 */}
        <div>
          <label className="block text-xs text-ink-soft/60 mb-1">作者</label>
          <input
            type="text"
            value={formData.author ?? ''}
            onChange={(e) => setFormData((prev) => ({ ...prev, author: e.target.value }))}
            placeholder="作者名称"
            className="w-full px-3 py-2 rounded-xl text-sm bg-white/80 border border-primary/20 focus:outline-none focus:border-primary"
          />
        </div>

        {/* 错误提示 */}
        {addingError && (
          <div className="text-xs text-red-500 bg-red-50 rounded-xl p-2">{addingError}</div>
        )}

        {/* 提交按钮 */}
        <button
          type="button"
          onClick={handleAdd}
          disabled={isAdding || !formData.title}
          className="btn-primary w-full py-2 text-sm disabled:opacity-50"
        >
          {isAdding ? '添加中...' : '添加资源'}
        </button>
      </div>
    </div>
  );
}

// ---------- 用于在 ResourcesView 中显示资源的删除按钮 ----------

export function AdminDeleteButton({
  resourceId,
  onDelete,
}: {
  resourceId: string;
  onDelete: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onDelete(resourceId);
      }}
      className="text-xs text-red-400 hover:text-red-600 transition-colors"
      aria-label="删除资源"
    >
      🗑️ 删除
    </button>
  );
}
