// 教学数据 — 由 scripts/extract_tutorial.mjs 从 data/annotations.jsonl 自动生成
// 5 个主流风格,共 356 条样本聚合

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

export const TUTORIALS: Tutorial[] = [
  {
    "id": "纯欲妆",
    "name": "纯欲妆",
    "trigger": "pure desire makeup, glossy lips, dewy skin, soft blush",
    "description": "水光玻璃唇 + 淡腮红,营造\"又纯又欲\"的氛围感。",
    "difficulty": "medium",
    "sampleCount": 195,
    "techniques": [
      {
        "name": "卧蚕提亮",
        "weight": 33
      },
      {
        "name": "眼下腮红",
        "weight": 12
      },
      {
        "name": "水光玻璃唇",
        "weight": 10
      },
      {
        "name": "野生眉",
        "weight": 9
      },
      {
        "name": "玻璃唇妆",
        "weight": 8
      },
      {
        "name": "自然野生眉",
        "weight": 7
      },
      {
        "name": "水光唇釉",
        "weight": 7
      },
      {
        "name": "卧蚕高光提亮",
        "weight": 7
      }
    ],
    "occasions": [
      "约会",
      "日常通勤",
      "闺蜜聚会",
      "拍照",
      "校园",
      "拍照打卡"
    ],
    "colors": [
      "裸粉",
      "蜜桃粉",
      "樱花粉",
      "奶白色",
      "奶白",
      "裸粉色"
    ],
    "skinFinish": "水光肌",
    "vibe": "清冷无辜、纯欲撩人、呼吸感"
  },
  {
    "id": "伪素颜妆",
    "name": "伪素颜妆",
    "trigger": "no-makeup makeup, natural bare skin, soft pink lip",
    "description": "极致裸妆,皮肤原生质感,直男看不出化过妆。",
    "difficulty": "easy",
    "sampleCount": 53,
    "techniques": [
      {
        "name": "原生眉",
        "weight": 23
      },
      {
        "name": "卧蚕提亮",
        "weight": 15
      },
      {
        "name": "高光提亮",
        "weight": 11
      },
      {
        "name": "裸色唇釉",
        "weight": 11
      },
      {
        "name": "自然眉形",
        "weight": 9
      },
      {
        "name": "自然野生眉",
        "weight": 9
      },
      {
        "name": "裸色唇妆",
        "weight": 8
      },
      {
        "name": "轻薄底妆",
        "weight": 8
      }
    ],
    "occasions": [
      "日常通勤",
      "约会",
      "校园",
      "居家",
      "见家长",
      "上学"
    ],
    "colors": [
      "裸粉",
      "自然肤色",
      "裸粉色",
      "奶白",
      "浅棕",
      "蜜桃粉"
    ],
    "skinFinish": "自然裸肌",
    "vibe": "清透自然"
  },
  {
    "id": "白开水妆",
    "name": "白开水妆",
    "trigger": "clean girl makeup, minimal, fresh, hydrated skin",
    "description": "clean girl 风,清透零妆感,韩系日常天花板。",
    "difficulty": "easy",
    "sampleCount": 52,
    "techniques": [
      {
        "name": "根根分明睫毛",
        "weight": 17
      },
      {
        "name": "原生眉",
        "weight": 17
      },
      {
        "name": "水光唇釉",
        "weight": 13
      },
      {
        "name": "伪素颜底妆",
        "weight": 12
      },
      {
        "name": "卧蚕提亮",
        "weight": 12
      },
      {
        "name": "高光提亮鼻梁与颧骨",
        "weight": 12
      },
      {
        "name": "原生眉形保留",
        "weight": 12
      },
      {
        "name": "野生眉",
        "weight": 10
      }
    ],
    "occasions": [
      "日常通勤",
      "约会",
      "校园",
      "见家长",
      "面试",
      "居家"
    ],
    "colors": [
      "裸粉",
      "蜜桃粉",
      "浅棕",
      "米白",
      "裸粉色",
      "奶白"
    ],
    "skinFinish": "水光肌",
    "vibe": "清透、纯欲、少女感、高级冷白皮"
  },
  {
    "id": "蜜桃妆",
    "name": "蜜桃妆",
    "trigger": "peach makeup, peachy blush, warm coral lip",
    "description": "蜜桃色系腮红 + 唇妆,温柔元气的春夏感。",
    "difficulty": "medium",
    "sampleCount": 29,
    "techniques": [
      {
        "name": "卧蚕提亮",
        "weight": 38
      },
      {
        "name": "团式腮红",
        "weight": 17
      },
      {
        "name": "眼下腮红",
        "weight": 14
      },
      {
        "name": "大面积腮红晕染",
        "weight": 10
      },
      {
        "name": "玻璃唇妆",
        "weight": 10
      },
      {
        "name": "眼睑下至",
        "weight": 10
      },
      {
        "name": "水光底妆",
        "weight": 10
      },
      {
        "name": "野生眉",
        "weight": 10
      }
    ],
    "occasions": [
      "约会",
      "日常通勤",
      "下午茶",
      "闺蜜聚会",
      "校园",
      "拍照"
    ],
    "colors": [
      "蜜桃粉",
      "裸粉",
      "奶白",
      "樱花粉",
      "奶白色",
      "粉色"
    ],
    "skinFinish": "水光肌",
    "vibe": "温柔、元气、清纯、少女感"
  },
  {
    "id": "韩系妆",
    "name": "韩系妆",
    "trigger": "korean makeup, gradient lips, straight brow, clear skin",
    "description": "水光肌 + 平眉 + 咬唇,经典韩剧女主妆。",
    "difficulty": "medium",
    "sampleCount": 27,
    "techniques": [
      {
        "name": "卧蚕提亮",
        "weight": 37
      },
      {
        "name": "团式腮红",
        "weight": 15
      },
      {
        "name": "高光提亮鼻梁与颧骨",
        "weight": 11
      },
      {
        "name": "水光肌底妆",
        "weight": 11
      },
      {
        "name": "弱化眼线",
        "weight": 7
      },
      {
        "name": "原生眉",
        "weight": 7
      },
      {
        "name": "眼下腮红",
        "weight": 7
      },
      {
        "name": "玻璃唇釉",
        "weight": 7
      }
    ],
    "occasions": [
      "约会",
      "日常通勤",
      "校园",
      "闺蜜聚会",
      "拍照",
      "下午茶"
    ],
    "colors": [
      "蜜桃粉",
      "裸粉",
      "奶白",
      "樱花粉",
      "浅棕",
      "奶白色"
    ],
    "skinFinish": "水光肌",
    "vibe": "甜妹感、少女心、奶fufu治愈系"
  }
];

export function getTutorial(id: string): Tutorial | undefined {
  return TUTORIALS.find((t) => t.id === id);
}

// ---------- 风格卡片元数据(纯前端展示用) ----------

export interface StyleMeta {
  id: string;
  name: string;
  emoji: string;
  gradient: string;
  tagline: string;
}

export const STYLE_META: StyleMeta[] = [
  { id: '纯欲妆',   name: '纯欲妆',   emoji: '💋', gradient: 'linear-gradient(135deg,#ff9a9e,#fad0c4)', tagline: '又纯又欲的氛围感' },
  { id: '伪素颜妆', name: '伪素颜妆', emoji: '🌸', gradient: 'linear-gradient(135deg,#fbc2eb,#a6c1ee)', tagline: '直男看不出的裸妆' },
  { id: '白开水妆', name: '白开水妆', emoji: '💧', gradient: 'linear-gradient(135deg,#e0c3fc,#8ec5fc)', tagline: '清透零妆感' },
  { id: '蜜桃妆',   name: '蜜桃妆',   emoji: '🍑', gradient: 'linear-gradient(135deg,#f6d365,#fda085)', tagline: '温柔元气春夏' },
  { id: '韩系妆',   name: '韩系妆',   emoji: '✨', gradient: 'linear-gradient(135deg,#a1c4fd,#c2e9fb)', tagline: '韩剧女主咬唇' },
];

export function getStyleMeta(id: string): StyleMeta | undefined {
  return STYLE_META.find((s) => s.id === id);
}
