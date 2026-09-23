# 项目现状与整理记录

> 状态：✅ 当前有效（09-17 审查快照，09-18 追加修复与验证；不是发布验收）
> 范围：先按用户授权做低风险整理，随后根据“开始修复”实施 R1–R8；循环安排的完成已明确为结束整个系列。

## 范围与结论

主项目为 `cyber-sister`，审查起点 `master` / `8f67d9ea74261fa7b3d1d7f2778e9725fc3d38d4`，工作区最初干净。旁侧历史目录、`_archive`、研究与验收素材、个人数据和密钥未整理、迁移或删除。

固定审查基准为功能收拢前检查点 `ca1a8f746115d65560ff5d8f52b82abebd120859`，使用 `git diff <base>...HEAD`：209 文件、4358 行增加、10276 行删除。两名独立审查者分别检查 Standards 与 Spec，主审补查文档、运行入口和 Web 分发。当前树的文档与模块盘点超出该 diff，但没有声称完成全部历史代码审计。

混乱主要来自三处：旧实施说明仍标为当前有效；同一功能在 Web/本地分发下边界不同；功能收拢后留下少量行为缺口。现有模块化单体可以继续维护，没有证据支持这轮重新分包或整体搬目录。

基线约有 715 个 Git 跟踪文件、62 份 `docs/` Markdown 文档、214 个应用/包内非测试 JS/JSX 源文件。规模用于定位维护范围，不作为质量评分。

原审查表行号对应 09-17 整理后的工作树，保留作缺陷证据；09-18 修复后的状态与验证见文末追加节。未写完整前缀的服务名均位于 `apps/api/src/services/`，前端组件位于 `apps/web/src/`。

## 当前代码地图

| 领域 | 入口与责任 | 边界 |
| --- | --- | --- |
| Web 路由/导航 | `apps/web/src/App.jsx`、`features/registry.js`、`features/distribution.js` | 默认 Web：对话、她、设置；`/tools/*` 仅本地分发，旧链接重定向 |
| 聊天 | 前端 `chatStore` → API `routes/chat` → `chatService` → `agentTurn` → `llmService` | 统一对话；危机、同意、取消与消息事务约束仍保留 |
| 模型供应商 | `packages/llm-gateway/src/index.js` | 云端模型；每次外发复核授权，流式取消与重试边界独立维护 |
| 工具执行 | `agentService`、`work*Service`、`work*Tools` | `work` 是保留的实现命名；API 独立限制本地分发，执行能力另受配置开关约束 |
| 安排 | `SchedulePage`、`reminderService`、`planMigrationService` | 定时任务替代旧日程/倒数日/习惯；旧表只读保留，迁移不在本轮执行 |
| 手记/经期/装扮 | `NotesPage`、`PeriodPage`、`StylePage` 及各领域服务 | 当前装扮入口走后端内存校验与模拟预览；日记/阅读短评也返回模拟内容，不能等同真实模型接通 |
| 正式记忆 | `memoryService`、`memoryGovernance`、`memoryIndexService`、`memoryTransferService` | 正式记忆、草稿、关系、投影和导入预览分别管理；09-18 修复 Web 页签 R7 缺口 |
| 数据库 | `apps/api/src/prisma/schema.prisma`、`migrations/`；`apps/api/prisma/seed.js` | 迁移与开发 seed 分开，不能因旧表暂不写入就删除历史数据 |
| 部署 | `.github/workflows/ci.yml`、`deploy.yml`、`compose.yaml`、`deploy/compose.server.yaml` | 同机同源配置；旧 chat-only 配置等待迁移验收，09-18 修复 R2 并通过隔离脚本故障测试 |

`llmService`、`chatService`、网关和旧 `WorkspacePage` 是较大的阅读热点。行数本身不构成缺陷；是否进一步拆分应由具体变更和测试边界决定。旧页面、部署兼容文件和数据表本轮没有因“看似不用”而删除。

## Standards

本轴最高严重度为 **P1：R2 发布健康失败绕过回滚**。标准来自用户的简单、局部、高内聚要求，以及《代码审查标准与流程》§2.1、《代码审查检查清单》可维护性条款。

| 登记 | 证据与影响 | 标准与建议 |
| --- | --- | --- |
| R2 · P1 · 本轮 diff 新增 | `deploy/scripts/release.sh:88–89` 调用 `fail`；`common.sh:12` 直接 `exit 1`，跳过 `release.sh:57` 的 `ERR` trap。新版本启动后健康失败会退出，但不自动执行回滚。等价纯 Bash 控制流复现未出现回滚标记；未执行部署脚本。 | §2.1 关键路径错误处理、注释与代码一致。独立修复失败出口，模拟 compose/健康失败验证回滚及退出码；不能用健康成功测试代替。 |
| R3 · P2 · 本轮 diff 新增 | `apps/api/src/services/planMigrationService.js:84–99` 先读 `plansMigratedAt`，插入后才无条件更新。重叠迁移可同时读到空标记。源码与内存并发调度复现重复创建；真实 PostgreSQL 并发仍待验。 | §2.1 并发/竞态。事务内原子领取用户或建立来源唯一约束，再用隔离数据库验证并发、失败回滚及重跑。 |
| R4 · P2 · 既存债务 | `apps/api/src/services/agentService.js:120–128` 和 `periodService.js:59–67` 分别使用本地日历/UTC 存储日预测。在洛杉矶时区，UTC 存储 2026-08-22、28 天周期，工具给出 09-18，领域服务给出 09-19。 | 检查清单“无重复代码（DRY）”与高内聚。复用领域预测需要单独的日期行为修复；本轮格式化去重不解决此问题。 |

## Spec

本轴最高严重度为 **P2**。本次有可用需求依据：09-16 Spec、路线图 C7 与功能收拢 CHANGELOG；未把历史阶段记录视为新的范围授权。

| 登记 | 证据与触发条件 | 需求与后续处理 |
| --- | --- | --- |
| R5 · P2 | `apps/api/src/services/agentService.js:70–80` 取排序后前 20 条，`reminderService.js:153–157` 返回全部状态并按下次时间升序。20 条旧的已完成安排可挡住第 21 条活动安排，工具无分页/筛选/截断提示。源码配合合成数据复现返回的活动安排为零。 | Spec §4.1 要求查看、完成、暂停、继续与改期。增加明确的查询范围及后续查询机制，避免把截断结果当作完整列表。 |
| R3 · P2 | 同 Standards 轴的并发迁移事实，本轴按需求另行保留。 | CHANGELOG 09-15（二）“每个用户只迁一次”、Spec §1“一次性迁移”。不得将串行重跑成功等同并发幂等。 |
| R6 · P2 | `apps/web/src/pages/SchedulePage.jsx:157–172` 只有 `freq === 'once'` 显示完成按钮；循环安排只能暂停、继续、删除，API 已接受 `done`。 | CHANGELOG 09-15（二）写“每条都能完成”。需确认是整项终结还是逐次打卡，再修复 UI；本轮不擅自改写产品承诺。 |
| R7 · P2 · 主审补查 | `apps/web/src/pages/HerPage.jsx:71–86` 无分发筛选显示待确认/关系；`components/memory/MemoryReviewPanel.jsx:29` 调用 `/derived`；`apps/api/src/app.js:147` 把 `/api/derived` 列入 `localWorkOnly`，Web 必然返回 403。静态调用链确认，未跑浏览器端到端复现。 | Spec §1 将「她」及其记忆分类纳入 Web 入口。应明确 Web 记忆治理的范围，配对调整接口/界面并验证 Web 和 local 两种分发；不直接移除服务端守卫。 |
| R8 · P2 · 既存文档冲突，主审补查 | `apps/web/src/pages/MakeupRoomPage.jsx:171–193` 明示原图提交后端、滑杆只填参数；`apps/api/src/services/workMediaService.js:23–44` 固定模拟，无实际生成。Spec §1 仍描述 MediaPipe 全程本地和真实图生 3D；§3.1 对日记/阅读短评的真实云端描述也与 `workCloudService.js:3–26` 冲突。 | 本轮按源码与 09-12 补充接口合同纠正入口说明，登记冲突；未修改产品基线或法律草案，也未借整理授权启用真实供应商。 |

## 本轮已整理

- README 改为当前入口、三种说话方式与统一对话，写明 Web/本地边界；Node 版本与清单、CI 对齐为 24。
- 启动命令统一到 README，贡献指南引用同一来源；修正从 `apps/api` 使用错误相对密钥路径、环境只作用于第一个命令的问题。新 PowerShell 示例仅做静态检查，未对个人数据库执行。
- 新人指南移除不存在的 `makeup-skill`、旧路由与本地模型步骤，明确装扮当前只是模拟预览，构建成功不代表真实生成验收。
- 文档索引纠正旧部署状态，降低已漂移扩展/阶段文档的有效性标签；历史文件保留原路径，避免破坏链接和证据。路线图登记 R1–R8，保留旧 Sprint 历史。
- AGENTS 的自动契约标记块保持不变；外部补充段仅同步路线图已有 C1–C7 决定。
- 三处相同的本地日期格式化复用 `dayHelpers.toLocalDayString`；原空值处理、Date 转换、UTC 日期函数与业务状态保持不变。

09-17 整理结束时 R1 尚未解决：机器本地 `.coordination/project.md` 仍有旧路径/模块/模型和过时里程碑，且“CONFIRMED”与未决确认条目并存。09-18 已依据后续修复授权同步事实，见追加节；机器本地契约继续不进入 Git。法律草案与其他用户/阶段文档未全面重审。

## 验证

验证环境为 Windows、Node v24.15.0、pnpm 11.5.1；测试使用已有依赖。检查日志位于本机临时目录 `C:/Users/36322/AppData/Local/Temp/amie-review-20260917/`，不纳入版本控制。

| 检查 | 本轮结果 |
| --- | --- |
| 初始全量 `pnpm test` | Web 659、API 1026、网关 20 通过；PostgreSQL 61 项跳过 |
| 日期去重后针对性回归 | agent/reminder/planMigration/period 共 4 文件、100 项通过 |
| `pnpm typecheck` | 通过（当前只有 Web 暴露该脚本） |
| `pnpm lint` | 通过，Web 22 / API 146 条既有警告；修改后 API lint 仍通过、146 条警告 |
| Web 生产构建 | 通过，输出到临时目录，保留衣柜大 chunk 警告；未覆盖现有 dist |
| 日期等价检查 | 上海、UTC、洛杉矶 3 个时区，跨日/跨年/夏令时/闰日与无效 Date 的格式化结果保持不变 |
| 文档与差异 | 11 份变更/新增 Markdown 的 160 个本地链接无断链；`git diff --check` 通过 |
| PostgreSQL / coverage / E2E / 真实模型 / 部署 | 未运行；没有把这些门禁记为通过 |

## 原审查建议顺序（09-17）

1. 先修 R2 并用模拟命令验证失败回滚，完成前不能依赖脚本的自动回滚承诺。
2. 修 R3；在隔离 PostgreSQL 验证并发与失败恢复后，再讨论真实旧数据迁移。
3. 配对处理 R5/R6/R7 的查询、状态和分发接口；补双分发的端到端验收。
4. 修 R4 的领域计算，核对时区边界；随后按模块逐步收敛旧文件与 R1/R8 文档。

本轮没有提交、推送、部署或迁移个人数据。已整理与待修复分别记录；测试通过不代表用户已接受产品行为。

## 2026-09-18 修复追加

用户随后明确要求“开始修复”，并确认循环安排的完成指结束整个重复系列。代码保持现有模块和数据结构，没有拆包、搬动业务目录、移除旧数据表或启用真实供应商。

| 登记 | 修复结果 | 验证与限制 |
| --- | --- | --- |
| R1 | README、API 说明、网关 package 描述和本地契约同步当前结构/路径/云端调用；移除契约中已过期的待确认项，明确旧数据治理权限不延续到本轮 | 契约 schema 标记及 AGENTS 自动块保留；`project-coordination` 工具当前不可用，未运行 `contract-check`，不冒称完成其机器验证 |
| R2 | `release.sh` 用 EXIT trap 覆盖显式失败，进入回调先解除 trap，保留原失败码；成功后解除 | 新增 8 项运行实际脚本的隔离测试：健康失败、构建失败、启动失败、空备份、损坏备份、首次部署失败、回滚失败、成功；fake docker/curl/df/sleep，不是真实部署演练 |
| R3 | 在创建新安排之前于同一事务内条件领取 `plansMigratedAt=null`；失败回滚领取，未领取者跳过；dry-run 不写 | 10 项迁移单测通过；真实 PostgreSQL 的并发只一次、插入异常回滚/重试、dry-run 用例已加入现有隔离套件，但本机没有运行服务，仍待实际执行 |
| R4 | `period_status` 复用 `periodService.predictNextPeriod`，经期输入/输出按 UTC 存储日解释；其他本地日期用途保留 | 在 America/Los_Angeles 下验证存储 08-22 + 28 天输出 09-19，与领域摘要一致 |
| R5 | 工具查询默认只看 active，支持 paused/done/all，20 条分页与明确的 hasMore/nextOffset，按下次日期和 id 稳定排序 | 20 条历史完成项不能挡住 25 条活动项；分页无重复，非法状态/offset 在数据库访问前拒绝 |
| R6 | 循环安排可「结束重复」，包括暂停的系列；结束后隐藏无产出的 pending 提醒、立即清理前端对应提醒，使结束前发出的轮询失效；已有任务产出仍可读取 | 四种频率的 UI 单测、成功/失败状态与晚到响应单测、320px 浏览器操作及刷新通过；新增 PostgreSQL 晚到投递插入用例，尚未运行 |
| R7 | `/api/derived` 移出本地工作接口限制，保留认证与领域归属/版本检查 | 真实 Express app 的 Web/local 分发、未登录拒绝、请求体伪造 userId 测试通过；桌面/移动的双分发浏览器确认流程通过；浏览器 API 使用合成 fixture，不冒称真实数据库 E2E |
| R8 | Spec/API 明确装扮显式提交原图到当前 API 内存校验、短评/来信为模拟；隐私政策增加显著技术冲突注记 | 未调用供应商、未增加图片传输范围；法律原条款留给审核者核对，草案仍不得发布。其他历史专题没有在本轮全面改写 |

### 修复后验证

日志及临时构建：`C:/Users/36322/AppData/Local/Temp/amie-fixes-20260918/`。使用已有 Node、pnpm、Git Bash、Chromium 与依赖，无下载；构建输出保留在临时目录，未覆盖原 dist。

| 检查 | 结果 |
| --- | --- |
| API 全量及覆盖率 | 73 文件、1037 项通过；65 项 PostgreSQL 跳过。串行覆盖率：语句 82.81%、分支 74.94%、函数 80.85%、行 86.77%，达到现有门槛 |
| API 覆盖率环境异常 | 默认并行及 4 worker 运行均出现 1 个 worker 意外退出，这两次不能算通过；改用 `--maxWorkers=1` 后完整运行通过，未降低阈值或修改产品代码规避 |
| Web 全量及覆盖率 | 90 文件、665 项通过；语句/行 94.84%、分支 86.96%、函数 82.38%，达到现有门槛 |
| 网关 | 20 项通过（根 `pnpm test`） |
| 发布脚本 | 8 项通过，验证原退出码与仅一次回滚；CI packages job 已接入 |
| 类型与 lint | `pnpm typecheck`、`pnpm lint` 通过；Web 22、API 146 条既有警告，未增加 |
| 生产构建 | Web 与 local 两种构建通过；local 衣柜大 chunk 警告保留 |
| Playwright | 本地全量 62 项，Web 记忆专项 2 项通过（均含 desktop/mobile）；新增 CI Web 分发回归 |
| 文档与差异 | 16 份变更/新增 Markdown 的 192 个本地链接无断链；AGENTS 自动契约块与 HEAD 一致，本地契约 schema 标记保留；`git diff --check` 通过 |
| 数据/上线 | Docker daemon 未启动，未找到可用本地 PostgreSQL；未执行个人数据迁移、真实模型调用、Docker 部署或数据库恢复 |

### 独立复审

**Standards**：以固定 HEAD `8f67d9ea74261fa7b3d1d7f2778e9725fc3d38d4` 为本轮未提交修复的对照（`git diff HEAD`），与原历史 merge-base 审查区分。独立审查未发现新增实质性阻塞；真实 PostgreSQL 验证仍缺。

**Spec**：首次复审发现 R6 的既有 pending 投递与前端晚到轮询可在结束后重新出现。补齐服务端筛选与前端失效控制，先复现再修复；增量复审确认原问题已在代码层闭合，未发现新增需求缺陷。没有把模拟接口的浏览器测试等同真实数据库联调。

下一步验证边界是隔离 PostgreSQL 65 项和真实部署恢复演练；本轮实现已落在工作区，未提交或推送。法律草案的正式审核另行进行。
