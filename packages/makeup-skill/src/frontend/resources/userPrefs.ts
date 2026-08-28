// 用户对教学资源的偏好: 书签 + 已读标记.
// 存储在 localStorage 中 (与具体看 look 无关, 即跨 tab), 用 localStorage key 命名空间.

const BOOKMARKS_KEY = 'zw:bookmarks';
const READ_KEY = 'zw:read';

function getStorage(): Storage | null {
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return null;
}

function safeParse<T>(raw: string | null): T {
  if (!raw) return [] as unknown as T;
  try {
    const v: unknown = JSON.parse(raw);
    return v as T;
  } catch {
    return [] as unknown as T;
  }
}

export function getBookmarks(): string[] {
  const s = getStorage();
  if (!s) return [];
  return safeParse<string[]>(s.getItem(BOOKMARKS_KEY));
}

export function toggleBookmark(resourceId: string): boolean {
  const s = getStorage();
  if (!s) return false;
  const list = getBookmarks();
  const idx = list.indexOf(resourceId);
  let added: boolean;
  if (idx >= 0) {
    list.splice(idx, 1);
    added = false;
  } else {
    list.push(resourceId);
    added = true;
  }
  s.setItem(BOOKMARKS_KEY, JSON.stringify(list));
  return added;
}

export function isBookmarked(resourceId: string): boolean {
  return getBookmarks().includes(resourceId);
}

export function getReadIds(): string[] {
  const s = getStorage();
  if (!s) return [];
  return safeParse<string[]>(s.getItem(READ_KEY));
}

export function markRead(resourceId: string): void {
  const s = getStorage();
  if (!s) return;
  const list = getReadIds();
  if (!list.includes(resourceId)) {
    list.push(resourceId);
    s.setItem(READ_KEY, JSON.stringify(list));
  }
}

export function isRead(resourceId: string): boolean {
  return getReadIds().includes(resourceId);
}
