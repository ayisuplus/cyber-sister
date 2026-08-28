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

// 字符串正则: 防止注入 / 路径穿越 / 特殊字符
// - id/lookId: UUID 风格 + dash
// - author / title / summary: 中文 / 字母 / 数字 / 空格 / 常见标点
// - URL: 严格 https?:// 前缀, 避免 javascript: / data: 等伪协议
// - body: 任意字符 (允许多行), 仅长度限制
const ID_PATTERN = /^[A-Za-z0-9_-]{0,64}$/;
const NAME_PATTERN = /^[\p{L}\p{N}\p{Zs}\-—‘’“”…()·.,!?、。]{0,100}$/u;
const URL_PATTERN = /^https?:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]{0,2048}$/;
const BODY_PATTERN = /^[\s\S]{0,50000}$/;

const createSchema: Schema = {
  lookId: { type: 'string', min: 0, max: 64, pattern: ID_PATTERN },
  kind: { type: 'enum', values: [...ALLOWED_KINDS] },
  title: { type: 'string', required: true, min: 1, max: 200, pattern: NAME_PATTERN },
  summary: { type: 'string', required: true, min: 1, max: 500, pattern: NAME_PATTERN },
  body: { type: 'string', min: 0, max: 50_000, pattern: BODY_PATTERN },
  coverImage: { type: 'string', min: 0, max: 2048, pattern: URL_PATTERN },
  videoUrl: { type: 'string', min: 0, max: 2048, pattern: URL_PATTERN },
  durationSec: { type: 'integer', ge: 0, le: 86400 },
  author: { type: 'string', min: 0, max: 100, pattern: NAME_PATTERN },
  tags: { type: 'string', min: 0, max: 500 },
};

// 字符串数组的窄化 — schema 只能校验 string, 运行时再 split.
// 每个 tag 必须是字母/数字/下划线/dash/中文, ≤ 30 字符.
function parseTags(input: unknown): string[] {
  if (typeof input !== 'string') return [];
  if (!input) return [];
  const raw = input.split(/[,，\s]+/);
  const out: string[] = [];
  for (const t of raw) {
    const trimmed = t.trim();
    if (!trimmed) continue;
    if (!/^[A-Za-z0-9_\-一-龥]{1,30}$/.test(trimmed)) continue;
    out.push(trimmed);
    if (out.length >= 20) break;
  }
  return out;
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
resourcesRouter.post('/teaching-resources', validateBody(createSchema), async (req, res) => {
  try {
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
    const created = await createResource({
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
  } catch (err) {
    const message = err instanceof Error ? err.message : 'create failed';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/teaching-resources/:id
resourcesRouter.delete('/teaching-resources/:id', async (req, res) => {
  try {
    const ok = await deleteResource(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'resource not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'delete failed';
    res.status(500).json({ error: message });
  }
});
