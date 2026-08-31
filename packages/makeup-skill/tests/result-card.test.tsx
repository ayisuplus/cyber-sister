// ResultCard 渲染 + 交互测试 (补充 resultCard.test.ts 未覆盖的组件行为).
//
// resultCard.test.ts 已覆盖: buildXiaohongshuText 文案结构 + 一次默认 SSR 渲染.
// 本文件覆盖: SSR 渲染分支 (收藏态/复制反馈/系统分享按钮/技巧打分排序/空步骤),
// 以及通过"直接调用组件函数 + 遍历元素树触发 onClick"覆盖事件处理器:
// onSaveImage (含 renderCardToPng canvas 重绘), copyToClipboard 三级降级,
// onNativeShare, toggleFavorite 收藏/取消收藏.
// hooks 由 react shim 兜底 (SSR 委托真实实现; 直接调用时 stateful 兜底).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FaceFeatures, MakeupLook, MakeupStep } from '../src/shared/types';

// ---------- React hooks shim ----------

const h = vi.hoisted(() => ({
  overrides: [] as Array<{ pred: (v: unknown) => boolean; value: unknown; consumed: boolean }>,
  states: [] as unknown[],
  cursor: 0,
  refs: [] as Array<{ current: unknown }>,
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
    useEffect: (fn: () => void, deps?: unknown) => {
      try {
        return (actual.useEffect as (f: () => void, d?: unknown) => void)(fn, deps);
      } catch {
        /* 直接调用: copied 自动消失计时器不注册 */
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

import ResultCard from '../src/frontend/result/ResultCard';
import { track } from '../src/shared/analytics';
import { haptic } from '../src/frontend/utils/haptic';
import { addFavorite, clearFavorites, isFavorited } from '../src/frontend/utils/favorites';

const trackMock = vi.mocked(track);
const hapticMock = vi.mocked(haptic);

// ---------- 夹具 ----------

function baseFeatures(over: Partial<FaceFeatures> = {}): FaceFeatures {
  return {
    upperThirdRatio: 0.33,
    middleThirdRatio: 0.34,
    lowerThirdRatio: 0.33,
    fiveEyeFit: 1.0,
    faceShape: 'oval',
    skinTone: 'cool_fair',
    eyeType: 'almond',
    noseType: 'straight',
    eyeDistanceRatio: 0.4,
    faceWidthHeightRatio: 0.8,
    lipFullnessRatio: 0.3,
    browArchAngle: 15,
    noseBridgeWidth: 0.2,
    confidence: 0.85,
    ...over,
  };
}

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

function baseLook(over: Partial<MakeupLook> = {}): MakeupLook {
  return {
    id: 'look_cool_water',
    name: '清冷白开水妆',
    scenario: '日常通勤',
    suitableFor: ['cool_fair', 'oval'],
    reason: '匹配冷白皮',
    steps: [makeStep({ brushDirection: '由内向外', toolHint: '美妆蛋' })],
    productHints: [],
    ...over,
  };
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

function setOverrides(list: Array<{ pred: (v: unknown) => boolean; value: unknown }>): void {
  h.overrides = list.map((o) => ({ ...o, consumed: false }));
}

beforeEach(() => {
  h.overrides = [];
  h.states = [];
  h.cursor = 0;
  h.refs = [];
  installLocalStorage();
  clearFavorites();
  trackMock.mockClear();
  hapticMock.mockClear();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
  vi.unstubAllGlobals();
});

// ---------- SSR 渲染分支 ----------

describe('ResultCard SSR 渲染分支', () => {
  it('默认: 摘要/技巧/操作按钮/种草文案区, 无系统分享按钮', () => {
    const html = renderToStaticMarkup(
      createElement(ResultCard, { features: baseFeatures(), look: baseLook() }),
    );
    expect(html).toContain('椭圆脸 + 冷白皮 + 杏眼');
    expect(html).toContain('清冷白开水妆');
    expect(html).toContain('日常通勤');
    expect(html).toContain('用气垫粉底轻拍全脸');
    expect(html).toContain('方向: 由内向外');
    expect(html).toContain('工具: 美妆蛋');
    expect(html).toContain('保存图片');
    expect(html).toContain('复制文案');
    expect(html).toContain('收藏方案');
    expect(html).toContain('闺蜜种草文案');
    expect(html).toContain('一键复制');
    expect(html).not.toContain('aria-label="系统分享"');
    expect(html).toContain('aria-pressed="false"');
  });

  it('已收藏: ★ 已收藏 + aria-pressed true', () => {
    addFavorite({
      lookId: 'look_cool_water',
      lookName: '清冷白开水妆',
      scenario: '日常通勤',
      features: { faceShape: 'oval', skinTone: 'cool_fair', eyeType: 'almond', confidence: 0.85 },
    });
    const html = renderToStaticMarkup(
      createElement(ResultCard, { features: baseFeatures(), look: baseLook() }),
    );
    expect(html).toContain('已收藏');
    expect(html).toContain('aria-pressed="true"');
  });

  it('copied / copiedXhs 注入: 显示已复制反馈', () => {
    // useState 顺序: copied(false) → copiedXhs(false) → favorited(lazy)
    setOverrides([
      { pred: (v) => v === false, value: true },
      { pred: (v) => v === false, value: true },
    ]);
    const html = renderToStaticMarkup(
      createElement(ResultCard, { features: baseFeatures(), look: baseLook() }),
    );
    expect(html).toContain('已复制');
    expect(html).toContain('✓ 已复制');
    expect(html).not.toContain('一键复制');
  });

  it('navigator.share 可用时渲染系统分享按钮', () => {
    vi.stubGlobal('navigator', { share: vi.fn() });
    const html = renderToStaticMarkup(
      createElement(ResultCard, { features: baseFeatures(), look: baseLook() }),
    );
    expect(html).toContain('aria-label="系统分享"');
  });

  it('技巧打分: brushDirection+toolHint 优先, 低分步骤被截断 (取前 3)', () => {
    const rich = makeStep({ id: 'a', instruction: '技巧A', brushDirection: '向上', toolHint: '刷' });
    const warnOnly = makeStep({ id: 'b', instruction: '技巧B', warnings: ['小心'] });
    const toolOnly = makeStep({ id: 'c', instruction: '技巧C', toolHint: '蛋' });
    const plain = makeStep({ id: 'd', instruction: '平淡步骤D' });
    const html = renderToStaticMarkup(
      createElement(ResultCard, {
        features: baseFeatures(),
        look: baseLook({ steps: [plain, toolOnly, warnOnly, rich] }),
      }),
    );
    expect(html).toContain('技巧A');
    expect(html).toContain('技巧B');
    expect(html).toContain('技巧C');
    // 4 步只取前 3 (按 score 排序), 无任何加分的 D 被截断
    expect(html).not.toContain('平淡步骤D');
  });

  it('空步骤: 技巧列表为空, 种草文案走无技巧兜底句', () => {
    const html = renderToStaticMarkup(
      createElement(ResultCard, {
        features: baseFeatures(),
        look: baseLook({ steps: [] }),
      }),
    );
    expect(html).toContain('整体妆面干净不挑皮');
  });

  it('不同五官映射: 心形脸/暖黄二白/肿泡眼', () => {
    const html = renderToStaticMarkup(
      createElement(ResultCard, {
        features: baseFeatures({ faceShape: 'heart', skinTone: 'warm_deep', eyeType: 'hooded' }),
        look: baseLook(),
      }),
    );
    expect(html).toContain('心形脸 + 暖黄二白 + 肿泡眼');
  });
});

// ---------- 直接调用组件: 事件处理器 ----------

interface TestEl {
  type: unknown;
  props: Record<string, unknown>;
}

function flattenTree(node: unknown, out: TestEl[] = []): TestEl[] {
  if (!node || typeof node === 'object') {
    if (Array.isArray(node)) {
      node.forEach((c) => flattenTree(c, out));
    } else if (node) {
      const el = node as TestEl;
      if (el.props && typeof el.props === 'object') {
        out.push(el);
        flattenTree(el.props.children, out);
      }
    }
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

function callCard(look: MakeupLook = baseLook(), features: FaceFeatures = baseFeatures()): TestEl[] {
  h.states = [];
  h.cursor = 0;
  h.refs = [];
  return flattenTree(
    (ResultCard as unknown as (p: unknown) => unknown)({ features, look }),
  );
}

function buttonByText(nodes: TestEl[], text: string): TestEl {
  const btn = nodes.find((n) => n.type === 'button' && textOf(n).includes(text));
  if (!btn) throw new Error(`button not found: ${text}`);
  return btn;
}

/** canvas 2d context 桩: 记录方法调用, 属性赋值透传. */
function makeCtx2d(calls: string[]): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop === 'measureText') return (s: string) => ({ width: String(s).length * 5 });
      if (prop === 'createLinearGradient') return () => ({ addColorStop: () => {} });
      if (!(prop in t)) {
        t[prop] = (...args: unknown[]) => {
          calls.push(prop);
          return args.length ? undefined : undefined;
        };
      }
      return t[prop];
    },
    set(t, prop: string, v: unknown) {
      t[prop] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

interface FakeDoc {
  body: { appendChild: (n: unknown) => void; removeChild: (n: unknown) => void };
  createElement: (tag: string) => Record<string, unknown>;
  execCommand: (cmd: string) => boolean;
  anchor: { click: ReturnType<typeof vi.fn>; href: string; download: string };
}

function stubDocument(ctxCalls: string[], ctxNull = false): FakeDoc {
  const anchor = { click: vi.fn(), href: '', download: '' };
  const doc: FakeDoc = {
    anchor,
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
    execCommand: vi.fn(() => true),
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => (ctxNull ? null : makeCtx2d(ctxCalls)),
          toDataURL: () => 'data:image/png;base64,FAKE',
        };
      }
      if (tag === 'a') return anchor;
      if (tag === 'textarea') return { value: '', style: {}, select: vi.fn() };
      return {};
    },
  };
  vi.stubGlobal('document', doc);
  return doc;
}

describe('ResultCard 保存图片', () => {
  it('cardRef 为空: 直接返回, 不产生下载', async () => {
    const doc = stubDocument([]);
    const nodes = callCard();
    await (buttonByText(nodes, '保存图片').props.onClick as () => Promise<void>)();
    expect(doc.anchor.click).not.toHaveBeenCalled();
    expect(trackMock).toHaveBeenCalledWith('result_share', { method: 'image' });
  });

  it('canvas 重绘成功: 触发 PNG 下载', async () => {
    const ctxCalls: string[] = [];
    const doc = stubDocument(ctxCalls);
    const nodes = callCard();
    h.refs[0]!.current = {}; // cardRef.current
    await (buttonByText(nodes, '保存图片').props.onClick as () => Promise<void>)();
    expect(doc.anchor.click).toHaveBeenCalledTimes(1);
    expect(doc.anchor.href).toBe('data:image/png;base64,FAKE');
    expect(doc.anchor.download).toContain('赛博姐妹-');
    expect(doc.anchor.download).toContain('.png');
    // canvas 重绘关键路径
    expect(ctxCalls).toContain('fillRect');
    expect(ctxCalls).toContain('arcTo'); // roundRect
    expect(ctxCalls).toContain('fillText');
    expect(hapticMock).toHaveBeenCalledWith('success');
  });

  it('getContext 返回 null: renderCardToPng 返回 null → haptic error, 无下载', async () => {
    const doc = stubDocument([], true);
    const nodes = callCard();
    h.refs[0]!.current = {};
    await (buttonByText(nodes, '保存图片').props.onClick as () => Promise<void>)();
    expect(doc.anchor.click).not.toHaveBeenCalled();
    expect(hapticMock).toHaveBeenCalledWith('error');
  });

  it('长文案在 canvas 中换行 (wrapText)', async () => {
    const ctxCalls: string[] = [];
    stubDocument(ctxCalls);
    const longStep = makeStep({
      instruction: '这是一段非常非常长的教学指令用来触发画布排版的自动换行逻辑'.repeat(10),
      brushDirection: '由内向外',
      toolHint: '美妆蛋',
    });
    const nodes = callCard(baseLook({ steps: [longStep] }));
    h.refs[0]!.current = {};
    await (buttonByText(nodes, '保存图片').props.onClick as () => Promise<void>)();
    // fillText 被调用多次: 标题/五官/妆容/多行技巧/页脚
    const fillTextCount = ctxCalls.filter((c) => c === 'fillText').length;
    expect(fillTextCount).toBeGreaterThan(10);
  });
});

describe('ResultCard 复制文案 (clipboard 三级降级)', () => {
  it('navigator.clipboard 可用: 写入分享文案, copied=true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const nodes = callCard();
    await (buttonByText(nodes, '复制文案').props.onClick as () => Promise<void>)();
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain('赛博姐妹 AI 妆教');
    expect(text).toContain('清冷白开水妆');
    expect(h.states[0]).toBe(true); // copied
    expect(trackMock).toHaveBeenCalledWith('result_share', { method: 'copy' });
  });

  it('clipboard 抛错 → textarea + execCommand 降级成功', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const doc = stubDocument([]);
    const nodes = callCard();
    await (buttonByText(nodes, '复制文案').props.onClick as () => Promise<void>)();
    expect(doc.execCommand).toHaveBeenCalledWith('copy');
    expect(h.states[0]).toBe(true);
  });

  it('clipboard 抛错 + execCommand 抛错 → 复制失败, copied 不变', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const doc = stubDocument([]);
    doc.execCommand = vi.fn(() => {
      throw new Error('no exec');
    });
    const nodes = callCard();
    await (buttonByText(nodes, '复制文案').props.onClick as () => Promise<void>)();
    expect(h.states[0]).toBe(false);
    expect(hapticMock).toHaveBeenCalledWith('error');
  });

  it('无 clipboard 且无 document → 复制失败返回 false', async () => {
    vi.stubGlobal('navigator', {});
    // 不 stub document — Node 无 document 全局
    const nodes = callCard();
    await (buttonByText(nodes, '复制文案').props.onClick as () => Promise<void>)();
    expect(h.states[0]).toBe(false);
    expect(hapticMock).toHaveBeenCalledWith('error');
  });

  it('种草文案一键复制: 写入 xhs 文案, copiedXhs=true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const nodes = callCard();
    await (buttonByText(nodes, '一键复制').props.onClick as () => Promise<void>)();
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain('#赛博姐妹');
    expect(h.states[1]).toBe(true); // copiedXhs
    expect(trackMock).toHaveBeenCalledWith('result_share', { method: 'copy_xhs' });
  });
});

describe('ResultCard 系统分享', () => {
  it('分享成功: haptic success + track native', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share });
    const nodes = callCard();
    const shareBtn = nodes.find((n) => n.type === 'button' && n.props['aria-label'] === '系统分享')!;
    await (shareBtn.props.onClick as () => Promise<void>)();
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('清冷白开水妆') }),
    );
    expect(trackMock).toHaveBeenCalledWith('result_share', { method: 'native' });
    expect(hapticMock).toHaveBeenCalledWith('success');
  });

  it('用户取消 (AbortError): 静默, 不报 error haptic', async () => {
    const abort = new Error('cancelled');
    abort.name = 'AbortError';
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(abort) });
    const nodes = callCard();
    const shareBtn = nodes.find((n) => n.type === 'button' && n.props['aria-label'] === '系统分享')!;
    await (shareBtn.props.onClick as () => Promise<void>)();
    expect(hapticMock).not.toHaveBeenCalledWith('error');
  });

  it('其他错误: haptic error', async () => {
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new Error('nope')) });
    const nodes = callCard();
    const shareBtn = nodes.find((n) => n.type === 'button' && n.props['aria-label'] === '系统分享')!;
    await (shareBtn.props.onClick as () => Promise<void>)();
    expect(hapticMock).toHaveBeenCalledWith('error');
  });
});

describe('ResultCard 收藏切换', () => {
  it('未收藏 → 点击收藏: addFavorite + track add', () => {
    const nodes = callCard();
    (buttonByText(nodes, '收藏方案').props.onClick as () => void)();
    expect(isFavorited('look_cool_water')).toBe(true);
    expect(h.states[2]).toBe(true); // favorited
    expect(trackMock).toHaveBeenCalledWith('favorite_toggle', {
      look_id: 'look_cool_water',
      action: 'add',
    });
  });

  it('已收藏 → 点击取消: removeFavorite + track remove', () => {
    addFavorite({
      lookId: 'look_cool_water',
      lookName: '清冷白开水妆',
      scenario: '日常通勤',
      features: { faceShape: 'oval', skinTone: 'cool_fair', eyeType: 'almond', confidence: 0.85 },
    });
    const nodes = callCard();
    (buttonByText(nodes, '已收藏').props.onClick as () => void)();
    expect(isFavorited('look_cool_water')).toBe(false);
    expect(h.states[2]).toBe(false);
    expect(trackMock).toHaveBeenCalledWith('favorite_toggle', {
      look_id: 'look_cool_water',
      action: 'remove',
    });
  });
});
