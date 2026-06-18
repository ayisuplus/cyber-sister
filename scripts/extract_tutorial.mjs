// 从 data/annotations.jsonl 提取 5 个主流风格的技法/难度/场合/色彩 → 写入 src/data.ts
// 用法: node scripts/extract_tutorial.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const TARGET_STYLES = ['纯欲妆', '伪素颜妆', '白开水妆', '蜜桃妆', '韩系妆'];

// 触发词(LoRA prompt 关键词,来自训练包)
const TRIGGERS = {
  '纯欲妆': 'pure desire makeup, glossy lips, dewy skin, soft blush',
  '伪素颜妆': 'no-makeup makeup, natural bare skin, soft pink lip',
  '白开水妆': 'clean girl makeup, minimal, fresh, hydrated skin',
  '蜜桃妆': 'peach makeup, peachy blush, warm coral lip',
  '韩系妆': 'korean makeup, gradient lips, straight brow, clear skin',
};

// 风格简介(从数据 vibe 聚合)
const DESCRIPTIONS = {
  '纯欲妆': '水光玻璃唇 + 淡腮红,营造"又纯又欲"的氛围感。',
  '伪素颜妆': '极致裸妆,皮肤原生质感,直男看不出化过妆。',
  '白开水妆': 'clean girl 风,清透零妆感,韩系日常天花板。',
  '蜜桃妆': '蜜桃色系腮红 + 唇妆,温柔元气的春夏感。',
  '韩系妆': '水光肌 + 平眉 + 咬唇,经典韩剧女主妆。',
};

const lines = readFileSync(join(ROOT, 'data', 'annotations.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean);

const buckets = Object.fromEntries(TARGET_STYLES.map((s) => [s, []]));

for (const line of lines) {
  try {
    const obj = JSON.parse(line);
    const a = obj.annotation;
    if (!a || !TARGET_STYLES.includes(a.style)) continue;
    buckets[a.style].push(a);
  } catch {
    // 跳过损坏行
  }
}

const tutorials = TARGET_STYLES.map((style) => {
  const items = buckets[style];
  // 技法频次
  const techCount = new Map();
  for (const a of items) for (const t of a.techniques || []) techCount.set(t, (techCount.get(t) || 0) + 1);
  const techniques = [...techCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t, c]) => ({ name: t, weight: Math.round((c / items.length) * 100) }));

  // 难度众数
  const diffCount = new Map();
  for (const a of items) diffCount.set(a.difficulty, (diffCount.get(a.difficulty) || 0) + 1);
  const difficulty = [...diffCount.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // 场合
  const occCount = new Map();
  for (const a of items)
    for (const o of (a.occasion || '').split(/[、,/,\s]+/))
      if (o) occCount.set(o, (occCount.get(o) || 0) + 1);
  const occasions = [...occCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([o]) => o);

  // 主导色
  const colorCount = new Map();
  for (const a of items)
    for (const c of a.dominant_colors || []) colorCount.set(c, (colorCount.get(c) || 0) + 1);
  const colors = [...colorCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([c]) => c);

  // 皮肤质地众数
  const skinCount = new Map();
  for (const a of items) if (a.skin_finish) skinCount.set(a.skin_finish, (skinCount.get(a.skin_finish) || 0) + 1);
  const skinFinish = [...skinCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  // vibe 众数
  const vibeCount = new Map();
  for (const a of items) if (a.vibe) vibeCount.set(a.vibe, (vibeCount.get(a.vibe) || 0) + 1);
  const vibe = [...vibeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  return {
    id: style,
    name: style,
    trigger: TRIGGERS[style],
    description: DESCRIPTIONS[style],
    difficulty,
    sampleCount: items.length,
    techniques,
    occasions,
    colors,
    skinFinish,
    vibe,
  };
});

const out = `// 教学数据 — 由 scripts/extract_tutorial.mjs 从 data/annotations.jsonl 自动生成
// 5 个主流风格,共 ${tutorials.reduce((s, t) => s + t.sampleCount, 0)} 条样本聚合

export interface Technique {
  name: string;
  weight: number; // 该技法在样本中出现的百分比
}

export interface Tutorial {
  id: string;
  name: string;
  trigger: string;        // LoRA 触发词
  description: string;
  difficulty: string;     // easy / medium / hard
  sampleCount: number;
  techniques: Technique[];
  occasions: string[];
  colors: string[];
  skinFinish: string;
  vibe: string;
}

export const TUTORIALS: Tutorial[] = ${JSON.stringify(tutorials, null, 2)};

export function getTutorial(id: string): Tutorial | undefined {
  return TUTORIALS.find((t) => t.id === id);
}
`;

writeFileSync(join(ROOT, 'src', 'data.ts'), out, 'utf8');
console.log(`[ok] wrote src/data.ts (${tutorials.length} styles, ${tutorials.reduce((s, t) => s + t.sampleCount, 0)} samples)`);
for (const t of tutorials) console.log(`  - ${t.name}: ${t.sampleCount} samples, ${t.techniques.length} techniques`);
