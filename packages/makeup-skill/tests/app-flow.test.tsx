// app-flow.test.tsx — App.tsx 状态机渲染分支 + 副作用编排测试.
//
// 策略 (SSR 无 jsdom):
// - vi.mock('react'): useReducer 返回注入的 state + 记录用 dispatch;
//   useState/useRef 用跨 render 持久的 slot (模拟同一组件实例);
//   useEffect 捕获回调, 测试中按 stage 手动触发真实 effect 体.
// - 带处理器的子视图全部 stub 并捕获 props, 渲染后调用捕获到的
//   onImagePicked/onAnalyze/onContinue/onSelect/... 驱动 App 的真实回调.
//   阶段选择逻辑 (state.stage → 视图) 是被测对象, 不 mock.
// - loader/landmarks/edgeCases/image/fetch 等重依赖 mock 成可控 vi.fn;
//   document.createElement('canvas') 与 Image 用最小 fake 全局补足.
// - lazy 组件首渲染走 Suspense fallback, flush 后重渲染得到 stub 内容.

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import type { FaceFeatures, MakeupLook, MakeupStep } from '../src/shared/types';
import type { AppState } from '../src/frontend/state/appReducer';

// ---------- 共享控制块 (hoisted) ----------

const ctl = vi.hoisted(() => ({
  /** useReducer 注入的 state. */
  state: null as unknown,
  /** dispatch 记录. */
  dispatchCalls: [] as Array<Record<string, unknown>>,
  /** useState 持久 slot (跨 render). */
  stateSlots: [] as Array<{ value: unknown }>,
  stateCursor: 0,
  /** useRef 持久 slot (跨 render). */
  refSlots: [] as Array<{ current: unknown }>,
  refCursor: 0,
  /** 每次 render 捕获的 useEffect 回调. */
  effects: [] as Array<() => unknown>,
  /** track 埋点记录. */
  trackCalls: [] as Array<{ event: string; props?: Record<string, unknown> }>,
  /** 子视图 stub 捕获的 props. */
  captured: {} as Record<string, Record<string, unknown>>,
  /** fake 全局开关: Image 加载失败 / canvas ctx 为 null. */
  imgFails: false,
  ctxNull: false,
}));

vi.mock('react', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof React & Record<string, unknown>;
  return {
    ...actual,
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED:
      actual['__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED'],
    useReducer: (): [unknown, (a: Record<string, unknown>) => void] => [
      ctl.state,
      (a) => {
        ctl.dispatchCalls.push(a);
      },
    ],
    useState: <T,>(initial: T | (() => T)): [T, (v: T | ((p: T) => T)) => void] => {
      const i = ctl.stateCursor++;
      const slot = (ctl.stateSlots[i] ??= {
        value: typeof initial === 'function' ? (initial as () => T)() : initial,
      });
      const set = (v: T | ((p: T) => T)) => {
        slot.value = typeof v === 'function' ? (v as (p: T) => T)(slot.value as T) : v;
      };
      return [slot.value as T, set];
    },
    useRef: <T,>(initial: T): { current: T } => {
      const i = ctl.refCursor++;
      return (ctl.refSlots[i] ??= { current: initial }) as { current: T };
    },
    useEffect: (fn: () => unknown): void => {
      ctl.effects.push(fn);
    },
  };
});

vi.mock('../src/shared/analytics', () => ({
  track: (event: string, props?: Record<string, unknown>) => {
    ctl.trackCalls.push({ event, props });
  },
  startTimer: () => () => 123,
  getSessionId: () => 'test-session-id',
}));

// ---------- 子视图 stub (捕获 props, 不 mock 阶段选择逻辑) ----------

vi.mock('../src/frontend/views/OnboardingView', () => ({
  OnboardingView: (p: Record<string, unknown>) => {
    ctl.captured['onboarding'] = p;
    return <div data-view="onboarding" />;
  },
}));

vi.mock('../src/frontend/views/ReadyView', () => ({
  ReadyView: (p: Record<string, unknown>) => {
    ctl.captured['ready'] = p;
    return <div data-view="ready">{String(p['previewUrl'])}</div>;
  },
}));

vi.mock('../src/frontend/views/AnalysisDoneView', () => ({
  AnalysisDoneView: (p: Record<string, unknown>) => {
    ctl.captured['analysisDone'] = p;
    return <div data-view="analysis-done" />;
  },
}));

vi.mock('../src/frontend/views/LooksReadyView', () => ({
  LooksReadyView: (p: Record<string, unknown>) => {
    ctl.captured['looksReady'] = p;
    const ex = p['explanation'] as { text: string; source: string } | null;
    return <div data-view="looks">{ex ? `${ex.source}:${ex.text}` : 'no-explanation'}</div>;
  },
}));

vi.mock('../src/frontend/views/TutorialView', () => ({
  TutorialView: (p: Record<string, unknown>) => {
    ctl.captured['tutorial'] = p;
    return <div data-view="tutorial" />;
  },
}));

vi.mock('../src/frontend/views/TutorialDoneView', () => ({
  TutorialDoneView: (p: Record<string, unknown>) => {
    ctl.captured['tutorialDone'] = p;
    return <div data-view="tutorial-done" />;
  },
}));

vi.mock('../src/frontend/views/SurveyView', () => ({
  SurveyView: (p: Record<string, unknown>) => {
    ctl.captured['survey'] = p;
    return <div data-view="survey" />;
  },
}));

vi.mock('../src/frontend/views/ErrorView', () => ({
  ErrorView: (p: Record<string, unknown>) => {
    ctl.captured['error'] = p;
    return (
      <div data-view="error">
        {String(p['message'])}|{p['recoverable'] ? 'recoverable' : 'fatal'}
      </div>
    );
  },
}));

vi.mock('../src/frontend/result/ResultCard', () => ({
  default: (p: Record<string, unknown>) => {
    ctl.captured['result'] = p;
    return <div data-view="result" />;
  },
}));

vi.mock('../src/frontend/resources/ResourcesView', () => ({
  default: (p: Record<string, unknown>) => {
    ctl.captured['resources'] = p;
    return <div data-view="resources" />;
  },
}));

// ---------- 重依赖 mock ----------

vi.mock('../src/frontend/face/loader', () => ({ loadModel: vi.fn() }));

vi.mock('../src/frontend/face/landmarks', () => ({
  extractAllLandmarks: vi.fn(),
  toSharedLandmarks: vi.fn((l: unknown) => l),
  NoFaceError: class NoFaceError extends Error {},
}));

vi.mock('../src/shared/faceFeatures', () => ({ analyzeFeatures: vi.fn() }));

vi.mock('../src/frontend/face/edgeCases', () => ({
  diagnoseSelfie: vi.fn(),
  readExifOrientation: vi.fn(),
  applyExifToImageData: vi.fn((d: unknown) => Promise.resolve(d)),
}));

vi.mock('../src/frontend/utils/image', () => ({
  compressImage: vi.fn(),
  blobToDataUrl: vi.fn(),
}));

vi.mock('../src/frontend/utils/fetch', () => ({ fetchJson: vi.fn() }));

import App from '../src/frontend/App';
import { ToastProvider } from '../src/frontend/components/Toast';
import { loadModel } from '../src/frontend/face/loader';
import { extractAllLandmarks, toSharedLandmarks } from '../src/frontend/face/landmarks';
import { analyzeFeatures } from '../src/shared/faceFeatures';
import {
  diagnoseSelfie,
  readExifOrientation,
  applyExifToImageData,
} from '../src/frontend/face/edgeCases';
import { compressImage, blobToDataUrl } from '../src/frontend/utils/image';
import { fetchJson } from '../src/frontend/utils/fetch';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

// ---------- fixtures ----------

const features: FaceFeatures = {
  upperThirdRatio: 0.33,
  middleThirdRatio: 0.31,
  lowerThirdRatio: 0.36,
  fiveEyeFit: 0.98,
  faceShape: 'oval',
  skinTone: 'warm_fair',
  eyeType: 'almond',
  noseType: 'straight',
  eyeDistanceRatio: 0.32,
  faceWidthHeightRatio: 0.78,
  lipFullnessRatio: 0.5,
  browArchAngle: 120,
  noseBridgeWidth: 0.15,
  confidence: 0.87,
};

const step: MakeupStep = {
  id: 's1',
  title: '底妆打底',
  area: 'base',
  instruction: '均匀拍开',
  overlayZones: ['forehead'],
  order: 0,
};

const lookA: MakeupLook = {
  id: 'look_1',
  name: '清冷白开水妆',
  scenario: '日常通勤',
  suitableFor: ['oval'],
  reason: '清透自然提气色',
  steps: [step],
  productHints: [],
};

const lookB: MakeupLook = {
  id: 'look_2',
  name: '蜜桃乌龙妆',
  scenario: '约会',
  suitableFor: ['round'],
  reason: '粉橘色调显温柔',
  steps: [],
  productHints: [],
};

const fakeImageData = {
  width: 8,
  height: 10,
  data: new Uint8ClampedArray(8 * 10 * 4),
} as ImageData;

/** App 内 ref slot 下标 (0 = ToastProvider 的 nextId). */
const REF = {
  imageData: 1,
  landmarks: 2,
  features: 3,
  tutorialStart: 4,
  previewUrl: 5,
  imageSize: 6,
  exif: 7,
} as const;

/** App 内 useEffect 捕获下标. */
const EFF = {
  appOpen: 0,
  analyzing: 1,
  recommending: 2,
  explain: 3,
  tutorialStep: 4,
  tutorialDone: 5,
} as const;

/** ToastProvider 的 items slot (provider 第一个 useState). */
function toastItems(): Array<{ id: number; message: string; kind: string }> {
  return ctl.stateSlots[0]!.value as Array<{ id: number; message: string; kind: string }>;
}

// ---------- fake 全局 (canvas / Image) ----------

const fakeCtx = {
  putImageData: vi.fn(),
  drawImage: vi.fn(),
  getImageData: vi.fn(() => fakeImageData),
};

function fakeCanvas() {
  return {
    width: 0,
    height: 0,
    getContext: () => (ctl.ctxNull ? null : fakeCtx),
    toDataURL: () => 'data:image/jpeg;oriented',
  };
}

class FakeImage {
  onload: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  naturalWidth = 8;
  naturalHeight = 10;
  set src(_v: string) {
    queueMicrotask(() => {
      if (ctl.imgFails) this.onerror?.(new Error('bad image'));
      else this.onload?.();
    });
  }
}

const realDocument = globalThis.document;
const realImage = globalThis.Image;

beforeAll(() => {
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => (tag === 'canvas' ? fakeCanvas() : {}),
  };
  (globalThis as Record<string, unknown>).Image = FakeImage;
});

afterAll(() => {
  (globalThis as Record<string, unknown>).document = realDocument;
  (globalThis as Record<string, unknown>).Image = realImage;
});

beforeEach(() => {
  ctl.state = null;
  ctl.dispatchCalls.length = 0;
  ctl.stateSlots.length = 0;
  ctl.stateCursor = 0;
  ctl.refSlots.length = 0;
  ctl.refCursor = 0;
  ctl.effects.length = 0;
  ctl.trackCalls.length = 0;
  ctl.captured = {};
  ctl.imgFails = false;
  ctl.ctxNull = false;
  vi.clearAllMocks();
  fakeCtx.getImageData.mockReturnValue(fakeImageData);
  asMock(loadModel).mockResolvedValue({ fake: 'landmarker' });
  asMock(readExifOrientation).mockResolvedValue(1);
  asMock(applyExifToImageData).mockImplementation((d: unknown) => Promise.resolve(d));
  asMock(compressImage).mockResolvedValue({ size: 10 } as Blob);
  asMock(blobToDataUrl).mockResolvedValue('data:image/jpeg;base64,pv');
  asMock(analyzeFeatures).mockReturnValue(features);
  asMock(diagnoseSelfie).mockReturnValue({ blocked: false, warnings: [], skippedFeatures: [] });
  asMock(toSharedLandmarks).mockImplementation((l: unknown) => l);
});

// ---------- 辅助 ----------

function renderApp(state: AppState): string {
  ctl.state = state;
  ctl.stateCursor = 0;
  ctl.refCursor = 0;
  ctl.effects.length = 0;
  return renderToStaticMarkup(
    <ToastProvider>
      <App />
    </ToastProvider>,
  );
}

/** 微任务冲刷: 等 mock 的 promise 链跑完. */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function effect(i: number): () => unknown {
  const fn = ctl.effects[i];
  if (!fn) throw new Error(`effect[${i}] not captured`);
  return fn;
}

function handler(view: string, name: string): (e?: unknown) => void {
  const fn = ctl.captured[view]?.[name];
  if (typeof fn !== 'function') throw new Error(`${view}.${name} not captured`);
  return fn as (e?: unknown) => void;
}

const idle: AppState = { stage: 'idle' };

// ---------- 阶段渲染分支 ----------

describe('App 阶段渲染', () => {
  it('idle → OnboardingView', () => {
    const html = renderApp(idle);
    expect(html).toContain('data-view="onboarding"');
    expect(html).toContain('href="/tools"'); // 页头返回入口
  });

  it('loading_model → LoadingModelView 显示进度', () => {
    const html = renderApp({ stage: 'loading_model', progress: 0.42 });
    expect(html).toContain('42%');
  });

  it('ready → ReadyView 带 previewUrl', () => {
    const html = renderApp({
      stage: 'ready',
      imageData: fakeImageData,
      previewUrl: 'data:pv',
      imageWidth: 8,
      imageHeight: 10,
    });
    expect(html).toContain('data-view="ready"');
    expect(html).toContain('data:pv');
  });

  it('analyzing → AnalyzingView', () => {
    expect(renderApp({ stage: 'analyzing' })).toContain('正在分析你的五官');
  });

  it('analysis_done → AnalysisDoneView 携带 features/warnings', () => {
    const html = renderApp({ stage: 'analysis_done', features, warnings: ['光线偏暗'] });
    expect(html).toContain('data-view="analysis-done"');
    expect(ctl.captured['analysisDone']?.['features']).toBe(features);
    expect(ctl.captured['analysisDone']?.['warnings']).toEqual(['光线偏暗']);
  });

  it('recommending → RecommendingView', () => {
    expect(renderApp({ stage: 'recommending' })).toContain('正在为你挑选妆容');
  });

  it('looks_ready → LooksReadyView, explanation 初始为 null', () => {
    const html = renderApp({ stage: 'looks_ready', looks: [lookA, lookB], selected: 1 });
    expect(html).toContain('data-view="looks"');
    expect(html).toContain('no-explanation');
    expect(ctl.captured['looksReady']?.['looks']).toEqual([lookA, lookB]);
    expect(ctl.captured['looksReady']?.['selected']).toBe(1);
  });

  it('tutorial_step → TutorialView, landmarks 引用初始为 null', () => {
    const html = renderApp({
      stage: 'tutorial_step',
      look: lookA,
      stepIndex: 0,
      previewUrl: 'data:pv',
      imageWidth: 8,
      imageHeight: 10,
    });
    expect(html).toContain('data-view="tutorial"');
    expect(ctl.captured['tutorial']?.['landmarks']).toBeNull();
  });

  it('tutorial_done → TutorialDoneView', () => {
    const html = renderApp({ stage: 'tutorial_done', look: lookA });
    expect(html).toContain('data-view="tutorial-done"');
  });

  it('survey → SurveyView', () => {
    expect(renderApp({ stage: 'survey', look: lookA })).toContain('data-view="survey"');
  });

  it('error → ErrorView 区分 recoverable', () => {
    const rec = renderApp({ stage: 'error', message: '网络开小差', recoverable: true });
    expect(rec).toContain('网络开小差');
    expect(rec).toContain('recoverable');
    const fatal = renderApp({ stage: 'error', message: '画布不支持', recoverable: false });
    expect(fatal).toContain('fatal');
  });

  it('result → 首渲染 Suspense fallback, flush 后渲染 ResultCard', async () => {
    const first = renderApp({ stage: 'result', look: lookA, features });
    expect(first).toContain('正在生成你的分享卡');
    await flush();
    const second = renderApp({ stage: 'result', look: lookA, features });
    expect(second).toContain('data-view="result"');
    expect(ctl.captured['result']?.['look']).toBe(lookA);
    expect(ctl.captured['result']?.['features']).toBe(features);
  });

  it('teaching_resources → 首渲染骨架 fallback, flush 后渲染 ResourcesView', async () => {
    const state: AppState = {
      stage: 'teaching_resources',
      lookId: 'look_2',
      looks: [lookA, lookB],
      selected: 1,
    };
    const first = renderApp(state);
    expect(first).toContain('aria-busy="true"');
    expect(first).not.toContain('data-view="resources"');
    await flush();
    const second = renderApp(state);
    expect(second).toContain('data-view="resources"');
    expect(ctl.captured['resources']?.['lookId']).toBe('look_2');
    // onBack → CLOSE_TEACHING_RESOURCES
    handler('resources', 'onBack')();
    expect(ctl.dispatchCalls).toContainEqual({ type: 'CLOSE_TEACHING_RESOURCES' });
  });
});

// ---------- effect 守卫 (stage 不匹配时全部提前返回) ----------

describe('App effect stage 守卫', () => {
  it('idle 渲染下触发所有 effect: 仅 app_open 埋点, 其余无动作', () => {
    renderApp(idle);
    effect(EFF.appOpen)();
    expect(ctl.trackCalls).toEqual([{ event: 'app_open', props: undefined }]);

    effect(EFF.analyzing)();
    effect(EFF.recommending)();
    effect(EFF.explain)();
    effect(EFF.tutorialStep)();
    effect(EFF.tutorialDone)();
    expect(ctl.dispatchCalls).toEqual([]);
    expect(asMock(fetchJson)).not.toHaveBeenCalled();
    expect(asMock(loadModel)).not.toHaveBeenCalled();
  });
});

// ---------- ready / analysis_done / looks_ready / tutorial 处理器 ----------

describe('App 视图回调 dispatch 接线', () => {
  const readyState: AppState = {
    stage: 'ready',
    imageData: fakeImageData,
    previewUrl: 'data:pv',
    imageWidth: 8,
    imageHeight: 10,
  };

  it('ready.onAnalyze: imageData 存入 ref + START_ANALYZE', () => {
    renderApp(readyState);
    handler('ready', 'onAnalyze')();
    expect(ctl.refSlots[REF.imageData]!.current).toBe(fakeImageData);
    expect(ctl.dispatchCalls).toContainEqual({ type: 'START_ANALYZE' });
  });

  it('ready.onRetake → reset: 清空全部 ref + explanation + RESET', () => {
    renderApp(readyState);
    ctl.refSlots[REF.previewUrl]!.current = 'data:pv';
    ctl.refSlots[REF.imageSize]!.current = { width: 8, height: 10 };
    ctl.refSlots[REF.exif]!.current = 6;
    ctl.refSlots[REF.features]!.current = features;
    ctl.stateSlots[1]!.value = { text: 'x', source: 'qwen' };
    handler('ready', 'onRetake')();
    expect(ctl.dispatchCalls).toContainEqual({ type: 'RESET' });
    expect(ctl.refSlots[REF.imageData]!.current).toBeNull();
    expect(ctl.refSlots[REF.features]!.current).toBeNull();
    expect(ctl.refSlots[REF.previewUrl]!.current).toBe('');
    expect(ctl.refSlots[REF.imageSize]!.current).toEqual({ width: 0, height: 0 });
    expect(ctl.refSlots[REF.exif]!.current).toBe(1);
    expect(ctl.stateSlots[1]!.value).toBeNull();
  });

  it('analysis_done.onContinue → START_RECOMMEND', () => {
    renderApp({ stage: 'analysis_done', features, warnings: [] });
    handler('analysisDone', 'onContinue')();
    expect(ctl.dispatchCalls).toContainEqual({ type: 'START_RECOMMEND' });
  });

  it('looks_ready: onSelect/onStart/onOpenTeaching/onRetake', () => {
    renderApp({ stage: 'looks_ready', looks: [lookA, lookB], selected: 1 });
    ctl.refSlots[REF.previewUrl]!.current = 'data:pv';
    ctl.refSlots[REF.imageSize]!.current = { width: 8, height: 10 };

    handler('looksReady', 'onSelect')(0);
    handler('looksReady', 'onStart')();
    handler('looksReady', 'onOpenTeaching')('look_2');
    handler('looksReady', 'onRetake')();

    expect(ctl.dispatchCalls).toContainEqual({ type: 'SELECT_LOOK', index: 0 });
    expect(ctl.dispatchCalls).toContainEqual({
      type: 'START_TUTORIAL',
      previewUrl: 'data:pv',
      imageWidth: 8,
      imageHeight: 10,
    });
    expect(ctl.dispatchCalls).toContainEqual({
      type: 'OPEN_TEACHING_RESOURCES',
      lookId: 'look_2',
    });
    expect(ctl.dispatchCalls).toContainEqual({ type: 'RESET' });
  });

  it('tutorial_step: onPrev/onNext/onRestart/onFinish', () => {
    renderApp({
      stage: 'tutorial_step',
      look: lookA,
      stepIndex: 1,
      previewUrl: 'data:pv',
      imageWidth: 8,
      imageHeight: 10,
    });
    handler('tutorial', 'onPrev')();
    handler('tutorial', 'onNext')();
    handler('tutorial', 'onRestart')();
    handler('tutorial', 'onFinish')();
    expect(ctl.dispatchCalls).toContainEqual({ type: 'PREV_STEP' });
    expect(ctl.dispatchCalls).toContainEqual({ type: 'NEXT_STEP' });
    expect(ctl.dispatchCalls).toContainEqual({ type: 'GOTO_STEP', index: 0 });
    expect(ctl.dispatchCalls).toContainEqual({ type: 'TUTORIAL_DONE' });
    // onRestart 重置教程计时
    expect(typeof ctl.refSlots[REF.tutorialStart]!.current).toBe('number');
  });

  it('tutorial_done: onOpenSurvey → OPEN_SURVEY; onContinue 无 features → ERROR', () => {
    renderApp({ stage: 'tutorial_done', look: lookA });
    handler('tutorialDone', 'onOpenSurvey')();
    expect(ctl.dispatchCalls).toContainEqual({ type: 'OPEN_SURVEY' });

    ctl.refSlots[REF.features]!.current = null;
    handler('tutorialDone', 'onContinue')();
    expect(ctl.dispatchCalls).toContainEqual({
      type: 'ERROR',
      message: '分析结果丢失',
      recoverable: true,
    });
  });

  it('tutorial_done.onContinue 有 features → ENTER_RESULT', () => {
    renderApp({ stage: 'tutorial_done', look: lookA });
    ctl.refSlots[REF.features]!.current = features;
    handler('tutorialDone', 'onContinue')();
    expect(ctl.dispatchCalls).toContainEqual({
      type: 'ENTER_RESULT',
      look: lookA,
      features,
    });
  });

  it('survey.onClose → CLOSE_SURVEY', () => {
    renderApp({ stage: 'survey', look: lookA });
    handler('survey', 'onClose')();
    expect(ctl.dispatchCalls).toContainEqual({ type: 'CLOSE_SURVEY' });
  });

  it('error.onRetry → reset (RESET)', () => {
    renderApp({ stage: 'error', message: 'x', recoverable: true });
    handler('error', 'onRetry')();
    expect(ctl.dispatchCalls).toContainEqual({ type: 'RESET' });
  });
});

// ---------- analyzing effect ----------

describe('App analyzing effect', () => {
  it('imageData 缺失 → ERROR(图片数据丢失)', () => {
    renderApp({ stage: 'analyzing' });
    effect(EFF.analyzing)();
    expect(ctl.dispatchCalls).toContainEqual({
      type: 'ERROR',
      message: '图片数据丢失，请重新上传',
      recoverable: true,
    });
  });

  it('成功路径: 多脸取最大 + 诊断警告 + ANALYSIS_DONE', async () => {
    renderApp({ stage: 'analyzing' });
    ctl.refSlots[REF.imageData]!.current = fakeImageData;
    const faceSmall = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }));
    const faceLarge = Array.from({ length: 500 }, () => ({ x: 1, y: 1 }));
    asMock(extractAllLandmarks).mockReturnValue([faceSmall, faceLarge]);
    asMock(diagnoseSelfie).mockReturnValue({
      blocked: false,
      warnings: ['光线偏暗'],
      skippedFeatures: ['lip'],
    });

    effect(EFF.analyzing)();
    await flush();

    expect(ctl.dispatchCalls).toContainEqual({
      type: 'ANALYSIS_DONE',
      features,
      warnings: ['光线偏暗'],
    });
    // analyzeFeatures 拿到的是点数最多的脸
    expect(asMock(analyzeFeatures).mock.calls[0]![0]).toBe(faceLarge);
    expect(ctl.refSlots[REF.landmarks]!.current).toBe(faceLarge);
    expect(ctl.refSlots[REF.features]!.current).toBe(features);
    const events = ctl.trackCalls.map((c) => c.event);
    expect(events).toContain('analysis_complete');
    expect(events).toContain('selfie_diagnosis');
  });

  it('cleanup 后再 resolve → cancelled 分支, 不 dispatch', async () => {
    renderApp({ stage: 'analyzing' });
    ctl.refSlots[REF.imageData]!.current = fakeImageData;
    asMock(extractAllLandmarks).mockReturnValue([Array.from({ length: 478 }, () => ({ x: 0, y: 0 }))]);
    const cleanup = effect(EFF.analyzing)() as () => void;
    cleanup(); // cancelled = true
    await flush();
    expect(ctl.dispatchCalls).toEqual([]);
  });

  it('无脸 → NoFaceError → ERROR(请上传清晰的正面照)', async () => {
    renderApp({ stage: 'analyzing' });
    ctl.refSlots[REF.imageData]!.current = fakeImageData;
    asMock(extractAllLandmarks).mockReturnValue([]);
    effect(EFF.analyzing)();
    await flush();
    expect(ctl.dispatchCalls).toContainEqual({
      type: 'ERROR',
      message: '请上传清晰的正面照 📷',
      recoverable: true,
    });
  });

  it('诊断 blocked → selfie_blocked 埋点 + ERROR', async () => {
    renderApp({ stage: 'analyzing' });
    ctl.refSlots[REF.imageData]!.current = fakeImageData;
    asMock(extractAllLandmarks).mockReturnValue([Array.from({ length: 478 }, () => ({ x: 0, y: 0 }))]);
    asMock(diagnoseSelfie).mockReturnValue({
      blocked: true,
      blockedReason: '检测到多张人脸',
      warnings: [],
      skippedFeatures: [],
    });
    effect(EFF.analyzing)();
    await flush();
    expect(ctl.trackCalls).toContainEqual({
      event: 'selfie_blocked',
      props: { reason: '检测到多张人脸' },
    });
    expect(ctl.dispatchCalls).toContainEqual({
      type: 'ERROR',
      message: '检测到多张人脸',
      recoverable: true,
    });
  });

  it('loadModel 抛 Error → ERROR(分析失败：msg); 非 Error → 兜底文案', async () => {
    renderApp({ stage: 'analyzing' });
    ctl.refSlots[REF.imageData]!.current = fakeImageData;
    asMock(loadModel).mockRejectedValue(new Error('WASM 加载失败'));
    effect(EFF.analyzing)();
    await flush();
    expect(ctl.dispatchCalls).toContainEqual({
      type: 'ERROR',
      message: '分析失败：WASM 加载失败',
      recoverable: true,
    });

    ctl.dispatchCalls.length = 0;
    renderApp({ stage: 'analyzing' });
    ctl.refSlots[REF.imageData]!.current = fakeImageData;
    asMock(loadModel).mockRejectedValue('string-error');
    effect(EFF.analyzing)();
    await flush();
    expect(ctl.dispatchCalls).toContainEqual({
      type: 'ERROR',
      message: '分析失败，稍后再试',
      recoverable: true,
    });
  });
});

// ---------- recommending effect ----------

describe('App recommending effect', () => {
  it('features 缺失 → 直接返回, 不发请求', () => {
    renderApp({ stage: 'recommending' });
    effect(EFF.recommending)();
    expect(asMock(fetchJson)).not.toHaveBeenCalled();
  });

  it('成功 → recommend_view 埋点 + LOOKS_READY(selected=0)', async () => {
    renderApp({ stage: 'recommending' });
    ctl.refSlots[REF.features]!.current = features;
    asMock(fetchJson).mockResolvedValue({ looks: [lookA, lookB] });
    effect(EFF.recommending)();
    await flush();
    expect(asMock(fetchJson).mock.calls[0]![0]).toBe('/api/recommend');
    expect(ctl.trackCalls).toContainEqual({ event: 'recommend_view', props: { count: 2 } });
    expect(ctl.dispatchCalls).toContainEqual({
      type: 'LOOKS_READY',
      looks: [lookA, lookB],
      selected: 0,
    });
  });

  it('失败(Error) → toast.error + ERROR(推荐失败：msg)', async () => {
    renderApp({ stage: 'recommending' });
    ctl.refSlots[REF.features]!.current = features;
    asMock(fetchJson).mockRejectedValue(new Error('HTTP 500'));
    effect(EFF.recommending)();
    await flush();
    expect(ctl.dispatchCalls).toContainEqual({
      type: 'ERROR',
      message: '推荐失败：HTTP 500',
      recoverable: true,
    });
    expect(toastItems().some((t) => t.kind === 'error' && t.message.includes('推荐失败'))).toBe(
      true,
    );
  });

  it('失败(非 Error) → 兜底文案', async () => {
    renderApp({ stage: 'recommending' });
    ctl.refSlots[REF.features]!.current = features;
    asMock(fetchJson).mockRejectedValue(42);
    effect(EFF.recommending)();
    await flush();
    expect(ctl.dispatchCalls).toContainEqual({
      type: 'ERROR',
      message: '推荐失败',
      recoverable: true,
    });
  });

  it('cleanup abort 后 resolve → 不 dispatch (aborted 分支)', async () => {
    renderApp({ stage: 'recommending' });
    ctl.refSlots[REF.features]!.current = features;
    asMock(fetchJson).mockResolvedValue({ looks: [lookA] });
    const cleanup = effect(EFF.recommending)() as () => void;
    cleanup(); // ctrl.abort()
    await flush();
    expect(ctl.dispatchCalls).toEqual([]);
    expect(ctl.trackCalls).toEqual([]);
  });

  it('reject 发生在 abort 后 → 静默', async () => {
    renderApp({ stage: 'recommending' });
    ctl.refSlots[REF.features]!.current = features;
    asMock(fetchJson).mockRejectedValue(new Error('late'));
    const cleanup = effect(EFF.recommending)() as () => void;
    cleanup();
    await flush();
    expect(ctl.dispatchCalls).toEqual([]);
  });
});

// ---------- explain effect (looks_ready) ----------

describe('App explain effect', () => {
  const looksReady: AppState = { stage: 'looks_ready', looks: [lookA, lookB], selected: 1 };

  it('成功 → explanation 经 setExplanation 流入 LooksReadyView', async () => {
    renderApp(looksReady);
    ctl.refSlots[REF.features]!.current = features;
    asMock(fetchJson).mockResolvedValue({ explanation: '云端解释文本', source: 'qwen' });
    effect(EFF.explain)();
    // effect 入口先清空旧解释
    expect(ctl.stateSlots[1]!.value).toBeNull();
    await flush();
    expect(ctl.stateSlots[1]!.value).toEqual({ text: '云端解释文本', source: 'qwen' });
    // 请求体只含规范化标签 + lookId
    const body = JSON.parse(
      (asMock(fetchJson).mock.calls[0]![1] as { body: string }).body,
    ) as Record<string, unknown>;
    expect(body['lookId']).toBe('look_2');
    expect(body['features']).toEqual({
      faceShape: 'oval',
      skinTone: 'warm_fair',
      eyeType: 'almond',
    });
    // 重渲染后解释出现在视图中
    const html = renderApp(looksReady);
    expect(html).toContain('qwen:云端解释文本');
  });

  it('失败 → 回退本地模板 (look.reason 截断)', async () => {
    renderApp(looksReady);
    ctl.refSlots[REF.features]!.current = features;
    asMock(fetchJson).mockRejectedValue(new Error('timeout'));
    effect(EFF.explain)();
    await flush();
    expect(ctl.stateSlots[1]!.value).toEqual({
      text: '粉橘色调显温柔',
      source: 'local_template',
    });
    const html = renderApp(looksReady);
    expect(html).toContain('local_template:粉橘色调显温柔');
  });

  it('选中妆容或 features 缺失 → 不发请求', () => {
    renderApp({ stage: 'looks_ready', looks: [], selected: 0 });
    ctl.refSlots[REF.features]!.current = features;
    effect(EFF.explain)();
    expect(asMock(fetchJson)).not.toHaveBeenCalled();

    renderApp(looksReady);
    ctl.refSlots[REF.features]!.current = null;
    effect(EFF.explain)();
    expect(asMock(fetchJson)).not.toHaveBeenCalled();
  });
});

// ---------- tutorial_step / tutorial_done effect ----------

describe('App tutorial 埋点 effect', () => {
  it('tutorial_step: 埋点含 step_index/area/look_id, 并启动计时', () => {
    renderApp({
      stage: 'tutorial_step',
      look: lookA,
      stepIndex: 0,
      previewUrl: 'data:pv',
      imageWidth: 8,
      imageHeight: 10,
    });
    effect(EFF.tutorialStep)();
    expect(ctl.trackCalls).toContainEqual({
      event: 'tutorial_step',
      props: { step_index: 0, area: 'base', look_id: 'look_1' },
    });
    const start = ctl.refSlots[REF.tutorialStart]!.current;
    expect(typeof start).toBe('number');
    // 再次触发不重置计时 (已非 null 分支)
    effect(EFF.tutorialStep)();
    expect(ctl.refSlots[REF.tutorialStart]!.current).toBe(start);
  });

  it('tutorial_step: step 越界 → area 回退 unknown', () => {
    renderApp({
      stage: 'tutorial_step',
      look: lookB, // steps: []
      stepIndex: 3,
      previewUrl: 'data:pv',
      imageWidth: 8,
      imageHeight: 10,
    });
    effect(EFF.tutorialStep)();
    expect(ctl.trackCalls).toContainEqual({
      event: 'tutorial_step',
      props: { step_index: 3, area: 'unknown', look_id: 'look_2' },
    });
  });

  it('tutorial_done: 有计时 → 携带时长; 无计时 → 0', () => {
    renderApp({ stage: 'tutorial_done', look: lookA });
    ctl.refSlots[REF.tutorialStart]!.current = Date.now() - 500;
    effect(EFF.tutorialDone)();
    const call = ctl.trackCalls.find((c) => c.event === 'tutorial_complete');
    expect(call?.props?.['look_id']).toBe('look_1');
    expect(call?.props?.['total_duration_ms'] as number).toBeGreaterThan(0);
    // 触发后计时清零
    expect(ctl.refSlots[REF.tutorialStart]!.current).toBeNull();

    ctl.trackCalls.length = 0;
    renderApp({ stage: 'tutorial_done', look: lookA });
    ctl.refSlots[REF.tutorialStart]!.current = null;
    effect(EFF.tutorialDone)();
    expect(ctl.trackCalls).toContainEqual({
      event: 'tutorial_complete',
      props: { look_id: 'look_1', total_duration_ms: 0 },
    });
  });
});

// ---------- onPick / compressAndProcess ----------

describe('App onPick 图片处理管线', () => {
  const file = { size: 1000, type: 'image/jpeg', name: 'a.jpg' } as File;

  it('happy path: 压缩更小 → image_compressed; MODEL_PROGRESS → MODEL_READY', async () => {
    renderApp(idle);
    asMock(loadModel).mockImplementation((onProgress: (p: number) => void) => {
      onProgress(0.5);
      return Promise.resolve({ fake: true });
    });
    handler('onboarding', 'onImagePicked')(file);
    await flush();

    expect(ctl.dispatchCalls[0]).toEqual({ type: 'START_LOAD_MODEL' });
    expect(ctl.dispatchCalls).toContainEqual({ type: 'MODEL_PROGRESS', progress: 0.5 });
    expect(ctl.dispatchCalls).toContainEqual({
      type: 'MODEL_READY',
      imageData: fakeImageData,
      previewUrl: 'data:image/jpeg;base64,pv',
      imageWidth: 8,
      imageHeight: 10,
    });
    const events = ctl.trackCalls.map((c) => c.event);
    expect(events).toEqual(
      expect.arrayContaining(['upload_start', 'image_compressed', 'model_load', 'upload_success']),
    );
    // ready 信息写入 ref 供 tutorial 阶段使用
    expect(ctl.refSlots[REF.previewUrl]!.current).toBe('data:image/jpeg;base64,pv');
    expect(ctl.refSlots[REF.imageSize]!.current).toEqual({ width: 8, height: 10 });
  });

  it('压缩结果更大 → 用原图, 不埋 image_compressed', async () => {
    renderApp(idle);
    asMock(compressImage).mockResolvedValue({ size: 5000 } as Blob);
    handler('onboarding', 'onImagePicked')(file);
    await flush();
    expect(ctl.trackCalls.find((c) => c.event === 'image_compressed')).toBeUndefined();
    expect(asMock(blobToDataUrl).mock.calls[0]![0]).toBe(file);
    expect(ctl.dispatchCalls.some((d) => d['type'] === 'MODEL_READY')).toBe(true);
  });

  it('EXIF orientation=6 → 旋转校正 + 重新生成预览', async () => {
    renderApp(idle);
    asMock(readExifOrientation).mockResolvedValue(6);
    handler('onboarding', 'onImagePicked')(file);
    await flush();
    expect(ctl.refSlots[REF.exif]!.current).toBe(6);
    expect(ctl.dispatchCalls).toContainEqual({
      type: 'MODEL_READY',
      imageData: fakeImageData,
      previewUrl: 'data:image/jpeg;oriented',
      imageWidth: 8,
      imageHeight: 10,
    });
  });

  it('EXIF 读取失败 + 压缩失败 → 降级继续, 仍 MODEL_READY', async () => {
    renderApp(idle);
    asMock(readExifOrientation).mockRejectedValue(new Error('no exif'));
    asMock(compressImage).mockRejectedValue(new Error('compress boom'));
    asMock(applyExifToImageData).mockRejectedValue(new Error('rotate boom'));
    handler('onboarding', 'onImagePicked')(file);
    await flush();
    const events = ctl.trackCalls.map((c) => c.event);
    expect(events).toContain('exif_read_fail');
    expect(events).toContain('image_compress_fail');
    expect(events).toContain('exif_apply_fail');
    expect(ctl.dispatchCalls.some((d) => d['type'] === 'MODEL_READY')).toBe(true);
  });

  it('图片解码失败 → image_process_fail + toast + ERROR(可恢复)', async () => {
    renderApp(idle);
    ctl.imgFails = true;
    handler('onboarding', 'onImagePicked')(file);
    await flush();
    expect(ctl.trackCalls.find((c) => c.event === 'image_process_fail')).toBeDefined();
    expect(ctl.dispatchCalls).toContainEqual({
      type: 'ERROR',
      message: '图片处理失败：图片加载失败',
      recoverable: true,
    });
    expect(toastItems().some((t) => t.kind === 'error')).toBe(true);
    expect(ctl.dispatchCalls.some((d) => d['type'] === 'MODEL_READY')).toBe(false);
  });

  it('canvas 2d 不可用 → ERROR(不可恢复), 不再加载模型', async () => {
    renderApp(idle);
    ctl.ctxNull = true;
    handler('onboarding', 'onImagePicked')(file);
    await flush();
    expect(ctl.dispatchCalls).toContainEqual({
      type: 'ERROR',
      message: '浏览器不支持画布',
      recoverable: false,
    });
    expect(asMock(loadModel)).not.toHaveBeenCalled();
  });

  it('模型加载失败(Error) → model_load_fail + toast + ERROR', async () => {
    renderApp(idle);
    asMock(loadModel).mockRejectedValue(new Error('网络中断'));
    handler('onboarding', 'onImagePicked')(file);
    await flush();
    expect(ctl.trackCalls.find((c) => c.event === 'model_load_fail')).toBeDefined();
    expect(ctl.dispatchCalls).toContainEqual({
      type: 'ERROR',
      message: '模型加载失败：网络中断',
      recoverable: true,
    });
    expect(toastItems().some((t) => t.kind === 'error')).toBe(true);
  });

  it('模型加载失败(非 Error) → 兜底文案', async () => {
    renderApp(idle);
    asMock(loadModel).mockRejectedValue({ weird: true });
    handler('onboarding', 'onImagePicked')(file);
    await flush();
    expect(ctl.dispatchCalls).toContainEqual({
      type: 'ERROR',
      message: '模型加载失败',
      recoverable: true,
    });
  });
});
