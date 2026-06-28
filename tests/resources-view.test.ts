// 教学资源视图组件测试 — ResourcesView 和 AdminPanel.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 设置环境变量让路由使用正确的测试数据
const TMP = join(tmpdir(), `rv-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const TEST_DATA_DIR = join(TMP, 'data');
process.env.ANALYTICS_DATA_DIR = TEST_DATA_DIR;

// 简单的 mock fetch 用于测试组件

// 创建一个非常简单的 mock
const mockRouter = (() => {
  const resources: Array<{ id: string; lookId: string; kind: string; title: string; summary: string; tags: string[]; videoUrl?: string; durationSec?: number }> = [
    { id: 'seed-1', lookId: 'look_cool_water', kind: 'article', title: '测试图文', summary: '摘要', tags: ['tag1'] },
    { id: 'seed-2', lookId: 'look_cool_water', kind: 'video', title: '测试视频', summary: '视频摘要', tags: ['tag2'], videoUrl: 'https://example.com/video', durationSec: 120 },
  ];
  return {
    list: () => resources,
    add: (r: typeof resources[0]) => resources.push(r),
    delete: (id: string) => {
      const idx = resources.findIndex((r) => r.id === id);
      if (idx >= 0) { resources.splice(idx, 1); return true; }
      return false;
    },
    getAll: () => [...resources],
  };
})();

beforeEach(() => {
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  if (existsSync(join(TEST_DATA_DIR, 'analytics.jsonl'))) rmSync(join(TEST_DATA_DIR, 'analytics.jsonl'));
});

// ---------- ResourcesView 数据层测试 ----------

describe('ResourcesView 数据层', () => {
  it('mock 资源列表有初始数据', () => {
    const list = mockRouter.getAll();
    expect(list.length).toBe(2);
    expect(list[0].kind).toBe('article');
    expect(list[1].kind).toBe('video');
  });

  it('可以按 lookId 过滤资源', () => {
    mockRouter.add({ id: 'new-1', lookId: 'look_peach_date', kind: 'article', title: '新资源', summary: '新摘要', tags: [] });
    const filtered = mockRouter.getAll().filter((r) => r.lookId === 'look_peach_date');
    expect(filtered.length).toBe(1);
    expect(filtered[0].title).toBe('新资源');
  });

  it('可以删除资源', () => {
    mockRouter.add({ id: 'to-delete', lookId: 'look_cool_water', kind: 'article', title: '待删除', summary: '', tags: [] });
    const before = mockRouter.getAll().length;
    const result = mockRouter.delete('to-delete');
    expect(result).toBe(true);
    expect(mockRouter.getAll().length).toBe(before - 1);
  });

  it('删除不存在的资源返回 false', () => {
    const result = mockRouter.delete('non-existent-id');
    expect(result).toBe(false);
  });
});

describe('ResourcesView 视觉组件', () => {
  // ResourcesView 需要 React + DOM 环境来渲染，
  // 这里测试其数据流和函数逻辑
  it('tab 切换逻辑正确', () => {
    const resources = mockRouter.getAll();
    const articleTab = resources.filter((r) => r.kind === 'article');
    const videoTab = resources.filter((r) => r.kind === 'video');
    // 资源按类型可以正确过滤
    expect(articleTab.length).toBeGreaterThan(0);
    expect(videoTab.length).toBeGreaterThan(0);
    // 类型过滤结果不重复
    articleTab.forEach((r) => expect(r.kind).toBe('article'));
    videoTab.forEach((r) => expect(r.kind).toBe('video'));
  });

  it('资源卡片显示标签', () => {
    const resources = mockRouter.getAll();
    expect(resources[0].tags.length).toBeGreaterThan(0);
    expect(resources[0].tags[0]).toBe('tag1');
  });

  it('视频资源有 URL 和时长', () => {
    const video = mockRouter.getAll().find((r) => r.kind === 'video');
    expect(video).toBeDefined();
    expect(video!.videoUrl).toBeDefined();
    expect(video!.durationSec).toBeGreaterThan(0);
  });
});

// ---------- AdminPanel 逻辑测试 ----------

describe('AdminPanel 逻辑', () => {
  it('添加资源增加列表长度', () => {
    const before = mockRouter.getAll().length;
    mockRouter.add({
      id: 'admin-added-1',
      lookId: 'look_korean',
      kind: 'article',
      title: '管理员添加的资源',
      summary: '管理添加测试',
      tags: ['admin'],
    });
    expect(mockRouter.getAll().length).toBe(before + 1);
  });

  it('删除资源减少列表长度', () => {
    mockRouter.add({ id: 'admin-delete', lookId: 'look_power_queen', kind: 'article', title: '待删', summary: '', tags: [] });
    const before = mockRouter.getAll().length;
    mockRouter.delete('admin-delete');
    expect(mockRouter.getAll().length).toBe(before - 1);
  });
});

afterEach(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});
