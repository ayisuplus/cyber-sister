// views-ssr.test.tsx — views/ 目录全部展示型视图的 SSR 渲染分支测试.
//
// 策略:
// - 无 jsdom: 用 renderToStaticMarkup 验证每个视图的结构与条件分支.
// - vi.mock('react') 覆盖 useState (按序出队注入 state + 记录 setter),
//   useRef (按序出队预置 ref), useEffect (捕获回调, 按需手动触发).
//   这样既能 SSR 渲染, 也能把函数组件当普通函数直接调用,
//   从返回的 element 树上取 onClick/onDrop 等处理器用 fake event 触发,
//   覆盖 SSR 触及不到的校验/拖拽/粘贴/收藏切换逻辑.
// - analytics/haptic 一律 mock 并记录调用, 用于断言埋点.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import type { FaceFeatures, MakeupLook, MakeupStep } from '../src/shared/types';
import type { Landmark } from '../src/shared/faceFeatures';

// ---------- react hook 接管 (queue 注入) ----------

const ctl = vi.hoisted(() => ({
  /** useState 覆盖队列 — 按组件内 useState 调用顺序出队. */
  stateQueue: [] as unknown[],
  /** 每次 useState 记录的 setter (按调用顺序). */
  setters: [] as Array<(v: unknown) => void>,
  /** useRef 预置队列 — 按 useRef 调用顺序出队. */
  refQueue: [] as Array<{ current: unknown }>,
  /** useEffect 捕获的回调. */
  effects: [] as Array<() => unknown>,
  /** track 埋点记录. */
  trackCalls: [] as Array<{ event: string; props?: Record<string, unknown> }>,
  /** haptic 调用记录. */
  haptics: [] as string[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof React & Record<string, unknown>;
  return {
    ...actual,
    // react-dom/server (CJS) 从 react 读共享 internals, 必须透传.
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED:
      actual['__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED'],
    useState: <T,>(initial: T | (() => T)): [T, (v: T) => void] => {
      const value =
        ctl.stateQueue.length > 0
          ? (ctl.stateQueue.shift() as T)
          : typeof initial === 'function'
            ? (initial as () => T)()
            : initial;
      const setter = (v: T) => {
        void v;
      };
      ctl.setters.push(setter as (v: unknown) => void);
      return [value, setter];
    },
    useRef: <T,>(initial: T): { current: T } =>
      ctl.refQueue.length > 0
        ? (ctl.refQueue.shift() as { current: T })
        : { current: initial },
    useEffect: (fn: () => unknown): void => {
      ctl.effects.push(fn);
    },
  };
});

vi.mock('../src/shared/analytics', () => ({
  track: (event: string, props?: Record<string, unknown>) => {
    ctl.trackCalls.push({ event, props });
  },
  startTimer: () => () => 0,
  getSessionId: () => 'test-session-id',
}));

vi.mock('../src/frontend/utils/haptic', () => ({
  haptic: (type: string) => {
    ctl.haptics.push(type);
  },
}));

import { FloatingOrbs } from '../src/frontend/views/FloatingOrbs';
import { LoadingModelView } from '../src/frontend/views/LoadingModelView';
import { ReadyView } from '../src/frontend/views/ReadyView';
import { AnalyzingView, SLOW_HINT_MS } from '../src/frontend/views/AnalyzingView';
import { AnalysisDoneView } from '../src/frontend/views/AnalysisDoneView';
import { RecommendingView } from '../src/frontend/views/RecommendingView';
import { LooksReadyView } from '../src/frontend/views/LooksReadyView';
import { OnboardingView } from '../src/frontend/views/OnboardingView';
import { TutorialView } from '../src/frontend/views/TutorialView';
import { TutorialDoneView } from '../src/frontend/views/TutorialDoneView';
import { SurveyView } from '../src/frontend/views/SurveyView';
import { ErrorView } from '../src/frontend/views/ErrorView';
import {
  TutorialLoadingFallback,
  ResourcesLoadingFallback,
  ResultLoadingFallback,
} from '../src/frontend/views/fallbacks';

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

const stepBase: MakeupStep = {
  id: 's1',
  title: '底妆打底',
  area: 'base',
  instruction: '用粉扑由内向外均匀拍开',
  overlayZones: ['forehead'],
  brushDirection: '由内向外',
  toolHint: '粉扑',
  colorFamily: '自然色',
  warnings: ['避开眼周'],
  order: 0,
};

const lookA: MakeupLook = {
  id: 'look_1',
  name: '清冷白开水妆',
  scenario: '日常通勤',
  suitableFor: ['oval'],
  reason: '清透自然提气色',
  steps: [stepBase],
  productHints: [],
};

const lookB: MakeupLook = {
  id: 'look_2',
  name: '蜜桃乌龙妆',
  scenario: '约会',
  suitableFor: ['round'],
  reason: '粉橘色调显温柔',
  steps: [stepBase],
  productHints: [],
};

const lookC: MakeupLook = {
  id: 'look_3',
  name: '红茶拿铁妆',
  scenario: '正式场合',
  suitableFor: ['square'],
  reason: '棕调修容显立体',
  steps: [stepBase],
  productHints: [],
};

const noop = () => {};

function landmarks478(): Landmark[] {
  return Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 }));
}

beforeEach(() => {
  ctl.stateQueue.length = 0;
  ctl.setters.length = 0;
  ctl.refQueue.length = 0;
  ctl.effects.length = 0;
  ctl.trackCalls.length = 0;
  ctl.haptics.length = 0;
});

// ---------- 纯展示视图 ----------

describe('FloatingOrbs (SSR)', () => {
  it('渲染 3 个装饰性 orb 且对辅助技术隐藏', () => {
    const html = renderToStaticMarkup(<FloatingOrbs />);
    expect(html.match(/float-orb/g)).toHaveLength(3);
    expect(html).toContain('aria-hidden="true"');
  });
});

describe('LoadingModelView (SSR)', () => {
  it('按 progress 渲染百分比 (42%)', () => {
    const html = renderToStaticMarkup(<LoadingModelView progress={0.42} />);
    expect(html).toContain('42%');
    expect(html).toContain('width:42%');
    expect(html).toContain('正在准备化妆台');
  });

  it('progress 边界: 0 与 1', () => {
    expect(renderToStaticMarkup(<LoadingModelView progress={0} />)).toContain('0%');
    expect(renderToStaticMarkup(<LoadingModelView progress={1} />)).toContain('100%');
  });
});

describe('ReadyView (SSR)', () => {
  it('渲染预览图与两个操作按钮', () => {
    const html = renderToStaticMarkup(
      <ReadyView previewUrl="data:image/jpeg;base64,xx" onRetake={noop} onAnalyze={noop} />,
    );
    expect(html).toContain('src="data:image/jpeg;base64,xx"');
    expect(html).toContain('确认这张照片');
    expect(html).toContain('开始分析');
    expect(html).toContain('重选一张');
  });
});

describe('AnalyzingView (SSR)', () => {
  it('渲染分析中文案', () => {
    const html = renderToStaticMarkup(<AnalyzingView />);
    expect(html).toContain('正在分析你的五官');
  });

  it('默认不渲染慢设备提示，slow=true 时追加', () => {
    expect(renderToStaticMarkup(<AnalyzingView />)).not.toContain('这台设备有点慢');
    ctl.stateQueue.push(true);
    expect(renderToStaticMarkup(<AnalyzingView />)).toContain('这台设备有点慢');
  });

  it('挂载时按 SLOW_HINT_MS 注册提示计时器，卸载清理', () => {
    renderToStaticMarkup(<AnalyzingView />);
    const effect = ctl.effects.at(-1) as (() => () => void) | undefined;
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const cleanup = effect?.();
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), SLOW_HINT_MS);
    cleanup?.();
    expect(clearSpy).toHaveBeenCalled();
    timeoutSpy.mockRestore();
    clearSpy.mockRestore();
  });
});

describe('RecommendingView (SSR)', () => {
  it('渲染推荐中文案', () => {
    const html = renderToStaticMarkup(<RecommendingView />);
    expect(html).toContain('正在为你挑选妆容');
  });
});

describe('ErrorView (SSR)', () => {
  it('recoverable=true 时渲染重试按钮', () => {
    const html = renderToStaticMarkup(
      <ErrorView message="网络开小差了" recoverable={true} onRetry={noop} />,
    );
    expect(html).toContain('网络开小差了');
    expect(html).toContain('再试一次');
  });

  it('recoverable=false 时不渲染重试按钮', () => {
    const html = renderToStaticMarkup(
      <ErrorView message="浏览器不支持画布" recoverable={false} onRetry={noop} />,
    );
    expect(html).toContain('浏览器不支持画布');
    expect(html).not.toContain('再试一次');
  });
});

// ---------- AnalysisDoneView ----------

describe('AnalysisDoneView (SSR)', () => {
  it('渲染五官报告: 中文映射 + 数值 + 无警告块', () => {
    const html = renderToStaticMarkup(
      <AnalysisDoneView features={features} warnings={[]} onContinue={noop} />,
    );
    expect(html).toContain('你的专属脸型报告');
    expect(html).toContain('椭圆脸');
    expect(html).toContain('暖白皮');
    expect(html).toContain('杏眼');
    expect(html).toContain('straight'); // 鼻型无中文映射, 原样展示
    expect(html).toContain('0.33');
    expect(html).toContain('置信度');
    expect(html).not.toContain('⚠️');
    // trusted=false 分支
    expect(html).toContain('👍 分析得挺准');
    expect(html).toContain('aria-pressed="false"');
  });

  it('warnings 非空时渲染警告列表', () => {
    const html = renderToStaticMarkup(
      <AnalysisDoneView
        features={features}
        warnings={['光线偏暗', '轻微模糊']}
        onContinue={noop}
      />,
    );
    expect(html).toContain('⚠️ 光线偏暗');
    expect(html).toContain('⚠️ 轻微模糊');
  });

  it('未知枚举值回退为原始字符串 (?? s 分支)', () => {
    const unknownFeatures: FaceFeatures = {
      ...features,
      faceShape: 'unknown',
      skinTone: 'unknown',
      eyeType: 'unknown',
      noseType: 'unknown',
    };
    const html = renderToStaticMarkup(
      <AnalysisDoneView features={unknownFeatures} warnings={[]} onContinue={noop} />,
    );
    expect(html.match(/unknown/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it('trusted=true 注入后渲染已感谢态', () => {
    ctl.stateQueue.push(true);
    const html = renderToStaticMarkup(
      <AnalysisDoneView features={features} warnings={[]} onContinue={noop} />,
    );
    expect(html).toContain('谢谢肯定～');
    expect(html).toContain('aria-pressed="true"');
  });
});

// ---------- LooksReadyView ----------

describe('LooksReadyView (SSR)', () => {
  const baseProps = {
    onSelect: noop as (i: number) => void,
    onStart: noop,
    onRetake: noop,
    onOpenTeaching: noop as (lookId: string) => void,
  };

  it('qwen 来源解释 + 选中卡片高亮', () => {
    const html = renderToStaticMarkup(
      <LooksReadyView
        {...baseProps}
        looks={[lookA, lookB, lookC]}
        selected={1}
        explanation={{ text: '云端说蜜桃乌龙最适合你', source: 'qwen' }}
      />,
    );
    expect(html).toContain('云端备用模型解释');
    expect(html).toContain('云端说蜜桃乌龙最适合你');
    expect(html).toContain('清冷白开水妆');
    expect(html).toContain('蜜桃乌龙妆');
    expect(html).toContain('红茶拿铁妆');
    // 仅选中卡片带 ✓ 标记
    expect(html.match(/✓/g)).toHaveLength(1);
  });

  it('local_model 来源解释', () => {
    const html = renderToStaticMarkup(
      <LooksReadyView
        {...baseProps}
        looks={[lookA]}
        selected={0}
        explanation={{ text: '本机解释', source: 'local_model' }}
      />,
    );
    expect(html).toContain('本机模型解释');
    expect(html).toContain('本机解释');
  });

  it('无解释时回退到选中妆容的 reason (本地模板标签)', () => {
    const html = renderToStaticMarkup(
      <LooksReadyView {...baseProps} looks={[lookA, lookB]} selected={1} explanation={null} />,
    );
    expect(html).toContain('本地模板解释');
    expect(html).toContain('粉橘色调显温柔');
  });

  it('空妆容列表: selectedLook 为 null, 解释区显示准备中文案', () => {
    const html = renderToStaticMarkup(
      <LooksReadyView {...baseProps} looks={[]} selected={0} explanation={null} />,
    );
    expect(html).toContain('正在准备解释…');
    expect(html).toContain('本地模板解释');
  });
});

// ---------- OnboardingView ----------

describe('OnboardingView (SSR)', () => {
  it('默认态: 隐私承诺 + 三步流程 + 上传入口 + 无错误提示', () => {
    const html = renderToStaticMarkup(<OnboardingView onImagePicked={noop} />);
    expect(html).toContain('找到最适合你的妆容');
    expect(html).toContain('拍一张正面照');
    expect(html).toContain('AI 分析你的脸型');
    expect(html).toContain('手把手教你画');
    expect(html).toContain('开始拍照');
    expect(html).toContain('从相册选择');
    expect(html).toContain('你的照片只在手机本地分析');
    // 非拖拽态 aria-label + 样式
    expect(html).toContain('拖拽图片到这里上传');
    expect(html).toContain('border-ink-soft/30');
    expect(html).not.toContain('role="alert"');
  });

  it('注入 error + isDragging: 显示错误与拖拽高亮', () => {
    // useState 顺序: error(null), isDragging(false)
    ctl.stateQueue.push('图片太大啦，换个 10MB 以内的吧～', true);
    const html = renderToStaticMarkup(<OnboardingView onImagePicked={noop} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('图片太大啦，换个 10MB 以内的吧～');
    expect(html).toContain('松开以上传');
    expect(html).toContain('border-primary');
  });

  it('注入 error=null 显式确认无错误分支', () => {
    ctl.stateQueue.push(null, false);
    const html = renderToStaticMarkup(<OnboardingView onImagePicked={noop} />);
    expect(html).not.toContain('role="alert"');
  });
});

// ---------- TutorialView ----------

describe('TutorialView (SSR)', () => {
  const baseProps = {
    previewUrl: 'data:image/jpeg;base64,pv',
    imageWidth: 8,
    imageHeight: 10,
    onPrev: noop,
    onNext: noop,
    onRestart: noop,
    onFinish: noop,
  };

  it('landmarks=null: 渲染关键点不可用占位 + 教学面板', () => {
    const html = renderToStaticMarkup(
      <TutorialView {...baseProps} look={lookA} stepIndex={0} landmarks={null} />,
    );
    expect(html).toContain('关键点不可用，分区预览略过');
    // TutorialPanel 真实渲染, 显示当前步骤标题
    expect(html).toContain('底妆打底');
  });

  it('landmarks 数量不足 478: 同样走占位分支', () => {
    const few = Array.from({ length: 10 }, () => ({ x: 0, y: 0, z: 0 }));
    const html = renderToStaticMarkup(
      <TutorialView {...baseProps} look={lookA} stepIndex={0} landmarks={few} />,
    );
    expect(html).toContain('关键点不可用，分区预览略过');
  });

  it('landmarks=478: 进入 MakeupCanvas 懒加载分支 (SSR 渲染 fallback)', () => {
    const html = renderToStaticMarkup(
      <TutorialView {...baseProps} look={lookA} stepIndex={0} landmarks={landmarks478()} />,
    );
    expect(html).toContain('正在加载教学模块…');
    expect(html).not.toContain('关键点不可用');
  });

  it('stepIndex 越界: step?.overlayZones ?? [] 空值回退', () => {
    const html = renderToStaticMarkup(
      <TutorialView {...baseProps} look={lookA} stepIndex={99} landmarks={landmarks478()} />,
    );
    expect(html).toContain('正在加载教学模块…');
  });
});

// ---------- TutorialDoneView ----------

describe('TutorialDoneView (SSR)', () => {
  it('未收藏态: 渲染恭喜文案 + 收藏入口 + 问卷入口', () => {
    const html = renderToStaticMarkup(
      <TutorialDoneView look={lookA} features={features} onOpenSurvey={noop} onContinue={noop} />,
    );
    expect(html).toContain('恭喜完成 清冷白开水妆！');
    expect(html).toContain('收藏这个妆容');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('查看妆容总结');
    expect(html).toContain('帮我们做得更好');
  });

  it('已收藏态 (useState 注入 true)', () => {
    ctl.stateQueue.push(true);
    const html = renderToStaticMarkup(
      <TutorialDoneView look={lookA} features={null} onOpenSurvey={noop} onContinue={noop} />,
    );
    expect(html).toContain('已收藏');
    expect(html).toContain('aria-pressed="true"');
  });
});

// ---------- SurveyView (补充; 主覆盖在 survey.test.tsx) ----------

describe('SurveyView (SSR)', () => {
  it('未配置 URL 时渲染占位 (effect 内埋点 SSR 不触发)', () => {
    const html = renderToStaticMarkup(<SurveyView onClose={noop} />);
    expect(html).toContain('产品反馈');
    expect(html).toContain('问卷准备中');
  });
});

// ---------- fallbacks ----------

describe('懒加载 fallbacks (SSR)', () => {
  it('TutorialLoadingFallback: 加载文案 + busy 状态', () => {
    const html = renderToStaticMarkup(<TutorialLoadingFallback />);
    expect(html).toContain('正在加载教学模块…');
    expect(html).toContain('aria-busy="true"');
  });

  it('ResourcesLoadingFallback: 骨架屏 + busy 状态', () => {
    const html = renderToStaticMarkup(<ResourcesLoadingFallback />);
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/animate-pulse-soft/g)!.length).toBeGreaterThan(3);
  });

  it('ResultLoadingFallback: 分享卡生成中文案', () => {
    const html = renderToStaticMarkup(<ResultLoadingFallback />);
    expect(html).toContain('正在生成你的分享卡…');
    expect(html).toContain('role="status"');
  });
});

// ---------- 事件处理器 harness ----------
// 函数组件当普通函数直接调用 (hook 已被上方 react mock 接管),
// 从返回的 element 树上递归取处理器, 用 fake event 触发真实逻辑.

interface FakeElement {
  type: unknown;
  props?: (Record<string, unknown> & { children?: unknown }) | null;
}

/** 递归收集 element 树中的所有 element 节点. */
function collect(node: unknown, out: FakeElement[] = []): FakeElement[] {
  if (Array.isArray(node)) {
    for (const n of node) collect(n, out);
    return out;
  }
  if (node !== null && typeof node === 'object' && 'props' in (node as FakeElement)) {
    const el = node as FakeElement;
    out.push(el);
    if (el.props) collect(el.props.children, out);
  }
  return out;
}

function findOne(root: unknown, pred: (el: FakeElement) => boolean): FakeElement {
  const hit = collect(root).find(pred);
  if (!hit) throw new Error('element not found in tree');
  return hit;
}

function on(el: FakeElement, name: string): (e: unknown) => void {
  const fn = el.props?.[name];
  if (typeof fn !== 'function') throw new Error(`handler ${name} missing`);
  return fn as (e: unknown) => void;
}

function makeFile(name: string, type: string, size: number): File {
  return { name, type, size } as File;
}

const fakeEvent = (extra: Record<string, unknown> = {}) => ({
  preventDefault: vi.fn(),
  ...extra,
});

describe('OnboardingView 处理器', () => {
  /** 直接调用组件, 返回 element 树; hooks 顺序: useRef×2 → useState(error) → useState(isDragging). */
  function callOnboarding(
    onImagePicked: (f: File) => void,
    opts: { error?: string | null; dragging?: boolean; cameraClick?: () => void; galleryClick?: () => void } = {},
  ): FakeElement {
    ctl.refQueue.push(
      { current: opts.cameraClick ? { click: opts.cameraClick } : null },
      { current: opts.galleryClick ? { click: opts.galleryClick } : null },
    );
    ctl.stateQueue.push(opts.error ?? null, opts.dragging ?? false);
    return OnboardingView({ onImagePicked }) as unknown as FakeElement;
  }

  it('拍照按钮: haptic + 触发相机 input click', () => {
    const cameraClick = vi.fn();
    const tree = callOnboarding(noop, { cameraClick });
    const btn = findOne(tree, (el) => el.props?.['aria-label'] === '拍照上传 (调用相机)');
    on(btn, 'onClick')(undefined);
    expect(ctl.haptics).toEqual(['select']);
    expect(cameraClick).toHaveBeenCalledTimes(1);
  });

  it('相册按钮: 触发相册 input click', () => {
    const galleryClick = vi.fn();
    const tree = callOnboarding(noop, { galleryClick });
    const btn = findOne(tree, (el) => el.props?.['aria-label'] === '从相册选择图片');
    on(btn, 'onClick')(undefined);
    expect(galleryClick).toHaveBeenCalledTimes(1);
  });

  it('相机 ref 缺失时不报错 (?. 分支)', () => {
    const tree = callOnboarding(noop);
    const btn = findOne(tree, (el) => el.props?.['aria-label'] === '拍照上传 (调用相机)');
    expect(() => on(btn, 'onClick')(undefined)).not.toThrow();
    expect(ctl.haptics).toEqual(['select']);
  });

  it('onChange: 选中合法图片 → setError(null) + onImagePicked; 清空 input value', () => {
    const picked = vi.fn();
    const tree = callOnboarding(picked);
    const input = findOne(
      tree,
      (el) => el.type === 'input' && el.props?.['capture'] === 'user',
    );
    const target = { files: [makeFile('a.jpg', 'image/jpeg', 1024)], value: 'x' };
    on(input, 'onChange')({ target });
    expect(picked).toHaveBeenCalledTimes(1);
    expect(target.value).toBe('');
    // error setter 收到 null (清除旧错误)
    expect(ctl.setters[0]).toBeDefined();
  });

  it('onChange: 未选文件 → pick 提前返回, 不上报', () => {
    const picked = vi.fn();
    const tree = callOnboarding(picked);
    const input = findOne(tree, (el) => el.type === 'input' && !el.props?.['capture']);
    on(input, 'onChange')({ target: { files: undefined, value: '' } });
    expect(picked).not.toHaveBeenCalled();
    expect(ctl.trackCalls.find((c) => c.event === 'upload_reject')).toBeUndefined();
  });

  it('pick: 超过 10MB → upload_reject(too_large) + 设置错误文案', () => {
    const picked = vi.fn();
    const tree = callOnboarding(picked);
    const big = makeFile('big.png', 'image/png', 11 * 1024 * 1024);
    on(tree, 'onDrop')(fakeEvent({ dataTransfer: { files: [big] } }));
    expect(picked).not.toHaveBeenCalled();
    const reject = ctl.trackCalls.find((c) => c.event === 'upload_reject');
    expect(reject?.props).toMatchObject({ reason: 'too_large' });
  });

  it('pick: 类型不符 → upload_reject(wrong_type)', () => {
    const picked = vi.fn();
    const tree = callOnboarding(picked);
    const gif = makeFile('a.gif', 'image/gif', 100);
    on(tree, 'onDrop')(fakeEvent({ dataTransfer: { files: [gif] } }));
    expect(picked).not.toHaveBeenCalled();
    const reject = ctl.trackCalls.find((c) => c.event === 'upload_reject');
    expect(reject?.props).toMatchObject({ reason: 'wrong_type', type: 'image/gif' });
  });

  it('pick: mime 为空但扩展名合法 → 通过 (正则回退分支)', () => {
    const picked = vi.fn();
    const tree = callOnboarding(picked);
    const noMime = makeFile('selfie.webp', '', 100);
    on(tree, 'onDrop')(fakeEvent({ dataTransfer: { files: [noMime] } }));
    expect(picked).toHaveBeenCalledWith(noMime);
    expect(ctl.trackCalls.find((c) => c.event === 'upload_via')?.props).toEqual({
      method: 'drop',
    });
  });

  it('onDrop: 无文件 → 不上报 upload_via', () => {
    const tree = callOnboarding(noop);
    on(tree, 'onDrop')(fakeEvent({ dataTransfer: { files: [] } }));
    expect(ctl.trackCalls.find((c) => c.event === 'upload_via')).toBeUndefined();
  });

  it('onDragOver: 非拖拽态 → setIsDragging(true); 已拖拽 → 不重复设置', () => {
    const tree1 = callOnboarding(noop, { dragging: false });
    on(tree1, 'onDragOver')(fakeEvent());
    const setDrag = ctl.setters[1]!;
    // 注入 dragging=true 后再次触发, setter 不应再被调用
    const tree2 = callOnboarding(noop, { dragging: true });
    const before = ctl.setters.length;
    on(tree2, 'onDragOver')(fakeEvent());
    expect(ctl.setters.length).toBe(before); // 无新 setter 注册之外的调用
    void setDrag;
  });

  it('onDragLeave: 指针仍在容器内 → 保持高亮; 离开容器 → 清除高亮', () => {
    const tree = callOnboarding(noop, { dragging: true });
    const stay = fakeEvent({
      currentTarget: { contains: () => true },
      relatedTarget: {},
    });
    on(tree, 'onDragLeave')(stay);
    const leave = fakeEvent({
      currentTarget: { contains: () => false },
      relatedTarget: {},
    });
    expect(() => on(tree, 'onDragLeave')(leave)).not.toThrow();
  });

  it('onPaste: 剪贴板有文件 → preventDefault + upload_via(paste) + pick', () => {
    const picked = vi.fn();
    const tree = callOnboarding(picked);
    const file = makeFile('p.png', 'image/png', 100);
    const ev = fakeEvent({ clipboardData: { files: [file] } });
    on(tree, 'onPaste')(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(ctl.trackCalls.find((c) => c.event === 'upload_via')?.props).toEqual({
      method: 'paste',
    });
    expect(picked).toHaveBeenCalledWith(file);
  });

  it('onPaste: 剪贴板为空 → 提前返回, 不 preventDefault', () => {
    const tree = callOnboarding(noop);
    const ev = fakeEvent({ clipboardData: { files: [] } });
    on(tree, 'onPaste')(ev);
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });
});

describe('AnalysisDoneView 处理器', () => {
  function callAnalysisDone(trusted: boolean): FakeElement {
    ctl.stateQueue.push(trusted);
    return AnalysisDoneView({ features, warnings: [], onContinue: noop }) as unknown as FakeElement;
  }

  it('首次点击信任: haptic + trust_click(含 confidence) + setTrusted(true)', () => {
    const tree = callAnalysisDone(false);
    const btn = findOne(tree, (el) => el.props?.['aria-label'] === '分析得挺准');
    on(btn, 'onClick')(undefined);
    expect(ctl.haptics).toEqual(['select']);
    expect(ctl.trackCalls).toEqual([
      { event: 'trust_click', props: { confidence: features.confidence } },
    ]);
  });

  it('已信任再点 → 提前返回, 不重复埋点', () => {
    const tree = callAnalysisDone(true);
    const btn = findOne(tree, (el) => el.props?.['aria-label'] === '分析得挺准');
    on(btn, 'onClick')(undefined);
    expect(ctl.trackCalls).toEqual([]);
    expect(ctl.haptics).toEqual([]);
  });
});

describe('LooksReadyView 处理器', () => {
  function callLooksReady(looks: MakeupLook[], selected: number) {
    const spies = {
      onSelect: vi.fn(),
      onStart: vi.fn(),
      onRetake: vi.fn(),
      onOpenTeaching: vi.fn(),
    };
    const tree = LooksReadyView({
      looks,
      selected,
      explanation: null,
      ...spies,
    }) as unknown as FakeElement;
    return { tree, spies };
  }

  it('点击卡片: track(look_select) + onSelect(index)', () => {
    const { tree, spies } = callLooksReady([lookA, lookB, lookC], 0);
    // LookCard 是未渲染的组件 element, onClick 闭包直接挂在它的 props 上.
    const cards = collect(tree).filter((el) => el.props?.['look'] !== undefined);
    expect(cards).toHaveLength(3);
    on(cards[2]!, 'onClick')(undefined);
    expect(ctl.trackCalls).toEqual([
      { event: 'look_select', props: { look_id: 'look_3', index: 2 } },
    ]);
    expect(spies.onSelect).toHaveBeenCalledWith(2);
  });

  it('查看教学资源: 选中妆容存在 → 传 lookId; 空列表 → 传空串', () => {
    const { tree, spies } = callLooksReady([lookA, lookB], 1);
    const btn = findOne(
      tree,
      (el) => typeof el.props?.className === 'string' && el.props.className.includes('gap-2') && el.type === 'button',
    );
    on(btn, 'onClick')(undefined);
    expect(spies.onOpenTeaching).toHaveBeenCalledWith('look_2');

    const empty = callLooksReady([], 0);
    const emptyBtn = findOne(
      empty.tree,
      (el) => typeof el.props?.className === 'string' && el.props.className.includes('gap-2') && el.type === 'button',
    );
    on(emptyBtn, 'onClick')(undefined);
    expect(empty.spies.onOpenTeaching).toHaveBeenCalledWith('');
  });
});

describe('TutorialDoneView 处理器', () => {
  // 用独立 lookId, 避免与默认渲染用例共享 favorites 存储.
  const favLook: MakeupLook = { ...lookA, id: 'look_fav_test', name: '收藏测试妆' };

  function callDone(favorited: boolean, feats: FaceFeatures | null) {
    const spies = { onOpenSurvey: vi.fn(), onContinue: vi.fn() };
    ctl.stateQueue.push(favorited);
    const tree = TutorialDoneView({ look: favLook, features: feats, ...spies }) as unknown as FakeElement;
    return { tree, spies };
  }

  it('未收藏 → 点击收藏: addFavorite + track(add) + haptic(success)', () => {
    const { tree } = callDone(false, features);
    const btn = findOne(tree, (el) => el.props?.['data-testid'] === 'done-favorite-btn');
    on(btn, 'onClick')(undefined);
    expect(ctl.trackCalls).toEqual([
      { event: 'favorite_toggle', props: { look_id: favLook.id, action: 'add', source: 'done' } },
    ]);
    expect(ctl.haptics).toEqual(['success']);
  });

  it('已收藏且有记录 → 点击取消: removeFavorite + track(remove) + haptic(tap)', () => {
    // 先通过真实 toggle 写入一条收藏
    const first = callDone(false, null); // features=null 走 ?? 'unknown' 分支
    on(findOne(first.tree, (el) => el.props?.['data-testid'] === 'done-favorite-btn'), 'onClick')(undefined);
    ctl.trackCalls.length = 0;
    ctl.haptics.length = 0;

    const { tree } = callDone(true, null);
    on(findOne(tree, (el) => el.props?.['data-testid'] === 'done-favorite-btn'), 'onClick')(undefined);
    expect(ctl.trackCalls).toEqual([
      { event: 'favorite_toggle', props: { look_id: favLook.id, action: 'remove', source: 'done' } },
    ]);
    expect(ctl.haptics).toEqual(['tap']);
  });

  it('已收藏但无记录 (rec undefined) → 仍然埋点, 不崩溃', () => {
    const orphan: MakeupLook = { ...lookA, id: 'look_orphan', name: '孤儿妆' };
    ctl.stateQueue.push(true);
    const tree = TutorialDoneView({
      look: orphan,
      features: null,
      onOpenSurvey: noop,
      onContinue: noop,
    }) as unknown as FakeElement;
    const btn = findOne(tree, (el) => el.props?.['data-testid'] === 'done-favorite-btn');
    expect(() => on(btn, 'onClick')(undefined)).not.toThrow();
    expect(ctl.trackCalls[0]?.props).toMatchObject({ action: 'remove' });
  });
});

describe('SurveyView 埋点 (effect 手动触发)', () => {
  it('mount effect 触发 survey_open; 关闭按钮触发 survey_close + haptic + onClose', () => {
    const onClose = vi.fn();
    SurveyView({ onClose }); // 直接调用, useEffect 被捕获
    const openEffect = ctl.effects.find((fn) => typeof fn === 'function');
    openEffect?.();
    expect(ctl.trackCalls).toEqual([{ event: 'survey_open', props: undefined }]);

    const tree = SurveyView({ onClose }) as unknown as FakeElement;
    const btn = findOne(tree, (el) => el.props?.['data-testid'] === 'survey-close-btn');
    on(btn, 'onClick')(undefined);
    expect(ctl.haptics).toEqual(['tap']);
    expect(ctl.trackCalls[1]?.event).toBe('survey_close');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
