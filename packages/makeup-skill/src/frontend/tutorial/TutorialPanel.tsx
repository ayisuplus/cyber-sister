// 分步教学面板:显示当前妆容 + 步骤指令 + 上一步/下一步/重新开始按钮 + 进度条.
// 视觉层:粉系毛玻璃卡片 + 渐变按钮 + 大圆角 chip 标签

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MakeupLook, MakeupStep } from '../../shared/types';
import { haptic } from '../utils/haptic';
import { useSwipe } from '../hooks/useSwipe';
import { track } from '../../shared/analytics';
import { annotateInstruction } from './glossary';
import {
  getFavoritesByScenario,
  type FavoriteRecord,
} from '../utils/favorites';

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

  // D12: 场景快速妆标签 — 点击展开同场景收藏方案
  const [showScenarioPanel, setShowScenarioPanel] = useState(false);
  const scenarioFavorites = useMemo<FavoriteRecord[]>(
    () => (showScenarioPanel ? getFavoritesByScenario(look.scenario) : []),
    [showScenarioPanel, look.scenario],
  );

  // 切换场景面板时埋点
  function toggleScenarioPanel() {
    haptic('select');
    const next = !showScenarioPanel;
    setShowScenarioPanel(next);
    track('scenario_tag_tap', {
      look_id: look.id,
      scenario: look.scenario,
      action: next ? 'open' : 'close',
    });
  }

  // 点击某条收藏方案: 记录回看事件 (本地数据无法还原完整妆容, 仅做回看参考)
  function onViewFavorite(rec: FavoriteRecord) {
    haptic('select');
    track('favorite_view', {
      look_id: rec.lookId,
      look_name: rec.lookName,
      scenario: rec.scenario,
      source: 'scenario_panel',
    });
  }

  if (!step) {
    return <div className="text-sm text-ink-soft/60 text-center py-4">该妆容暂无教学步骤。</div>;
  }

  const progress = ((stepIndex + 1) / total) * 100;

  return (
    <div className="text-left space-y-4" ref={swipeRef}>
      {/* 妆容头信息 */}
      <div>
        <div className="relative inline-block">
          <button
            type="button"
            onClick={toggleScenarioPanel}
            aria-expanded={showScenarioPanel}
            aria-label={`查看「${look.scenario}」场景的收藏方案`}
            className="chip-tag mb-1.5 inline-flex items-center gap-1 cursor-pointer active:scale-95 transition-transform"
            style={{ outline: 'none' }}
          >
            {look.scenario}
            <span className="text-[10px] opacity-70">⌄</span>
          </button>
          {showScenarioPanel && (
            <ScenarioFavoritesPanel
              scenario={look.scenario}
              favorites={scenarioFavorites}
              onView={onViewFavorite}
              onClose={() => setShowScenarioPanel(false)}
            />
          )}
        </div>
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

        <AnnotatedInstruction text={step.instruction} />

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

// ---------- D10: 教学术语括注 ----------

/**
 * 渲染带术语标注的教学指令.
 * 术语显示为带虚线下划线的可点击元素, 点击弹出粉色解释气泡; 点别处关闭.
 */
function AnnotatedInstruction({ text }: { text: string }) {
  const segments = useMemo(() => annotateInstruction(text), [text]);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLParagraphElement | null>(null);

  // 点击指令外部时关闭气泡
  useEffect(() => {
    if (openIdx === null) return;
    function onDocDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenIdx(null);
      }
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [openIdx]);

  // 无术语命中: 直接当普通段落渲染, 保持原样式
  if (segments.length === 0 || segments.every((s) => s.type === 'text')) {
    return <p className="text-ink/85 leading-relaxed text-sm">{text}</p>;
  }

  return (
    <p ref={containerRef} className="text-ink/85 leading-relaxed text-sm relative">
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <span key={i}>{seg.content}</span>;
        }
        const isOpen = openIdx === i;
        return (
          <span key={i} className="relative inline">
            <span
              role="button"
              tabIndex={0}
              aria-label={`术语：${seg.term}`}
              onClick={() => {
                haptic('select');
                setOpenIdx(isOpen ? null : i);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  haptic('select');
                  setOpenIdx(isOpen ? null : i);
                }
              }}
              className="cursor-pointer font-medium transition-colors"
              style={{
                color: '#C86B77',
                borderBottom: '1.5px dotted #C86B77',
              }}
            >
              {seg.content}
            </span>
            {isOpen && (
              <span
                role="tooltip"
                className="absolute z-30 left-1/2 top-full mt-1.5 -translate-x-1/2 w-max max-w-[16rem] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-lg"
                style={{
                  background: 'linear-gradient(135deg, #FFF5F6, #FDE2E5)',
                  border: '1px solid rgba(200,107,119,0.35)',
                  boxShadow: '0 8px 24px rgba(200,107,119,0.18)',
                  color: '#5C3942',
                }}
              >
                <span className="block font-bold text-primary-deep mb-0.5">{seg.term}</span>
                <span className="block whitespace-normal">{seg.explain}</span>
                <span
                  className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45"
                  style={{ background: '#FFF5F6', borderLeft: '1px solid rgba(200,107,119,0.35)', borderTop: '1px solid rgba(200,107,119,0.35)' }}
                />
              </span>
            )}
          </span>
        );
      })}
    </p>
  );
}

// ---------- D12: 场景快速妆收藏面板 ----------

/** 把时间戳格式化成 "今天 / 昨天 / X天前" 的相对文案. */
function formatRelative(ts: number): string {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const today = new Date(now);
  const that = new Date(ts);
  const sameDay =
    today.getFullYear() === that.getFullYear() &&
    today.getMonth() === that.getMonth() &&
    today.getDate() === that.getDate();
  if (sameDay) return '今天';
  const diffDays = Math.floor((now - ts) / dayMs);
  if (diffDays <= 1) return '昨天';
  if (diffDays < 7) return `${diffDays} 天前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`;
  return `${that.getMonth() + 1}月${that.getDate()}日`;
}

interface ScenarioFavoritesPanelProps {
  scenario: string;
  favorites: FavoriteRecord[];
  onView: (rec: FavoriteRecord) => void;
  onClose: () => void;
}

/**
 * 同场景收藏方案面板. 点场景标签弹出, 列出该场景已收藏的妆容.
 * 有收藏: 列表展示, 每条可点击回看 (记录 favorite_view 事件).
 * 无收藏: 友好提示引导收藏.
 */
function ScenarioFavoritesPanel({
  scenario,
  favorites,
  onView,
  onClose,
}: ScenarioFavoritesPanelProps) {
  return (
    <>
      {/* 透明遮罩: 点击关闭面板 */}
      <div
        className="fixed inset-0 z-20"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-label={`「${scenario}」场景的收藏方案`}
        className="absolute z-30 left-0 top-full mt-1.5 w-72 max-w-[80vw] rounded-3xl p-3.5 space-y-2"
        style={{
          background: 'linear-gradient(135deg, #FFF5F6, #FDE2E5)',
          border: '1.5px solid rgba(200,107,119,0.35)',
          boxShadow: '0 12px 32px rgba(200,107,119,0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5 pb-1.5 border-b border-dashed" style={{ borderColor: 'rgba(200,107,119,0.2)' }}>
          <span className="text-sm">🔖</span>
          <span className="text-xs font-semibold text-primary-deep">{scenario} · 收藏方案</span>
        </div>
        {favorites.length === 0 ? (
          <div className="text-xs text-ink-soft/70 py-2 text-center leading-relaxed">
            收藏过这个场景的妆容后，<br />可以快速回看哦～
          </div>
        ) : (
          <ul className="space-y-1.5 max-h-56 overflow-y-auto">
            {favorites.map((rec) => (
              <li key={rec.id}>
                <button
                  type="button"
                  onClick={() => onView(rec)}
                  className="w-full text-left rounded-2xl px-3 py-2 active:scale-[0.98] transition-transform"
                  style={{
                    background: 'rgba(255,255,255,0.7)',
                    border: '1px solid rgba(234,182,188,0.4)',
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-ink truncate">{rec.lookName}</span>
                    <span className="text-[10px] text-ink-soft/60 flex-shrink-0">
                      {formatRelative(rec.savedAt)}
                    </span>
                  </div>
                  <div className="text-[10px] text-ink-soft/60 mt-0.5 truncate">
                    {rec.features.faceShape} · {rec.features.skinTone} · {rec.features.eyeType}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
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
