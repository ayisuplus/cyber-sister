// 教学术语 gloss/括注 — 让新手看懂教学步骤里的专业术语.
// 设计:
//   - GLOSSARY 是术语表 (term + 口语化 explain + 可选 aliases)
//   - getGlossary() 返回术语表 (数组, 便于 UI 展示 / 测试)
//   - annotateInstruction(text) 把一段教学指令拆成 {text | term} 片段数组,
//     UI 层据此把术语渲染成可点击的提示气泡.
//
// 约束: 本文件不依赖 React / DOM, 纯逻辑, 可在 node 测试环境直接跑.

/** 单个术语词条. */
export interface GlossaryEntry {
  /** 术语原文 (中文展示名). */
  term: string;
  /** 口语化、闺蜜感语气解释. */
  explain: string;
  /** 别名 / 英文写法, 命中任一别名都会标注为同一术语. */
  aliases?: string[];
}

/** annotateInstruction 返回的片段. */
export interface AnnotatedSegment {
  /** 'text' = 普通文本; 'term' = 命中的术语 (可点击). */
  type: 'text' | 'term';
  /** 片段文本内容. */
  content: string;
  /** 仅 type='term' 时有: 命中的标准术语名. */
  term?: string;
  /** 仅 type='term' 时有: 该术语的口语化解释. */
  explain?: string;
}

/**
 * 化妆教学常见术语表. 覆盖技法 / 脸型概念 / 眼型问题 / 工具 / 色系.
 * 解释统一用闺蜜感口语, 让新手不用查百度也能看懂.
 */
const GLOSSARY: GlossaryEntry[] = [
  {
    term: '截断式眼妆',
    explain:
      '用深色眼影在双眼皮褶皱上方画一道清晰的分界线，上面铺亮色，下面铺深色，双眼瞬间放大、立体感拉满～新手先用大地色练手最稳。',
    aliases: ['cut crease', '截断'],
  },
  {
    term: 'tightline',
    explain:
      '把眼线画在睫毛根部的内侧（不是画在眼皮上哦），睁开眼几乎看不到线，但睫毛根部瞬间变密，眼神立马有神，适合裸妆党。',
    aliases: ['内眼线', 'tightlining'],
  },
  {
    term: '晕染',
    explain:
      '用刷子把颜色边界来回扫开，让两种色过渡自然、没有明显分界线。妆面干不干净全看这步，多扫几下不亏。',
  },
  {
    term: '修容',
    explain:
      '用灰棕调深色扫在脸侧、鼻翼、发际线制造阴影感，视觉上脸小一圈、五官更立体。颜色别太红，否则像没洗干净。',
    aliases: ['阴影', 'contour'],
  },
  {
    term: '高光',
    explain:
      '用细闪的浅色点在鼻梁、颧骨、眉骨这些该凸的地方，让它“嘭”起来，立体又通透。少量多次，别涂成油饼脸。',
    aliases: ['highlight'],
  },
  {
    term: '遮瑕',
    explain:
      '用比肤色亮一点的遮瑕膏盖黑眼圈、痘印、红血丝，局部精准覆盖就好，别全脸糊一层。橘调遮黑眼圈最自然。',
    aliases: ['concealer'],
  },
  {
    term: '定妆',
    explain:
      '画完妆扫一层散粉或喷定妆喷雾，把粉底“焊”在脸上，出门一天也不脱妆。油皮必做，干皮选喷雾更温和。',
    aliases: ['散粉', '定妆喷雾'],
  },
  {
    term: '三庭五眼',
    explain:
      '衡量脸型比例的老说法——三庭是把脸长三等分（上庭/中庭/下庭），五眼是脸宽约五个眼睛宽。越接近越“标准”，化妆时用来判断哪里要拉长或缩短。',
  },
  {
    term: '面部折叠度',
    explain:
      '脸部立体程度的一种说法：折叠度高＝侧脸立体深邃，适合浓妆、欧美感；折叠度低＝扁平温柔，适合淡妆、韩系感。决定你化浓还是化淡。',
  },
  {
    term: '八字眉',
    explain:
      '眉头高、眉尾往下掉的眉形，看起来有点丧、没精神。画眉时记得把眉尾稍微提上去，整个人就精神了。',
  },
  {
    term: '肿泡眼',
    explain:
      '眼皮脂肪厚、看起来鼓鼓的眼睛。画眼影要避开大面积珠光，用哑光大地色从睫毛根向上晕染，消肿最稳，别一通乱涂亮片。',
  },
  {
    term: '卧蚕',
    explain:
      '笑起来眼下那条鼓鼓的肉条。用一点点亮色画在下面，眼睛会显得更圆更甜、像小狗眼，小心别和眼袋搞混啦。',
  },
  {
    term: '美妆蛋',
    explain:
      '一颗蛋形海绵，打湿后用来拍粉底，拍出来的妆面更服帖清透。记得勤洗，不然会滋生细菌长痘哦。',
    aliases: ['beauty blender'],
  },
  {
    term: '斜角刷',
    explain:
      '刷毛呈斜角的扁刷，画眉、画眼线、勾唇线都好用，精准利落。新手画眉选它最不容易出错。',
    aliases: ['angle brush'],
  },
  {
    term: '晕染刷',
    explain:
      '毛松软、蓬松的圆头刷，专门用来把眼影边界扫开、晕自然，新手必备一把。晕染全靠它。',
    aliases: ['blending brush'],
  },
  {
    term: '大地色系',
    explain:
      '棕、咖、米、浅金这一挂的颜色，最百搭、最消肿，通勤面试不出错的首选。新手第一盘眼影闭眼入大地色。',
    aliases: ['earth tone'],
  },
  {
    term: '蜜桃色系',
    explain:
      '粉橘偏暖的色系，腮红唇彩用上气色立马变好，温柔甜美感拉满，约会必备色系～',
    aliases: ['peach tone'],
  },
  {
    term: '浆果色系',
    explain:
      '深紫红、酒红这一挂，秋冬、晚宴、约会最有氛围感，显白又高级。唇深一点气场全开。',
    aliases: ['berry tone'],
  },
];

/** 返回术语表副本 (数组), 便于 UI 列表展示或测试断言. */
export function getGlossary(): GlossaryEntry[] {
  return GLOSSARY.map((g) => ({ ...g, aliases: g.aliases ? [...g.aliases] : undefined }));
}

// ---------- 术语匹配引擎 ----------

/** 转义正则元字符, 让术语原文能安全拼进 RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 构建匹配表: 把每个术语及其别名展开成 {match, entry}, 按长度降序排列.
 * 长串优先, 避免短别名 (如 "截断") 抢在长串 (如 "截断式眼妆") 前面导致误切.
 */
interface MatchRule {
  match: string;
  lower: string;
  entry: GlossaryEntry;
}

const MATCH_RULES: MatchRule[] = GLOSSARY.flatMap((entry) => {
  const keys = [entry.term, ...(entry.aliases ?? [])].filter((s) => s.length > 0);
  return keys.map((match) => ({ match, lower: match.toLowerCase(), entry }));
}).sort((a, b) => b.match.length - a.match.length);

/**
 * 用 lower 作为 key 的查找表 (大小写不敏感), 命中后回填标准 term.
 * 注意: 不同别名可能 lower 相同, 后者覆盖前者无害 (都指向同一 entry 概念).
 */
const MATCH_BY_LOWER: Map<string, MatchRule> = new Map();
for (const rule of MATCH_RULES) {
  if (!MATCH_BY_LOWER.has(rule.lower)) {
    MATCH_BY_LOWER.set(rule.lower, rule);
  }
}

/** 全局匹配正则: 大小写不敏感, 按规则顺序 (长串优先) 尝试. */
const TERM_PATTERN = new RegExp(
  `(${MATCH_RULES.map((r) => escapeRegExp(r.match)).join('|')})`,
  'gi',
);

/**
 * 将一段教学指令文本拆分为带术语标注的片段数组.
 *
 * - 普通片段 type='text', 直接渲染.
 * - 术语片段 type='term', 带 term / explain, UI 层渲染为可点击提示.
 * - 大小写不敏感 (英文别名 tightline / Tightline 都能命中).
 * - 长串优先: "截断式眼妆" 不会被 "截断" 提前切断.
 * - 无术语命中时返回单条 text 片段, UI 可直接当作普通 <p> 渲染.
 *
 * @param text 教学指令原文.
 * @returns 片段数组 (顺序与原文一致).
 */
export function annotateInstruction(text: string): AnnotatedSegment[] {
  if (!text || text.length === 0) return [];

  const segments: AnnotatedSegment[] = [];
  let lastIndex = 0;
  // 每次调用重置 lastIndex, 避免上次调用残留 (正则带 g 标志会记忆).
  TERM_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TERM_PATTERN.exec(text)) !== null) {
    const matched = match[0];
    const start = match.index;
    // 先把术语前的普通文本灌进去
    if (start > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, start) });
    }
    const rule = MATCH_BY_LOWER.get(matched.toLowerCase());
    if (rule) {
      segments.push({
        type: 'term',
        content: matched,
        term: rule.entry.term,
        explain: rule.entry.explain,
      });
    } else {
      // 理论上不会走到 (正则只匹配已知术语), 兜底当普通文本.
      segments.push({ type: 'text', content: matched });
    }
    lastIndex = start + matched.length;
    // 防御零宽匹配导致死循环
    if (TERM_PATTERN.lastIndex === start) {
      TERM_PATTERN.lastIndex++;
    }
  }

  // 尾部剩余普通文本
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  // 合并相邻的 text 片段, 让 UI 渲染更干净
  return mergeAdjacentText(segments);
}

/** 合并相邻的 type='text' 片段, 减少节点数. */
function mergeAdjacentText(segs: AnnotatedSegment[]): AnnotatedSegment[] {
  const out: AnnotatedSegment[] = [];
  for (const seg of segs) {
    const last = out[out.length - 1];
    if (seg.type === 'text' && last && last.type === 'text') {
      last.content += seg.content;
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}
