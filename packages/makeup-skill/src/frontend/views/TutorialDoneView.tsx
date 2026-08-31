import { useState } from 'react';
import type { FaceFeatures, MakeupLook } from '../../shared/types';
import { track } from '../../shared/analytics';
import { haptic } from '../utils/haptic';
import {
  addFavorite,
  findFavoriteByLookId,
  isFavorited,
  removeFavorite,
} from '../utils/favorites';

interface Props {
  look: MakeupLook;
  /** 分析五官; tutorial_done 阶段 state 未携带, 由 App 通过 featuresRef 透传, 可能为 null. */
  features: FaceFeatures | null;
  /** D9: 打开问卷页回调. */
  onOpenSurvey: () => void;
  /** User-controlled transition to the result card. */
  onContinue: () => void;
}

/**
 * 教学完成页: "恭喜完成" + 进度条过渡 + 收藏入口.
 * 收藏按钮在 1.8s 过渡窗口内可快速点按; 完整收藏体验在 ResultCard 也有.
 */
export function TutorialDoneView({ look, features, onOpenSurvey, onContinue }: Props) {
  const [favorited, setFavorited] = useState<boolean>(() => isFavorited(look.id));

  function toggleFavorite() {
    if (favorited) {
      const rec = findFavoriteByLookId(look.id);
      if (rec) removeFavorite(rec.id);
      track('favorite_toggle', { look_id: look.id, action: 'remove', source: 'done' });
      haptic('tap');
      setFavorited(false);
    } else {
      addFavorite({
        lookId: look.id,
        lookName: look.name,
        scenario: look.scenario,
        features: {
          faceShape: features?.faceShape ?? 'unknown',
          skinTone: features?.skinTone ?? 'unknown',
          eyeType: features?.eyeType ?? 'unknown',
          confidence: features?.confidence ?? 0,
        },
      });
      track('favorite_toggle', { look_id: look.id, action: 'add', source: 'done' });
      haptic('success');
      setFavorited(true);
    }
  }

  return (
    <div className="py-12 text-center">
      <div
        className="w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center text-4xl animate-glow"
        style={{ background: 'linear-gradient(135deg,#EAB6BC,#C86B77)' }}
      >
        🎉
      </div>
      <h2 className="font-serif text-2xl font-bold text-ink mb-2">恭喜完成 {look.name}！</h2>
      <p className="text-ink-soft/70">教程已完成，你可以继续查看总结。</p>
      <div className="mt-6 mx-auto w-32 progress-track">
        <div
          className="progress-fill animate-shimmer"
          style={{
            background: 'linear-gradient(90deg,#EAB6BC 0%,#C86B77 50%,#EAB6BC 100%)',
            backgroundSize: '200% 100%',
            width: '100%',
          }}
        />
      </div>

      {/* D11: 收藏这个妆容 (本地, 7 日内可回看) */}
      <div className="mt-6">
        <button
          type="button"
          onClick={toggleFavorite}
          data-testid="done-favorite-btn"
          aria-pressed={favorited}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-5 rounded-full font-medium text-sm active:scale-95 transition-all"
          style={{
            background: favorited
              ? 'linear-gradient(135deg,#EAB6BC,#C86B77)'
              : 'rgba(234,182,188,0.25)',
            color: favorited ? '#fff' : '#C86B77',
            boxShadow: favorited ? '0 4px 12px rgba(200,107,119,0.3)' : 'none',
            border: favorited ? 'none' : '1.5px solid rgba(200,107,119,0.35)',
          }}
        >
          <span>{favorited ? '✓' : '⭐'}</span>
          <span>{favorited ? '已收藏' : '收藏这个妆容'}</span>
        </button>
      </div>

      {/* D9: 问卷入口 — 帮我们做得更好 */}
      <div className="mt-4">
        <button
          type="button"
          onClick={onContinue}
          className="btn-primary w-full min-h-[48px] mb-3"
        >
          查看妆容总结 →
        </button>
        <button
          type="button"
          onClick={onOpenSurvey}
          data-testid="done-survey-btn"
          className="inline-flex items-center gap-1.5 min-h-[44px] px-5 rounded-full font-medium text-sm active:scale-95 transition-all"
          style={{
            background: 'rgba(234,182,188,0.15)',
            color: '#C86B77',
            border: '1.5px dashed rgba(200,107,119,0.3)',
          }}
        >
          <span aria-hidden="true">📋</span>
          <span>帮我们做得更好</span>
        </button>
      </div>
    </div>
  );
}
