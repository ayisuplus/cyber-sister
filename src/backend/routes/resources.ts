// 教学资源路由 —
//   GET    /api/teaching-resources?lookId=...  列出 (可按 lookId 过滤)
//   GET    /api/teaching-resources/:id         单个详情
//   POST   /api/teaching-resources             新建 (admin 用途)
//   DELETE /api/teaching-resources/:id         删除 (admin 用途)
import { Router } from 'express';
import type { TeachingResourceKind } from '../../shared/types.js';
import { createResource, deleteResource, getResource, listResources } from './_resources.js';
import { validateBody, type Schema } from '../middleware/validate.js';

const ALLOWED_KINDS: ReadonlyArray<TeachingResourceKind> = ['article', 'video'];

const createSchema: Schema = {
  lookId: { type: 'string', min: 0, max: 64 },
  kind: { type: 'enum', values: [...ALLOWED_KINDS] },
  title: { type: 'string', required: true, min: 1, max: 200 },
  summary: { type: 'string', required: true, min: 1, max: 500 },
  body: { type: 'string', min: 0, max: 50_000 },
  coverImage: { type: 'string', min: 0, max: 2048 },
  videoUrl: { type: 'string', min: 0, max: 2048 },
  durationSec: { type: 'integer', ge: 0, le: 86400 },
  author: { type: 'string', min: 0, max: 100 },
  tags: { type: 'string', min: 0, max: 500 },
};

// 字符串数组的窄化 — schema 只能校验 string, 运行时再 split.
function parseTags(input: unknown): string[] {
  if (typeof input !== 'string') return [];
  if (!input) return [];
  return input
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function parseStringField(input: unknown): string | undefined {
  return typeof input === 'string' && input.length > 0 ? input : undefined;
}

function parseNumberField(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) ? input : undefined;
}

export const resourcesRouter = Router();

 // GET /api/teaching-resources?lookId=...
resourcesRouter.get('/teaching-resources', (req, res) => {
  const list = listResources();
  const q = req.query.lookId;
  if (typeof q === 'string' && q.length > 0) {
    res.json({ resources: list.filter((r) => r.lookId === q) });
    return;
  }
  res.json({ resources: list });
});

// GET /api/teaching-resources/:id
resourcesRouter.get('/teaching-resources/:id', (req, res) => {
  const found = getResource(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'resource not found' });
    return;
  }
  res.json(found);
});

// POST /api/teaching-resources
resourcesRouter.post(
  '/teaching-resources',
  validateBody(createSchema),
  (req, res) => {
    const body = req.body as {
      lookId?: unknown;
      kind?: unknown;
      title?: unknown;
      summary?: unknown;
      body?: unknown;
      coverImage?: unknown;
      videoUrl?: unknown;
      durationSec?: unknown;
      author?: unknown;
      tags?: unknown;
    };
    // schema 已保证 required 字段存在且类型对,这里只 narrow 剩余 optional
    const lookId = typeof body.lookId === 'string' ? body.lookId : '';
    const kind = body.kind === 'video' ? 'video' : 'article';
    const title = typeof body.title === 'string' ? body.title : '';
    const summary = typeof body.summary === 'string' ? body.summary : '';
    const created = createResource({
      lookId,
      kind,
      title,
      summary,
      tags: parseTags(body.tags),
      body: parseStringField(body.body),
      coverImage: parseStringField(body.coverImage),
      videoUrl: parseStringField(body.videoUrl),
      durationSec: parseNumberField(body.durationSec),
      author: parseStringField(body.author),
    });
    res.status(201).json(created);
  },
);

// DELETE /api/teaching-resources/:id
resourcesRouter.delete('/teaching-resources/:id', (req, res) => {
  const ok = deleteResource(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'resource not found' });
    return;
  }
  res.json({ ok: true });
});
