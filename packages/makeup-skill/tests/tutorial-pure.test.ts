// glossary 补充测试 — 针对 annotateInstruction 的分支边界:
//   - 术语紧邻 (两个术语之间无普通文本 → 不灌 text 片段)
//   - 术语在首尾 (无头部/尾部 text 片段)
//   - 英文别名大小写不敏感
//   - 长串优先 + lastIndex 复位 (重复调用)
// 注: glossary.ts 的 223 / 228 / 247 行是防御性兜底 (正则不可能零宽匹配、
// 命中词一定在查找表里、相邻 text 片段只在兜底分支出现), 通过公开 API 不可达,
// 本文件用行为测试把可达分支全部锁死.

import { describe, it, expect } from 'vitest';
import { annotateInstruction } from '../src/frontend/tutorial/glossary';

describe('annotateInstruction — 术语紧邻与首尾边界', () => {
  it('两个术语紧邻 (无间隔文本) → 两个 term 片段, 不产生空 text', () => {
    const segs = annotateInstruction('晕染修容');
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ type: 'term', content: '晕染', term: '晕染' });
    expect(segs[1]).toMatchObject({ type: 'term', content: '修容', term: '修容' });
    // 不允许出现 content 为空的 text 片段
    expect(segs.some((s) => s.type === 'text' && s.content === '')).toBe(false);
  });

  it('术语在开头和结尾 → 无头部/尾部 text 片段', () => {
    const segs = annotateInstruction('晕染这一步很重要,最后记得定妆');
    expect(segs[0]).toMatchObject({ type: 'term', term: '晕染' });
    expect(segs[segs.length - 1]).toMatchObject({ type: 'term', term: '定妆' });
    // 中间应有普通文本
    expect(segs.some((s) => s.type === 'text' && s.content.includes('很重要'))).toBe(true);
  });

  it('术语后面紧跟标点 → 标点归入尾部 text', () => {
    const segs = annotateInstruction('高光,');
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ type: 'term', term: '高光' });
    expect(segs[1]).toEqual({ type: 'text', content: ',' });
  });
});

describe('annotateInstruction — 英文别名与大小写', () => {
  it('英文别名大小写不敏感: Cut Crease → 截断式眼妆', () => {
    const segs = annotateInstruction('试试 Cut Crease 画法');
    const term = segs.find((s) => s.type === 'term');
    expect(term).toBeDefined();
    expect(term).toMatchObject({ content: 'Cut Crease', term: '截断式眼妆' });
    expect(term?.explain).toBeTruthy();
  });

  it('全大写 TIGHTLINE 也命中 tightline', () => {
    const segs = annotateInstruction('TIGHTLINE 适合裸妆');
    expect(segs[0]).toMatchObject({ type: 'term', content: 'TIGHTLINE', term: 'tightline' });
  });
});

describe('annotateInstruction — 长串优先与状态复位', () => {
  it('截断式眼妆 不被短别名 截断 提前切断', () => {
    const segs = annotateInstruction('先画截断式眼妆再晕染');
    const terms = segs.filter((s) => s.type === 'term');
    expect(terms.map((t) => t.term)).toEqual(['截断式眼妆', '晕染']);
  });

  it('重复调用不残留 lastIndex (正则带 g 标志)', () => {
    const a = annotateInstruction('高光提亮');
    const b = annotateInstruction('高光提亮');
    expect(a).toEqual(b);
    expect(a.some((s) => s.type === 'term' && s.term === '高光')).toBe(true);
  });

  it('空字符串 → 空数组', () => {
    expect(annotateInstruction('')).toEqual([]);
  });

  it('无术语文本 → 单条 text 片段', () => {
    const segs = annotateInstruction('今天天气不错适合出门');
    expect(segs).toEqual([{ type: 'text', content: '今天天气不错适合出门' }]);
  });
});
