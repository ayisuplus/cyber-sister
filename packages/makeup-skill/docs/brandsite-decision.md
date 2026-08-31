> ℹ️ 历史文档：品牌「妆语」已于 2026-08-31 并入「赛博姐妹」，文中「妆语 / MakeupWhisper」均为历史名称；现行品牌见 docs/02-设计/品牌规范.md（仓库根 docs/）。

# 品牌站（brandsite）部署决策

**日期**：2026-07-09
**决策人**：方向明（工程）
**状态**：已决

---

## 1. 现状

品牌站 `brandsite/index.html` 是一个**纯静态 HTML 页面**（1439 行），自包含 CSS（内联样式、无外部依赖），用于产品落地页展示：

- 品牌故事（妆语 · Maison de Beauté）
- 三套妆容 Lookbook（纯欲/清冷/气场）
- 四功能卡片（三庭五眼、AI 肤色卡、跟妆步骤、闺蜜文案）
- 引导 CTA（指向主应用）
- 移动端响应式（至 360px）

该文件与 React 主应用**零耦合**：
- 无 React/TypeScript 依赖
- 无共享组件或状态
- 无 API 调用
- 仅使用 Google Fonts 外部资源

---

## 2. 选项分析

### 方案 A：并入主应用

将 brandsite 迁移为 React 组件，纳入 Vite 构建流程。

| 优点 | 缺点 |
|------|------|
| 统一域名与部署 | 增加主应用 bundle 体积 |
| 共享设计令牌 | 引入额外字体（Cormorant Garamond / Ma Shan Zheng），主应用用 Inter + system-ui |
| 统一 CI/CD | 品牌站更新需走完整前端构建 → 测试流程 |
| | 品牌站观众（潜在用户）与主应用用户（已上传用户）差异大，强行统一增加复杂度 |
| | 品牌站不需要 React 运行时，静态 HTML 加载速度更快 |

### 方案 B：独立部署（推荐）

保持 `brandsite/index.html` 为独立静态资源，单独部署到 CDN 或静态托管。

| 优点 | 缺点 |
|------|------|
| 极速加载（零 JS 框架，仅 HTML+CSS） | 需单独配置部署流水线 |
| 品牌站更新不影响主应用 CI | 域名可能不同（如 `brandsite.zhuangyu.com` vs `app.zhuangyu.com`） |
| 解耦发布节奏：品牌站可随营销活动频繁更新 | |
| 主应用保持轻量 | |
| SEO 友好（纯静态，搜索引擎直接索引） | |

---

## 3. 决策：方案 B — 独立部署

**理由**：
1. **零耦合现实**：品牌站与主应用在技术栈、受众、更新频率三方面均独立
2. **加载性能**：静态 HTML 首屏渲染远快于 React SPA，品牌站作为流量入口应优先速度
3. **维护隔离**：营销文案/样式的试错迭代不应触发主应用的完整 CI 流程
4. **已有基础**：当前实现即独立静态文件，无需重构

---

## 4. 实施建议

### 部署方案
- **推荐**：CloudStudio Pages / EdgeOne Pages（项目已有 `cloudstudio-deploy` skill）
- **备选**：Nginx 静态文件服务 / CDN + OSS
- **域名**：建议 `zhuangyu.com`（或独立子域名），主应用单独部署

### CI 解耦
- 品牌站部署不依赖主应用构建
- `.github/workflows/deploy-brandsite.yml`（或等效 CI）仅监听 `brandsite/` 目录变更
- 主应用 CI 忽略 `brandsite/` 目录

### CTA 链接
- `brandsite/index.html` 中的 CTA 链接（`#ending` / `#`）需替换为实际主应用 URL
- 当前占位：`<a href="#ending">` — 需改为 `https://app.zhuangyu.com` 或实际部署地址

### 后续优化（非本期）
- 接入 Google Analytics / 埋点，追踪品牌站 → 主应用的转化漏斗
- A/B 测试落地页文案
- 多语言版本（当前含法文装饰文字）

---

## 5. 决策记录

| 项目 | 决定 |
|------|------|
| 部署方式 | 独立部署，不耦合主应用 |
| 技术方案 | 纯静态 HTML，CDN 托管 |
| CI 耦合 | 解耦，独立流水线 |
| 本期行动 | CTA 链接占位 → 真实 URL（待域名确定后修改） |
| 负责人 | 方向明（工程） |
