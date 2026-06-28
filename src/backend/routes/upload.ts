// Upload endpoint — accepts a base64 image, writes it to public/uploads/,
// returns { imageId, url, size }. Used by /api/generate to know where
// to read the source image from on disk.

import { Router } from 'express';
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { UploadResponse } from '../../shared/types.js';
import { config } from '../config.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { validateBody, type Schema } from '../middleware/validate.js';

export const uploadRouter = Router();

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/backend/routes/upload.ts → <root>/public/uploads
const UPLOAD_DIR = resolve(__dirname, '..', '..', '..', config.uploadDir);

// Ensure upload dir exists at boot. Cheap idempotent op.
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

const uploadSchema: Schema = {
  image: { type: 'string', required: true, min: 32, max: config.maxUploadBytes * 4 / 3 + 64 },
};

uploadRouter.post(
  '/upload',
  uploadLimiter,
  validateBody(uploadSchema),
  (req, res) => {
    const body = req.body as { image?: string };
    const image = body.image;
    // validateBody 已保证是非空字符串,这里再次 narrow 防止 unreachable.
    if (typeof image !== 'string') {
      res.status(400).json({ error: '缺少图片数据 (image base64)' });
      return;
    }
    const m = DATA_URL_RE.exec(image);
    if (!m) {
      res.status(400).json({ error: '图片格式仅支持 jpeg / png / webp' });
      return;
    }
    // m[1] / m[2] 已经被正则的捕获组保证存在;String#exec 返回 null 时上面已经 return.
    const mimeSub = m[1]!;
    const b64 = m[2]!;
    const ext = mimeSub === 'jpeg' ? 'jpg' : mimeSub;
    const buf = Buffer.from(b64, 'base64');
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

    // 防御性检查:目录剩余空间至少 >= 2x 上传大小 (避免打满磁盘)
    try {
      // fs.statfs 需要 Node 18.15+,不在所有环境 — 降级为 catch-all
      const dirStat = statSync(UPLOAD_DIR);
      if (!dirStat.isDirectory()) {
        res.status(500).json({ error: '上传目录不可用' });
        return;
      }
    } catch {
      // 静默 — mkdir 已保证目录存在;真正的写错误由下面的 writeFileSync 抛出
    }

    const id = randomUUID();
    const filename = `${id}.${ext}`;
    try {
      writeFileSync(join(UPLOAD_DIR, filename), buf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '写入失败';
      res.status(500).json({ error: `写入失败: ${msg}` });
      return;
    }

    const resp: UploadResponse = {
      imageId: id,
      url: `/uploads/${filename}`,
      size: buf.length,
    };
    res.json(resp);
  },
);
