// Loads src/shared/data/teaching-resources.json once as seed data,
// then keeps a mutable in-memory copy for POST/DELETE operations.
// (单进程 MVP — 重启会回到 seed 状态; 文档化这个限制.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TeachingResource, TeachingResourceKind } from '../../shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/backend/routes/_resources.ts → src/shared/data/teaching-resources.json
const DATA_DIR = join(__dirname, '..', '..', 'shared', 'data');
const SEED_PATH = join(DATA_DIR, 'teaching-resources.json');

let cache: TeachingResource[] | null = null;

function isSeedFile(v: unknown): v is { resources: TeachingResource[] } {
  if (!v || typeof v !== 'object') return false;
  const candidate = v as { resources?: unknown };
  return Array.isArray(candidate.resources);
}

function loadSeed(): TeachingResource[] {
  const raw: unknown = JSON.parse(readFileSync(SEED_PATH, 'utf-8'));
  if (!isSeedFile(raw)) {
    throw new Error('teaching-resources.json 缺少 "resources" 数组');
  }
  return raw.resources;
}

export function listResources(): TeachingResource[] {
  if (!cache) cache = loadSeed();
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

export function createResource(input: CreateResourceInput): TeachingResource {
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
  listResources().push(resource);
  return resource;
}

export function deleteResource(id: string): boolean {
  const list = listResources();
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  list.splice(idx, 1);
  return true;
}

/** Test helper: reset to seed state. */
export function resetResourcesCache(): void {
  cache = null;
}
