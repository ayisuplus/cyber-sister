# 妆语 MakeupWhisper

> 上传一张自拍，AI 分析你的脸型 / 五官 / 肤色，给你推荐 3 套适合的妆容，手把手在原图上教你怎么画。

移动端优先的 AI 妆教 Web 应用。前端基于 **MediaPipe Face Landmarker** 在浏览器内本地完成 478 关键点检测与肤色调色（不上传原图），后端用 **Express 5** 提供确定性推荐、可选 LLM 解释与轻量埋点。

详细产品说明见 [`docs/mvp-spec.md`](docs/mvp-spec.md)；任务级 MVP 实施计划见 [`MVP方案.md`](MVP方案.md)。

## 1. 技术栈

| 层 | 选择 | 理由 |
| --- | --- | --- |
| 构建工具 | **Vite 8** + esbuild（后端） | Vite 处理前端 HMR；esbuild 单文件打包 Node 后端 |
| 前端框架 | **React 19 + TypeScript** | Hooks + useReducer 实现状态机 |
| 样式 | **Tailwind CSS 4**（CSS-first） | 无 JS config，主题在 `index.css` 的 `@theme` 块中 |
| 后端 | **Express 5 + TypeScript** | 单进程既托管 SPA 也提供 `/api` 路由 |
| 人脸检测 | **`@mediapipe/tasks-vision` 0.10** | 浏览器侧 478 关键点，模型本地托管 |
| 测试 | **Vitest 4** | 与 Vite 同生态，启动 < 1s |
| Lint / Format | **ESLint 9 flat config + Prettier 3** | 统一代码风格，零样式争议 |
| 包管理 | **pnpm** | 严格、快、原生 monorepo 支持 |

## 2. 仓库结构

```
.
├─ docs/                       产品 / 设计文档
│  └─ mvp-spec.md
├─ public/                     Vite 入口 + 静态资源
│  ├─ index.html               Vite 模板 (#root)
│  └─ mp-models/               MediaPipe 模型本地副本（gitignored）
├─ scripts/                    数据准备脚本（不在运行时使用）
├─ src/
│  ├─ frontend/                React 应用
│  │  ├─ main.tsx              Vite 入口
│  │  ├─ App.tsx               状态机 + 视图组件
│  │  ├─ index.css             Tailwind 4 主题（@theme）
│  │  ├─ face/                 MediaPipe loader / landmarks / edge cases
│  │  ├─ tutorial/             Canvas 覆盖区 + 坐标映射 + 教学面板
│  │  └─ result/               小红书风格分享卡 + 文案生成
│  ├─ backend/                 Express 5 应用
│  │  ├─ server.ts             入口 + 静态资源 SPA fallback
│  │  └─ routes/
│  │     ├─ recommend.ts       确定性妆容评分
│  │     ├─ explain.ts         LLM 解释（带 fallback）
│  │     └─ analytics.ts       JSONL 文件埋点
│  └─ shared/                  前后端共用
│     ├─ types.ts              领域类型
│     ├─ faceFeatures.ts       三庭五眼 / 脸型 / 肤色 / 鼻型分类
│     └─ analytics.ts          前端埋点 API
├─ tests/                      Vitest 单元测试
├─ .github/workflows/ci.yml    CI: format + lint + typecheck + test + build
├─ eslint.config.js            ESLint 9 flat config
├─ .prettierrc.json            Prettier 配置
├─ tsconfig.json
├─ vite.config.ts
└─ vitest.config.ts
```

## 3. 本地开发

```bash
# 1. 安装依赖
pnpm install

# 2. 准备 MediaPipe 模型（首次运行）
mkdir -p public/mp-models/wasm
# 下载 wasm glue
curl -L https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task -o public/mp-models/face_landmarker.task
# 下载 vision_tasks wasm 套件（@mediapipe/tasks-vision 0.10.x 配套）
curl -L https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm -o public/mp-models/wasm.zip
unzip public/mp-models/wasm.zip -d public/mp-models/

# 3. 启动开发环境（同时拉起前后端）
pnpm dev
# 前端: http://localhost:5173
# 后端: http://localhost:3001
```

## 4. 命令一览

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 并发启动 Vite (5173) + tsx watch (3001) |
| `pnpm dev:frontend` | 仅前端 HMR |
| `pnpm dev:server` | 仅后端热重载 |
| `pnpm build` | 前端 `vite build` + 后端 esbuild → `dist/` |
| `pnpm preview` | 运行生产构建产物 |
| `pnpm start` | 同 `pnpm preview`（CI / 部署用） |
| `pnpm test` | Vitest 单次运行 |
| `pnpm test:watch` | Vitest 监听 |
| `pnpm test:coverage` | Vitest + c8 覆盖率 |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint 全量扫描 |
| `pnpm lint:fix` | ESLint 自动修复 |
| `pnpm format` | Prettier 全量格式化 |
| `pnpm format:check` | Prettier 校验（CI 用） |

## 5. 架构

```
┌──────────────────────────┐         ┌──────────────────────────┐
│  Browser (React SPA)     │  POST   │  Express 5               │
│                          │ /api/*  │                          │
│  • MediaPipe FaceMarker  │ ──────▶ │  • /api/recommend        │
│  • face feature analysis │         │  • /api/explain          │
│  • canvas overlay render │         │  • /api/analytics        │
│  • share card render     │         │                          │
└──────────────────────────┘         └──────────┬───────────────┘
                                                 │ JSONL
                                                 ▼
                                       data/analytics.jsonl
```

- **数据流**：自拍 → 浏览器内提取 478 关键点 → 计算 `FaceFeatures`（不上传原图）→ POST `/api/recommend` → 后端返回 3 套妆容 + 评分 → 前端进入分步教学 → 用户在原图 Canvas 上看到每个步骤的覆盖区。
- **解释层**：前端可在用户点选某个妆容后 POST `/api/explain`，后端优先调用 LLM（OpenAI 兼容），失败/超时回落到确定性文案。
- **埋点**：所有关键事件（`app_open` / `model_load` / `analysis_complete` / `tutorial_step` / `result_share` 等）通过 `track()` fire-and-forget 上报到 `/api/analytics`，写入 `data/analytics.jsonl`。

## 6. 状态机

```
idle
  ↓ tap upload
loading_model → ready
  ↓ tap analyze
analyzing → analysis_done
  ↓ auto
recommending → looks_ready
  ↓ tap start
tutorial_step ⟳ (prev/next/restart/finish)
  ↓ finish
tutorial_done → result
  ↑ on error → error (recoverable=true → back to idle)
```

## 7. 测试

```bash
pnpm test           # 单次
pnpm test:watch     # 监听
```

测试覆盖：
- `faceFeatures.test.ts` — 三庭五眼 / 脸型分类 / 肤色 LAB 分类 / 鼻型 / 置信度
- `edgeCases.test.ts` — 没人脸 / 多人脸 / 侧脸 / 暗光 / 模糊 / 戴眼镜 / 刘海 / 浓妆 / EXIF
- `recommend.test.ts` — 评分确定性 / 未知特征兜底 / 避免项惩罚 / HTTP 路由
- `resultCard.test.ts` — 小红书文案生成（标题 / 正则 / 标签 / unknown 兜底）
- `analytics.test.ts` — JSONL 写入 / sessionId 优先级 / 坏行跳过

## 8. 隐私

- 自拍与原始像素**不离开浏览器**。
- MediaPipe 模型本地托管，避免 Google CDN 在国内不稳定。
- 仅发送**结构化特征**（数值化的三庭比例、脸型 / 肤色枚举）到后端。
- 埋点为事件名 + 业务属性，不包含图像或 PII。

## 9. License

Private — 仅用于毕设 / 内部演示。