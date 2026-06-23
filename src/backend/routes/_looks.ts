// Loads src/shared/data/looks.json once and caches the result.
// Shared by recommend.ts and generate.ts so the trigger prompt and
// look names stay in sync with the canonical data file.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { MakeupLook } from '../../shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/backend/routes/_looks.ts → src/shared/data/looks.json
const DATA_DIR = join(__dirname, '..', '..', 'shared', 'data');

let cache: MakeupLook[] | null = null;

export function loadLooks(): MakeupLook[] {
  if (cache) return cache;
  const raw = JSON.parse(readFileSync(join(DATA_DIR, 'looks.json'), 'utf-8')) as {
    looks: MakeupLook[];
  };
  cache = raw.looks;
  return cache;
}

/** Test helper: drop the cache so a fresh file is re-read. */
export function resetLooksCache(): void {
  cache = null;
}
