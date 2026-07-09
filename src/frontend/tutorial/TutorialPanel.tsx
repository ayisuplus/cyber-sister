// 分步教学面板:显示当前妆容 + 步骤指令 + 上一步/下一步/重新开始按钮 + 进度条.
// 视觉层:粉系毛玻璃卡片 + 渐变按钮 + 大圆角 chip 标签

import { useEffect, useRef } from 'react';
import type { MakeupLook, MakeupStep } from '../../shared/types';
import { haptic } from '../utils/haptic';
import { useSwipe } from '../hooks/useSwipe';

interface Props {
  look: MakeupLook;
  stepIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onRestart: () => void;
  onFinish: () => void;
  /** 显示在步骤下方的可选警告 (如"肿泡眼避免珠光"). */
  warnings?: string[];
}

export default function TutorialPanel({
  look,
  stepIndex,
  onPrev,
  onNext,
  onRestart,
  onFinish,
  warnings,
}: Props) {
  const steps = look.steps;
  const step: MakeupStep | undefined = steps[stepIndex];
  const total = steps.length;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === total - 1;

  // 键盘导航: ← 上一步 / → 下一步 / Home 回到起点 / End 跳到结尾
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      }
      if (e.key === 'ArrowLeft' && !isFirst) {
        haptic('select');
        onPrev();
      } else if (e.key === 'ArrowRight' && !isLast) {
        haptic('select');
        onNext();
      } else if (e.key === 'Home' && stepIndex !== 0) {
        haptic('select');
        onRestart();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFirst, isLast, stepIndex, onPrev, onNext, onRestart]);

  // 滑动:左滑下一步, 右滑上一步 (移动端)
  const swipeRef = useRef<HTMLDivElement | null>(null);
  useSwipe(swipeRef, {
    onSwipeLeft: () => {
      if (!isLast) {
        haptic('select');
        onNext();
      }
    },
    onSwipeRight: () => {
      if (!isFirst) {
        haptic('select');
        onPrev();
      }
    },
  });

  if (!step) {
    return <div className="text-sm text-ink-soft/60 text-center py-4">该妆容暂无教学步骤。</div>;
  }

  const progress = ((stepIndex + 1) / total) * 100;

  return (
    <div className="text-left space-y-4" ref={swipeRef}>
      {/* 妆容头信息 */}
      <div>
        <div className="chip-tag mb-1.5">{look.scenario}</div>
        <h2 className="font-serif text-2xl font-bold text-ink mt-1">{look.name}</h2>
        <p className="text-sm text-ink-soft/70 mt-1">{look.reason}</p>
      </div>

      {/* 进度条 */}
      <div>
        <div className="flex justify-between text-xs text-ink-soft/70 mb-1.5">
          <span className="font-medium">
            步骤 {stepIndex + 1} / {total}
          </span>
          <span className="truncate ml-2">{step.title}</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        {/* 步骤小圆点 */}
        <div className="flex justify-between mt-3 px-1">
          {steps.map((_, i) => (
            <div
              key={i}
              className="transition-all rounded-full"
              style={{
                width: i === stepIndex ? 14 : 6,
                height: 6,
                background:
                  i <= stepIndex
                    ? 'linear-gradient(90deg,#EAB6BC,#C86B77)'
                    : 'rgba(234,182,188,0.4)',
              }}
            />
          ))}
        </div>
      </div>

      {/* 步骤主卡 */}
      <div
        className="rounded-3xl p-5 space-y-3"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.95), rgba(253,242,243,0.7))',
          border: '1.5px solid rgba(234,182,188,0.4)',
          boxShadow: '0 8px 24px rgba(200,107,119,0.1)',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-2xl flex items-center justify-center text-sm font-bold text-white"
            style={{
              background: 'linear-gradient(135deg,#EAB6BC,#C86B77)',
              boxShadow: '0 4px 12px rgba(200,107,119,0.3)',
            }}
          >
            {stepIndex + 1}
          </div>
          <div className="font-serif font-bold text-ink text-lg">{step.title}</div>
        </div>

        <p className="text-ink/85 leading-relaxed text-sm">{step.instruction}</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {step.brushDirection && <Tag label="方向" value={step.brushDirection} />}
          {step.toolHint && <Tag label="工具" value={step.toolHint} />}
          {step.colorFamily && <Tag label="色系" value={step.colorFamily} />}
        </div>

        {(step.warnings && step.warnings.length > 0) || (warnings && warnings.length > 0) ? (
          <div
            className="rounded-2xl p-3 space-y-1"
            style={{
              background: 'rgba(234,182,188,0.18)',
              border: '1px dashed rgba(200,107,119,0.3)',
            }}
          >
            {[...(step.warnings ?? []), ...(warnings ?? [])].map((w, i) => (
              <div key={i} className="text-xs text-primary-deep">
                ⚠️ {w}
              </div>
            ))}
          </div>
        ) : null}

        {look.productHints && look.productHints.length > 0 && (
          <div
            className="pt-3 border-t border-dashed"
            style={{ borderColor: 'rgba(200,107,119,0.2)' }}
          >
            <div className="text-[10px] text-ink-soft/60 mb-1.5 uppercase tracking-wide">
              推荐产品 (CPS 占位)
            </div>
            <ul className="space-y-1">
              {look.productHints
                .filter((p) => matchesArea(p.category, step.area))
                .slice(0, 2)
                .map((p, i) => (
                  <li key={i} className="text-xs text-ink-soft/85">
                    <span className="chip-rose mr-1.5">{p.category}</span>
                    <span className="text-ink">{p.shadeFamily}</span>
                    {p.finishType ? ` · ${p.finishType}` : ''}
                    {p.priceRange ? ` · ${p.priceRange}` : ''}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>

      {/* 操作按钮组 */}
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onRestart} className="btn-ghost text-sm">
          ↺ 重新开始
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              haptic('select');
              onPrev();
            }}
            disabled={isFirst}
            className="btn-secondary text-sm py-2 min-h-[44px] active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← 上一步
          </button>
          {isLast ? (
            <button
              type="button"
              onClick={onFinish}
              className="btn-primary text-sm py-2"
              data-finish-button
            >
              完成 →
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                haptic('select');
                onNext();
              }}
              className="btn-primary text-sm py-2 min-h-[44px] active:scale-95 transition-transform"
            >
              下一步 →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Tag({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-2xl px-3 py-2"
      style={{
        background: 'linear-gradient(135deg, rgba(253,242,243,0.9), rgba(234,182,188,0.3))',
        border: '1px solid rgba(234,182,188,0.4)',
      }}
    >
      <div className="text-[10px] text-ink-soft/60 uppercase tracking-wide">{label}</div>
      <div className="text-ink font-semibold text-sm">{value}</div>
    </div>
  );
}

/**
 * 简单的产品分类 → 步骤区域映射.不严格,只是尽量把相关产品显示出来.
 */
function matchesArea(category: string, area: string): boolean {
  const c = category.toLowerCase();
  if (area === 'base' && /粉底|底妆|气垫|bb|cc/.test(c)) return true;
  if (area === 'concealer' && /遮瑕/.test(c)) return true;
  if (area === 'contour' && /修容|阴影|轮廓/.test(c)) return true;
  if (area === 'highlight' && /高光/.test(c)) return true;
  if (area === 'brow' && /眉/.test(c)) return true;
  if (area === 'eye' && /眼影/.test(c)) return true;
  if (area === 'eyeliner' && /眼线/.test(c)) return true;
  if (area === 'lash' && /睫毛|睫毛膏/.test(c)) return true;
  if (area === 'blush' && /腮红/.test(c)) return true;
  if (area === 'lip' && /唇|口红|唇釉/.test(c)) return true;
  return false;
}
