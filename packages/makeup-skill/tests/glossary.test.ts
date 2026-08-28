// glossary.ts 单元测试 — 术语表 + annotateInstruction 拆分逻辑.

import { describe, it, expect } from 'vitest';
import {
  getGlossary,
  annotateInstruction,
  type AnnotatedSegment,
} from '../src/frontend/tutorial/glossary';

/** 把片段重新拼回字符串, 用于断言内容完整. */
function joinSegments(segs: AnnotatedSegment[]): string {
  return segs.map((s) => s.content).join('');
}

describe('getGlossary — 术语表', () => {
  it('至少 15 个词条', () => {
    expect(getGlossary().length).toBeGreaterThanOrEqual(15);
  });

  it('每个词条有 term + explain (非空)', () => {
    for (const g of getGlossary()) {
      expect(g.term.length).toBeGreaterThan(0);
      expect(g.explain.length).toBeGreaterThan(5);
    }
  });

  it('覆盖需求要求的关键术语', () => {
    const terms = getGlossary().map((g) => g.term);
    const required = [
      '截断式眼妆',
      'tightline',
      '晕染',
      '修容',
      '高光',
      '遮瑕',
      '定妆',
      '三庭五眼',
      '面部折叠度',
      '八字眉',
      '肿泡眼',
      '卧蚕',
      '美妆蛋',
      '斜角刷',
      '晕染刷',
      '大地色系',
      '蜜桃色系',
      '浆果色系',
    ];
    for (const r of required) {
      expect(terms).toContain(r);
    }
  });

  it('返回的是副本, 修改不影响内部表', () => {
    const a = getGlossary();
    a.push({ term: 'hack', explain: 'x' });
    const b = getGlossary();
    expect(b.some((g) => g.term === 'hack')).toBe(false);
  });
});

describe('annotateInstruction — 术语标注拆分', () => {
  it('无术语时返回单条 text 片段, 内容完整', () => {
    const text = '今天天气不错, 出门逛街吧';
    const segs = annotateInstruction(text);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.type).toBe('text');
    expect(joinSegments(segs)).toBe(text);
  });

  it('空字符串返回空数组', () => {
    expect(annotateInstruction('')).toEqual([]);
  });

  it('命中中文术语 → 生成 term 片段, 带 term + explain', () => {
    const text = '用刷子做好晕染, 妆面才干净';
    const segs = annotateInstruction(text);
    const termSeg = segs.find((s) => s.type === 'term');
    expect(termSeg).toBeDefined();
    expect(termSeg!.term).toBe('晕染');
    expect(termSeg!.explain!.length).toBeGreaterThan(5);
    expect(joinSegments(segs)).toBe(text);
  });

  it('英文别名 tightline 大小写不敏感命中', () => {
    for (const word of ['tightline', 'Tightline', 'TIGHTLINE']) {
      const segs = annotateInstruction(`画好 ${word} 让眼神有神`);
      const termSeg = segs.find((s) => s.type === 'term');
      expect(termSeg, `应命中 tightline (${word})`).toBeDefined();
      expect(termSeg!.term).toBe('tightline');
    }
  });

  it('中文别名「内眼线」命中 tightline 词条', () => {
    const segs = annotateInstruction('先画内眼线再夹睫毛');
    const termSeg = segs.find((s) => s.type === 'term');
    expect(termSeg).toBeDefined();
    expect(termSeg!.term).toBe('tightline');
  });

  it('长串优先: 「截断式眼妆」不被「截断」提前切断', () => {
    const segs = annotateInstruction('试试截断式眼妆放大双眼');
    const termSegs = segs.filter((s) => s.type === 'term');
    expect(termSegs).toHaveLength(1);
    expect(termSegs[0]!.content).toBe('截断式眼妆');
    expect(termSegs[0]!.term).toBe('截断式眼妆');
  });

  it('单独「截断」(别名) 也能命中截断式眼妆词条', () => {
    const segs = annotateInstruction('用截断手法画眼影');
    const termSeg = segs.find((s) => s.type === 'term');
    expect(termSeg).toBeDefined();
    expect(termSeg!.term).toBe('截断式眼妆');
  });

  it('「晕染刷」作为整体命中, 不被「晕染」拆开', () => {
    const segs = annotateInstruction('拿晕染刷把边界扫开');
    const termSegs = segs.filter((s) => s.type === 'term');
    expect(termSegs).toHaveLength(1);
    expect(termSegs[0]!.content).toBe('晕染刷');
  });

  it('一段文本含多个术语 → 多个 term 片段, 顺序与原文一致', () => {
    const text = '先修容再上高光, 最后定妆';
    const segs = annotateInstruction(text);
    const termSegs = segs.filter((s) => s.type === 'term');
    expect(termSegs.map((s) => s.term)).toEqual(['修容', '高光', '定妆']);
    expect(joinSegments(segs)).toBe(text);
  });

  it('拆分后拼回的文本与原文完全一致 (无丢失/重复)', () => {
    const text = '用美妆蛋拍底妆, 斜角刷画眉, 大地色系眼影消肿, 卧蚕提亮';
    expect(joinSegments(annotateInstruction(text))).toBe(text);
  });

  it('相邻 text 片段会被合并 (减少节点)', () => {
    // "修容" 和 "高光" 之间只有 "再上", 应合并成一条 text
    const segs = annotateInstruction('修容再上高光');
    const textSegs = segs.filter((s) => s.type === 'text');
    // 期望: [term 修容] [text 再上] [term 高光] —— 中间一条 text
    expect(textSegs).toHaveLength(1);
    expect(textSegs[0]!.content).toBe('再上');
  });
});
