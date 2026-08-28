import { useEffect } from 'react';
import { track } from '../../shared/analytics';
import { haptic } from '../utils/haptic';

/** 从 Vite 环境变量读取腾讯问卷外链; 未配置时为空字符串 → 展示占位. */
const SURVEY_URL: string = import.meta.env.VITE_SURVEY_URL ?? '';

interface Props {
  onClose: () => void;
}

/**
 * D9 问卷/落地页 — 嵌入或链接到腾讯问卷.
 *
 * 两种模式:
 * - 已配置 VITE_SURVEY_URL: 内嵌 iframe 展示问卷.
 * - 未配置: 展示友好占位 "问卷准备中，敬请期待～".
 *
 * 埋点: 进入时 track('survey_open'), 关闭时 track('survey_close').
 */
export function SurveyView({ onClose }: Props) {
  useEffect(() => {
    track('survey_open');
  }, []);

  function handleClose() {
    haptic('tap');
    track('survey_close');
    onClose();
  }

  return (
    <div className="py-4">
      {/* 顶部返回栏 */}
      <div className="flex items-center gap-3 mb-4">
        <button
          type="button"
          onClick={handleClose}
          data-testid="survey-close-btn"
          className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full font-medium text-sm active:scale-95 transition-all"
          style={{
            background: 'rgba(234,182,188,0.25)',
            color: '#C86B77',
            border: '1.5px solid rgba(200,107,119,0.35)',
          }}
        >
          <span aria-hidden="true">←</span>
          <span>返回</span>
        </button>
        <h2 className="font-serif text-xl font-bold text-ink">产品反馈</h2>
      </div>

      {SURVEY_URL ? (
        /* 有问卷 URL: 内嵌 iframe */
        <div
          className="w-full overflow-hidden rounded-2xl"
          style={{ height: '70vh' }}
        >
          <iframe
            src={SURVEY_URL}
            title="产品反馈问卷"
            data-testid="survey-iframe"
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            loading="lazy"
          />
        </div>
      ) : (
        /* 无问卷 URL: 友好占位 */
        <div className="py-12 text-center">
          <div
            className="w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center text-4xl"
            style={{ background: 'rgba(234,182,188,0.4)' }}
          >
            📋
          </div>
          <h3 className="font-serif text-xl font-bold text-ink mb-3">问卷准备中</h3>
          <p className="text-ink-soft/70 mb-2">敬请期待～</p>
          <p className="text-xs text-ink-soft/50">
            我们正在准备用户调研问卷，
            <br />
            感谢你的关注！
          </p>
        </div>
      )}
    </div>
  );
}
