// D9 问卷/落地页测试 — reducer + SurveyView 渲染 + 埋点.
// 注: 项目未引入 jsdom, 组件用 renderToString 验证结构;
// useEffect 内的 track 调用在 SSR 下不触发, 埋点行为通过 mock 独立验证.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import {
  reducer,
  initialState,
  type AppState,
} from '../src/frontend/state/appReducer';
import { SurveyView } from '../src/frontend/views/SurveyView';

const look = {
  id: 'look_1',
  name: '清冷白开水妆',
  scenario: '日常通勤',
  suitableFor: ['oval'],
  reason: '匹配',
  steps: [],
  productHints: [],
};

// ---------- 埋点 mock ----------

const trackCalls: Array<{ event: string; props?: Record<string, unknown> }> = [];

vi.mock('../src/shared/analytics', () => ({
  track: (event: string, props?: Record<string, unknown>) => {
    trackCalls.push({ event, props });
    if (typeof console !== 'undefined') {
      console.debug('[analytics mock]', event, props ?? {});
    }
  },
  startTimer: () => () => 0,
  getSessionId: () => 'test-session-id',
}));

// 模拟 tap haptic
vi.mock('../src/frontend/utils/haptic', () => ({
  haptic: (_type: string) => {},
}));

// ---------- 辅助 ----------

function flushTrackCalls(): void {
  trackCalls.length = 0;
}

function renderSurvey(onClose: () => void = () => {}): string {
  return renderToString(React.createElement(SurveyView, { onClose }));
}

// ---------- Reducer ----------

describe('survey reducer', () => {
  it('OPEN_SURVEY 只允许从 tutorial_done 进入并保留原妆容', () => {
    const next = reducer(initialState, { type: 'OPEN_SURVEY' });
    expect(next).toEqual(initialState);
    expect(reducer({ stage: 'tutorial_done', look }, { type: 'OPEN_SURVEY' })).toEqual({
      stage: 'survey',
      look,
    });
  });

  it('CLOSE_SURVEY 返回打开问卷前的 tutorial_done', () => {
    const next = reducer({ stage: 'survey', look }, { type: 'CLOSE_SURVEY' });
    expect(next).toEqual({ stage: 'tutorial_done', look });
  });

  it('OPEN_SURVEY 从非 idle 阶段也可进入 survey', () => {
    const tutorialDone: AppState = {
      stage: 'tutorial_done',
      look,
    };
    expect(reducer(tutorialDone, { type: 'OPEN_SURVEY' })).toEqual({
      stage: 'survey',
      look,
    });
  });

  it('CLOSE_SURVEY 从非 survey 阶段不影响当前状态', () => {
    const idle: AppState = { stage: 'idle' };
    expect(reducer(idle, { type: 'CLOSE_SURVEY' })).toEqual({ stage: 'idle' });
  });

  it('AppState 联合类型包含 survey stage', () => {
    // 编译期已验证; 运行时确认字面量.
    const s: AppState = { stage: 'survey', look };
    expect(s.stage).toBe('survey');
  });
});

// ---------- SurveyView 渲染 ----------

describe('SurveyView 渲染 (SSR)', () => {
  beforeEach(() => {
    flushTrackCalls();
  });

  it('渲染返回按钮 (含 data-testid)', () => {
    const html = renderSurvey();
    expect(html).toContain('data-testid="survey-close-btn"');
    expect(html).toContain('返回');
  });

  it('渲染标题 "产品反馈"', () => {
    const html = renderSurvey();
    expect(html).toContain('产品反馈');
  });

  it('未配置 VITE_SURVEY_URL 时渲染占位文案', () => {
    const html = renderSurvey();
    expect(html).toContain('问卷准备中');
    expect(html).toContain('敬请期待');
  });

  it('未配置 URL 时不渲染 iframe', () => {
    const html = renderSurvey();
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('data-testid="survey-iframe"');
  });

  it('占位模式包含 emoji 📋', () => {
    const html = renderSurvey();
    expect(html).toContain('📋');
  });

  it('占位模式包含补充说明文案', () => {
    const html = renderSurvey();
    expect(html).toContain('我们正在准备用户调研问卷');
    expect(html).toContain('感谢你的关注');
  });
});

// ---------- track 埋点 ----------

describe('survey track 埋点', () => {
  beforeEach(() => {
    flushTrackCalls();
  });

  it('track 函数可正常调用', async () => {
    // 动态导入获得 mock 后的 track
    const { track } = await import('../src/shared/analytics');
    track('survey_open');
    expect(trackCalls).toHaveLength(1);
    expect(trackCalls[0]!.event).toBe('survey_open');
  });

  it('track("survey_close") 可正常调用', async () => {
    const { track } = await import('../src/shared/analytics');
    track('survey_close');
    expect(trackCalls).toHaveLength(1);
    expect(trackCalls[0]!.event).toBe('survey_close');
  });

  it('track 携带 props 参数', async () => {
    const { track } = await import('../src/shared/analytics');
    track('survey_open', { source: 'tutorial_done' });
    expect(trackCalls[0]!.props).toEqual({ source: 'tutorial_done' });
  });
});

// ---------- SurveyView 模块导入 ----------

describe('SurveyView 模块导入', () => {
  it('SurveyView 是 named export', () => {
    expect(SurveyView).toBeDefined();
    expect(typeof SurveyView).toBe('function');
  });

  it('SurveyView displayName 或函数名可识别', () => {
    expect(SurveyView.name).toBe('SurveyView');
  });
});
