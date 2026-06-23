// Upload endpoint — accepts a base64 image, writes it to public/uploads/,
// returns { imageId, url, size }. Used by /api/generate to know where
// to read the source image from on disk.

import { Router } from 'express';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { UploadResponse } from '../../shared/types.js';
import { config } from '../config.js';

export const uploadRouter = Router();

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/backend/routes/upload.ts → <root>/public/uploads
const UPLOAD_DIR = resolve(__dirname, '..', '..', '..', config.uploadDir);

// Ensure upload dir exists at boot. Cheap idempotent op.
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

uploadRouter.post('/upload', (req, res) => {
  const body = (req.body ?? {}) as { image?: unknown };
  const image = body.image;
  if (typeof image !== 'string' || image.length === 0) {
    res.status(400).json({ error: '缺少图片数据 (image base64)' });
    return;
  }
  const m = image.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
  if (!m) {
    res.status(400).json({ error: '图片格式仅支持 jpeg / png / webp' });
    return;
  }
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buf = Buffer.from(m[2]!, 'base64');
  if (buf.length === 0) {
    res.status(400).json({ error: '图片数据为空' });
    return;
  }
  if (buf.length > config.maxUploadBytes) {
    res
      .status(413)
      .json({ error: `图片超过 ${Math.floor(config.maxUploadBytes / 1024 / 1024)} MB` });
    return;
  }

  const id = randomUUID();
  const filename = `${id}.${ext}`;
  writeFileSync(join(UPLOAD_DIR, filename), buf);

  const resp: UploadResponse = {
    imageId: id,
    url: `/uploads/${filename}`,
    size: buf.length,
  };
  res.json(resp);
});
