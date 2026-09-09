# 落地页重构概览 · Botanical Editorial

## 改了什么
- `index.html` 全面重构：从粉黛酒红 Pastel Editorial 改为参考图的「鼠尾草绿 × 奶油 × 植物系生活感」风格
- 所有合规文案（暂行办法、白名单内测、三条「不做的事」、数据统计）原样保留

## 设计系统
- 色板：cream #FAF7F0 / sage-100 #E7EDDA / sage-700 #66784F（主行动色）/ sage-900 #3E4A32
- 字体：serif 展示标题（Georgia/宋体系）+ 楷体手写批注
- 装饰：拱形主视觉、旋转圆徽章、枝叶 SVG、悬浮色块、滚动浮现

## 新增资产（AI 水彩插画，已去水印）
- `assets/botanical/hero-girl.png` — 主视觉：抱花女孩
- `assets/botanical/morning-desk.png` — 关于区：清晨日记桌面
- `assets/botanical/meadow-wide.png` — 日常区：晨光花野
- `assets/botanical/vase-still.png` — 承诺区：尤加利静物

## 后续可选项
- 旧资产 `assets/hero-main.png`、`about-desk.png`、`hero-volc.jpeg` 已不再被引用，可清理
- 若应用内（src/）也要统一为鼠尾草绿，可把本页 token 同步进 `packages/design-tokens`
