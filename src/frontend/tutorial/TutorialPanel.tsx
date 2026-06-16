// 分步教学面板:显示当前妆容 + 步骤指令 + 上一步/下一步/重新开始按钮 + 进度条.

import type { MakeupLook, MakeupStep } from '../../shared/types';

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

  if (!step) {
    return (
      <div className="text-sm text-ink/60">该妆容暂无教学步骤。</div>
    );
  }

  const progress = ((stepIndex + 1) / total) * 100;

  return (
    <div className="text-left space-y-4">
      <div>
        <div className="text-xs text-accent font-medium uppercase tracking-wide">
          {look.scenario}
        </div>
        <h2 className="text-2xl font-semibold text-ink mt-1">{look.name}</h2>
        <p className="text-sm text-ink/70 mt-1">{look.reason}</p>
      </div>

      <div>
        <div className="flex justify-between text-xs text-ink/60 mb-1">
          <span>
            步骤 {stepIndex + 1} / {total}
          </span>
          <span>{step.title}</span>
        </div>
        <div className="w-full h-2 bg-secondary/40 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="bg-white border-2 border-secondary rounded-2xl p-4 space-y-3">
        <div className="font-semibold text-ink text-lg">{step.title}</div>
        <p className="text-ink/80 leading-relaxed text-sm">{step.instruction}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {step.brushDirection && (
            <Tag label="方向" value={step.brushDirection} />
          )}
          {step.toolHint && <Tag label="工具" value={step.toolHint} />}
          {step.colorFamily && <Tag label="色系" value={step.colorFamily} />}
        </div>

        {(step.warnings && step.warnings.length > 0) || (warnings && warnings.length > 0) ? (
          <ul className="text-xs text-accent bg-accent/5 border border-accent/20 rounded-xl p-2 space-y-1">
            {[...(step.warnings ?? []), ...(warnings ?? [])].map((w, i) => (
              <li key={i}>⚠️ {w}</li>
            ))}
          </ul>
        ) : null}

        {look.productHints && look.productHints.length > 0 && (
          <div className="pt-2 border-t border-secondary/60">
            <div className="text-xs text-ink/60 mb-1">推荐产品 (CPS 占位)</div>
            <ul className="text-xs text-ink/70 space-y-0.5">
              {look.productHints
                .filter((p) => matchesArea(p.category, step.area))
                .slice(0, 2)
                .map((p, i) => (
                  <li key={i}>
                    <span className="font-medium text-ink">{p.category}</span> · {p.shadeFamily}
                    {p.finishType ? ` · ${p.finishType}` : ''}
                    {p.priceRange ? ` · ${p.priceRange}` : ''}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 justify-between">
        <button
          type="button"
          onClick={onRestart}
          className="text-sm text-ink/60 hover:text-ink px-3 py-1.5 rounded-full"
        >
          ↺ 重新开始
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onPrev}
            disabled={isFirst}
            className="bg-white border-2 border-primary text-accent hover:bg-secondary/30 disabled:opacity-40 disabled:cursor-not-allowed font-medium px-4 py-1.5 rounded-full text-sm"
          >
            ← 上一步
          </button>
          {isLast ? (
            <button
              type="button"
              onClick={onFinish}
              className="bg-gradient-to-r from-primary to-accent text-white font-medium px-4 py-1.5 rounded-full text-sm shadow-soft"
            >
              完成 →
            </button>
          ) : (
            <button
              type="button"
              onClick={onNext}
              className="bg-gradient-to-r from-primary to-accent text-white font-medium px-4 py-1.5 rounded-full text-sm shadow-soft"
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
    <div className="bg-secondary/30 rounded-xl px-3 py-2">
      <div className="text-ink/50 text-[10px] uppercase tracking-wide">{label}</div>
      <div className="text-ink font-medium">{value}</div>
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
