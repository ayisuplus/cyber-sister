# 贡献指南

欢迎参与Amie的开发。这是一份**内测阶段的中文 AI 闺蜜产品**，涉及情感交互与用户隐私，因此我们对代码质量、合规与文档有较高要求。本文档帮你从零跑起项目并提交第一个 PR。

---

## 0. 先读这三份

在动手前，请务必读完，它们定义了"什么是对的"：

| 文档 | 作用 |
|------|------|
| [`README.md`](README.md) | 内测范围、仓库结构、本地运行与部署的完整步骤 |
| [`docs/Spec_Amie_v1.0.md`](docs/Spec_Amie_v1.0.md) | **实施基线合同**。范围、认证、聊天、记忆、危机、虚拟房间、发布验收 |
| [`docs/01-产品/开发计划与路线图.md`](docs/01-产品/开发计划与路线图.md) | 当前排期、已实现/后置能力、已知文档与实现冲突 |

> 历史微服务等方案已移入 `docs/09-参考/历史归档/`。开发前查看[文档索引](docs/README.md)的状态和[现状审查](docs/architecture/project-review-20260917.md)的未决项；阶段验收记录不等于当前产品入口。

---

## 1. 环境准备

**硬性要求**：Node.js 24、pnpm 11.5.1、Docker（本地 PostgreSQL；可选隔离执行也依赖 Docker）。

```bash
# 1. 安装依赖（仓库只维护根级 pnpm-lock.yaml）
pnpm install --frozen-lockfile

# 2. 启动开发用 PostgreSQL（只起数据库，应用跑在宿主机）
docker compose -f compose.dev.yaml up -d
```

> Docker Hub 不可达时可经镜像代理拉取后打标签，命令见 README。

---

## 2. 本地运行

内测模式要求 `APP_ENV=internal`，且**密钥、白名单、固定验证码必须通过仓库外的只读文件提供**，绝不进仓库。

密钥文件清单、完整环境变量、初始化与前后端启动命令统一维护在 [README「本地运行」](README.md#本地运行)，本页不再复制一套。只使用独立开发库；本地生活功能需同时启用 API 与 Web 的分发开关，默认 Web 不开放工具。

未配置云端供应商时聊天返回 `LLM_UNAVAILABLE`；没有同意授权时不会调用模型。当前装扮页面只提供 `cloud_mock` 模拟预览；构建没有旧文档所称的 MediaPipe/WASM 资产门禁，构建成功不能代替功能验收。

---

## 3. 日常开发命令

```bash
pnpm lint        # ESLint
pnpm typecheck   # tsc --noEmit
pnpm test        # 全量测试
pnpm build       # 构建
```

> Windows 注意：跑 `pnpm test` 前先停掉 dev API——`node --watch` 会占用 Prisma 引擎文件，导致 `pretest` 的 `prisma generate` 报 EPERM。

**数据库门禁**（需真实 PostgreSQL）：

```bash
TEST_DATABASE_URL='postgresql://用户:口令@127.0.0.1:5432/postgres' \
pnpm --filter cyber-sister-server test:postgres
```

测试会创建随机隔离空库、执行 `migrate deploy` 与 seed、验证关系，结束后强制删除。未设置 `TEST_DATABASE_URL` 时普通 `pnpm test` 会跳过这 5 个集成套件。覆盖率与 E2E 的实际门禁见 [.github/workflows/ci.yml](.github/workflows/ci.yml)。

---

## 4. 分支与提交

**分支命名**：

```
feature/简短描述     # 新功能
fix/简短描述         # 修复
docs/简短描述        # 文档
chore/简短描述       # 构建/依赖/杂项
```

**提交信息**：使用中文，格式为 `type: 描述`

```
feat: 新增倒数日删除确认
fix: 修复记忆归属校验绕过
docs: 补充 API 文档的错误码
test: 补充危机检测单元测试
chore: 升级 pnpm 至 11.5.1
```

常用 type：`feat` / `fix` / `docs` / `test` / `refactor` / `chore` / `perf`。

---

## 5. 提交 PR

1. 确保 `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿
2. 从 `master` 拉最新并 rebase，解决冲突
3. 填写 PR 模板（`.github/PULL_REQUEST_TEMPLATE.md`），逐项勾选检查清单
4. 关联对应 Issue
5. UI 变更必须附截图或录屏

**PR 会被重点检查**：

- 是否遵循 [`代码审查标准与流程`](docs/代码审查标准与流程_V1.0.md) 与 [`代码审查检查清单`](docs/代码审查检查清单.md)
- 数据库是否只用 `prisma migrate deploy`（**禁止 `db push`**）
- 日志是否泄漏提示词、聊天正文、记忆、凭据、图片（Spec §8）
- 涉及危机文案的是否已获产品负责人书面批准（Spec §5）
- 用户可见变更是否同步更新了 `docs/07-用户/` 文档
- 无障碍：键盘可达、44px 触控、焦点管理、reduced-motion

---

## 6. 本项目特有的红线

做这个功能，有几条不能碰：

| 红线 | 说明 |
|------|------|
| **AI 身份不可被覆盖** | 人格可以网络化、可以有脾气，但 AI 身份、安全边界、用户自主性不能被人格或用户提示改写 |
| **危机检测优先于模型调用** | 中高风险输入必须在数据库事务中阻断，模型调用次数为零 |
| **未核验的危机资源不得进仓库** | 热线等展示资源须产品负责人书面批准并记录来源与核验日期；不得无证据声明"24 小时" |
| **媒体边界** | 当前装扮预览在显式提交时把图片送到应用后端，内存校验后返回模拟结果。旧“照片永不上传”说明与实现冲突已登记 R8；这不授权新增上传或对外发送 |
| **数据最小化** | 按 Spec §3/§4 的同意与消息合同装配、脱敏；Web 业务消息最多 20 条、记忆最多 5 条，本地工具回合预算见 §4；不发送用户 ID、手机号字段和无关记忆。媒体用途的文档冲突见 R8，不能自行扩大范围 |
| **不做的事** | 不弱化安全红线、不引入情感诱导付费、不做医疗诊断与心理咨询、不冒充真人 |

---

## 7. 发现文档问题

文档与实现漂移是本项目的已知痛点。发现不一致请直接提 `📝 文档问题` Issue——**这属于必须做的工作，不是吹毛求疵**。

已知的冲突记录在 [`docs/01-产品/开发计划与路线图.md`](docs/01-产品/开发计划与路线图.md) 第 1.3 节。

---

## 8. 需要帮助

- 先看 [`docs/README.md`](docs/README.md) 文档索引，确认有没有现成答案
- 环境与部署问题：查 [`docs/deployment/internal-runbook.md`](docs/deployment/internal-runbook.md)
- 范围问题（这个该不该做）：查 [`docs/Spec_Amie_v1.0.md`](docs/Spec_Amie_v1.0.md) §1
- 仍不确定：提 Issue，标签选 `status: needs-triage`
