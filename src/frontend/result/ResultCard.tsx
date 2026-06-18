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
  // 闺蜜种草文案专用复制反馈,跟原 copied 区分避免互相覆盖
  const [copiedXhs, setCopiedXhs] = useState(false);

  const tips = pickTopTips(look.steps, 3);
  const summary = `${FACE_SHAPE_CN[features.faceShape] ?? '未知'} + ${SKIN_TONE_CN[features.skinTone] ?? '未知'} + ${EYE_CN[features.eyeType] ?? '未知'}`;
  const shareText = buildShareText(summary, look, tips);
  // 闺蜜口吻的小红书/朋友圈种草文案
  const xhsText = buildXiaohongshuText(features, look, tips);

  // copied state 自动消失
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    if (!copiedXhs) return;
    const t = setTimeout(() => setCopiedXhs(false), 2000);
    return () => clearTimeout(t);
  }, [copiedXhs]);

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

  // 复制函数封装:支持 navigator.clipboard 不可用时降级到 textarea + execCommand
  async function copyToClipboard(text: string): Promise<boolean> {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // fall through
    }
    // 降级方案:用 textarea 选中再 execCommand
    if (typeof document !== 'undefined') {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        return true;
      } catch {
        return false;
      } finally {
        document.body.removeChild(ta);
      }
    }
    return false;
  }

  async function onCopyText() {
    track('result_share', { method: 'copy' });
    const ok = await copyToClipboard(shareText);
    if (ok) setCopied(true);
  }

  async function onCopyXhsText() {
    track('result_share', { method: 'copy_xhs' });
    const ok = await copyToClipboard(xhsText);
    if (ok) setCopiedXhs(true);
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

        {/* 二维码占位:扫码回看教程. 当前阶段用静态占位 SVG,留好接口由后端 /api/share/qrcode 后续替换. */}
        <QrPlaceholder lookId={look.id} />
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

      {/* 闺蜜种草文案区:小红书/朋友圈口吻,一键复制 */}
      <div className="bg-white/70 rounded-2xl p-4 border border-primary/30 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm text-ink/70 font-medium">📝 闺蜜种草文案</div>
          <button
            type="button"
            onClick={onCopyXhsText}
            data-testid="copy-xhs-btn"
            className="text-xs bg-primary text-white px-3 py-1 rounded-full hover:bg-accent"
          >
            {copiedXhs ? '✓ 已复制' : '一键复制'}
          </button>
        </div>
        <pre
          data-testid="xhs-preview"
          className="whitespace-pre-wrap text-xs text-ink/85 leading-relaxed font-sans"
        >
          {xhsText}
        </pre>
      </div>
    </div>
  );
}

// ---------- 二维码占位组件 ----------
// 当前阶段渲染一个内联 SVG 占位图(灰底 + "QR" 字样).
// 后续接 /api/share/qrcode?lookId=xxx 返回真实 PNG/SVG dataURL 时,只需替换 <QrPlaceholder /> 内部实现,
// 其它调用方不受影响.

function QrPlaceholder({ lookId }: { lookId: string }) {
  return (
    <div
      data-testid="qr-placeholder"
      data-look-id={lookId}
      className="mt-4 bg-white/80 rounded-2xl p-3 flex items-center gap-3 border border-dashed border-primary/40"
    >
      {/* 静态 SVG 占位:96x96 像素,后续由后端接口替换 */}
      <svg
        width="72"
        height="72"
        viewBox="0 0 72 72"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="QR placeholder"
        role="img"
      >
        <rect x="0" y="0" width="72" height="72" rx="8" fill="#F4F4F4" />
        {/* 三个定位角标 */}
        <rect x="6" y="6" width="16" height="16" fill="#3F2A2E" />
        <rect x="50" y="6" width="16" height="16" fill="#3F2A2E" />
        <rect x="6" y="50" width="16" height="16" fill="#3F2A2E" />
        <rect x="10" y="10" width="8" height="8" fill="#F4F4F4" />
        <rect x="54" y="10" width="8" height="8" fill="#F4F4F4" />
        <rect x="10" y="54" width="8" height="8" fill="#F4F4F4" />
        <text
          x="36"
          y="42"
          textAnchor="middle"
          fontSize="9"
          fill="#3F2A2E"
          fontFamily="sans-serif"
        >
          QR
        </text>
      </svg>
      <div className="flex-1 text-xs text-ink/70">
        <div className="font-medium text-ink/90">📱 扫码回看教程</div>
        <div className="mt-0.5">打开微信扫一扫,跟着视频一步步画</div>
        <div className="mt-0.5 text-ink/40">lookId: {lookId} (后端接口待接入)</div>
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

// ---------- 闺蜜种草文案 (小红书/朋友圈) ----------
// 格式:
//   标题行: emoji + 妆容名 + 适合脸型
//   正文:   3-5 行闺蜜口吻 (用 "姐妹/宝宝/家人们" 等口语词),包含关键特征和化妆技巧
//   标签:   #妆语 #妆容推荐 等

interface XhsInput {
  features: FaceFeatures;
  look: MakeupLook;
  tips: string[];
}

const XHS_OPENERS = ['姐妹们', '宝宝们', '家人们', '集美们', '宝子们'];

/**
 * 生成小红书风格的种草文案.
 * - 标题: 1 行,emoji + 妆容名 + 适合脸型
 * - 正文: 3-5 行, 闺蜜口吻, 包含特征描述 + 化妆技巧
 * - 标签: 末尾 #妆语 #妆容推荐 + 妆容场景 tag
 */
export function buildXiaohongshuText(
  features: FaceFeatures,
  look: MakeupLook,
  tips?: string[]
): string {
  const faceCn = FACE_SHAPE_CN[features.faceShape] ?? '百搭脸型';
  const skinCn = SKIN_TONE_CN[features.skinTone] ?? '自然肤色';
  const eyeCn = EYE_CN[features.eyeType] ?? '灵动眼型';
  // 标题行:用粉底液 emoji + 妆容名 + "适合 xxx 脸" 句式
  const title = `💄 ${look.name} · 适合${faceCn}`;

  // 闺蜜口吻开场
  const opener = XHS_OPENERS[Math.abs(hashStr(look.id)) % XHS_OPENERS.length] ?? '姐妹们';

  // 正文 3-5 行,根据 features 动态拼
  const bodyLines: string[] = [];
  bodyLines.push(`${opener}挖到宝了! AI 测出来我是 ${faceCn} + ${skinCn} + ${eyeCn}。`);
  bodyLines.push(`这套「${look.name}」真的太适合 ${look.scenario} 了,新手也能驾驭。`);

  // 拼化妆技巧(最多 2 条,优先带 toolHint/brushDirection 的)
  const usedTips = (tips ?? pickTopTips(look.steps, 3)).slice(0, 2);
  if (usedTips.length > 0) {
    bodyLines.push(`几个小心得:${usedTips.map((t) => `「${t}」`).join('、')}。`);
  } else {
    bodyLines.push('整体妆面干净不挑皮,通勤约会都能 hold 住。');
  }
  bodyLines.push('想看完整教程就扫卡片上的二维码回看,姐妹们冲!');

  // 标签
  const tags = ['#妆语', '#妆容推荐', `#${look.scenario.replace(/\s+/g, '')}`, `#${faceCn}`];

  return [title, '', ...bodyLines, '', tags.join(' ')].join('\n');
}

// 简单字符串 hash,用于从 lookId 选 opener (确定性)
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
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
