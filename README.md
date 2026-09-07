# 赛博姐妹（Cyber Sister）

面向中国区白名单成年测试者的中文 AI 姐妹内测版。当前架构是单机 Docker Compose 模块化单体：主 Web、Node.js API、PostgreSQL。2026-09-07 起聊天切换为**云端唯一路径**（供应商槽 `GATEWAY_QWEN_*`，供应商中立）——目标用户是手机用户，跑不了本地模型，llama.cpp 管理面、虚拟试衣/化妆间与服务器侧执行能力已删除。

## 当前内测范围

- 白名单手机号 + 内测固定验证码登录、刷新轮换与退出撤销。
- 分句流式聊天，`toxic`、`gentle`、`rational`、`energetic`、`sister`、`cool` 六种人格即时切换。
- `cloud-primary-v1` 云端模型同意、拒绝与撤回：未同意时云端调用次数为零，聊天不可用；每次调用前服务端重读同意状态，撤回授权会拦截尚未发出的请求。
- 用户显式创建、编辑、删除和清空的轻量记忆；「帮我记住」按需生成候选，未确认不落库。
- 姐妹工具箱：经期记录与预测、倒数日、日程（按天时间线，可带日期与时间）、提醒设置（喝水/睡觉/经期）、日记、手帐打卡、阅读、自习。
- 智能体工具回路：聊天内直接操作上述工具（日程/倒数日/经期/提醒/日记/手帐/阅读/自习/联网搜索），动作标签可见；工作模式为日程四件、计算换算、联网搜索、写作/翻译/计划。
- 美颜相机：MediaPipe WASM 全程浏览器内处理，照片不上传。
- 本机 FunASR 语音转文字（sidecar，不送外部服务）。
- 数据与迁移：导出全部自有数据为单个 JSON（永久免费，不设会员门槛）；导入自家导出包或豆包/千问智能体人设文本，逐条确认后落库；角色扮演恋人红线如实拒绝。
- 中高风险输入服务端阻断；危机资源文案须经产品负责人核验后配置。

天气（现有路由为假数据，内测环境保持 409 关闭）、会员、支付、账号删除、真实短信、自动记忆提取、向量检索、模型训练、微服务/Kubernetes 和公开发布均不属于本次内测。

## 仓库结构

| 路径 | 作用 |
| --- | --- |
| `apps/web` | React/Vite 主应用 |
| `apps/api` | Express/Prisma API 与 PostgreSQL 迁移 |
| `packages/llm-gateway` | 非流式与 SSE 流式 OpenAI-compatible 模型网关 |
| `packages/design-tokens` | 主应用及未来能力共享的四色语义令牌 |
| `deploy` | Nginx TLS 配置、环境示例与部署手册 |
| `tools` | 数据准备与采集工具：`data-pipeline`=数据准备工具；`mediacrawler`=采集工具，不属于主应用构建 |
| `docs` | 产品、架构、合规、用户文档，索引与状态标签见 `docs/README.md` |
| `.github` | Issue 模板与 PR 模板（合规与安全必查清单） |

当前视觉与插画规范见 [`docs/UI设计系统规范_V3.0.md`](docs/UI设计系统规范_V3.0.md)。

## 本地验证

要求 Node.js 20+ 与 pnpm 11.5.1。仓库只维护根级 `pnpm-lock.yaml`。

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

真实 PostgreSQL 门禁需把 `TEST_DATABASE_URL` 指向一个具备 `CREATEDB` 权限的维护库（建议测试实例的 `postgres` 库），测试会创建随机隔离空库、执行 `migrate deploy` 与 seed、验证基础关系，并在结束时强制删除隔离库：

```bash
TEST_DATABASE_URL='postgresql://测试用户:测试口令@127.0.0.1:5432/postgres' pnpm --filter cyber-sister-server test:postgres
```

## 本地运行

应用进程跑在宿主机，PostgreSQL 用仓库自带的开发容器（口令为公开占位值，仅限本机）：

```bash
docker compose -f compose.dev.yaml up -d   # 仅 PostgreSQL
```

Docker Hub 不可达时可先经镜像代理拉取再打标签：`docker pull docker.m.daocloud.io/library/postgres:16.6-alpine && docker tag docker.m.daocloud.io/library/postgres:16.6-alpine postgres:16.6-alpine`。

内测登录要求 `APP_ENV=internal`，且该模式下密钥必须经仓库外的只读文件提供。在仓库外的私有目录（如 `../.local-secrets/`）各建一个文件：`postgres_password`（值 `cyber_sister_dev`）、`jwt_secret` 与 `jwt_refresh_secret`（各 32 位以上随机串）、`internal_test_phones`（逗号分隔手机号）、`instance_admin_phones`（须为白名单子集）、`internal_test_code`（6 位数字），然后：

```bash
cd apps/api
# Unix shell 示例；Windows cmd 用 set KEY=value&& 前缀，PowerShell 用 $env:KEY="value"
APP_ENV=internal NODE_ENV=development PORT=3000 \
DATABASE_HOST=localhost POSTGRES_USER=cyber_sister POSTGRES_DB=cyber_sister \
DATABASE_PASSWORD_FILE=../.local-secrets/postgres_password \
JWT_SECRET_FILE=../.local-secrets/jwt_secret \
JWT_REFRESH_SECRET_FILE=../.local-secrets/jwt_refresh_secret \
INTERNAL_TEST_CODE_FILE=../.local-secrets/internal_test_code \
INTERNAL_TEST_PHONES_FILE=../.local-secrets/internal_test_phones \
INSTANCE_ADMIN_PHONES_FILE=../.local-secrets/instance_admin_phones \
CORS_ORIGIN=https://internal.example.test APP_DOMAIN=internal.example.test \
BIND_ADDRESS=127.0.0.1 IMAGE_TAG=local-dev-1 \
pnpm db:migrate:deploy && pnpm db:seed && pnpm dev
```

聊天需要云端供应商：另在仓库外私有目录建 `qwen_api_key`（任意 OpenAI 兼容端点的 Key），启动时追加 `GATEWAY_QWEN_BASE_URL=<端点>/v1 GATEWAY_QWEN_MODEL=<模型> GATEWAY_QWEN_API_KEY_FILE=../.local-secrets/qwen_api_key`。未配置供应商时聊天返回 `LLM_UNAVAILABLE`，属预期降级；首次进入聊天须经首屏同意门授权。

注意：运行 `pnpm test` 前先停掉 dev API——`node --watch` 进程会占用 Prisma 引擎文件，导致 `pretest` 的 `prisma generate` 在 Windows 上 EPERM 失败。

另起终端 `pnpm dev:web`（Vite 把 `/api` 代理到 `localhost:3000`，浏览器不受 CORS_ORIGIN 限制），用白名单手机号 + 固定码登录。


业务服务只通过 `prisma migrate deploy` 应用数据库迁移，禁止使用 `prisma db push`。运行配置示例见 [`deploy/internal.env.example`](deploy/internal.env.example)；数据库口令、JWT、手机号白名单、固定码和云端供应商 Key 只通过仓库外的只读 secret 文件挂载。

## 内测部署

部署前必须由运维注入通过清单和 SHA-256 校验的 MediaPipe/WASM 资产（美颜相机用），并提供域名、证书、实例管理员白名单和经批准的危机资源文案。云端供应商凭据经 `compose.qwen.yaml` 挂载只读 Key 文件。完整步骤、备份和回滚边界见 [`docs/deployment/internal-runbook.md`](docs/deployment/internal-runbook.md)。能力扩展边界见 [`docs/architecture/local-first-capabilities.md`](docs/architecture/local-first-capabilities.md)。

该版本是 VPN/可信私网中的受限内测，不代表公开生产发布、医疗服务或法律合规认证。
