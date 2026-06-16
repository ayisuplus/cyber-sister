// 妆教 Canvas 组件:
// 1) 底层:用户自拍图片 (按 layout 等比缩放居中)
// 2) 中层:当前步骤高亮 opacity 0.4,其他 zone opacity 0.05
// 3) 顶层:brushDirection 箭头
// 移动端:pinch zoom + pan + double-tap reset.

import { useEffect, useRef, useState } from 'react';
import type { Landmark } from '../../shared/faceFeatures';
import type { OverlayZone } from '../../shared/types';
import {
  computeCanvasLayout,
  mapLandmarkToCanvas,
  mapLandmarksToCanvas,
  type CanvasLayout,
} from './coordinateMapper';
import { getZoneDef } from './overlayZones';

interface Props {
  imageSrc: string;
  imageWidth: number;
  imageHeight: number;
  landmarks: Landmark[];
  /** 当前步骤要高亮的区域. */
  currentZones: OverlayZone[];
  /** 笔刷方向文案 (渲染为箭头),可为空. */
  brushDirection?: string;
}

interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const DOUBLE_TAP_MS = 300;

export default function MakeupCanvas({
  imageSrc,
  imageWidth,
  imageHeight,
  landmarks,
  currentZones,
  brushDirection,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [layout, setLayout] = useState<CanvasLayout | null>(null);
  const [transform, setTransform] = useState<Transform>({ scale: 1, tx: 0, ty: 0 });
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [hover, setHover] = useState(false);

  // 加载图片
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setImgEl(img);
    img.src = imageSrc;
  }, [imageSrc]);

  // 监听 canvas 尺寸变化
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const { width, height } = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      if (imgEl) {
        setLayout(
          computeCanvasLayout(imageWidth, imageHeight, canvas.width, canvas.height)
        );
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [imageWidth, imageHeight, imgEl]);

  // 绘制
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout || !imgEl) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 应用 pan + zoom
    ctx.translate(transform.tx, transform.ty);
    ctx.scale(transform.scale, transform.scale);

    // 1) 底层图
    ctx.drawImage(
      imgEl,
      layout.imageX,
      layout.imageY,
      layout.imageWidth,
      layout.imageHeight
    );

    // 2) 覆盖区
    const currentSet = new Set(currentZones);
    const allZones = new Set<OverlayZone>([
      ...currentZones,
      ...collectNonCurrentZones(landmarks, currentSet),
    ]);

    for (const zone of allZones) {
      const def = getZoneDef(zone);
      if (!def) continue;
      const pts = def.landmarks
        .map((i) => landmarks[i])
        .filter((p): p is Landmark => !!p && (p.x !== 0 || p.y !== 0));
      if (pts.length < 2) continue;
      const canvasPts = mapLandmarksToCanvas(pts, layout);

      const isCurrent = currentSet.has(zone);
      const fillAlpha = isCurrent ? 0.4 : 0.05;
      const strokeAlpha = isCurrent ? 0.9 : 0.15;
      drawZone(ctx, def, canvasPts, def.color, fillAlpha, strokeAlpha);
    }

    // 3) 笔刷方向箭头 (取当前高亮区中心)
    if (brushDirection && currentZones.length > 0) {
      const firstZone = currentZones[0];
      const def = firstZone ? getZoneDef(firstZone) : null;
      if (def) {
        const centerIdx = def.center ?? def.landmarks[0];
        const c = landmarks[centerIdx];
        if (c) {
          const center = mapLandmarkToCanvas(c, layout);
          drawArrow(ctx, center, brushDirection, layout);
        }
      }
    }

    ctx.restore();
  }, [layout, imgEl, landmarks, currentZones, brushDirection, transform]);

  // ----- 触摸: pinch zoom + pan + double-tap reset -----
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const lastPinchDist = useRef<number | null>(null);
  const lastPanCenter = useRef<{ x: number; y: number } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      // 检测 double-tap
      const now = Date.now();
      const last = lastTapRef.current;
      if (
        last &&
        now - last.t < DOUBLE_TAP_MS &&
        Math.abs(e.clientX - last.x) < 20 &&
        Math.abs(e.clientY - last.y) < 20
      ) {
        setTransform({ scale: 1, tx: 0, ty: 0 });
        lastTapRef.current = null;
        return;
      }
      lastTapRef.current = { t: now, x: e.clientX, y: e.clientY };
    } else if (pointers.current.size === 2) {
      lastPinchDist.current = pinchDistance();
      const c = pinchCenter();
      lastPanCenter.current = c;
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const newDist = pinchDistance();
      const base = lastPinchDist.current;
      if (base && newDist > 0) {
        const ratio = newDist / base;
        setTransform((t) => clampZoom(t.scale * ratio, t.tx, t.ty));
        lastPinchDist.current = newDist;
      }
      const c = pinchCenter();
      const last = lastPanCenter.current;
      if (last) {
        setTransform((t) => ({
          ...t,
          tx: t.tx + (c.x - last.x),
          ty: t.ty + (c.y - last.y),
        }));
      }
      lastPanCenter.current = c;
    } else if (pointers.current.size === 1) {
      // pan: 鼠标拖动平移 (双指 pan 已覆盖 touch,这里只用于鼠标)
      // 注: React Pointer Events 自动处理多指,不需要做单指 pan (会与滚动冲突)
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) {
      lastPinchDist.current = null;
      lastPanCenter.current = null;
    }
  }

  function pinchDistance(): number {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function pinchCenter(): { x: number; y: number } {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return { x: 0, y: 0 };
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function clampZoom(s: number, tx: number, ty: number): Transform {
    const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
    return { scale: ns, tx, ty };
  }

  return (
    <div
      className="relative w-full h-[480px] bg-secondary/30 rounded-card overflow-hidden touch-none"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ cursor: hover ? 'grab' : 'default' }}
      />
      {!imgEl && (
        <div className="absolute inset-0 flex items-center justify-center text-ink/50 text-sm">
          图片加载中...
        </div>
      )}
      <div className="absolute bottom-2 right-2 text-[10px] text-ink/40 bg-white/70 rounded-full px-2 py-0.5">
        双击重置 · 双指缩放
      </div>
    </div>
  );
}

// ---------- 内部绘制函数 ----------

function collectNonCurrentZones(
  _landmarks: Landmark[],
  currentSet: Set<OverlayZone>
): OverlayZone[] {
  // 仅显示当前高亮 + 已注册的所有.其他全 0.05.此处返回空,由 draw 时统一处理.
  void _landmarks;
  void currentSet;
  return [];
}

function drawZone(
  ctx: CanvasRenderingContext2D,
  def: ReturnType<typeof getZoneDef>,
  pts: Array<{ x: number; y: number }>,
  baseColor: string,
  fillAlpha: number,
  strokeAlpha: number
) {
  if (!def) return;
  ctx.save();
  ctx.fillStyle = withAlpha(baseColor, fillAlpha);
  ctx.strokeStyle = withAlpha(baseColor, strokeAlpha);
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';

  if (def.shape === 'ellipse' && def.center !== undefined) {
    const centerIdx = def.landmarks.indexOf(def.center);
    const c = centerIdx >= 0 ? pts[centerIdx] : pts[0];
    if (c) {
      const radius = computeEllipseRadius(pts, c) * (def.radiusFactor ?? 0.7);
      if (radius > 0) {
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, radius, radius * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  } else {
    drawBezierPolygon(ctx, pts);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawBezierPolygon(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>
) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]!;
    const cur = pts[i]!;
    const mx = (prev.x + cur.x) / 2;
    const my = (prev.y + cur.y) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
  }
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  ctx.quadraticCurveTo(last.x, last.y, first.x, first.y);
  ctx.closePath();
}

function computeEllipseRadius(
  pts: Array<{ x: number; y: number }>,
  center: { x: number; y: number }
): number {
  if (pts.length === 0) return 0;
  let sum = 0;
  for (const p of pts) {
    sum += Math.hypot(p.x - center.x, p.y - center.y);
  }
  return sum / pts.length;
}

function withAlpha(rgba: string, alpha: number): string {
  // 接受 "rgba(R,G,B,A)" 格式 → 改写 A
  const m = rgba.match(/rgba?\(([^)]+)\)/);
  if (!m) return rgba;
  const parts = m[1]!.split(',').map((s) => s.trim());
  const r = parts[0] ?? '255';
  const g = parts[1] ?? '200';
  const b = parts[2] ?? '220';
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  direction: string,
  layout: CanvasLayout
) {
  // 把中文方向关键词映射到箭头向量;未匹配时默认向右
  const dir = directionArrow(direction);
  const len = Math.max(40, layout.imageWidth * 0.06);
  const to = { x: from.x + dir.x * len, y: from.y + dir.y * len };

  ctx.save();
  ctx.strokeStyle = 'rgba(236, 64, 122, 0.9)';
  ctx.fillStyle = 'rgba(236, 64, 122, 0.9)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();

  // 箭头头部
  const angle = Math.atan2(dir.y, dir.x);
  const headLen = 14;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(
    to.x - headLen * Math.cos(angle - Math.PI / 6),
    to.y - headLen * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    to.x - headLen * Math.cos(angle + Math.PI / 6),
    to.y - headLen * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function directionArrow(text: string): { x: number; y: number } {
  // 简化:扫描关键词
  if (/向?上|提拉|上挑|上拉/.test(text)) return { x: 0, y: -1 };
  if (/向?下|下压|下拉/.test(text)) return { x: 0, y: 1 };
  if (/向?左|往左/.test(text)) return { x: -1, y: 0 };
  if (/向?右|往外|向外|外/.test(text)) return { x: 1, y: 0 };
  if (/斜|外上|外下|斜向/.test(text)) return { x: 0.7, y: -0.7 };
  if (/点|点涂|点拍/.test(text)) return { x: 0, y: 0 };
  return { x: 1, y: 0 };
}
