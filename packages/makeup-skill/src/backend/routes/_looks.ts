// Loads src/shared/data/looks.json once and caches the result.
// Shared by recommend.ts so look names stay in sync with the canonical data file.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MakeupLook } from '../../shared/types.js';

// pnpm starts this package with cwd=<package root>; this also survives bundling.
const DATA_DIR = join(process.cwd(), 'src', 'shared', 'data');

let cache: MakeupLook[] | null = null;

export function loadLooks(): MakeupLook[] {
  if (cache) return cache;
  const parsed: unknown = JSON.parse(readFileSync(join(DATA_DIR, 'looks.json'), 'utf-8'));
  // 仓库内 JSON 随版本走, 运行时再 narrow 一道防手滑改坏.
  const looks = (parsed as { looks?: unknown } | null)?.looks;
  if (!Array.isArray(looks)) {
    throw new Error('looks.json 缺少 "looks" 数组');
  }
  cache = looks as MakeupLook[];
  return cache;
}

/** Test helper: drop the cache so a fresh file is re-read. */
export function resetLooksCache(): void {
  cache = null;
}
