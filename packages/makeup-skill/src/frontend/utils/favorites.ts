// 本地收藏 (回看) — 用 localStorage 存已做过的妆容方案, 7 日内可回看.
//
// 设计要点:
//   - 存储 key: makeupwhisper_favorites
//   - 每条记录只存方案摘要 (lookId/lookName/scenario + 简化五官摘要 + 时间戳)
//   - 禁含 PII: 不存原图、不存用户姓名等任何个人信息
//   - localStorage 不可用 (SSR / 隐私模式 / 配额满) 时优雅降级为内存态
//   - 每次读写都重新探测 localStorage 可用性, 便于测试时随时替换全局 localStorage
//
// 本文件不依赖 React / DOM 全局类型, 通过 globalThis 探测, 可在 node 测试环境直接跑.

import type { FaceShape, EyeType, SkinTone } from '../../shared/types';

/** 收藏记录里保存的简化五官摘要 (只挑回看时最有用的几个字段). */
export interface FavoriteFeaturesSummary {
  faceShape: FaceShape;
  skinTone: SkinTone;
  eyeType: EyeType;
  /** AI 分析置信度, 回看时判断这份数据靠不靠谱. */
  confidence: number;
}

/** 一条收藏记录. */
export interface FavoriteRecord {
  /** 自动生成的唯一 id. */
  id: string;
  /** 妆容 id (MakeupLook.id). */
  lookId: string;
  /** 妆容展示名. */
  lookName: string;
  /** 适用场景 (如 通勤/约会/面试). */
  scenario: string;
  /** 简化五官摘要. */
  features: FavoriteFeaturesSummary;
  /** 收藏时间戳 (ms). */
  savedAt: number;
}

const STORAGE_KEY = 'makeupwhisper_favorites';

/** localStorage 不可用时的内存兜底仓. */
const memoryFallback: FavoriteRecord[] = [];

/**
 * 探测并返回可用的 localStorage. 每次调用都重新探测, 便于:
 *   - 隐私模式 / 配额满时实时降级
 *   - 测试时随时替换 globalThis.localStorage
 * 返回 null 表示不可用, 调用方走内存兜底.
 */
function getLocalStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls || typeof ls.getItem !== 'function') return null;
    // 探测可写 (隐私模式 getItem 存在但 setItem 抛错)
    const probeKey = '__mw_probe__';
    ls.setItem(probeKey, '1');
    ls.removeItem(probeKey);
    return ls;
  } catch {
    return null;
  }
}

/** 生成唯一 id: 优先 crypto.randomUUID, 不可用回退到时间戳 + 随机串. */
function generateId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c && typeof c.randomUUID === 'function') {
      return c.randomUUID();
    }
  } catch {
    /* 静默 */
  }
  return 'fav-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** 校验一条记录结构是否合法, 防止脏数据混入. */
function isValidRecord(r: unknown): r is FavoriteRecord {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.lookId === 'string' &&
    typeof o.lookName === 'string' &&
    typeof o.scenario === 'string' &&
    typeof o.savedAt === 'number' &&
    typeof o.features === 'object' &&
    o.features !== null
  );
}

/** 读取全部收藏 (原始顺序). localStorage 不可用 / 解析失败时返回内存兜底或空数组. */
function readAll(): FavoriteRecord[] {
  const ls = getLocalStorage();
  if (!ls) return memoryFallback;
  try {
    const raw = ls.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidRecord);
  } catch {
    return [];
  }
}

/** 持久化全部收藏. localStorage 写失败时降级到内存兜底. */
function writeAll(records: FavoriteRecord[]): void {
  const ls = getLocalStorage();
  if (!ls) {
    memoryFallback.length = 0;
    memoryFallback.push(...records);
    return;
  }
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // 配额满 / 隐私模式写入失败 → 降级内存
    memoryFallback.length = 0;
    memoryFallback.push(...records);
  }
}

/**
 * 添加一条收藏. 自动补全 id 与 savedAt.
 * @param record 不含 id / savedAt 的记录.
 * @returns 完整记录 (含生成的 id 与时间戳).
 */
export function addFavorite(record: Omit<FavoriteRecord, 'id' | 'savedAt'>): FavoriteRecord {
  const full: FavoriteRecord = {
    ...record,
    id: generateId(),
    savedAt: Date.now(),
  };
  const all = readAll();
  // 同一 lookId 已存在则不重复收藏 (覆盖更新, 保留新时间戳)
  const filtered = all.filter((r) => r.lookId !== record.lookId);
  filtered.push(full);
  writeAll(filtered);
  return full;
}

/**
 * 删除一条收藏.
 * @param id 收藏记录 id (FavoriteRecord.id).
 */
export function removeFavorite(id: string): void {
  const all = readAll();
  writeAll(all.filter((r) => r.id !== id));
}

/**
 * 删除某个 lookId 对应的收藏 (便于按妆容取消收藏).
 * @param lookId 妆容 id.
 */
export function removeFavoriteByLookId(lookId: string): void {
  const all = readAll();
  writeAll(all.filter((r) => r.lookId !== lookId));
}

/**
 * 获取全部收藏, 按收藏时间倒序 (最新在前).
 * 时间戳相同时 (同一毫秒内连续收藏), 后插入的排更前, 保证"最近收藏优先".
 */
export function getFavorites(): FavoriteRecord[] {
  return readAll()
    .map((r, idx) => ({ r, idx }))
    .sort((a, b) => b.r.savedAt - a.r.savedAt || b.idx - a.idx)
    .map((x) => x.r);
}

/**
 * 判断某个妆容是否已被收藏.
 * @param lookId 妆容 id.
 */
export function isFavorited(lookId: string): boolean {
  return readAll().some((r) => r.lookId === lookId);
}

/**
 * 按场景筛选收藏, 按时间倒序. 场景大小写不敏感比较.
 * 时间戳相同时后插入的排更前 (同 getFavorites).
 * @param scenario 场景名 (如 "通勤").
 */
export function getFavoritesByScenario(scenario: string): FavoriteRecord[] {
  const target = scenario.trim().toLowerCase();
  return readAll()
    .map((r, idx) => ({ r, idx }))
    .filter((x) => x.r.scenario.trim().toLowerCase() === target)
    .sort((a, b) => b.r.savedAt - a.r.savedAt || b.idx - a.idx)
    .map((x) => x.r);
}

/**
 * 根据 lookId 找到对应的收藏记录 (便于取消收藏时拿到 id).
 * @param lookId 妆容 id.
 */
export function findFavoriteByLookId(lookId: string): FavoriteRecord | undefined {
  return readAll().find((r) => r.lookId === lookId);
}

/** 清空全部收藏 (主要用于测试 / 重置). */
export function clearFavorites(): void {
  writeAll([]);
}
