> ℹ️ 历史文档：品牌「妆语」已于 2026-08-31 并入「赛博姐妹」，文中「妆语 / MakeupWhisper」均为历史名称；现行品牌见 docs/02-设计/品牌规范.md（仓库根 docs/）。

# 妆语 MakeupWhisper — 开发执行任务拆解（dev-execution-plan）

**日期**：2026-07-09
**类型**：开发执行计划
**参与成员**：路径（路线图规划师）；引用战略三件套成员：析客（需求分析师）、瑞思（用户研究员）、竞析（竞品分析师）、数析（数据分析师）

---

## 1. TL;DR
- 执行总顺序：P0 埋点 + 范围治理收尾（W1–3）→ P1 增强（W3–9）→ P2 远期（W9–13+）。
- 最优先项：P0 埋点链路（sessionId 串联 + upload_success + 信任点击）。当前 `analytics.jsonl` 仅 2 行测试、sessionId 全 null，无基线则无法判定"信任度≥60%、完成率≥35%"生死线。
- 关键依赖：埋点先于读数据；范围治理已基本完成、不阻塞埋点；P1 增强依赖 W4–5 验证结论。
- 现实校正：图像生成模块（`src/frontend/generate`、`routes/generate.ts`）与采集脚本在代码层**已剥离/已归档**（Grep 证实 server.ts 无 generate 路由、脚本全在 archive/）。本期重点是补埋点 + 文档闭环 + 回归，而非重写。

---

## 2. 核心结论卡片
| 推荐执行顺序 | 优先级 | 总资源估算 | 风险等级 |
|---|---|---|---|
| 埋点先行，治理收尾，增强后置 | P0→P1→P2 | ≈33 人天（P0≈12 / P1≈13 / P2≈8） | 中（样本误判；剥离回归） |

---

## 3. 任务清单总表
| 任务ID | 标题 | 涉及文件（真实路径+标注） | 验收标准（可测） | 依赖 | 估算 | 角色 | 风险/注意 |
|---|---|---|---|---|---|---|---|
| D1 | sessionId 串联 | `src/shared/analytics.ts`【修改】；`src/frontend/App.tsx`【修改】；`tests/analytics.test.ts`【修改】 | `analytics.jsonl` 中同一会话连续事件含相同非空 sessionId；新增单测断言 track 自动附带 | — | 2d | 前端 | 本地生成、禁含 PII |
| D2 | upload_success 事件 | `src/frontend/App.tsx`【修改】 | 图片处理成功后落 `upload_success`{size,type}；与已有 `upload_start` 配对率可算 | D1 | 1d | 前端 | 勿与 analysis_complete 重复 |
| D3 | 信任点击埋点 | `src/frontend/views/AnalysisDoneView.tsx`【修改】；`src/shared/analytics.ts`【修改】 | 报告页新增"分析得挺准"按钮，点击落 `trust_click`{look_id/confidence}；信任率可算 | D1 | 2d | 前端 | 配合瑞思信任度口径 |
| D4 | 真实事件落地+看板建议 | `data/analytics.jsonl`【验证】 | 上线 2 周出现 ≥200 含 sessionId 会话；给出 ≥200 会话采样看板建议文档 | D1–D3 | 3d | 数据/工程 | 小样本勿早判 |
| D5 | 图像生成收尾清理 | `src/backend/config.ts`【修改】；`docs/scope.md`【修改】 | 移除 `IMAGE_GEN_*` 占位（config.ts:30-37 已注"已剥离"）；scope.md 标已完成；主流程 e2e 通过 | — | 2d | 工程 | Grep 已证无残留引用 |
| D6 | 品牌站决策与独立部署 | `brandsite/index.html`【确认】；`docs/brandsite-decision.md`【新增】 | 产出整合/独立方案，默认独立部署不耦合主应用；CI 解耦 | — | 1.5d | 方向明/工程 | 默认建议独立 |
| D7 | 采集脚本冻结标注 | `scripts/archive/README.md`【新增】 | 12 脚本已在 `scripts/archive/`，README 标注冻结原因与日期 | — | 0.5d | 工程 | 已迁移，仅补说明 |
| D8 | 隐私立场文案前置 | `src/frontend/views/OnboardingView.tsx`【修改】 | 上传页顶部常驻"本地处理、不上传原图"文案；瑞思隐私立场定稿落地 | — | 1d | 前端 | 文案需瑞思定稿 |
| D9 | 问卷/落地页配合 | `src/frontend/views/SurveyView.tsx`【待确认/新增】 | 落地页挂问卷入口；结果页信任点击已埋（D3）；招募 5–10 人访谈可追踪 | D3 | 2d | 前端/用研 | 路径待确认 |
| D10 | 教学术语 gloss/括注 | `src/frontend/tutorial/glossary.ts`【新增】；`src/frontend/tutorial/TutorialPanel.tsx`【修改】 | 关键术语 100% 带括注/图标；新手可独立完成教学 | D8 | 5d | 前端 | 术语表需设计共建 |
| D11 | 回看/收藏（本地） | `src/frontend/utils/favorites.ts`【新增】；`src/frontend/result/ResultCard.tsx`【修改】；`src/frontend/views/TutorialDoneView.tsx`【修改】 | localStorage 存已做方案；7 日内回看率 ≥20% 可测 | D1 | 5d | 全栈 | 仅本地、禁 PII |
| D12 | 场景快速妆标签 | `src/frontend/tutorial/TutorialPanel.tsx`【修改】；`src/frontend/views/QuickScenarioView.tsx`【待确认/新增】 | ≥5 场景标签（通勤/约会/面试…）一键取用收藏方案 | D11 | 3d | 前端 | 依赖收藏数据 |
| D13 | CPS 占位转真实库 | `src/backend/routes/cps.ts`【新增】；`src/frontend/tutorial/TutorialPanel.tsx`【修改】 | productHints 由真实库接口提供，点击落 `cps_click` 可追踪；标"合作" | D11 | 5d | 后端/商务 | 合规招商周期 |
| D14 | 结果卡二维码回看 | `src/frontend/result/ResultCard.tsx`【修改】 | 结果卡含可扫二维码回看本人教程；`result_share` 已存在（image/copy/copy_xhs/native） | D11 | 3d | 前端 | 二维码不含原图 |

---

## 4. 里程碑甘特（文字版）
- 验证期（W1–2）：D1→D2→D3（埋点链路）；D5–D7（治理收尾）；D8–D9（验证辅助）。
- 治理+增强（W3–6）：D10（术语）→ D11（收藏）→ D12（场景）。依赖箭头：D11 ⟶ D12；D8 ⟶ D10。
- 远期（W9–13+）：D13（CPS）→ D14（二维码）。依赖箭头：D11 ⟶ D13/D14。
- 读数据节点：W4 数析基于 D1–D3 真实事件输出首批漏斗；W4–5 团队依生死线决策继续/调人群/止损。

---

## 5. 依赖关系说明
- 埋点（D1–D3）先于读数据（D4）：无 sessionId 与四事件则漏斗无法串联，D4 采样看板无意义。
- 范围治理（D5–D7）已基本完成，剥离图像生成不阻塞埋点；D5 仅清理占位+回归，D7 仅补说明。
- P1 增强（D10–D12）依赖 W4–5 验证结论（先服务透哪类人）；D11 收藏是 D12/D13/D14 的前置数据层。
- D3 信任点击是瑞思信任度指标（≥60%）数据源，须与 D9 问卷同期上线。

---

## 6. Non-goals（本期开发不做）
AR/实时试妆、图像生成接入、订阅/付费报告、电商下单闭环、跨平台账号体系、多人群全量覆盖、CPS 真实货盘招商（仅 D13 预留轻量接口）、底层架构重构。

---

## 7. 数据来源 & 成员产出索引
- 战略三件套：`prd-ai-makeup-2026-07-09.md`（R1–R10）、`roadmap-update-ai-makeup-2026-07-09.md`（W1–W13、治理三动作）、`README.md`/`docs/scope.md`/`docs/mvp-spec.md`（架构、track()、事件定义）。
- 真实代码探查：`data/analytics.jsonl`（2 行测试、sessionId 均 null）；`src/shared/analytics.ts`（track 无 sessionId）；`src/backend/server.ts`（无 generate/brandsite 路由）；`src/backend/config.ts:30-37`（image-gen 占位已剥离）；`src/frontend/App.tsx`（有 upload_start 无 upload_success、无 trust_click）；`src/frontend/views/AnalysisDoneView.tsx`（无信任按钮）；`src/frontend/result/ResultCard.tsx`（result_share 已存在、无二维码）；`scripts/archive/`（12 脚本已归档）；`brandsite/index.html`（独立静态页）；`src/frontend/tutorial/TutorialPanel.tsx`（scenario 标签已存在、CPS 占位）。

---

> 本报告由产品战略团队 AI 协作生成，重要决策请由产品负责人审定。
