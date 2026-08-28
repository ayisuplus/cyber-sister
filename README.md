# cyber-sister 赛博姐妹

面向全球年轻女性的 AI 闺蜜，永远站你这边，但也会骂醒你。

本仓库由「电子闺蜜」（赛博姐妹）与「AI妆教」（妆语）合并而成：赛博姐妹为主体产品，妆教作为美妆技能模块接入。不自训大模型，通过统一多模型网关接入外部 LLM API。

## 结构

```
apps/
  web/                 赛博姐妹前端（React 18 + Vite + Tailwind + Zustand）
  api/                 统一后端（Node ESM + Express + Prisma + PostgreSQL）
packages/
  makeup-skill/        妆教技能模块（React 19 + Express 5，含完整历史）
  llm-gateway/         多模型抽象层（规划中，P2）
  harness/             人设/风格/知识/评测参考（规划中，P4）
  i18n/                国际化（规划中，P5 二期）
  compliance/          合规层：国内拟人化办法 + 海外 GDPR/AI Act（规划中，P5 二期）
tools/
  data-pipeline/       数据精炼脚本与源材料（sft_v1.jsonl、原始语料、脱敏爬取数据）
  mediacrawler/        MediaCrawler 爬虫（不纳入主构建，本地改动见 patches/）
docs/                  PRD、架构文档、设计文档
```

## 开发

```bash
pnpm install
pnpm dev        # 后端
pnpm dev:web    # 前端
pnpm test       # 全部子包测试
```

## 安全约定

- `.env`、cookies、爬虫凭据一律不进版本库（见根 `.gitignore`）
- `tools/data-pipeline/sources/` 内数据均已脱敏，新增数据须先过脱敏脚本
