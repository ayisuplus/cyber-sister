# 赛博姐妹（Cyber Sister）

面向中国区白名单成年测试者的中文 AI 姐妹内测版。当前架构是单机 Docker Compose 模块化单体：主 Web、Node.js API、PostgreSQL、默认连接部署主机上的 llama.cpp，以及同源挂载在 `/makeup/` 的独立妆教模块。Qwen 仅是用户明确授权后的可选云端备用。

## 当前内测范围

- 白名单手机号 + 内测固定验证码登录、刷新轮换与退出撤销。
- 非流式聊天，`toxic`、`gentle`、`rational` 三种人格即时切换。
- 实例管理员可在页面自动发现、测试并保存受控 llama.cpp；普通用户只能查看状态。
- `qwen-fallback-v1` 云端备用同意、拒绝与撤回；未选择或拒绝不影响本地聊天。
- 用户显式创建、编辑、删除和清空的轻量记忆。
- 姐妹工具箱：经期记录与预测、倒数日、待办清单、提醒设置（喝水/睡觉/经期）。
- 中高风险输入服务端阻断；危机资源文案须经产品负责人核验后配置。
- 主应用中的妆教入口及 `/makeup/` 本地图片/视频帧分析流程。

虚拟试衣间和虚拟化妆间已提供可导航页面：照片只在浏览器本地选择预览（不上传）、静态款式/单品目录可选；生图将走外部 API，本期未接入——生成入口诚实显示“接入中”（`POST /api/virtual/image-gen/generations` 恒返回 503 `IMAGE_GEN_NOT_CONFIGURED`）。天气（现有路由为假数据，内测环境保持 409 关闭）、会员、支付、真实短信、自动记忆提取、向量检索、流式输出、模型训练、微服务/Kubernetes 和公开发布均不属于本次内测。

## 仓库结构

| 路径 | 作用 |
| --- | --- |
| `apps/web` | React/Vite 主应用 |
| `apps/api` | Express/Prisma API 与 PostgreSQL 迁移 |
| `packages/llm-gateway` | 非流式 OpenAI-compatible 模型网关 |
| `packages/makeup-skill` | 独立妆教前端与解释 API |
| `packages/design-tokens` | 主应用、妆教及未来能力共享的四色语义令牌 |
| `deploy` | Nginx TLS 配置、环境示例与部署手册 |

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
LOCAL_LLM_ALLOWED_ORIGINS=http://127.0.0.1:8080 \
pnpm db:migrate:deploy && pnpm db:seed && pnpm dev
```

注意：运行 `pnpm test` 前先停掉 dev API——`node --watch` 进程会占用 Prisma 引擎文件，导致 `pretest` 的 `prisma generate` 在 Windows 上 EPERM 失败。

另起终端 `pnpm dev:web`（Vite 把 `/api` 代理到 `localhost:3000`，浏览器不受 CORS_ORIGIN 限制），用白名单手机号 + 固定码登录。未配置 llama.cpp 时聊天接口返回 `LOCAL_LLM_NOT_CONFIGURED`，属预期降级；管理员登录后可在「本地模型」页指向 `LOCAL_LLM_ALLOWED_ORIGINS` 内的 llama.cpp。

未注入并登记获批 SHA-256 的 MediaPipe/WASM 资产时，`pnpm build` 按设计失败关闭。

业务服务只通过 `prisma migrate deploy` 应用数据库迁移，禁止使用 `prisma db push`。运行配置示例见 [`deploy/internal.env.example`](deploy/internal.env.example)；数据库口令、JWT、手机号白名单、固定码和可选 Qwen Key 只通过仓库外的只读 secret 文件挂载。llama.cpp 地址和模型由实例管理员保存到 PostgreSQL 的实例级配置中，服务端只接受 `LOCAL_LLM_ALLOWED_ORIGINS` 中的精确地址。

## 内测部署

部署前必须由运维注入通过清单和 SHA-256 校验的 MediaPipe/WASM 资产，并提供域名、证书、实例管理员白名单和经批准的危机资源文案。纯本地部署不需要 Qwen 凭据；启用云端备用时再通过 `compose.qwen.yaml` 挂载 Key。完整步骤、备份和回滚边界见 [`docs/deployment/internal-runbook.md`](docs/deployment/internal-runbook.md)。能力扩展边界见 [`docs/architecture/local-first-capabilities.md`](docs/architecture/local-first-capabilities.md)。

该版本是 VPN/可信私网中的受限内测，不代表公开生产发布、医疗服务或法律合规认证。
