// 小红书风格分享卡:
// 1) 脸型分析摘要 (中文)
// 2) 推荐妆容 + 3 条关键技巧
// 3) 保存图片 (canvas → PNG 下载)
// 4) 复制文案 (Clipboard API)

import { useEffect, useRef, useState } from 'react';
import type { FaceFeatures, MakeupLook, MakeupStep } from '../../shared/types';
import { track } from '../../shared/analytics';

interface Props {
  features: FaceFeatures;
  look: MakeupLook;
}

const FACE_SHAPE_CN: Record<string, string> = {
  oval: '椭圆脸',
  round: '圆脸',
  square: '方脸',
  heart: '心形脸',
  long: '长脸',
  diamond: '菱形脸',
  unknown: '未知',
};

const SKIN_TONE_CN: Record<string, string> = {
  cool_fair: '冷白皮',
  cool_medium: '冷黄一白',
  neutral_fair: '中性一白',
  neutral_medium: '中性二白',
  warm_fair: '暖白皮',
  warm_medium: '暖黄一白',
  warm_deep: '暖黄二白',
  warm_deep_dark: '暖深色',
  unknown: '未知',
};

const EYE_CN: Record<string, string> = {
  almond: '杏眼',
  round: '圆眼',
  hooded: '肿泡眼',
  monolid: '单眼皮',
  downturned: '下垂眼',
  upturned: '上挑眼',
  close_set: '眼距近',
  wide_set: '眼距远',
  unknown: '未知',
};

export default function ResultCard({ features, look }: Props) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);

  const tips = pickTopTips(look.steps, 3);
  const summary = `${FACE_SHAPE_CN[features.faceShape] ?? '未知'} + ${SKIN_TONE_CN[features.skinTone] ?? '未知'} + ${EYE_CN[features.eyeType] ?? '未知'}`;
  const shareText = buildShareText(summary, look, tips);

  // copied state 自动消失
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function onSaveImage() {
    track('result_share', { method: 'image' });
    const card = cardRef.current;
    if (!card) return;
    try {
      // 用 html-to-image 风格的轻量方案:这里直接用 SVG foreignObject 把 DOM 转图片.
      // MVP 阶段不引依赖,改成手动 CSS snapshot:用 canvas 重绘.
      const dataUrl = renderCardToPng(card, summary, look, tips);
      if (!dataUrl) return;
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `妆语-${look.name}.png`;
      a.click();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('save image failed', err);
    }
  }

  async function onCopyText() {
    track('result_share', { method: 'copy' });
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareText);
        setCopied(true);
        return;
      }
    } catch {
      // fall through
    }
    // 降级:用 textarea 选中
    const ta = document.createElement('textarea');
    ta.value = shareText;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      setCopied(true);
    } catch {
      /* ignore */
    }
    document.body.removeChild(ta);
  }

  return (
    <div className="text-left space-y-4">
      <div
        ref={cardRef}
        className="bg-gradient-to-br from-primary/30 to-accent/20 border-2 border-white rounded-card p-6 shadow-soft"
        style={{ fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif' }}
      >
        <div className="text-center mb-4">
          <div className="text-xs text-ink/60 tracking-widest">妆语 AI 妆教</div>
          <div className="font-hand text-3xl text-accent mt-1">我的脸型报告</div>
        </div>

        <div className="bg-white/80 rounded-2xl p-4 mb-3">
          <div className="text-sm text-ink/70">✨ 我的五官</div>
          <div className="text-lg text-ink font-semibold mt-1">{summary}</div>
          <div className="text-xs text-ink/50 mt-1">三庭 {format3(features)} · 五眼 {features.fiveEyeFit.toFixed(2)} · 置信度 {features.confidence.toFixed(2)}</div>
        </div>

        <div className="bg-white/80 rounded-2xl p-4 mb-3">
          <div className="text-sm text-ink/70">💄 推荐妆容</div>
          <div className="text-lg text-ink font-semibold mt-1">{look.name}</div>
          <div className="text-xs text-ink/60 mt-1">{look.scenario}</div>
        </div>

        <div className="bg-white/80 rounded-2xl p-4">
          <div className="text-sm text-ink/70">💡 3 个关键技巧</div>
          <ol className="mt-2 space-y-1 text-sm text-ink/90 list-decimal list-inside">
            {tips.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </div>

        <div className="text-center text-[10px] text-ink/40 mt-4">
          妆语 · 让 AI 教你画自己的脸
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={onSaveImage}
          className="flex-1 bg-gradient-to-r from-primary to-accent text-white font-medium px-4 py-2.5 rounded-full shadow-soft"
        >
          🖼️ 保存图片
        </button>
        <button
          type="button"
          onClick={onCopyText}
          className="flex-1 bg-white border-2 border-primary text-accent hover:bg-secondary/30 font-medium px-4 py-2.5 rounded-full"
        >
          {copied ? '✓ 已复制' : '📋 复制文案'}
        </button>
      </div>
    </div>
  );
}

// ---------- 工具 ----------

function format3(features: FaceFeatures): string {
  return `${features.upperThirdRatio.toFixed(2)} / ${features.middleThirdRatio.toFixed(2)} / ${features.lowerThirdRatio.toFixed(2)}`;
}

function pickTopTips(steps: MakeupStep[], n: number): string[] {
  // 优先取有 brushDirection 或 toolHint 的步骤作为"技巧"展示.
  const scored = steps.map((s) => ({
    s,
    score: (s.brushDirection ? 2 : 0) + (s.toolHint ? 1 : 0) + (s.warnings && s.warnings.length ? 1 : 0),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map((x) => {
    const parts: string[] = [x.s.instruction];
    if (x.s.brushDirection) parts.push(`方向: ${x.s.brushDirection}`);
    if (x.s.toolHint) parts.push(`工具: ${x.s.toolHint}`);
    return parts.join(' · ');
  });
}

function buildShareText(
  summary: string,
  look: MakeupLook,
  tips: string[]
): string {
  return [
    '🌸 妆语 AI 妆教 — 我的脸型报告',
    `✨ 五官：${summary}`,
    `💄 推荐妆容：${look.name}`,
    `💡 ${tips.length} 个技巧：`,
    ...tips.map((t, i) => `${i + 1}. ${t}`),
  ].join('\n');
}

/**
 * 用 canvas 把卡片 DOM 简单"重绘"为 PNG.
 * 不引 html-to-image,直接根据 props 生成像素. 文字用 canvas 排版.
 */
function renderCardToPng(
  _card: HTMLElement,
  summary: string,
  look: MakeupLook,
  tips: string[]
): string | null {
  const canvas = document.createElement('canvas');
  const W = 720;
  const H = 900;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // 背景:粉渐变
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#FFE4EC');
  grad.addColorStop(1, '#FFD1DC');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 白色圆角卡片
  const padX = 40;
  const padY = 60;
  const cardW = W - padX * 2;
  const cardH = H - padY * 2;
  roundRect(ctx, padX, padY, cardW, cardH, 24);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 4;
  ctx.stroke();

  // 标题
  ctx.fillStyle = '#FF69B4';
  ctx.font = 'bold 36px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('妆语 AI 妆教', W / 2, padY + 60);
  ctx.font = '28px "Ma Shan Zheng", "PingFang SC", cursive';
  ctx.fillStyle = '#FF69B4';
  ctx.fillText('我的脸型报告', W / 2, padY + 110);

  // 五官
  ctx.textAlign = 'left';
  let y = padY + 170;
  ctx.fillStyle = '#7A6A6E';
  ctx.font = '16px sans-serif';
  ctx.fillText('✨ 我的五官', padX + 30, y);
  ctx.fillStyle = '#3F2A2E';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(summary, padX + 30, y + 36);

  // 妆容
  y += 100;
  ctx.fillStyle = '#7A6A6E';
  ctx.font = '16px sans-serif';
  ctx.fillText('💄 推荐妆容', padX + 30, y);
  ctx.fillStyle = '#3F2A2E';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(`${look.name} (${look.scenario})`, padX + 30, y + 32);

  // 技巧
  y += 90;
  ctx.fillStyle = '#7A6A6E';
  ctx.font = '16px sans-serif';
  ctx.fillText('💡 关键技巧', padX + 30, y);
  ctx.font = '18px sans-serif';
  ctx.fillStyle = '#3F2A2E';
  for (let i = 0; i < tips.length; i++) {
    const t = tips[i]!;
    const lines = wrapText(ctx, `${i + 1}. ${t}`, cardW - 60, 18);
    for (const line of lines) {
      y += 28;
      ctx.fillText(line, padX + 30, y);
    }
    y += 8;
  }

  // 页脚
  ctx.fillStyle = '#3F2A2E';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('妆语 · 让 AI 教你画自己的脸', W / 2, H - 30);

  return canvas.toDataURL('image/png');
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  _fontSize: number
): string[] {
  // 按字符截断 (中文不按空格分词)
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line.length > 0) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}
