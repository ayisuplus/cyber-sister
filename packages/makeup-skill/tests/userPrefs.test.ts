// Tests for the userPrefs module: bookmark + read tracking with localStorage.
// 用 in-memory storage stub 模拟 localStorage, 不依赖 happy-dom/jsdom.

import { describe, it, expect, beforeEach } from 'vitest';

function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

beforeEach(() => {
  (globalThis as { localStorage: Storage }).localStorage = makeMemoryStorage();
});
import {
  getBookmarks,
  isBookmarked,
  toggleBookmark,
  getReadIds,
  isRead,
  markRead,
} from '../src/frontend/resources/userPrefs';

describe('userPrefs: bookmarks', () => {
  it('initial state is empty list', () => {
    expect(getBookmarks()).toEqual([]);
  });

  it('toggleBookmark adds a new id and returns true', () => {
    const added = toggleBookmark('r1');
    expect(added).toBe(true);
    expect(getBookmarks()).toEqual(['r1']);
    expect(isBookmarked('r1')).toBe(true);
  });

  it('toggleBookmark removes an existing id and returns false', () => {
    toggleBookmark('r1');
    const added = toggleBookmark('r1');
    expect(added).toBe(false);
    expect(getBookmarks()).toEqual([]);
    expect(isBookmarked('r1')).toBe(false);
  });

  it('toggleBookmark supports multiple ids', () => {
    toggleBookmark('r1');
    toggleBookmark('r2');
    expect(getBookmarks()).toEqual(['r1', 'r2']);
    toggleBookmark('r1');
    expect(getBookmarks()).toEqual(['r2']);
  });

  it('isBookmarked returns false for unknown id', () => {
    expect(isBookmarked('missing')).toBe(false);
  });
});

describe('userPrefs: read tracking', () => {
  it('initial state is empty list', () => {
    expect(getReadIds()).toEqual([]);
  });

  it('markRead adds a new id', () => {
    markRead('r1');
    expect(getReadIds()).toEqual(['r1']);
    expect(isRead('r1')).toBe(true);
  });

  it('markRead is idempotent', () => {
    markRead('r1');
    markRead('r1');
    markRead('r1');
    expect(getReadIds()).toEqual(['r1']);
  });

  it('isRead returns false for unknown id', () => {
    expect(isRead('missing')).toBe(false);
  });
});

describe('userPrefs: persistence', () => {
  it('reads existing values from localStorage', () => {
    globalThis.localStorage.setItem('zw:bookmarks', JSON.stringify(['x', 'y']));
    globalThis.localStorage.setItem('zw:read', JSON.stringify(['z']));
    expect(getBookmarks()).toEqual(['x', 'y']);
    expect(getReadIds()).toEqual(['z']);
  });

  it('falls back to empty when JSON is corrupted', () => {
    globalThis.localStorage.setItem('zw:bookmarks', 'not-json{');
    expect(getBookmarks()).toEqual([]);
  });
});
