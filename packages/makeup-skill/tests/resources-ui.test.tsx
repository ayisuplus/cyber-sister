// 教学资源 UI 测试 — ResourcesView / AdminPanel / ResourceCard / ResourceDetailView /
// Highlight 组件 / markdownToHtml / userPrefs 边界.
//
// 无 jsdom: 组件用 renderToStaticMarkup (SSR) 验证渲染分支;
// 需要注入组件内部状态时, 通过 vi.mock('react') 包裹真实 hooks 并按初始值特征覆盖.
// 事件处理函数 (如 AdminPanel.handleAdd) 通过直接调用组件函数 + 遍历返回的
// 元素树触发 onClick, hooks 由 shim 兜底 (stateful), 不依赖 DOM.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TeachingResource } from '../src/shared/types';

// ---------- React hooks shim (SSR 下委托真实实现; 直接调用组件时兜底) ----------

const h = vi.hoisted(() => ({
  overrides: [] as Array<{ pred: (v: unknown) => boolean; value: unknown; consumed: boolean }>,
  states: [] as unknown[],
  cursor: 0,
  contextValue: null as unknown,
  captureEffects: false,
  effects: [] as Array<() => unknown>,
  pullOptions: null as { onRefresh: () => void | Promise<void> } | null,
  swipeOptions: null as { onSwipeDown?: () => void } | null,
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const takeOverride = (init: unknown): unknown => {
    const o = h.overrides.find((x) => !x.consumed && x.pred(init));
    if (o) {
      o.consumed = true;
      return o.value;
    }
    return init;
  };
  return {
    ...actual,
    useState: (init: unknown) => {
      const v = takeOverride(init);
      try {
        return actual.useState(v as never);
      } catch {
        // 无 dispatcher (直接调用组件函数): stateful 兜底
        const idx = h.cursor++;
        h.states[idx] = typeof v === 'function' ? (v as () => unknown)() : v;
        return [
          h.states[idx],
          (nv: unknown) => {
            h.states[idx] =
              typeof nv === 'function' ? (nv as (p: unknown) => unknown)(h.states[idx]) : nv;
          },
        ];
      }
    },
    useEffect: (fn: () => void, deps?: unknown) => {
      try {
        return (actual.useEffect as (f: () => void, d?: unknown) => void)(fn, deps);
      } catch {
        // 无 dispatcher (直接调用组件): 按需捕获 effect 供手动触发
        if (h.captureEffects) h.effects.push(fn);
      }
    },
    useMemo: (fn: () => unknown, deps?: unknown) => {
      try {
        return actual.useMemo(fn, deps as never);
      } catch {
        return fn();
      }
    },
    useCallback: (fn: unknown, deps?: unknown) => {
      try {
        return actual.useCallback(fn as never, deps as never);
      } catch {
        return fn;
      }
    },
    useRef: (init: unknown) => {
      try {
        return actual.useRef(init);
      } catch {
        return { current: init };
      }
    },
    useContext: (ctx: unknown) => {
      try {
        return actual.useContext(ctx as never);
      } catch {
        return h.contextValue;
      }
    },
    useTransition: () => {
      try {
        return actual.useTransition();
      } catch {
        return [false, (fn?: () => void) => fn?.()];
      }
    },
    useDeferredValue: (v: unknown) => {
      try {
        return (actual as unknown as { useDeferredValue: (x: unknown) => unknown }).useDeferredValue(v);
      } catch {
        return v;
      }
    },
  };
});

vi.mock('../src/frontend/utils/haptic', () => ({
  haptic: vi.fn(() => true),
  isHapticSupported: () => false,
}));
vi.mock('../src/frontend/utils/fetch', () => ({
  fetchJson: vi.fn(),
}));

// usePullToRefresh / useSwipe 是独立测试过的手势 hooks (usePullToRefresh.test? / useSwipe.test.ts),
// 这里仅捕获传入的回调, 便于触发组件侧的分支 (refreshList / 下滑关闭).
vi.mock('../src/frontend/hooks/usePullToRefresh', () => ({
  usePullToRefresh: (opts: { onRefresh: () => void | Promise<void> }) => {
    h.pullOptions = opts;
    return { pullDistance: 0, isRefreshing: false, ref: { current: null } };
  },
}));

vi.mock('../src/frontend/hooks/useSwipe', () => ({
  useSwipe: (_ref: unknown, opts: { onSwipeDown?: () => void }) => {
    h.swipeOptions = opts;
  },
}));

import ResourcesView from '../src/frontend/resources/ResourcesView';
import AdminPanel, { AdminDeleteButton } from '../src/frontend/resources/AdminPanel';
import { ResourceCard } from '../src/frontend/resources/ResourceCard';
import { ResourceDetailView } from '../src/frontend/resources/ResourceDetailView';
import { Highlight } from '../src/frontend/resources/Highlight';
import { markdownToHtml } from '../src/frontend/resources/markdownToHtml';
import {
  getBookmarks,
  getReadIds,
  isBookmarked,
  isRead,
  markRead,
  toggleBookmark,
} from '../src/frontend/resources/userPrefs';
import { ToastProvider } from '../src/frontend/components/Toast';
import { fetchJson } from '../src/frontend/utils/fetch';

const fetchJsonMock = vi.mocked(fetchJson);

// ---------- 夹具 ----------

function makeResource(over: Partial<TeachingResource> = {}): TeachingResource {
  return {
    id: 'res-1',
    lookId: 'look-1',
    kind: 'article',
    title: '底妆入门指南',
    summary: '学会清透打底',
    body: '## 步骤\n\n**轻拍** 上妆',
    tags: ['底妆', '新手'],
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

let store: Map<string, string>;

function installLocalStorage(): void {
  store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: ls,
    configurable: true,
    writable: true,
  });
}

function uninstallLocalStorage(): void {
  delete (globalThis as Record<string, unknown>).localStorage;
}

/** 设置 useState 覆盖项 (按初始值特征 + 出现顺序消费). 每次渲染前调用. */
function setOverrides(list: Array<{ pred: (v: unknown) => boolean; value: unknown }>): void {
  h.overrides = list.map((o) => ({ ...o, consumed: false }));
}

// ResourcesView useState 初始值特征 (声明顺序):
// tab('article') → showBookmarks(false) → searchQuery('') → bookmarkTick(0) → readTick(0)
// → resources([]) → loading(true) → error(null) → selectedResource(null)
const OV = {
  tab: (value: string) => ({ pred: (v: unknown) => v === 'article', value }),
  bookmarks: (value: boolean) => ({ pred: (v: unknown) => v === false, value }),
  query: (value: string) => ({ pred: (v: unknown) => v === '', value }),
  resources: (value: TeachingResource[]) => ({
    pred: (v: unknown) => Array.isArray(v) && v.length === 0,
    value,
  }),
  loading: (value: boolean) => ({ pred: (v: unknown) => v === true, value }),
  error: (value: string | null) => ({ pred: (v: unknown) => v === null, value }),
  selected: (value: TeachingResource | null) => ({ pred: (v: unknown) => v === null, value }),
};

function renderView(overrides: Parameters<typeof setOverrides>[0] = []): string {
  setOverrides(overrides);
  return renderToStaticMarkup(createElement(ResourcesView, { lookId: 'look-1', onBack: () => {} }));
}

beforeEach(() => {
  h.overrides = [];
  h.states = [];
  h.cursor = 0;
  h.contextValue = null;
  installLocalStorage();
  fetchJsonMock.mockReset();
});

afterEach(() => {
  uninstallLocalStorage();
});

// ---------- userPrefs 边界 (补充 userPrefs.test.ts 未覆盖行) ----------

describe('userPrefs — 无 localStorage 降级', () => {
  it('localStorage 不存在时全部安全降级', () => {
    uninstallLocalStorage();
    expect(getBookmarks()).toEqual([]);
    expect(getReadIds()).toEqual([]);
    expect(isBookmarked('x')).toBe(false);
    expect(isRead('x')).toBe(false);
    expect(toggleBookmark('x')).toBe(false);
    expect(() => markRead('x')).not.toThrow();
  });

  it('存储内容不是合法 JSON 时返回空数组', () => {
    store.set('zw:bookmarks', '{not-json');
    store.set('zw:read', '][[');
    expect(getBookmarks()).toEqual([]);
    expect(getReadIds()).toEqual([]);
  });

  it('toggleBookmark 添加后再次调用移除; markRead 幂等', () => {
    expect(toggleBookmark('a')).toBe(true);
    expect(isBookmarked('a')).toBe(true);
    expect(toggleBookmark('a')).toBe(false);
    expect(isBookmarked('a')).toBe(false);
    markRead('a');
    markRead('a');
    expect(getReadIds()).toEqual(['a']);
  });
});

// ---------- markdownToHtml ----------

describe('markdownToHtml', () => {
  it('转换三级标题', () => {
    expect(markdownToHtml('# 一')).toContain('<h1');
    expect(markdownToHtml('## 二')).toContain('<h2');
    expect(markdownToHtml('### 三')).toContain('<h3');
  });

  it('转换粗体与斜体', () => {
    const html = markdownToHtml('**粗** 和 *斜*');
    expect(html).toContain('<strong class="font-semibold">粗</strong>');
    expect(html).toContain('<em>斜</em>');
  });

  it('转换无序列表并包裹 <ul>', () => {
    const html = markdownToHtml('- 甲\n- 乙');
    expect(html).toContain('<ul class="my-2">');
    expect(html).toContain('<li class="ml-4 mb-1 list-disc">甲</li>');
    expect(html).toContain('<li class="ml-4 mb-1 list-disc">乙</li>');
  });

  it('空行拆分段落, 单行换行转 <br/>', () => {
    expect(markdownToHtml('甲\n\n乙')).toContain('</p><p class="mb-2">');
    expect(markdownToHtml('甲\n乙')).toContain('甲<br/>乙');
  });

  it('组合规则: 标题内粗体也生效', () => {
    const html = markdownToHtml('## **重点** 步骤');
    expect(html).toContain('<h2');
    expect(html).toContain('<strong');
  });

  // markdownToHtml 先转义再转换 (ResourceDetailView 用 dangerouslySetInnerHTML 渲染),
  // 防止资源正文里的 HTML/脚本注入.
  it('转义原始 HTML, 防止存储型 XSS', () => {
    const html = markdownToHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('转义 & 且不影响 markdown 语法', () => {
    const html = markdownToHtml('**A & B**');
    expect(html).toContain('<strong');
    expect(html).toContain('A &amp; B');
  });
});

// ---------- Highlight 组件 (补充 Highlight.test.ts 未覆盖的组件渲染行) ----------

describe('Highlight 组件渲染', () => {
  it('命中片段渲染 <mark>, 未命中渲染 <span>', () => {
    const html = renderToStaticMarkup(createElement(Highlight, { text: '底妆教程', query: '教程' }));
    expect(html).toContain('<mark');
    expect(html).toContain('教程</mark>');
    expect(html).toContain('<span>底妆</span>');
  });

  it('query 为空时整段普通渲染, 无 <mark>', () => {
    const html = renderToStaticMarkup(createElement(Highlight, { text: 'abc', query: '' }));
    expect(html).not.toContain('<mark');
    expect(html).toContain('abc');
  });

  it('query 无命中时无 <mark>', () => {
    const html = renderToStaticMarkup(createElement(Highlight, { text: 'abc', query: 'zzz' }));
    expect(html).not.toContain('<mark');
  });
});

// ---------- ResourceCard ----------

describe('ResourceCard 渲染', () => {
  it('图文资源: 标题/摘要/📖/标签/未收藏态', () => {
    const html = renderToStaticMarkup(
      createElement(ResourceCard, { resource: makeResource(), onClick: () => {} }),
    );
    expect(html).toContain('底妆入门指南');
    expect(html).toContain('学会清透打底');
    expect(html).toContain('📖');
    expect(html).toContain('底妆');
    expect(html).toContain('☆');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="收藏"');
  });

  it('视频资源: 🎬 + 作者 + 时长格式 m:ss', () => {
    const html = renderToStaticMarkup(
      createElement(ResourceCard, {
        resource: makeResource({ kind: 'video', author: '小妆', durationSec: 125 }),
        onClick: () => {},
      }),
    );
    expect(html).toContain('🎬');
    expect(html).toContain('小妆');
    expect(html).toContain('2:05');
  });

  it('无作者或时长为 0 时不渲染作者行/时长', () => {
    const noAuthor = renderToStaticMarkup(
      createElement(ResourceCard, {
        resource: makeResource({ author: undefined, durationSec: 125 }),
        onClick: () => {},
      }),
    );
    expect(noAuthor).not.toContain('2:05');
    const zeroDuration = renderToStaticMarkup(
      createElement(ResourceCard, {
        resource: makeResource({ author: '小妆', durationSec: 0 }),
        onClick: () => {},
      }),
    );
    expect(zeroDuration).toContain('小妆');
    expect(zeroDuration).not.toContain('0:00');
  });

  it('空标签数组不渲染标签区', () => {
    const html = renderToStaticMarkup(
      createElement(ResourceCard, { resource: makeResource({ tags: [] }), onClick: () => {} }),
    );
    expect(html).not.toContain('rounded-full text-[10px] bg-primary/10');
  });

  it('已收藏 → ★ + 取消收藏; 已读 → 已读角标', () => {
    toggleBookmark('res-1');
    markRead('res-1');
    const html = renderToStaticMarkup(
      createElement(ResourceCard, { resource: makeResource(), onClick: () => {} }),
    );
    expect(html).toContain('★');
    expect(html).toContain('aria-label="取消收藏"');
    expect(html).toContain('aria-label="已读"');
  });

  it('searchQuery 命中时标题/摘要带 <mark> 高亮', () => {
    const html = renderToStaticMarkup(
      createElement(ResourceCard, {
        resource: makeResource(),
        searchQuery: '底妆',
        onClick: () => {},
      }),
    );
    expect(html).toContain('<mark');
  });
});

// ---------- ResourceDetailView ----------

describe('ResourceDetailView 渲染', () => {
  const noop = () => {};

  it('图文有正文: markdown 转 HTML 渲染, 不显示占位', () => {
    const html = renderToStaticMarkup(
      createElement(ResourceDetailView, { resource: makeResource(), onBack: noop }),
    );
    expect(html).toContain('<h2');
    expect(html).toContain('<strong');
    expect(html).not.toContain('暂无详细内容');
    expect(html).toContain('← 返回');
  });

  it('图文无正文: 显示 "暂无详细内容"', () => {
    const html = renderToStaticMarkup(
      createElement(ResourceDetailView, {
        resource: makeResource({ body: undefined }),
        onBack: noop,
      }),
    );
    expect(html).toContain('暂无详细内容');
  });

  it('视频资源: 渲染 iframe 播放器, 无正文占位', () => {
    const html = renderToStaticMarkup(
      createElement(ResourceDetailView, {
        resource: makeResource({
          kind: 'video',
          body: undefined,
          videoUrl: 'https://example.com/v.mp4',
        }),
        onBack: noop,
      }),
    );
    expect(html).toContain('<iframe');
    expect(html).toContain('https://example.com/v.mp4');
    expect(html).not.toContain('暂无详细内容');
  });

  it('已收藏/已读态: ★ + 已读徽章', () => {
    const html = renderToStaticMarkup(
      createElement(ResourceDetailView, {
        resource: makeResource(),
        bookmarked: true,
        isRead: true,
        onToggleBookmark: noop,
        onBack: noop,
      }),
    );
    expect(html).toContain('aria-label="取消收藏"');
    expect(html).toContain('已读');
  });

  it('不传 onToggleBookmark 时不渲染收藏按钮; 空标签不渲染标签区', () => {
    const html = renderToStaticMarkup(
      createElement(ResourceDetailView, {
        resource: makeResource({ tags: [] }),
        onBack: noop,
      }),
    );
    expect(html).not.toContain('aria-label="收藏"');
    expect(html).not.toContain('aria-label="取消收藏"');
    expect(html).not.toContain('rounded-full text-[10px] bg-primary/10');
  });
});

// ---------- ResourcesView (SSR + useState 注入) ----------

describe('ResourcesView 渲染', () => {
  it('默认 (loading): 加载中 + 搜索框 + 图文 tab 选中 + 收藏开关关', () => {
    const html = renderView();
    expect(html).toContain('加载中...');
    expect(html).toContain('教学资源');
    expect(html).toContain('aria-label="搜索资源"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('☆ 仅收藏');
    expect(html).toContain('← 返回');
  });

  it('error 状态: 显示错误文案', () => {
    const html = renderView([OV.loading(false), OV.error('HTTP 500: boom')]);
    expect(html).toContain('HTTP 500: boom');
    expect(html).not.toContain('加载中...');
  });

  it('图文 tab: 只列出 article 资源, 过滤掉 video', () => {
    const article = makeResource();
    const video = makeResource({ id: 'res-2', kind: 'video', title: '眼线视频课' });
    const html = renderView([
      OV.resources([article, video]),
      OV.loading(false),
      OV.error(null),
      OV.selected(null),
    ]);
    expect(html).toContain('底妆入门指南');
    expect(html).not.toContain('眼线视频课');
  });

  it('视频 tab: 只列出 video 资源', () => {
    const article = makeResource();
    const video = makeResource({ id: 'res-2', kind: 'video', title: '眼线视频课' });
    const html = renderView([
      OV.tab('video'),
      OV.resources([article, video]),
      OV.loading(false),
      OV.error(null),
      OV.selected(null),
    ]);
    expect(html).toContain('眼线视频课');
    expect(html).not.toContain('底妆入门指南');
  });

  it('空列表: 按当前 tab 显示占位文案', () => {
    const articleEmpty = renderView([OV.resources([]), OV.loading(false), OV.error(null), OV.selected(null)]);
    expect(articleEmpty).toContain('暂无图文资源');
    const videoEmpty = renderView([
      OV.tab('video'),
      OV.resources([]),
      OV.loading(false),
      OV.error(null),
      OV.selected(null),
    ]);
    expect(videoEmpty).toContain('暂无视频资源');
  });

  it('搜索无结果: 显示 "没找到匹配" + 清空按钮; 搜索框出现 ✕', () => {
    const html = renderView([
      OV.query('zzz'),
      OV.resources([makeResource()]),
      OV.loading(false),
      OV.error(null),
      OV.selected(null),
    ]);
    expect(html).toContain('没找到匹配「zzz」的资源');
    expect(html).toContain('清空搜索');
    expect(html).toContain('aria-label="清空搜索"');
  });

  it('搜索按 标题/摘要/标签 命中', () => {
    const r = makeResource();
    for (const q of ['底妆入门', '清透', '新手']) {
      const html = renderView([
        OV.query(q),
        OV.resources([r]),
        OV.loading(false),
        OV.error(null),
        OV.selected(null),
      ]);
      expect(html).toContain('底妆入门指南');
    }
  });

  it('仅收藏开启: 未收藏资源被过滤, 已收藏资源保留', () => {
    toggleBookmark('res-1');
    const bookmarked = makeResource();
    const plain = makeResource({ id: 'res-2', title: '未收藏教程' });
    const html = renderView([
      OV.bookmarks(true),
      OV.resources([bookmarked, plain]),
      OV.loading(false),
      OV.error(null),
      OV.selected(null),
    ]);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('★ 仅收藏');
    expect(html).toContain('底妆入门指南');
    expect(html).not.toContain('未收藏教程');
  });

  it('仅收藏开启但无收藏: 显示空态', () => {
    const html = renderView([
      OV.bookmarks(true),
      OV.resources([makeResource()]),
      OV.loading(false),
      OV.error(null),
      OV.selected(null),
    ]);
    expect(html).toContain('暂无图文资源');
  });

  it('选中资源: 渲染详情视图 (含返回 + 收藏 + 已读状态)', () => {
    toggleBookmark('res-1');
    markRead('res-1');
    const html = renderView([
      OV.resources([makeResource()]),
      OV.loading(false),
      OV.error(null),
      OV.selected(makeResource()),
    ]);
    expect(html).toContain('← 返回');
    expect(html).toContain('aria-label="取消收藏"');
    expect(html).toContain('已读');
    // 详情正文经 markdown 转换
    expect(html).toContain('<h2');
  });
});

// ---------- AdminPanel (SSR) ----------

function renderAdmin(overrides: Parameters<typeof setOverrides>[0] = []): string {
  setOverrides(overrides);
  return renderToStaticMarkup(
    createElement(ToastProvider, null, createElement(AdminPanel, { onRefresh: () => {}, onClose: () => {} })),
  );
}

// AdminPanel useState 顺序: isAdding(false) → addingError(null) → formData({...kind:'article'}) → tagsInput('')
const AOV = {
  isAdding: (value: boolean) => ({ pred: (v: unknown) => v === false, value }),
  addingError: (value: string | null) => ({ pred: (v: unknown) => v === null, value }),
  formData: (value: Record<string, unknown>) => ({
    pred: (v: unknown) => typeof v === 'object' && v !== null && 'kind' in (v as object),
    value,
  }),
};

describe('AdminPanel 渲染', () => {
  it('默认 (图文): 正文 textarea 在, 视频 URL 不在, 空标题时提交禁用', () => {
    const html = renderAdmin();
    expect(html).toContain('资源管理');
    expect(html).toContain('添加新资源');
    expect(html).toContain('<textarea');
    expect(html).not.toContain('视频 URL');
    expect(html).toContain('添加资源');
    // 空标题 → disabled
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="false"/);
  });

  it('视频类型: 显示视频 URL 输入框, 隐藏正文 textarea; 有标题可提交', () => {
    const html = renderAdmin([
      AOV.formData({ lookId: '', kind: 'video', title: '新课', summary: 's', tags: '' }),
    ]);
    expect(html).toContain('视频 URL');
    expect(html).not.toContain('<textarea');
    // 提交按钮存在且不带 disabled 属性 (class 里的 "disabled:" 前缀不算)
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*aria-busy="false"/);
  });

  it('添加中: spinner + aria-busy + 禁用', () => {
    const html = renderAdmin([AOV.isAdding(true)]);
    expect(html).toContain('添加中…');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('animate-spin');
  });

  it('添加失败: 显示错误提示', () => {
    const html = renderAdmin([AOV.addingError('HTTP 400: 标题必填')]);
    expect(html).toContain('HTTP 400: 标题必填');
  });
});

// ---------- AdminPanel handleAdd (直接调用组件, 遍历元素树触发 onClick) ----------

type El = { type: unknown; props: Record<string, unknown> };

function walk(node: unknown, visit: (n: El) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((c) => walk(c, visit));
    return;
  }
  const el = node as El;
  if (el.props && typeof el.props === 'object') {
    visit(el);
    walk(el.props.children, visit);
  }
}

function findButtons(root: unknown): El[] {
  const out: El[] = [];
  walk(root, (n) => {
    if (n.type === 'button') out.push(n);
  });
  return out;
}

function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object') return textOf((node as El).props?.children);
  return '';
}

describe('AdminPanel 添加资源流程', () => {
  function setup() {
    const toast = Object.assign(vi.fn(), {
      success: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    });
    h.contextValue = toast;
    h.states = [];
    h.cursor = 0;
    const onRefresh = vi.fn();
    const onClose = vi.fn();
    const el = (AdminPanel as unknown as (p: unknown) => unknown)({ onRefresh, onClose });
    return { toast, onRefresh, onClose, el };
  }

  it('提交成功: toast.success + onRefresh 回调', async () => {
    const { toast, onRefresh, el } = setup();
    fetchJsonMock.mockResolvedValue(makeResource());
    const submit = findButtons(el).find((b) => textOf(b).includes('添加资源'))!;
    await (submit.props.onClick as () => Promise<void>)();
    expect(fetchJsonMock).toHaveBeenCalledWith(
      '/api/teaching-resources',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(toast.success).toHaveBeenCalledWith('资源已添加');
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('提交失败: 不触发 onRefresh, 错误进入 state', async () => {
    const { toast, onRefresh, el } = setup();
    fetchJsonMock.mockRejectedValue(new Error('服务器错误'));
    const submit = findButtons(el).find((b) => textOf(b).includes('添加资源'))!;
    await (submit.props.onClick as () => Promise<void>)();
    expect(toast.success).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
    // addingError 是第 2 个 useState (index 1)
    expect(h.states[1]).toBe('服务器错误');
  });

  it('退出管理按钮触发 onClose', () => {
    const { onClose, el } = setup();
    const closeBtn = findButtons(el).find((b) => textOf(b).includes('退出管理'))!;
    (closeBtn.props.onClick as () => void)();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---------- AdminDeleteButton ----------

describe('AdminDeleteButton', () => {
  it('渲染删除按钮', () => {
    const html = renderToStaticMarkup(
      createElement(AdminDeleteButton, { resourceId: 'r9', onDelete: () => {} }),
    );
    expect(html).toContain('aria-label="删除资源"');
    expect(html).toContain('🗑️ 删除');
  });

  it('点击: stopPropagation + onDelete(id)', () => {
    const onDelete = vi.fn();
    const el = (AdminDeleteButton as unknown as (p: unknown) => El)({
      resourceId: 'r9',
      onDelete,
    });
    const stopPropagation = vi.fn();
    (el.props.onClick as (e: { stopPropagation: () => void }) => void)({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('r9');
  });
});

// ---------- 组件内部交互 (直接调用组件函数 + 捕获 effect/回调) ----------

interface TestEl {
  type: unknown;
  props: Record<string, unknown>;
}

function flattenTree(node: unknown, out: TestEl[] = []): TestEl[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((c) => flattenTree(c, out));
    return out;
  }
  const el = node as TestEl;
  if (el.props && typeof el.props === 'object') {
    out.push(el);
    flattenTree(el.props.children, out);
  }
  return out;
}

function directRender<T>(component: (p: T) => unknown, props: T): unknown {
  h.states = [];
  h.cursor = 0;
  h.effects = [];
  h.captureEffects = true;
  const el = component(props);
  h.captureEffects = false;
  return el;
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('ResourceCard 交互', () => {
  it('点击卡片主体触发 onClick', () => {
    const onClick = vi.fn();
    const el = directRender(ResourceCard, { resource: makeResource(), onClick });
    const main = flattenTree(el).find(
      (n) => n.type === 'button' && String(n.props['aria-label'] ?? '').startsWith('打开 '),
    )!;
    (main.props.onClick as () => void)();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('点击收藏按钮: toggleBookmark + onBookmarkTick 回调', () => {
    const onBookmarkTick = vi.fn();
    const el = directRender(ResourceCard, {
      resource: makeResource(),
      onClick: () => {},
      onBookmarkTick,
    });
    const star = flattenTree(el).find(
      (n) => n.type === 'button' && n.props['aria-label'] === '收藏',
    )!;
    (star.props.onClick as () => void)();
    expect(isBookmarked('res-1')).toBe(true);
    expect(onBookmarkTick).toHaveBeenCalledTimes(1);
  });
});

describe('ResourceDetailView 交互', () => {
  it('下滑手势回调触发 onBack', () => {
    const onBack = vi.fn();
    directRender(ResourceDetailView, { resource: makeResource(), onBack });
    expect(h.swipeOptions?.onSwipeDown).toBeTypeOf('function');
    h.swipeOptions!.onSwipeDown!();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('keydown effect: Esc / Ctrl+B 关闭, 其他键忽略', () => {
    const listeners = new Map<string, (e: Record<string, unknown>) => void>();
    vi.stubGlobal('window', {
      addEventListener: (name: string, fn: (e: Record<string, unknown>) => void) =>
        listeners.set(name, fn),
      removeEventListener: vi.fn(),
    });
    const onBack = vi.fn();
    directRender(ResourceDetailView, { resource: makeResource(), onBack });
    expect(h.effects).toHaveLength(1);
    const cleanup = h.effects[0]!() as (() => void) | undefined;
    const onKey = listeners.get('keydown')!;
    expect(onKey).toBeTypeOf('function');

    onKey({ key: 'Escape' });
    expect(onBack).toHaveBeenCalledTimes(1);

    const preventDefault = vi.fn();
    onKey({ key: 'b', ctrlKey: true, preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(2);

    onKey({ key: 'x' });
    expect(onBack).toHaveBeenCalledTimes(2);

    expect(cleanup).toBeTypeOf('function');
    vi.unstubAllGlobals();
  });
});

describe('ResourcesView 数据加载 effect', () => {
  function stubWindowListeners(): Map<string, (e: Record<string, unknown>) => void> {
    const listeners = new Map<string, (e: Record<string, unknown>) => void>();
    vi.stubGlobal('window', {
      addEventListener: (name: string, fn: (e: Record<string, unknown>) => void) =>
        listeners.set(name, fn),
      removeEventListener: vi.fn(),
    });
    return listeners;
  }

  // useState 索引: 0 tab, 1 showBookmarks, 2 searchQuery, 3 bookmarkTick,
  // 4 readTick, 5 resources, 6 loading, 7 error, 8 selectedResource
  it('加载成功: 写入资源列表并结束 loading', async () => {
    stubWindowListeners();
    fetchJsonMock.mockResolvedValue({ resources: [makeResource()] });
    directRender(ResourcesView, { lookId: 'look-1', onBack: () => {} });
    expect(h.effects).toHaveLength(1);
    h.effects[0]!();
    expect(fetchJsonMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/teaching-resources?'),
    );
    await flushMicrotasks();
    expect(h.states[5]).toHaveLength(1);
    expect(h.states[6]).toBe(false);
    vi.unstubAllGlobals();
  });

  it('响应缺少 resources 字段时降级为空数组', async () => {
    stubWindowListeners();
    fetchJsonMock.mockResolvedValue({});
    directRender(ResourcesView, { lookId: 'look-1', onBack: () => {} });
    h.effects[0]!();
    await flushMicrotasks();
    expect(h.states[5]).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('加载失败 (Error / 非 Error): 写入错误文案', async () => {
    stubWindowListeners();
    fetchJsonMock.mockRejectedValue(new Error('网络中断'));
    directRender(ResourcesView, { lookId: 'look-1', onBack: () => {} });
    h.effects[0]!();
    await flushMicrotasks();
    expect(h.states[7]).toBe('网络中断');
    expect(h.states[6]).toBe(false);
    vi.unstubAllGlobals();

    stubWindowListeners();
    fetchJsonMock.mockRejectedValue('boom');
    directRender(ResourcesView, { lookId: 'look-1', onBack: () => {} });
    h.effects[0]!();
    await flushMicrotasks();
    expect(h.states[7]).toBe('加载失败');
    vi.unstubAllGlobals();
  });

  it('cleanup 后到达的响应被丢弃 (cancelled)', async () => {
    stubWindowListeners();
    let resolveFn: (v: { resources: TeachingResource[] }) => void = () => {};
    fetchJsonMock.mockImplementation(
      () =>
        new Promise<{ resources: TeachingResource[] }>((resolve) => {
          resolveFn = resolve;
        }),
    );
    directRender(ResourcesView, { lookId: 'look-1', onBack: () => {} });
    const cleanup = h.effects[0]!() as () => void;
    cleanup();
    resolveFn({ resources: [makeResource()] });
    await flushMicrotasks();
    expect(h.states[5]).toEqual([]);
    expect(h.states[6]).toBe(true);
    vi.unstubAllGlobals();
  });

  it('storage 事件: 收藏/已读 key 递增对应 tick', () => {
    const listeners = stubWindowListeners();
    fetchJsonMock.mockResolvedValue({ resources: [] });
    directRender(ResourcesView, { lookId: 'look-1', onBack: () => {} });
    h.effects[0]!();
    const onStorage = listeners.get('storage')!;
    onStorage({ key: 'zw:bookmarks' });
    expect(h.states[3]).toBe(1);
    onStorage({ key: 'zw:read' });
    expect(h.states[4]).toBe(1);
    onStorage({ key: 'other' });
    expect(h.states[3]).toBe(1);
    expect(h.states[4]).toBe(1);
    vi.unstubAllGlobals();
  });

  it('下拉刷新回调: 成功重新拉取; 失败静默保留列表', async () => {
    fetchJsonMock.mockResolvedValue({ resources: [makeResource()] });
    directRender(ResourcesView, { lookId: 'look-1', onBack: () => {} });
    expect(h.pullOptions?.onRefresh).toBeTypeOf('function');
    await h.pullOptions!.onRefresh();
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
    expect(h.states[5]).toHaveLength(1);

    fetchJsonMock.mockRejectedValue(new Error('x'));
    await expect(h.pullOptions!.onRefresh()).resolves.toBeUndefined();
    expect(h.states[5]).toHaveLength(1);
  });
});

describe('ResourcesView 按钮交互', () => {
  function renderWithList(): ReturnType<typeof flattenTree> {
    setOverrides([
      OV.resources([makeResource()]),
      OV.loading(false),
      OV.error(null),
      OV.selected(null),
    ]);
    const el = directRender(ResourcesView, { lookId: 'look-1', onBack: () => {} });
    return flattenTree(el);
  }

  it('tab 切换: 点击视频 tab 更新 state', () => {
    const nodes = renderWithList();
    const videoTab = nodes.find((n) => n.type === 'button' && String(n.props['aria-selected']) === 'false')!;
    (videoTab.props.onClick as () => void)();
    expect(h.states[0]).toBe('video');
    expect(h.states[8]).toBeNull();
  });

  it('仅收藏开关: 点击取反', () => {
    const nodes = renderWithList();
    const toggle = nodes.find((n) => n.type === 'button' && n.props.role === 'switch')!;
    (toggle.props.onClick as () => void)();
    expect(h.states[1]).toBe(true);
  });

  it('清空搜索按钮: 重置 searchQuery', () => {
    setOverrides([
      OV.query('zzz'),
      OV.resources([makeResource()]),
      OV.loading(false),
      OV.error(null),
      OV.selected(null),
    ]);
    const nodes = flattenTree(directRender(ResourcesView, { lookId: 'look-1', onBack: () => {} }));
    const clear = nodes.find((n) => n.type === 'button' && n.props['aria-label'] === '清空搜索')!;
    (clear.props.onClick as () => void)();
    expect(h.states[2]).toBe('');
  });

  it('搜索输入 onChange: 写入 searchQuery', () => {
    const nodes = renderWithList();
    const input = nodes.find((n) => n.type === 'input')!;
    (input.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: '底妆' },
    });
    expect(h.states[2]).toBe('底妆');
  });

  it('卡片点击: markRead + 选中资源; onBookmarkTick 递增', () => {
    const nodes = renderWithList();
    const card = nodes.find((n) => typeof n.type === 'function')!;
    (card.props.onClick as () => void)();
    expect(isRead('res-1')).toBe(true);
    expect(h.states[4]).toBe(1);
    expect(h.states[8]).toMatchObject({ id: 'res-1' });
    (card.props.onBookmarkTick as () => void)();
    expect(h.states[3]).toBe(1);
  });
});

describe('AdminPanel 表单 onChange', () => {
  function renderForm(): ReturnType<typeof flattenTree> {
    h.contextValue = Object.assign(vi.fn(), {
      success: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    });
    return flattenTree(directRender(AdminPanel, { onRefresh: () => {}, onClose: () => {} }));
  }

  // useState 索引: 0 isAdding, 1 addingError, 2 formData, 3 tagsInput
  it('各输入框 onChange 写入 formData / tagsInput', () => {
    const nodes = renderForm();
    const select = nodes.find((n) => n.type === 'select')!;
    (select.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: 'video' },
    });
    expect(h.states[2]).toMatchObject({ kind: 'video' });

    const inputs = nodes.filter((n) => n.type === 'input');
    // 默认图文表单: [标题, 摘要, 标签, 作者]
    (inputs[0]!.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: '新课' },
    });
    expect(h.states[2]).toMatchObject({ title: '新课' });
    (inputs[1]!.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: '摘要文' },
    });
    expect(h.states[2]).toMatchObject({ summary: '摘要文' });
    (inputs[2]!.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: '底妆,通勤' },
    });
    expect(h.states[3]).toBe('底妆,通勤');
    (inputs[3]!.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: '小妆' },
    });
    expect(h.states[2]).toMatchObject({ author: '小妆' });

    const textarea = nodes.find((n) => n.type === 'textarea')!;
    (textarea.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: '# 正文' },
    });
    expect(h.states[2]).toMatchObject({ body: '# 正文' });
  });

  it('视频表单: 视频 URL onChange 写入 formData.videoUrl', () => {
    setOverrides([AOV.formData({ lookId: '', kind: 'video', title: '', summary: '', tags: [] })]);
    const nodes = renderForm();
    const urlInput = nodes.find((n) => n.type === 'input' && n.props.type === 'url')!;
    (urlInput.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: 'https://v.example/x' },
    });
    expect(h.states[2]).toMatchObject({ videoUrl: 'https://v.example/x' });
  });
});
