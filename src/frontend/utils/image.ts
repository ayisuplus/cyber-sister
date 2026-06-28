// 图片压缩工具 — 在上传到服务器之前在浏览器里 resize + 转 JPEG.
// 移动端自拍常 4-12 MB;人脸检测只需要 ~512px,大图只浪费带宽和启动时间.

const MAX_DIMENSION = 1280; // 上限长边 — 超过这个就等比缩放
const JPEG_QUALITY = 0.86;

interface CompressOptions {
  /** 长边上限,默认 1280. */
  maxDimension?: number;
  /** JPEG 质量 0..1,默认 0.86. */
  quality?: number;
  /** 最大输出字节,超过就再降质量重试. */
  maxBytes?: number;
}

/**
 * 把 File / Blob 加载为 HTMLImageElement.
 */
function loadImage(src: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(src);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片加载失败'));
    };
    img.src = url;
  });
}

/**
 * 等比缩放到长边 <= maxDimension.
 */
function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  if (w >= h) return { width: max, height: Math.round((h * max) / w) };
  return { width: Math.round((w * max) / h), height: max };
}

/**
 * 把 canvas 转成 Blob. 优先 image/jpeg,失败回退 image/png.
 */
function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error(`canvas.toBlob(${type}) 返回 null`))),
      type,
      quality,
    );
  });
}

/**
 * 压缩图片:
 * - 等比缩放到长边 <= maxDimension (默认 1280)
 * - 编码为 JPEG, 质量 0.86
 * - 若结果仍 > maxBytes (默认 1.5 MB), 降质量重试 (0.7 → 0.5)
 *
 * @returns 压缩后的 Blob (image/jpeg) — 调用方再 .arrayBuffer() / 走 fetch.
 */
export async function compressImage(
  source: Blob,
  opts: CompressOptions = {},
): Promise<Blob> {
  const maxDim = opts.maxDimension ?? MAX_DIMENSION;
  const maxBytes = opts.maxBytes ?? 1_500_000;

  const img = await loadImage(source);
  const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, maxDim);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(img, 0, 0, width, height);

  // 渐进降质量
  const qualities = [opts.quality ?? JPEG_QUALITY, 0.7, 0.5];
  let lastError: unknown = null;
  for (const q of qualities) {
    try {
      const blob = await canvasToBlob(canvas, 'image/jpeg', q);
      if (blob.size <= maxBytes) return blob;
      // 还在循环:下一轮降质量
      if (q === qualities[qualities.length - 1]) return blob;
    } catch (e) {
      lastError = e;
    }
  }
  // 走完三档仍超限 — 返回最后一档结果 (已经尽力)
  return canvasToBlob(canvas, 'image/jpeg', 0.5).catch((e) => {
    throw lastError ?? e;
  });
}

/** 把 Blob 转成 data URL (用于 fetch body). */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader 失败'));
    reader.readAsDataURL(blob);
  });
}
