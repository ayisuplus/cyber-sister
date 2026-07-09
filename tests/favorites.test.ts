// favorites.ts 单元测试 — 本地收藏 CRUD + 内存兜底 + localStorage 持久化.
// vitest 默认 node 环境: 无 localStorage, 走内存兜底;
// localStorage 用例通过注入 mock Storage 测试真实持久化路径.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  addFavorite,
  removeFavorite,
  removeFavoriteByLookId,
  getFavorites,
  isFavorited,
  getFavoritesByScenario,
  findFavoriteByLookId,
  clearFavorites,
  type FavoriteRecord,
} from '../src/frontend/utils/favorites';

const STORAGE_KEY = 'makeupwhisper_favorites';

/** 构造一条不含 id/savedAt 的收藏输入. */
function makeInput(over: Partial<Omit<FavoriteRecord, 'id' | 'savedAt'>> = {}) {
  return {
    lookId: 'look_a',
    lookName: '清冷白开水妆',
    scenario: '日常通勤',
    features: {
      faceShape: 'oval' as const,
      skinTone: 'cool_fair' as const,
      eyeType: 'almond' as const,
      confidence: 0.88,
    },
    ...over,
  };
}

/** 简易内存 Storage, 模拟浏览器 localStorage. */
function createMemoryStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    clear() {
      store = {};
    },
    getItem(k: string) {
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k]! : null;
    },
    key(i: number) {
      return Object.keys(store)[i] ?? null;
    },
    removeItem(k: string) {
      delete store[k];
    },
    setItem(k: string, v: string) {
      store[k] = String(v);
    },
  };
}

// ---------- 内存兜底 (无 localStorage) ----------

describe('favorites — 内存兜底 (node 无 localStorage)', () => {
  beforeEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    clearFavorites();
  });

  it('addFavorite 返回含 id + savedAt 的完整记录', () => {
    const rec = addFavorite(makeInput());
    expect(rec.id.length).toBeGreaterThan(0);
    expect(typeof rec.savedAt).toBe('number');
    expect(rec.lookId).toBe('look_a');
  });

  it('getFavorites 按时间倒序', () => {
    addFavorite(makeInput({ lookId: 'l1' }));
    addFavorite(makeInput({ lookId: 'l2' }));
    const list = getFavorites();
    expect(list[0]!.lookId).toBe('l2');
    expect(list[1]!.lookId).toBe('l1');
  });

  it('isFavorited 正确反映收藏状态', () => {
    expect(isFavorited('look_a')).toBe(false);
    addFavorite(makeInput());
    expect(isFavorited('look_a')).toBe(true);
  });

  it('removeFavorite 按 id 删除', () => {
    const rec = addFavorite(makeInput());
    expect(isFavorited('look_a')).toBe(true);
    removeFavorite(rec.id);
    expect(isFavorited('look_a')).toBe(false);
    expect(getFavorites()).toHaveLength(0);
  });

  it('removeFavoriteByLookId 按妆容删除', () => {
    addFavorite(makeInput());
    removeFavoriteByLookId('look_a');
    expect(isFavorited('look_a')).toBe(false);
  });

  it('同一 lookId 重复收藏不产生重复 (覆盖更新)', () => {
    addFavorite(makeInput());
    addFavorite(makeInput());
    expect(getFavorites()).toHaveLength(1);
  });

  it('getFavoritesByScenario 按场景筛选 (大小写不敏感)', () => {
    addFavorite(makeInput({ lookId: 'l1', scenario: '日常通勤' }));
    addFavorite(makeInput({ lookId: 'l2', scenario: '约会' }));
    addFavorite(makeInput({ lookId: 'l3', scenario: '日常通勤' }));
    const list = getFavoritesByScenario('日常通勤');
    expect(list).toHaveLength(2);
    expect(list.every((r) => r.scenario === '日常通勤')).toBe(true);
    // 带空格/大小写也应匹配
    expect(getFavoritesByScenario('  日常通勤  ')).toHaveLength(2);
  });

  it('findFavoriteByLookId 返回对应记录', () => {
    addFavorite(makeInput({ lookId: 'look_x' }));
    const found = findFavoriteByLookId('look_x');
    expect(found).toBeDefined();
    expect(found!.lookName).toBe('清冷白开水妆');
    expect(findFavoriteByLookId('not_exist')).toBeUndefined();
  });

  it('禁含 PII: 记录结构不含原图/姓名等字段', () => {
    const rec = addFavorite(makeInput());
    const keys = Object.keys(rec);
    expect(keys).not.toContain('image');
    expect(keys).not.toContain('userName');
    expect(keys).not.toContain('photo');
  });
});

// ---------- localStorage 持久化 ----------

describe('favorites — localStorage 持久化', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = createMemoryStorage();
    clearFavorites();
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('addFavorite 写入 localStorage (key=makeupwhisper_favorites)', () => {
    const ls = (globalThis as { localStorage: Storage }).localStorage;
    addFavorite(makeInput({ lookId: 'l1' }));
    const raw = ls.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as FavoriteRecord[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.lookId).toBe('l1');
  });

  it('读取直接来自 localStorage (模拟 reload 后仍可读)', () => {
    addFavorite(makeInput({ lookId: 'l_persist' }));
    // 不重新 import 模块, 但 readAll 每次都从 localStorage 读, 等价于 reload
    expect(isFavorited('l_persist')).toBe(true);
    expect(getFavorites()[0]!.lookId).toBe('l_persist');
  });

  it('removeFavorite 同步删除 localStorage', () => {
    const ls = (globalThis as { localStorage: Storage }).localStorage;
    const rec = addFavorite(makeInput());
    removeFavorite(rec.id);
    const raw = ls.getItem(STORAGE_KEY);
    expect(JSON.parse(raw!) as FavoriteRecord[]).toHaveLength(0);
  });

  it('脏数据 (非数组 / 缺字段) 被过滤, 不抛错', () => {
    const ls = (globalThis as { localStorage: Storage }).localStorage;
    ls.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: 'x', lookId: 'l1', lookName: 'n', scenario: 's', savedAt: 1, features: { faceShape: 'oval', skinTone: 'cool_fair', eyeType: 'almond', confidence: 0.5 } },
        'not-an-object',
        { id: 123 },
        null,
      ]),
    );
    const list = getFavorites();
    expect(list).toHaveLength(1);
    expect(list[0]!.lookId).toBe('l1');
  });

  it('localStorage 不可写 (setItem 抛错) 时降级内存, 不影响功能', () => {
    // 替换成一个 setItem 会抛错的 Storage
    const broken: Storage = {
      ...createMemoryStorage(),
      setItem() {
        throw new Error('quota');
      },
    };
    (globalThis as { localStorage?: Storage }).localStorage = broken;
    // 探测时 setItem 抛错 → getLocalStorage 返回 null → 走内存兜底
    const rec = addFavorite(makeInput({ lookId: 'l_mem' }));
    expect(rec.id.length).toBeGreaterThan(0);
    expect(isFavorited('l_mem')).toBe(true);
  });
});
