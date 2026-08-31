# 变更日志

本项目所有值得记录的变更都会写在这里。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循语义化版本。
**当前处于内测准备阶段，尚未发布正式版本。**

---

## [未发布] — 内测准备中

> 目标发布日：2026-10-01
> 实施基线：[`docs/Spec_赛博姐妹_v1.0.md`](docs/Spec_赛博姐妹_v1.0.md)
> 排期见：[`docs/01-产品/开发计划与路线图.md`](docs/01-产品/开发计划与路线图.md)

### 2026-08-31 仓库收敛与品牌统一

- **单仓库单品牌**：cyber-sister 成为唯一活跃仓库与唯一品牌「赛博姐妹」。原 `AI妆教/` 仓库归档至 `../_archive/AI妆教/`（其最终提交 `f2dc25b` 早已 subtree 并入本仓库，归档前确认工作区干净、无独有内容）
- **落地页迁入**：主落地页从 `电子闺蜜/landing/` 迁至 `apps/web/public/landing/`（`/landing/` 路径直接可访问），并新增「AI 妆教」板块承接对外叙事，导航栏加入口
- **品牌统一**：妆教模块不再使用独立品牌「妆语」，统一为「赛博姐妹 AI 妆教」（功能名「妆教」）；独立品牌站 `packages/makeup-skill/brandsite/` 下线（内容可从 git 历史找回）；11 份历史文档加品牌并入横幅
- **补迁资产**：六张妆容设计参考图迁入 `packages/makeup-skill/design-reference/looks/`（未接入运行时）
- **安全网**：`.gitignore` 忽略 `mp-models/` 注入产物（36MB MediaPipe 二进制不入库）；移除指向已归档仓库的危险远端 `ai-makeup`
- **灾后重建**：`packages/` 目录遭外部因素整体删除。`makeup-skill` 155 个文件从 git 完整恢复；`llm-gateway` 与 `design-tokens`（此前从未提交）按消费方契约重建并全部通过验证；模型注入源 `.assets/` 从幸存的 `apps/web/public/mp-models/` 恢复，7 个文件 SHA-256 校验全部通过

### 已就绪（待随首个内测版发布）

依据 2026-08-31 代码核查，以下能力已实现，等待走完发布验收门（Spec §9）：

**账号与身份**
- 白名单手机号 + 固定验证码登录，非白名单与错误码统一返回 401，不泄漏白名单状态
- access token 鉴权 + refresh token 轮换与 logout 撤销（HttpOnly / Secure cookie，服务端只存 hash）

**聊天与人格**
- llama.cpp 本地优先的非流式聊天（`stream:false`）
- 三种人格 `toxic` / `gentle` / `rational` 即时切换，切换后下一条消息生效
- `qwen-fallback-v1` 可选云端备用：同意 / 拒绝 / 撤回三态，由服务端门控，未同意时 Qwen 调用次数为零
- 送入模型的数据脱敏，业务消息最多 20 条，记忆最多注入 5 条

**记忆**
- 显式记忆 CRUD：`semantic` / `episodic` / `procedural` 三类，带 importance 与 tags
- 记忆归属校验，支持清空；系统不自动提取、不由模型推断

**安全与合规**
- 危机检测先于同意检查与模型调用；中高风险输入事务内阻断并写入 `CrisisLog`，模型调用次数为零
- 安全输出过滤，命中红线（威胁、拱火、浪漫化伤害、冒充真人、替用户决定重大事项）替换为安全模板
- 日志最小化：只记 request ID、scene、provider/model、尝试次数、延迟、结果

**工具箱**
- 待办、倒数日、经期记录、提醒设置
- 天气端点保持 409 关闭（内测不提供）

**妆教模块**
- `/makeup/` 同源挂载，浏览器本地分析，图片与视频帧永不外发
- MediaPipe/WASM 构建前注入并按 SHA-256 校验，缺失则构建失败
- 解释 API 只接受规范化特征标签 + `lookId`

**运维**
- 单机 Docker Compose：Nginx(TLS) + Web + API + Makeup + PostgreSQL + 一次性 migration job
- `/api/health/live` 与 `/api/health/ready` 分离；本地模型未加载时应用仍 ready
- 不可变镜像 tag，纯初始迁移（禁 `db push`）

### 已知限制（内测期不会修复）

- 虚拟试衣间 / 虚拟化妆间：页面可导航，生图未接入，恒返回 503 `IMAGE_GEN_NOT_CONFIGURED`，入口显示"接入中"
- 会员中心：仅页面展示，无真实支付
- 无流式输出，无自动记忆提取，无向量检索
- 无语音 / 图片生成，无真实短信，无账号删除
- ⚠️ 文档与实现存在冲突（工具箱是否属于内测范围等），见开发计划第 1.3 节

---

## 仓库历史

### 2026-08-28 · monorepo 合并

- `f4846d8` P1: monorepo 骨架 + 工具目录与数据源迁入
- `1236570` 从独立仓库合入 `packages/makeup-skill`（妆教模块）
- `3bd7928` P1: 迁入赛博姐妹前后端、文档与设计资产

### 2026-06 ~ 2026-07 · 妆教模块（合入前历史，来自 makeup-skill 仓库）

- `f2dc25b` feat(P0): D6 品牌站独立部署决策 + D9 问卷/落地页
- `23e7638` feat(P1): D10 术语括注 + D11 收藏回看 + D12 场景标签
- `4ed8e78` feat(analytics): P0 埋点链路 + 治理收尾
- `4995113` refactor: 剥离超范围功能，回归 MVP 核心 + 架构重构 + 安全加固
- `731cb91` feat(security): CSRF 双重提交 Cookie 防护
- `48c48cd` feat(security): 严格 schema 验证 + mass assignment 防护
- `4276294` feat(security): 严格 CSP / Permissions-Policy / Referrer-Policy / HSTS
- 以及一批无障碍、触控目标、性能与交互细节提交（44px 触控、键盘导航、reduced-motion、焦点陷阱、空闲预取、埋点缓存等）

---

## 版本命名约定

内测期间采用 `v0.x.y-internal.N`：

- 首个内测基线：`v0.1.0-internal.1`
- 后续内测迭代递增 `N`
- 修复与小幅调整递增 `y`
- 能力范围变化递增 `x`

发布时必须同时更新：

- 本文件
- Release Notes（模板见 `docs/09-参考/发布说明模板.md`）
- `docs/01-产品/开发计划与路线图.md` 的进度状态
