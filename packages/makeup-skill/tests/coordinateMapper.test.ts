// coordinateMapper 测试 — MediaPipe 归一化坐标 ↔ Canvas 像素坐标映射.
// 纯函数, 覆盖: 等比缩放居中布局 / 单点与批量映射 / OverlayZone 端到端映射
// (关键点缺失跳过, 未注册区域 null, ellipse 中心与半径计算, 自定义 radiusFactor).

import { describe, it, expect, afterEach } from 'vitest';
import {
  computeCanvasLayout,
  mapLandmarkToCanvas,
  mapLandmarksToCanvas,
  getZoneLandmarkIndices,
  mapZoneToCanvas,
  getZoneCenterOnCanvas,
  getZoneRadiusOnCanvas,
  getZoneDrawInfo,
  mapZonesToDrawInfo,
  ZONE_DEFINITIONS,
  type CanvasLayout,
  type NormalizedLandmarks,
} from '../src/frontend/tutorial/coordinateMapper';
import type { ZoneDefinition } from '../src/frontend/tutorial/overlayZones';
import type { OverlayZone } from '../src/shared/types';

/** 恒等布局: 归一化坐标 × 100 = Canvas 像素. */
const IDENTITY: CanvasLayout = {
  imageX: 0,
  imageY: 0,
  imageWidth: 100,
  imageHeight: 100,
  canvasWidth: 100,
  canvasHeight: 100,
};

/** 稀疏关键点表: 只设置指定索引, 其余留空 (模拟越界/缺失). */
function sparse(entries: Record<number, { x: number; y: number; z?: number }>): NormalizedLandmarks {
  const arr: Array<{ x: number; y: number; z?: number }> = [];
  for (const [k, v] of Object.entries(entries)) {
    arr[Number(k)] = v;
  }
  return arr;
}

/** 478 个全部同一点的关键点表. */
function uniform(x: number, y: number): NormalizedLandmarks {
  return Array.from({ length: 478 }, () => ({ x, y }));
}

// 注入测试用的假区域定义 (用例结束后删除, 不污染其他测试).
const FAKE_KEYS = ['fake_no_center', 'fake_radius_factor', 'fake_empty_radius'] as const;
afterEach(() => {
  const dict = ZONE_DEFINITIONS as Record<string, ZoneDefinition>;
  for (const k of FAKE_KEYS) delete dict[k];
});

describe('computeCanvasLayout — 等比缩放居中', () => {
  it('横图放进方画布: 宽度撑满, 垂直居中', () => {
    const l = computeCanvasLayout(1000, 500, 100, 100);
    expect(l).toEqual({
      imageX: 0,
      imageY: 25,
      imageWidth: 100,
      imageHeight: 50,
      canvasWidth: 100,
      canvasHeight: 100,
    });
  });

  it('竖图放进方画布: 高度撑满, 水平居中', () => {
    const l = computeCanvasLayout(500, 1000, 100, 100);
    expect(l.imageX).toBe(25);
    expect(l.imageY).toBe(0);
    expect(l.imageWidth).toBe(50);
    expect(l.imageHeight).toBe(100);
  });

  it('宽高比一致 → 完全填满, 无偏移', () => {
    const l = computeCanvasLayout(200, 100, 100, 50);
    expect(l.imageX).toBe(0);
    expect(l.imageY).toBe(0);
    expect(l.imageWidth).toBe(100);
    expect(l.imageHeight).toBe(50);
  });

  it('小图放大 (scale > 1) 也允许', () => {
    const l = computeCanvasLayout(50, 50, 100, 100);
    expect(l.imageWidth).toBe(100);
    expect(l.imageHeight).toBe(100);
  });

  it.each([
    [0, 500, 100, 100],
    [-1, 500, 100, 100],
    [1000, 0, 100, 100],
    [1000, 500, 0, 100],
    [1000, 500, 100, -5],
  ])('非法维度 (%s,%s → %s,%s) → 零尺寸布局, 避免除零', (iw, ih, cw, ch) => {
    const l = computeCanvasLayout(iw, ih, cw, ch);
    expect(l.imageX).toBe(0);
    expect(l.imageY).toBe(0);
    expect(l.imageWidth).toBe(0);
    expect(l.imageHeight).toBe(0);
    // Canvas 尺寸原样保留
    expect(l.canvasWidth).toBe(cw);
    expect(l.canvasHeight).toBe(ch);
  });
});

describe('mapLandmarkToCanvas / mapLandmarksToCanvas', () => {
  const layout: CanvasLayout = {
    imageX: 10,
    imageY: 20,
    imageWidth: 200,
    imageHeight: 100,
    canvasWidth: 220,
    canvasHeight: 140,
  };

  it('单点: 偏移 + 缩放', () => {
    expect(mapLandmarkToCanvas({ x: 0, y: 0 }, layout)).toEqual({ x: 10, y: 20 });
    expect(mapLandmarkToCanvas({ x: 0.5, y: 0.5 }, layout)).toEqual({ x: 110, y: 70 });
    expect(mapLandmarkToCanvas({ x: 1, y: 1 }, layout)).toEqual({ x: 210, y: 120 });
  });

  it('镜像/越界归一化坐标按同一仿射公式映射 (不做裁剪)', () => {
    // x 镜像场景由上层翻转坐标后传入, 这里只验证线性映射
    expect(mapLandmarkToCanvas({ x: 1.2, y: -0.1 }, layout)).toEqual({ x: 250, y: 10 });
  });

  it('批量: 空数组 → 空数组; 多点逐一映射', () => {
    expect(mapLandmarksToCanvas([], layout)).toEqual([]);
    const out = mapLandmarksToCanvas(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      layout,
    );
    expect(out).toEqual([
      { x: 10, y: 20 },
      { x: 210, y: 120 },
    ]);
  });
});

describe('getZoneLandmarkIndices', () => {
  it('已注册区域返回关键点索引数组', () => {
    expect(getZoneLandmarkIndices('forehead')).toEqual([10, 151, 9, 8, 168, 6]);
  });

  it('未注册区域返回 null', () => {
    expect(getZoneLandmarkIndices('bogus' as OverlayZone)).toBeNull();
  });
});

describe('mapZoneToCanvas', () => {
  it('完整 478 关键点 → 区域内所有点都被映射', () => {
    const pts = mapZoneToCanvas('forehead', uniform(0.5, 0.5), IDENTITY);
    expect(pts).toHaveLength(6);
    for (const p of pts!) expect(p).toEqual({ x: 50, y: 50 });
  });

  it('关键点缺失 (越界) 被跳过, 不抛错', () => {
    const pts = mapZoneToCanvas('forehead', sparse({ 10: { x: 0.2, y: 0.4 } }), IDENTITY);
    expect(pts).toEqual([{ x: 20, y: 40 }]);
  });

  it('全部关键点缺失 → 空数组 (非 null)', () => {
    expect(mapZoneToCanvas('forehead', [], IDENTITY)).toEqual([]);
  });

  it('未注册区域 → null', () => {
    expect(mapZoneToCanvas('bogus' as OverlayZone, uniform(0.5, 0.5), IDENTITY)).toBeNull();
  });
});

describe('getZoneCenterOnCanvas', () => {
  it('polygon: 取所有可用顶点的平均坐标', () => {
    const landmarks = sparse({
      10: { x: 0, y: 0 },
      151: { x: 1, y: 0 },
      9: { x: 0, y: 1 },
      8: { x: 1, y: 1 },
      168: { x: 0.5, y: 0.5 },
      6: { x: 0.5, y: 0.5 },
    });
    expect(getZoneCenterOnCanvas('forehead', landmarks, IDENTITY)).toEqual({ x: 50, y: 50 });
  });

  it('polygon: 部分关键点缺失时只用可用的点求平均', () => {
    const landmarks = sparse({ 10: { x: 0, y: 0 }, 151: { x: 1, y: 1 } });
    expect(getZoneCenterOnCanvas('forehead', landmarks, IDENTITY)).toEqual({ x: 50, y: 50 });
  });

  it('polygon: 全部关键点缺失 → null', () => {
    expect(getZoneCenterOnCanvas('forehead', [], IDENTITY)).toBeNull();
  });

  it('ellipse: 用 center 指定的关键点, 与其他顶点无关', () => {
    const landmarks = sparse({ 1: { x: 0.3, y: 0.6 }, 2: { x: 0.9, y: 0.9 } });
    expect(getZoneCenterOnCanvas('nose_tip', landmarks, IDENTITY)).toEqual({ x: 30, y: 60 });
  });

  it('ellipse: center 关键点缺失 → null', () => {
    // nose_tip center=1, 只给 idx 2
    const landmarks = sparse({ 2: { x: 0.5, y: 0.5 } });
    expect(getZoneCenterOnCanvas('nose_tip', landmarks, IDENTITY)).toBeNull();
  });

  it('ellipse 未定义 center (防御分支) → null', () => {
    (ZONE_DEFINITIONS as Record<string, ZoneDefinition>).fake_no_center = {
      landmarks: [1, 2, 3],
      shape: 'ellipse',
      color: 'rgba(0,0,0,0.5)',
    };
    expect(
      getZoneCenterOnCanvas('fake_no_center' as OverlayZone, uniform(0.5, 0.5), IDENTITY),
    ).toBeNull();
  });

  it('未注册区域 → null', () => {
    expect(getZoneCenterOnCanvas('bogus' as OverlayZone, uniform(0.5, 0.5), IDENTITY)).toBeNull();
  });
});

describe('getZoneRadiusOnCanvas', () => {
  // nose_tip: landmarks [1,2,4,5,6], center 1
  const radiusLandmarks = sparse({
    1: { x: 0.5, y: 0.5 },
    2: { x: 0.6, y: 0.5 },
    4: { x: 0.5, y: 0.6 },
    5: { x: 0.4, y: 0.5 },
    6: { x: 0.5, y: 0.4 },
  });
  // 平均归一化距离 = (0 + 0.1*4) / 5 = 0.08
  const layout: CanvasLayout = { ...IDENTITY, imageHeight: 200 };

  it('ellipse: 平均距离 × 0.7 (默认系数), 按宽高分别换算像素', () => {
    const r = getZoneRadiusOnCanvas('nose_tip', radiusLandmarks, layout);
    expect(r).not.toBeNull();
    // rNorm = 0.08 * 0.7 = 0.056
    expect(r!.rx).toBeCloseTo(0.056 * 100, 6);
    expect(r!.ry).toBeCloseTo(0.056 * 200, 6);
  });

  it('radiusFactorOverride 覆盖默认系数', () => {
    const r = getZoneRadiusOnCanvas('nose_tip', radiusLandmarks, layout, 1.0);
    expect(r!.rx).toBeCloseTo(8, 6);
    expect(r!.ry).toBeCloseTo(16, 6);
  });

  it('区域自带 radiusFactor 时用定义值', () => {
    (ZONE_DEFINITIONS as Record<string, ZoneDefinition>).fake_radius_factor = {
      landmarks: [0, 1],
      shape: 'ellipse',
      center: 0,
      radiusFactor: 0.5,
      color: 'rgba(0,0,0,0.5)',
    };
    const landmarks = sparse({ 0: { x: 0, y: 0 }, 1: { x: 0.2, y: 0 } });
    // avg = (0 + 0.2)/2 = 0.1; rNorm = 0.1 * 0.5 = 0.05
    const r = getZoneRadiusOnCanvas('fake_radius_factor' as OverlayZone, landmarks, IDENTITY);
    expect(r!.rx).toBeCloseTo(5, 6);
    expect(r!.ry).toBeCloseTo(5, 6);
  });

  it('polygon 区域 → null (半径只对 ellipse 有意义)', () => {
    expect(getZoneRadiusOnCanvas('forehead', uniform(0.5, 0.5), IDENTITY)).toBeNull();
  });

  it('未注册区域 → null', () => {
    expect(getZoneRadiusOnCanvas('bogus' as OverlayZone, uniform(0.5, 0.5), IDENTITY)).toBeNull();
  });

  it('ellipse 未定义 center (防御分支) → null', () => {
    (ZONE_DEFINITIONS as Record<string, ZoneDefinition>).fake_no_center = {
      landmarks: [1, 2, 3],
      shape: 'ellipse',
      color: 'rgba(0,0,0,0.5)',
    };
    expect(
      getZoneRadiusOnCanvas('fake_no_center' as OverlayZone, uniform(0.5, 0.5), IDENTITY),
    ).toBeNull();
  });

  it('center 关键点缺失 → null', () => {
    expect(getZoneRadiusOnCanvas('nose_tip', sparse({ 2: { x: 0.5, y: 0.5 } }), IDENTITY)).toBeNull();
  });

  it('center 存在但所有采样点缺失 → null (count === 0)', () => {
    (ZONE_DEFINITIONS as Record<string, ZoneDefinition>).fake_empty_radius = {
      landmarks: [5, 6, 7],
      shape: 'ellipse',
      center: 0,
      color: 'rgba(0,0,0,0.5)',
    };
    const landmarks = sparse({ 0: { x: 0.5, y: 0.5 } });
    expect(
      getZoneRadiusOnCanvas('fake_empty_radius' as OverlayZone, landmarks, IDENTITY),
    ).toBeNull();
  });

  it('半径随布局缩放: 图片缩放 2 倍, 半径也 2 倍', () => {
    const big: CanvasLayout = { ...IDENTITY, imageWidth: 200, imageHeight: 400 };
    const r = getZoneRadiusOnCanvas('nose_tip', radiusLandmarks, big);
    expect(r!.rx).toBeCloseTo(0.056 * 200, 6);
    expect(r!.ry).toBeCloseTo(0.056 * 400, 6);
  });
});

describe('getZoneDrawInfo', () => {
  it('polygon 区域: 顶点 + 颜色 + radius=null', () => {
    const info = getZoneDrawInfo('forehead', uniform(0.5, 0.5), IDENTITY);
    expect(info).not.toBeNull();
    expect(info!.zone).toBe('forehead');
    expect(info!.shape).toBe('polygon');
    expect(info!.points).toHaveLength(6);
    expect(info!.radius).toBeNull();
    expect(info!.color).toBe(ZONE_DEFINITIONS.forehead.color);
    expect(info!.definition).toBe(ZONE_DEFINITIONS.forehead);
  });

  it('ellipse 区域: 中心点 + 半径', () => {
    const landmarks = sparse({
      1: { x: 0.5, y: 0.5 },
      2: { x: 0.6, y: 0.5 },
      4: { x: 0.5, y: 0.6 },
      5: { x: 0.4, y: 0.5 },
      6: { x: 0.5, y: 0.4 },
    });
    const info = getZoneDrawInfo('nose_tip', landmarks, IDENTITY);
    expect(info).not.toBeNull();
    expect(info!.shape).toBe('ellipse');
    expect(info!.points).toHaveLength(5);
    expect(info!.radius).not.toBeNull();
    expect(info!.radius!.rx).toBeCloseTo(5.6, 6);
    expect(info!.radius!.ry).toBeCloseTo(5.6, 6);
  });

  it('未注册区域 → null', () => {
    expect(getZoneDrawInfo('bogus' as OverlayZone, uniform(0.5, 0.5), IDENTITY)).toBeNull();
  });

  it('所有关键点缺失 → null (points 为空)', () => {
    expect(getZoneDrawInfo('forehead', [], IDENTITY)).toBeNull();
  });
});

describe('mapZonesToDrawInfo', () => {
  it('批量转换: 失败/未注册的 zone 被跳过, 顺序保持', () => {
    const landmarks = uniform(0.5, 0.5);
    const out = mapZonesToDrawInfo(['forehead', 'bogus' as OverlayZone, 'nose_tip'], landmarks, IDENTITY);
    expect(out.map((i) => i.zone)).toEqual(['forehead', 'nose_tip']);
  });

  it('空输入 → 空数组', () => {
    expect(mapZonesToDrawInfo([], uniform(0.5, 0.5), IDENTITY)).toEqual([]);
  });
});
