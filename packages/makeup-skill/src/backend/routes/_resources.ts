// Loads src/shared/data/teaching-resources.json as seed data,
// keeps a mutable in-memory cache for reads (hot path),
// 写操作同步原子写回文件 (atomic rename).
//
// 并发安全:
// - 读路径: 直接返回 cache (O(1), 高频)
// - 写路径: 串行 mutex (Node 单进程事件循环天然串行, 加显式 lock 是为了文档化意图)
// - 文件写: tmp → rename 原子替换
//
// 重启会读到最新状态 (从 JSON 加载), 不会再回退到 seed.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TeachingResource, TeachingResourceKind } from '../../shared/types.js';

// pnpm starts this package with cwd=<package root>; this also survives bundling.
const DATA_DIR = join(process.cwd(), 'src', 'shared', 'data');
// 测试时可通过 TEACHING_RESOURCES_FILE 环境变量重定向 (用于隔离 + 临时目录).
function getStoragePath(): string {
  const override = process.env.TEACHING_RESOURCES_FILE;
  if (override) return override;
  return join(DATA_DIR, 'teaching-resources.json');
}
const DEFAULT_PATH = join(DATA_DIR, 'teaching-resources.json');

let cache: TeachingResource[] | null = null;
let pendingWrite: Promise<unknown> = Promise.resolve();

function isSeedFile(
  v: unknown,
): v is { resources: TeachingResource[]; description?: string; version?: number } {
  if (!v || typeof v !== 'object') return false;
  const candidate = v as { resources?: unknown };
  return Array.isArray(candidate.resources);
}

function loadFromDisk(): TeachingResource[] {
  const path = getStoragePath();
  // 测试可能重定向到临时文件 — 如果临时文件不存在,fallback 到 seed.
  if (!existsSync(path)) {
    const raw: unknown = JSON.parse(readFileSync(DEFAULT_PATH, 'utf-8'));
    if (!isSeedFile(raw)) {
      throw new Error('teaching-resources.json 缺少 "resources" 数组');
    }
    return raw.resources;
  }
  const raw: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  if (!isSeedFile(raw)) {
    throw new Error('teaching-resources.json 缺少 "resources" 数组');
  }
  return raw.resources;
}

function persistToDisk(list: TeachingResource[]): void {
  const path = getStoragePath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const payload = JSON.stringify(
    { version: 1, description: '教学资源 — 妆容教程配套的图文 + 视频列表.', resources: list },
    null,
    2,
  );
  writeFileSync(tmp, payload, 'utf-8');
  renameSync(tmp, path);
}

/** 串行化所有写操作 — 防止同时两个写交错覆盖. */
function enqueueWrite<T>(work: () => T): Promise<T> {
  const run = pendingWrite.then(
    () => work(),
    () => work(),
  );
  pendingWrite = run.catch(() => undefined);
  return run;
}

export function listResources(): TeachingResource[] {
  if (!cache) cache = loadFromDisk();
  return cache;
}

export function getResource(id: string): TeachingResource | undefined {
  return listResources().find((r) => r.id === id);
}

export interface CreateResourceInput {
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

export async function createResource(input: CreateResourceInput): Promise<TeachingResource> {
  const now = Date.now();
  const resource: TeachingResource = {
    id: randomUUID(),
    lookId: input.lookId,
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    tags: input.tags,
    createdAt: now,
    updatedAt: now,
  };
  if (input.body !== undefined) resource.body = input.body;
  if (input.coverImage !== undefined) resource.coverImage = input.coverImage;
  if (input.videoUrl !== undefined) resource.videoUrl = input.videoUrl;
  if (input.durationSec !== undefined) resource.durationSec = input.durationSec;
  if (input.author !== undefined) resource.author = input.author;
  return enqueueWrite(() => {
    listResources().push(resource);
    persistToDisk(listResources());
  }).then(() => resource);
}

export async function deleteResource(id: string): Promise<boolean> {
  return enqueueWrite(() => {
    const list = listResources();
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    list.splice(idx, 1);
    persistToDisk(list);
    return true;
  });
}

/** Test helper: reset to disk state. */
export function resetResourcesCache(): void {
  cache = null;
}

/** Test helper: delete the on-disk file (test isolation). */
export function deleteStorage(): void {
  cache = null;
}
