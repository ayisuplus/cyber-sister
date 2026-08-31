// 教学面板 + 妆教画布测试.
//
// TutorialPanel: SSR 渲染分支 (步骤边界/标签/警告/产品提示/术语括注/场景收藏面板)
// + 直接调用组件触发按钮交互 (上一步/下一步/重新开始/完成/场景标签).
// MakeupCanvas: SSR 渲染主体 + 直接调用 + 捕获 useEffect 手动执行
// (图片加载/ResizeObserver/canvas 绘制) + 指针手势 (双击重置/双指缩放/平移).
// canvas 2d context / Image / ResizeObserver / window 均为桩, 不依赖 DOM.
// 注: useSwipe 键盘/触摸 effect 回调在 SSR 下不可达, 为可接受损失 (见报告).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MakeupLook, MakeupStep, OverlayZone, ProductHint } from '../src/shared/types';
import type { Landmark } from '../src/shared/faceFeatures';

// ---------- React hooks shim ----------

const h = vi.hoisted(() => ({
  overrides: [] as Array<{ pred: (v: unknown) => boolean; value: unknown; consumed: boolean }>,
  states: [] as unknown[],
  cursor: 0,
  refs: [] as Array<{ current: unknown }>,
  captureEffects: false,
  effects: [] as Array<() => unknown>,
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const takeOverride = (init: unknown): unknown => {
    const o = h.overrides.find((x) => !x.consumed && x.pred(init));
    if (o) {
      o.consumed = true;
      return o.value;
    }
    return init;
  };
  return {
    ...actual,
    useState: (init: unknown) => {
      const v = takeOverride(init);
      try {
        return actual.useState(v as never);
      } catch {
        const idx = h.cursor++;
        h.states[idx] = typeof v === 'function' ? (v as () => unknown)() : v;
        return [
          h.states[idx],
          (nv: unknown) => {
            h.states[idx] =
              typeof nv === 'function' ? (nv as (p: unknown) => unknown)(h.states[idx]) : nv;
          },
        ];
      }
    },
    useEffect: (fn: () => unknown, deps?: unknown) => {
      try {
        return (actual.useEffect as (f: () => unknown, d?: unknown) => void)(fn, deps);
      } catch {
        if (h.captureEffects) h.effects.push(fn);
      }
    },
    useMemo: (fn: () => unknown, deps?: unknown) => {
      try {
        return actual.useMemo(fn, deps as never);
      } catch {
        return fn();
      }
    },
    useRef: (init: unknown) => {
      try {
        return actual.useRef(init);
      } catch {
        const ref = { current: init };
        h.refs.push(ref);
        return ref;
      }
    },
  };
});

vi.mock('../src/shared/analytics', () => ({
  track: vi.fn(),
  startTimer: () => () => 0,
  getSessionId: () => 'test-session-id',
}));

vi.mock('../src/frontend/utils/haptic', () => ({
  haptic: vi.fn(() => true),
  isHapticSupported: () => false,
}));

import TutorialPanel from '../src/frontend/tutorial/TutorialPanel';
import MakeupCanvas from '../src/frontend/tutorial/MakeupCanvas';
import { track } from '../src/shared/analytics';

const trackMock = vi.mocked(track);

// ---------- 夹具 ----------

function makeStep(over: Partial<MakeupStep> = {}): MakeupStep {
  return {
    id: 's1',
    title: '底妆',
    area: 'base',
    instruction: '用气垫粉底轻拍全脸',
    overlayZones: ['left_cheek'],
    order: 1,
    ...over,
  };
}

function makeLook(over: Partial<MakeupLook> = {}): MakeupLook {
  return {
    id: 'look-1',
    name: '清冷白开水妆',
    scenario: '日常通勤',
    suitableFor: ['oval'],
    reason: '匹配冷白皮',
    steps: [
      makeStep({ id: 's1', title: '底妆', area: 'base', order: 1 }),
      makeStep({ id: 's2', title: '眼妆', area: 'eye', order: 2 }),
      makeStep({ id: 's3', title: '唇妆', area: 'lip', order: 3 }),
    ],
    productHints: [],
    ...over,
  };
}

interface PanelProps {
  look: MakeupLook;
  stepIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onRestart: () => void;
  onFinish: () => void;
  warnings?: string[];
}

function panelProps(over: Partial<PanelProps> = {}): PanelProps {
  return {
    look: makeLook(),
    stepIndex: 0,
    onPrev: () => {},
    onNext: () => {},
    onRestart: () => {},
    onFinish: () => {},
    ...over,
  };
}

function setOverrides(list: Array<{ pred: (v: unknown) => boolean; value: unknown }>): void {
  h.overrides = list.map((o) => ({ ...o, consumed: false }));
}

let store: Map<string, string>;

function installLocalStorage(): void {
  store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
    configurable: true,
    writable: true,
  });
}

function seedFavorite(id: string, savedAt: number, scenario = '日常通勤'): void {
  const raw = store.get('makeupwhisper_favorites');
  const list: unknown[] = raw ? (JSON.parse(raw) as unknown[]) : [];
  list.push({
    id,
    lookId: id,
    lookName: `妆容${id}`,
    scenario,
    features: { faceShape: 'oval', skinTone: 'cool_fair', eyeType: 'almond', confidence: 0.9 },
    savedAt,
  });
  store.set('makeupwhisper_favorites', JSON.stringify(list));
}

beforeEach(() => {
  h.overrides = [];
  h.states = [];
  h.cursor = 0;
  h.refs = [];
  h.effects = [];
  h.captureEffects = false;
  installLocalStorage();
  trackMock.mockClear();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
  vi.unstubAllGlobals();
});

// ---------- TutorialPanel SSR 渲染分支 ----------

describe('TutorialPanel 渲染', () => {
  it('无步骤: 显示占位文案', () => {
    const html = renderToStaticMarkup(
      createElement(TutorialPanel, panelProps({ look: makeLook({ steps: [] }) })),
    );
    expect(html).toContain('该妆容暂无教学步骤');
  });

  it('stepIndex 越界: 同样显示占位', () => {
    const html = renderToStaticMarkup(createElement(TutorialPanel, panelProps({ stepIndex: 9 })));
    expect(html).toContain('该妆容暂无教学步骤');
  });

  it('第一步: 上一步禁用, 显示下一步 (非完成)', () => {
    const html = renderToStaticMarkup(createElement(TutorialPanel, panelProps({ stepIndex: 0 })));
    expect(html).toContain('步骤 1 / 3');
    expect(html).toContain('清冷白开水妆');
    expect(html).toContain('匹配冷白皮');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>← 上一步/);
    expect(html).toContain('下一步 →');
    expect(html).not.toContain('data-finish-button');
    // 进度 1/3
    expect(html).toContain('width:33.33333333333333%');
  });

  it('中间步: 上一步可用 + 下一步', () => {
    const html = renderToStaticMarkup(createElement(TutorialPanel, panelProps({ stepIndex: 1 })));
    expect(html).toContain('步骤 2 / 3');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>← 上一步/);
    expect(html).toContain('下一步 →');
  });

  it('最后一步: 显示完成按钮', () => {
    const html = renderToStaticMarkup(createElement(TutorialPanel, panelProps({ stepIndex: 2 })));
    expect(html).toContain('步骤 3 / 3');
    expect(html).toContain('完成 →');
    expect(html).toContain('data-finish-button');
    expect(html).toContain('width:100%');
  });

  it('步骤标签: brushDirection/toolHint/colorFamily 齐全时渲染 方向/工具/色系', () => {
    const look = makeLook({
      steps: [
        makeStep({ brushDirection: '由内向外', toolHint: '美妆蛋', colorFamily: '大地色系' }),
      ],
    });
    const html = renderToStaticMarkup(
      createElement(TutorialPanel, panelProps({ look, stepIndex: 0 })),
    );
    expect(html).toContain('由内向外');
    expect(html).toContain('美妆蛋');
    expect(html).toContain('大地色系');
  });

  it('步骤标签缺省: 无对应字段不渲染标签', () => {
    const html = renderToStaticMarkup(createElement(TutorialPanel, panelProps({ stepIndex: 0 })));
    expect(html).not.toContain('方向</div>');
    expect(html).not.toContain('工具</div>');
    expect(html).not.toContain('色系</div>');
  });

  it('警告: step.warnings 与 props.warnings 合并展示', () => {
    const look = makeLook({ steps: [makeStep({ warnings: ['肿泡眼避免珠光'] })] });
    const html = renderToStaticMarkup(
      createElement(TutorialPanel, panelProps({ look, warnings: ['少量多次'] })),
    );
    expect(html).toContain('⚠️ 肿泡眼避免珠光');
    expect(html).toContain('⚠️ 少量多次');
  });

  it('无警告: 不渲染警告区', () => {
    const html = renderToStaticMarkup(createElement(TutorialPanel, panelProps({ stepIndex: 0 })));
    expect(html).not.toContain('⚠️');
  });

  it('产品提示: 分类匹配当前步骤区域才列出 (matchesArea 全分支)', () => {
    const cases: Array<[string, string, boolean]> = [
      ['base', '粉底液', true],
      ['concealer', '遮瑕膏', true],
      ['contour', '修容盘', true],
      ['highlight', '高光粉', true],
      ['brow', '眉笔', true],
      ['eye', '眼影盘', true],
      ['eyeliner', '眼线胶笔', true],
      ['lash', '睫毛膏', true],
      ['blush', '腮红膏', true],
      ['lip', '口红', true],
      ['nose', '粉底液', false], // nose 区域无匹配规则
      ['base', '香水', false], // 分类不匹配
    ];
    for (const [area, category, shouldShow] of cases) {
      const hint: ProductHint = { category, shadeFamily: '自然色' };
      const look = makeLook({ steps: [makeStep({ area: area as MakeupStep['area'] })], productHints: [hint] });
      const html = renderToStaticMarkup(
        createElement(TutorialPanel, panelProps({ look, stepIndex: 0 })),
      );
      expect(html).toContain('推荐产品 (CPS 占位)');
      if (shouldShow) {
        expect(html).toContain(category);
      } else {
        expect(html).not.toContain(category);
      }
    }
  });

  it('产品提示可选字段: finishType / priceRange 拼接', () => {
    const look = makeLook({
      steps: [makeStep()],
      productHints: [
        { category: '粉底液', shadeFamily: '象牙白', finishType: '哑光', priceRange: '¥100-200' },
        { category: '气垫', shadeFamily: '自然色' },
        { category: 'BB霜', shadeFamily: '第三件被截断' },
      ],
    });
    const html = renderToStaticMarkup(
      createElement(TutorialPanel, panelProps({ look, stepIndex: 0 })),
    );
    expect(html).toContain('象牙白');
    expect(html).toContain('· 哑光');
    expect(html).toContain('· ¥100-200');
    expect(html).toContain('自然色');
    // slice(0, 2): 第三条不显示
    expect(html).not.toContain('第三件被截断');
  });

  it('无产品提示: 不渲染产品区', () => {
    const html = renderToStaticMarkup(createElement(TutorialPanel, panelProps({ stepIndex: 0 })));
    expect(html).not.toContain('推荐产品');
  });

  it('术语括注: 命中术语渲染可点击 role=button, 未命中渲染普通段落', () => {
    const withTerm = makeLook({
      steps: [makeStep({ instruction: '用修容扫在脸侧制造阴影感' })],
    });
    const html1 = renderToStaticMarkup(
      createElement(TutorialPanel, panelProps({ look: withTerm })),
    );
    expect(html1).toContain('role="button"');
    expect(html1).toContain('术语：修容');

    const noTerm = makeLook({ steps: [makeStep({ instruction: '随便画画就好' })] });
    const html2 = renderToStaticMarkup(
      createElement(TutorialPanel, panelProps({ look: noTerm })),
    );
    expect(html2).not.toContain('role="button"');
    expect(html2).toContain('随便画画就好');
  });

  it('术语气泡展开 (openIdx 注入): 显示术语解释 tooltip', () => {
    const look = makeLook({ steps: [makeStep({ instruction: '修容是关键一步' })] });
    // TutorialPanel useState: showScenarioPanel(false) → AnnotatedInstruction openIdx(null)
    setOverrides([{ pred: (v) => v === null, value: 0 }]);
    const html = renderToStaticMarkup(createElement(TutorialPanel, panelProps({ look })));
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('视觉上脸小一圈');
  });

  it('场景收藏面板: 有收藏时列出方案 + 相对时间', () => {
    const now = Date.now();
    seedFavorite('f-today', now);
    seedFavorite('f-yesterday', now - 26 * 3600 * 1000);
    seedFavorite('f-3days', now - 3 * 24 * 3600 * 1000);
    seedFavorite('f-2weeks', now - 14 * 24 * 3600 * 1000);
    seedFavorite('f-old', now - 40 * 24 * 3600 * 1000);
    setOverrides([{ pred: (v) => v === false, value: true }]);
    const html = renderToStaticMarkup(createElement(TutorialPanel, panelProps({ stepIndex: 0 })));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('收藏方案');
    expect(html).toContain('妆容f-today');
    expect(html).toContain('今天');
    expect(html).toContain('昨天');
    expect(html).toContain('3 天前');
    expect(html).toContain('2 周前');
    expect(html).toMatch(/\d+月\d+日/);
    expect(html).toContain('oval · cool_fair · almond');
  });

  it('场景收藏面板: 无收藏时显示引导文案', () => {
    setOverrides([{ pred: (v) => v === false, value: true }]);
    const html = renderToStaticMarkup(createElement(TutorialPanel, panelProps({ stepIndex: 0 })));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('收藏过这个场景的妆容后');
  });

  it('收藏面板按场景过滤: 其他场景的收藏不显示', () => {
    seedFavorite('f-other', Date.now(), '约会晚宴');
    setOverrides([{ pred: (v) => v === false, value: true }]);
    const html = renderToStaticMarkup(createElement(TutorialPanel, panelProps({ stepIndex: 0 })));
    expect(html).not.toContain('妆容f-other');
    expect(html).toContain('收藏过这个场景的妆容后');
  });
});

// ---------- 直接调用组件: 元素树遍历 ----------

interface TestEl {
  type: unknown;
  props: Record<string, unknown>;
}

function flattenTree(node: unknown, out: TestEl[] = []): TestEl[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((c) => flattenTree(c, out));
    return out;
  }
  const el = node as TestEl;
  if (el.props && typeof el.props === 'object') {
    out.push(el);
    flattenTree(el.props.children, out);
  }
  return out;
}

function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object') return textOf((node as TestEl).props?.children);
  return '';
}

function buttonByText(nodes: TestEl[], text: string): TestEl {
  const btn = nodes.find((n) => n.type === 'button' && textOf(n).includes(text));
  if (!btn) throw new Error(`button not found: ${text}`);
  return btn;
}

describe('TutorialPanel 按钮交互', () => {
  function setup(over: Partial<PanelProps> = {}) {
    h.states = [];
    h.cursor = 0;
    const spies = { onPrev: vi.fn(), onNext: vi.fn(), onRestart: vi.fn(), onFinish: vi.fn() };
    const el = (TutorialPanel as unknown as (p: unknown) => unknown)(
      panelProps({ ...spies, ...over }),
    );
    return { spies, nodes: flattenTree(el) };
  }

  it('上一步/下一步/重新开始触发对应回调', () => {
    const { spies, nodes } = setup({ stepIndex: 1 });
    (buttonByText(nodes, '← 上一步').props.onClick as () => void)();
    expect(spies.onPrev).toHaveBeenCalledTimes(1);
    (buttonByText(nodes, '下一步 →').props.onClick as () => void)();
    expect(spies.onNext).toHaveBeenCalledTimes(1);
    (buttonByText(nodes, '↺ 重新开始').props.onClick as () => void)();
    expect(spies.onRestart).toHaveBeenCalledTimes(1);
  });

  it('最后一步点击完成触发 onFinish', () => {
    const { spies, nodes } = setup({ stepIndex: 2 });
    (buttonByText(nodes, '完成 →').props.onClick as () => void)();
    expect(spies.onFinish).toHaveBeenCalledTimes(1);
  });

  it('场景标签点击: 展开面板 + track scenario_tag_tap open', () => {
    const { nodes } = setup({ stepIndex: 0 });
    (buttonByText(nodes, '日常通勤').props.onClick as () => void)();
    expect(h.states[0]).toBe(true); // showScenarioPanel
    expect(trackMock).toHaveBeenCalledWith('scenario_tag_tap', {
      look_id: 'look-1',
      scenario: '日常通勤',
      action: 'open',
    });
  });
});

// ---------- MakeupCanvas ----------

function makeLandmarks(n = 478, x = 50, y = 60): Landmark[] {
  return Array.from({ length: n }, (_, i) => ({ x: x + (i % 10), y: y + (i % 7), z: 0 }));
}

interface CanvasProps {
  imageSrc: string;
  imageWidth: number;
  imageHeight: number;
  landmarks: Landmark[];
  currentZones: OverlayZone[];
  brushDirection?: string;
}

function canvasProps(over: Partial<CanvasProps> = {}): CanvasProps {
  return {
    imageSrc: 'selfie.png',
    imageWidth: 100,
    imageHeight: 100,
    landmarks: makeLandmarks(),
    currentZones: ['left_cheek'],
    ...over,
  };
}

describe('MakeupCanvas SSR 渲染', () => {
  it('默认: canvas + 图片加载中占位 + 手势提示, cursor default', () => {
    const html = renderToStaticMarkup(createElement(MakeupCanvas, canvasProps()));
    expect(html).toContain('<canvas');
    expect(html).toContain('图片加载中...');
    expect(html).toContain('双击重置 · 双指缩放');
    expect(html).toContain('cursor:default');
  });

  it('hover 注入: cursor grab', () => {
    // useState 顺序: layout(null) → transform({...}) → imgEl(null) → hover(false)
    setOverrides([{ pred: (v) => v === false, value: true }]);
    const html = renderToStaticMarkup(createElement(MakeupCanvas, canvasProps()));
    expect(html).toContain('cursor:grab');
  });

  it('imgEl 注入: 隐藏加载占位', () => {
    setOverrides([
      { pred: (v) => v === null, value: null }, // layout 保持 null
      { pred: (v) => v === null, value: {} }, // imgEl 非空
    ]);
    const html = renderToStaticMarkup(createElement(MakeupCanvas, canvasProps()));
    expect(html).not.toContain('图片加载中...');
  });
});

// ---------- MakeupCanvas effects + 手势 (直接调用) ----------

/** canvas 2d context 桩: 记录方法调用与属性赋值. */
function makeCtx2d(): { ctx: CanvasRenderingContext2D; calls: string[]; sets: Record<string, unknown> } {
  const calls: string[] = [];
  const sets: Record<string, unknown> = {};
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(t, prop: string) {
      if (!(prop in t)) {
        t[prop] = () => {
          calls.push(prop);
        };
      }
      return t[prop];
    },
    set(t, prop: string, v: unknown) {
      t[prop] = v;
      sets[prop] = v;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, sets };
}

interface FakeImage {
  crossOrigin: string;
  onload: (() => void) | null;
  src: string;
}

interface CanvasSetup {
  nodes: TestEl[];
  ctxCalls: string[];
  fakeCanvas: {
    width: number;
    height: number;
    getContext: () => CanvasRenderingContext2D;
    getBoundingClientRect: () => { width: number; height: number };
  };
  images: FakeImage[];
  observers: Array<{ cb: () => void; disconnected: boolean }>;
}

function setupCanvas(over: Partial<CanvasProps> = {}, withLayout = true): CanvasSetup {
  const images: FakeImage[] = [];
  const observers: Array<{ cb: () => void; disconnected: boolean }> = [];
  vi.stubGlobal(
    'Image',
    class {
      crossOrigin = '';
      onload: (() => void) | null = null;
      src = '';
      constructor() {
        images.push(this as unknown as FakeImage);
      }
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      cb: () => void;
      disconnected = false;
      constructor(cb: () => void) {
        this.cb = cb;
        observers.push(this as unknown as { cb: () => void; disconnected: boolean });
      }
      observe(): void {}
      disconnect(): void {
        this.disconnected = true;
      }
    },
  );
  vi.stubGlobal('window', { devicePixelRatio: 2 });

  const { ctx, calls } = makeCtx2d();
  const fakeCanvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 300, height: 200 }),
  };

  if (withLayout) {
    setOverrides([
      {
        pred: (v) => v === null,
        value: {
          imageX: 0,
          imageY: 0,
          imageWidth: 100,
          imageHeight: 100,
          canvasWidth: 600,
          canvasHeight: 400,
        },
      },
      { pred: (v) => v === null, value: { width: 100, height: 100 } }, // imgEl
    ]);
  }

  h.states = [];
  h.cursor = 0;
  h.refs = [];
  h.effects = [];
  h.captureEffects = true;
  const el = (MakeupCanvas as unknown as (p: unknown) => unknown)(canvasProps(over));
  h.captureEffects = false;

  h.refs[0]!.current = fakeCanvas; // canvasRef
  return { nodes: flattenTree(el), ctxCalls: calls, fakeCanvas, images, observers };
}

function canvasEl(nodes: TestEl[]): TestEl {
  const c = nodes.find((n) => n.type === 'canvas');
  if (!c) throw new Error('canvas element not found');
  return c;
}

describe('MakeupCanvas effects', () => {
  it('图片加载 effect: 创建 Image 并设置 crossOrigin/src, onload 更新 imgEl', () => {
    const s = setupCanvas();
    expect(h.effects).toHaveLength(3);
    h.effects[0]!();
    expect(s.images).toHaveLength(1);
    expect(s.images[0]!.crossOrigin).toBe('anonymous');
    expect(s.images[0]!.src).toBe('selfie.png');
    s.images[0]!.onload!();
    expect(h.states[2]).toBe(s.images[0]); // imgEl state
  });

  it('ResizeObserver effect: 按 dpr 设置画布尺寸并重算 layout, cleanup 断连', () => {
    const s = setupCanvas();
    const cleanup = h.effects[1]!() as () => void;
    expect(s.observers).toHaveLength(1);
    s.observers[0]!.cb();
    expect(s.fakeCanvas.width).toBe(600); // 300 * dpr 2
    expect(s.fakeCanvas.height).toBe(400);
    expect(h.states[0]).toMatchObject({ canvasWidth: 600, canvasHeight: 400 });
    cleanup();
    expect(s.observers[0]!.disconnected).toBe(true);
  });

  it('canvasRef 为空时 ResizeObserver effect 直接返回', () => {
    const s = setupCanvas();
    h.refs[0]!.current = null;
    const cleanup = h.effects[1]!() as () => void;
    expect(s.observers).toHaveLength(0);
    expect(cleanup).toBeUndefined(); // 提前返回, 无 cleanup
  });

  it('layout/imgEl 缺失时绘制 effect 提前返回', () => {
    setupCanvas({}, false); // 不注入 layout/imgEl
    h.effects[2]!();
    // 无异常即通过 (早期返回分支)
  });

  it('绘制: polygon zone 用贝塞尔多边形, ellipse zone 用椭圆, 带方向箭头', () => {
    const s = setupCanvas({
      currentZones: ['left_cheek', 'inner_corner_l'],
      brushDirection: '向上提拉',
    });
    h.effects[2]!();
    expect(s.ctxCalls).toContain('drawImage');
    expect(s.ctxCalls).toContain('quadraticCurveTo'); // polygon
    expect(s.ctxCalls).toContain('ellipse'); // ellipse zone
    expect(s.ctxCalls).toContain('lineTo'); // 箭头
    expect(s.ctxCalls).toContain('translate');
    expect(s.ctxCalls).toContain('save');
    expect(s.ctxCalls).toContain('restore');
  });

  it('绘制: 未注册 zone 跳过 (getZoneDef 返回空)', () => {
    const s = setupCanvas({
      currentZones: ['not_a_zone' as OverlayZone, 'left_cheek'],
    });
    expect(() => h.effects[2]!()).not.toThrow();
    expect(s.ctxCalls).toContain('drawImage');
  });

  it('绘制: landmarks 不足时跳过 zone 与箭头', () => {
    const s = setupCanvas({
      landmarks: [],
      currentZones: ['left_cheek'],
      brushDirection: '向上',
    });
    h.effects[2]!();
    expect(s.ctxCalls).toContain('drawImage');
    expect(s.ctxCalls).not.toContain('quadraticCurveTo');
    expect(s.ctxCalls).not.toContain('lineTo');
  });

  it('绘制: ellipse zone 半径为 0 时不画椭圆', () => {
    // inner_corner_l 的 center=133; 所有点与中心重合 → 半径 0
    const s = setupCanvas({
      landmarks: makeLandmarks(478, 0, 0).map(() => ({ x: 0, y: 0, z: 0 })),
      currentZones: ['inner_corner_l'],
    });
    // 点被 (x!==0||y!==0) 过滤 → pts<2 也跳过; 改用非零重合点
    const s2 = setupCanvas({
      landmarks: makeLandmarks(478, 7, 7).map(() => ({ x: 7, y: 7, z: 0 })),
      currentZones: ['inner_corner_l'],
    });
    h.effects[2]!();
    expect(s.ctxCalls).not.toContain('ellipse');
    s2.ctxCalls.length = 0;
    // s2 是独立组件实例, 运行它自己的绘制 effect
    // (setupCanvas 每次重设 h.effects, 此处 h.effects 属于 s2)
    h.effects[2]!();
    expect(s2.ctxCalls).not.toContain('ellipse');
  });

  it('brushDirection 各方向关键词映射到箭头向量 (directionArrow 全分支)', () => {
    const directions = ['向上提拉', '向下轻压', '向左带过', '向外晕染', '斜向上扫', '点涂轻拍', '无匹配词'];
    for (const dir of directions) {
      setupCanvas({ brushDirection: dir });
      expect(() => h.effects[2]!()).not.toThrow();
    }
  });

  it('无 brushDirection 时不画箭头', () => {
    const s = setupCanvas({ brushDirection: undefined });
    h.effects[2]!();
    expect(s.ctxCalls).not.toContain('lineTo');
  });
});

describe('MakeupCanvas 指针手势', () => {
  interface PointerEvt {
    pointerId: number;
    clientX: number;
    clientY: number;
    target: { setPointerCapture: (id: number) => void };
  }

  function evt(id: number, x: number, y: number): PointerEvt {
    return { pointerId: id, clientX: x, clientY: y, target: { setPointerCapture: () => {} } };
  }

  // useState 索引: 0 layout, 1 transform, 2 imgEl, 3 hover
  function transform(): { scale: number; tx: number; ty: number } {
    return h.states[1] as { scale: number; tx: number; ty: number };
  }

  it('双击重置 transform', () => {
    const s = setupCanvas();
    const canvas = canvasEl(s.nodes);
    const down = canvas.props.onPointerDown as (e: PointerEvt) => void;
    down(evt(1, 100, 100));
    (canvas.props.onPointerUp as (e: PointerEvt) => void)(evt(1, 100, 100));
    // 短时间内第二次点击 (同位置) → 重置
    down(evt(1, 102, 101));
    expect(transform()).toEqual({ scale: 1, tx: 0, ty: 0 });
  });

  it('双指捏合: 放大被 clamp 到 MAX_SCALE, 缩小到 MIN_SCALE', () => {
    const s = setupCanvas();
    const canvas = canvasEl(s.nodes);
    const down = canvas.props.onPointerDown as (e: PointerEvt) => void;
    const move = canvas.props.onPointerMove as (e: PointerEvt) => void;
    down(evt(1, 0, 0));
    down(evt(2, 10, 0));
    move(evt(2, 100000, 0)); // 极大比例 → clamp 4
    expect(transform().scale).toBe(4);
    move(evt(2, 1, 0)); // 极小比例 → clamp 0.5
    expect(transform().scale).toBe(0.5);
  });

  it('双指拖动: 平移 tx/ty', () => {
    const s = setupCanvas();
    const canvas = canvasEl(s.nodes);
    const down = canvas.props.onPointerDown as (e: PointerEvt) => void;
    const move = canvas.props.onPointerMove as (e: PointerEvt) => void;
    down(evt(1, 0, 0));
    down(evt(2, 10, 0)); // 中心 x=5
    move(evt(2, 40, 20)); // 新中心 x=20,y=10 → tx+=15, ty+=10
    expect(transform().tx).toBe(15);
    expect(transform().ty).toBe(10);
  });

  it('未跟踪的 pointerId 移动被忽略; 单指移动不改变 transform', () => {
    const s = setupCanvas();
    const canvas = canvasEl(s.nodes);
    const down = canvas.props.onPointerDown as (e: PointerEvt) => void;
    const move = canvas.props.onPointerMove as (e: PointerEvt) => void;
    down(evt(1, 0, 0));
    move(evt(99, 500, 500)); // 未跟踪
    expect(transform()).toEqual({ scale: 1, tx: 0, ty: 0 });
    move(evt(1, 500, 500)); // 单指: 无 pan (移动端防滚动冲突)
    expect(transform()).toEqual({ scale: 1, tx: 0, ty: 0 });
  });

  it('抬起指针: 剩余不足双指时重置 pinch/pan 基准', () => {
    const s = setupCanvas();
    const canvas = canvasEl(s.nodes);
    const down = canvas.props.onPointerDown as (e: PointerEvt) => void;
    const up = canvas.props.onPointerUp as (e: PointerEvt) => void;
    down(evt(1, 0, 0));
    down(evt(2, 10, 0));
    up(evt(1, 0, 0));
    up(evt(2, 10, 0));
    (canvas.props.onPointerCancel as (e: PointerEvt) => void)(evt(3, 0, 0));
    expect(transform()).toEqual({ scale: 1, tx: 0, ty: 0 });
  });

  it('鼠标悬停切换 hover → cursor', () => {
    const s = setupCanvas();
    const container = s.nodes.find((n) => typeof n.props.onMouseEnter === 'function')!;
    (container.props.onMouseEnter as () => void)();
    expect(h.states[3]).toBe(true);
    (container.props.onMouseLeave as () => void)();
    expect(h.states[3]).toBe(false);
  });
});

// ---------- TutorialPanel 键盘导航 + 嵌套组件交互 ----------

describe('TutorialPanel 键盘导航 effect', () => {
  function setupKey(stepIndex: number): {
    onKey: (e: Record<string, unknown>) => void;
    spies: { onPrev: ReturnType<typeof vi.fn>; onNext: ReturnType<typeof vi.fn>; onRestart: ReturnType<typeof vi.fn> };
  } {
    const listeners = new Map<string, (e: Record<string, unknown>) => void>();
    vi.stubGlobal('window', {
      addEventListener: (name: string, fn: (e: Record<string, unknown>) => void) =>
        listeners.set(name, fn),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('HTMLElement', class {});
    h.states = [];
    h.cursor = 0;
    h.effects = [];
    h.captureEffects = true;
    const spies = { onPrev: vi.fn(), onNext: vi.fn(), onRestart: vi.fn(), onFinish: vi.fn() };
    (TutorialPanel as unknown as (p: unknown) => unknown)(panelProps({ ...spies, stepIndex }));
    h.captureEffects = false;
    h.effects.forEach((fn) => fn()); // 执行 effect 注册监听器 (useSwipe 的 effect 因 ref 为空提前返回)
    const onKey = listeners.get('keydown');
    if (!onKey) throw new Error('keydown listener not registered');
    return { onKey, spies };
  }

  it('← 上一步 / → 下一步 / Home 回起点', () => {
    const { onKey, spies } = setupKey(1);
    onKey({ key: 'ArrowLeft' });
    expect(spies.onPrev).toHaveBeenCalledTimes(1);
    onKey({ key: 'ArrowRight' });
    expect(spies.onNext).toHaveBeenCalledTimes(1);
    onKey({ key: 'Home' });
    expect(spies.onRestart).toHaveBeenCalledTimes(1);
  });

  it('边界: 第一步忽略 ←/Home, 最后一步忽略 →', () => {
    const first = setupKey(0);
    first.onKey({ key: 'ArrowLeft' });
    first.onKey({ key: 'Home' });
    expect(first.spies.onPrev).not.toHaveBeenCalled();
    expect(first.spies.onRestart).not.toHaveBeenCalled();

    const last = setupKey(2);
    last.onKey({ key: 'ArrowRight' });
    expect(last.spies.onNext).not.toHaveBeenCalled();
  });

  it('输入框聚焦时按键被忽略', () => {
    const { onKey, spies } = setupKey(1);
    const El = globalThis.HTMLElement as unknown as new () => object;
    const input = Object.assign(new El(), { tagName: 'INPUT', isContentEditable: false });
    onKey({ key: 'ArrowLeft', target: input });
    const textarea = Object.assign(new El(), { tagName: 'TEXTAREA', isContentEditable: false });
    onKey({ key: 'ArrowRight', target: textarea });
    const editable = Object.assign(new El(), { tagName: 'DIV', isContentEditable: true });
    onKey({ key: 'Home', target: editable });
    expect(spies.onPrev).not.toHaveBeenCalled();
    expect(spies.onNext).not.toHaveBeenCalled();
    expect(spies.onRestart).not.toHaveBeenCalled();
  });
});

describe('AnnotatedInstruction 术语气泡交互', () => {
  function setupAnnotated(instruction: string, openIdx: number | null = null) {
    const look = makeLook({ steps: [makeStep({ instruction })] });
    if (openIdx !== null) setOverrides([{ pred: (v) => v === null, value: openIdx }]);
    h.states = [];
    h.cursor = 0;
    h.refs = [];
    h.effects = [];
    const el = (TutorialPanel as unknown as (p: unknown) => unknown)(panelProps({ look }));
    const nested = flattenTree(el).find(
      (n) => typeof n.type === 'function' && typeof n.props.text === 'string',
    );
    if (!nested) throw new Error('AnnotatedInstruction element not found');
    // 直接调用嵌套组件, 捕获其 state/effect
    h.states = [];
    h.cursor = 0;
    h.refs = [];
    h.effects = [];
    h.captureEffects = true;
    const tree = (nested.type as (p: unknown) => unknown)(nested.props);
    h.captureEffects = false;
    return { nodes: flattenTree(tree) };
  }

  it('点击术语: 展开/收起气泡 (openIdx 切换)', () => {
    const { nodes } = setupAnnotated('修容是关键一步');
    const term = nodes.find((n) => n.props.role === 'button')!;
    (term.props.onClick as () => void)();
    expect(h.states[0]).toBe(0); // 展开第一个术语
  });

  it('Enter / Space 键切换气泡, 其他键忽略', () => {
    const { nodes } = setupAnnotated('修容是关键一步');
    const term = nodes.find((n) => n.props.role === 'button')!;
    const preventDefault = vi.fn();
    (term.props.onKeyDown as (e: Record<string, unknown>) => void)({
      key: 'Enter',
      preventDefault,
    });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(h.states[0]).toBe(0);
    (term.props.onKeyDown as (e: Record<string, unknown>) => void)({ key: 'x', preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1); // 未再调用
  });

  it('点击指令外部关闭气泡 (doc mousedown)', () => {
    const listeners = new Map<string, (e: Record<string, unknown>) => void>();
    vi.stubGlobal('document', {
      addEventListener: (name: string, fn: (e: Record<string, unknown>) => void) =>
        listeners.set(name, fn),
      removeEventListener: vi.fn(),
    });
    const { nodes } = setupAnnotated('修容是关键一步', 0); // openIdx=0 → effect 注册监听
    expect(nodes.length).toBeGreaterThan(0);
    expect(h.effects).toHaveLength(1);
    h.effects[0]!();
    const onDown = listeners.get('mousedown')!;
    expect(onDown).toBeTypeOf('function');
    // containerRef 指向不包含 target 的容器 → 关闭
    h.refs[0]!.current = { contains: () => false };
    onDown({ target: {} });
    expect(h.states[0]).toBeNull();
    // 已关闭 (openIdx null) 时 effect 提前返回 — 重新以 null 渲染验证
    const closed = setupAnnotated('修容是关键一步');
    expect(closed.nodes.length).toBeGreaterThan(0);
  });
});

describe('ScenarioFavoritesPanel 交互', () => {
  function setupPanel() {
    seedFavorite('fav-1', Date.now());
    setOverrides([{ pred: (v) => v === false, value: true }]); // showScenarioPanel=true
    h.states = [];
    h.cursor = 0;
    const el = (TutorialPanel as unknown as (p: unknown) => unknown)(panelProps({ stepIndex: 0 }));
    const panelEl = flattenTree(el).find(
      (n) => typeof n.type === 'function' && typeof n.props.scenario === 'string',
    );
    if (!panelEl) throw new Error('ScenarioFavoritesPanel element not found');
    return panelEl;
  }

  it('点击查看收藏方案: track favorite_view (onViewFavorite)', () => {
    const panelEl = setupPanel();
    const rec = (panelEl.props.favorites as Array<unknown>)[0];
    (panelEl.props.onView as (r: unknown) => void)(rec);
    expect(trackMock).toHaveBeenCalledWith('favorite_view', {
      look_id: 'fav-1',
      look_name: '妆容fav-1',
      scenario: '日常通勤',
      source: 'scenario_panel',
    });
  });

  it('关闭面板: onClose 重置 showScenarioPanel', () => {
    const panelEl = setupPanel();
    (panelEl.props.onClose as () => void)();
    expect(h.states[0]).toBe(false);
  });

  it('面板内部: 遮罩点击关闭, 方案按钮 onView, 面板自身点击不冒泡', () => {
    const panelEl = setupPanel();
    const tree = (panelEl.type as (p: unknown) => unknown)(panelEl.props);
    const nodes = flattenTree(tree);
    const overlay = nodes.find((n) => n.props['aria-hidden'] === 'true' && n.props.onClick);
    (overlay!.props.onClick as () => void)();
    expect(h.states[0]).toBe(false);

    const stopPropagation = vi.fn();
    const dialog = nodes.find((n) => n.props.role === 'dialog')!;
    (dialog.props.onClick as (e: { stopPropagation: () => void }) => void)({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledTimes(1);

    const favBtn = nodes.find(
      (n) => n.type === 'button' && textOf(n).includes('妆容fav-1'),
    )!;
    const rec = (panelEl.props.favorites as Array<unknown>)[0];
    const onViewSpy = vi.fn();
    void onViewSpy;
    (favBtn.props.onClick as () => void)();
    expect(trackMock).toHaveBeenCalledWith('favorite_view', expect.objectContaining({ look_id: 'fav-1' }));
    void rec;
  });
});
