# Amie · 你的 AI 闺蜜

面向中国区白名单成年测试者的中文 AI 姐妹内测版。当前架构是模块化单体：React/Vite Web、Express/Prisma API、PostgreSQL，通过统一网关调用云端模型（供应商槽 `GATEWAY_QWEN_*`）。部署配置已收敛到单机 Docker Compose；配置存在不等于线上验收完成。

> **维护入口（2026-09-18）**：[项目现状与整理记录](docs/architecture/project-review-20260917.md)列出代码地图、审查问题、修复状态与验证边界。文档状态以 [docs/README.md](docs/README.md) 为索引，产品范围以 [Spec](docs/Spec_Amie_v1.0.md) 为基线。

## 当前内测范围

- 白名单手机号 + 内测固定验证码登录、刷新轮换与退出撤销。
- 只有一段一直往下聊的对话（没有会话列表与新建；升级前的会话首次打开时按时间合并，已归档的保留在设置里），分句流式输出，可在设置里清空聊天记录；界面提供温柔 `gentle`（默认）、直爽 `toxic`、安静 `cool` 三种说话方式，六个历史人格 ID 保持兼容。角色扮演与聊天/工作模式切换已移除。
- 「她」页集中说话方式、她的节奏、「做梦」开关（默认关闭，由用户自己决定是否让她在后台回想对话）与她记得的你（已记住 / 待确认；关系并入待确认，一句一条，类型与版本号不摆在界面上）；账号、模型和数据操作集中到设置。AI 角色持续状态是数值模拟，范围与验证限制见 [角色运行内核](docs/architecture/pi-companion-runtime-20260915.md)。
- `cloud-primary-v4` 云端模型同意、拒绝与撤回：未同意时云端调用次数为零，聊天不可用；每次调用前服务端重读同意状态，撤回授权会拦截尚未发出的请求。v4 覆盖聊天内容、照片、记忆向量与开启后的来信分析写作，旧版同意失效需重新选择。
- 用户显式创建、编辑、删除和清空的轻量记忆；「帮我记住」按需生成候选，未确认不落库；记忆语义向量投影（保存时生成、可重建、失败静默降级）让相关记忆按意思相近召回，无向量回退关键词。
- 生活功能（Web 版直接可用）：「安排」统一日程、倒数日、提醒与习惯；「手记」是一条时间线，日记与读书笔记写在同一个输入框里（填了书名就记到那本书下）；「读书」可以把自己的 EPUB/TXT 放进来和她一起读——书只存在这台设备的浏览器里，不上传，读到哪儿都能问她一句，同一轮问答也留在对话里；「经期」独立保留，新增、修改和让她读取前需单独同意（敏感个人信息，可撤回）；「装扮」是你自己的收藏：衣柜与化妆间，可以拍一张、从相册选或粘贴分享链接，照片在手机上压缩并去掉拍摄位置后存在服务器，链接只存不打开。番茄钟已下线，旧记录只读保留供导出与一次性迁移。
- 智能体工具回路：安排、经期、日记、阅读、计算与（启用时）搜索在 Web 版可用；文件产物、Python、浏览器与生图是本机能力，只在 API 跑在用户自己的电脑上时开放，服务端独立判断，不信任浏览器声明。模块名中的 `work` 是保留的执行能力命名，不代表仍有两种会话模式。
- 装扮（2026-09-21 起）：不再做美颜或 3D 生成，改成收藏（`/api/collection`）；旧的化妆间滑杆、模拟预览、3D 衣柜与 MediaPipe 模型已删除。
- 本机 FunASR 语音转文字（sidecar，不送外部服务）。
- 她的工作台：派生理解草稿（模式/推测/冲突/小结）用户逐条定夺（晋升/厘清/忽略），冲突可定稿入记忆；「关系」页签确认记忆之间的明确关系（相似/相关/冲突），canonical 边聊天时一跳联想。
- 她主动说的话只有对话这一个出口：到点的安排提醒、「她来想你」（生日、经期、带日子的安排、昨日心情）和每周的信，合成一条时间线落在对话末尾，每条附「为什么看到这条」，一句「知道了」收起。打开对话时拉取，没有推送通道；关怀总开关仍在设置里。
- 她的信：每周一封，完全由本周真实数据在本机生成（不调用云端模型），同一周幂等唯一，沉默的一周宁缺毋滥；写好后由她在对话里说，点过「知道了」就不再出现。日记与读书的 AI 回应只读保留旧内容，不再提供模拟按钮。
- 数据与迁移：导出全部自有数据为单个 JSON（永久免费，不设会员门槛）；导入自家导出包或豆包/千问智能体人设文本，逐条确认后落库；角色扮演恋人红线如实拒绝。
- 中高风险输入服务端阻断；危机资源文案须经产品负责人核验后配置。

会员、支付、天气、账号删除、真实短信、自动记忆提取（语义投影已实现，自动落库式提取仍后置）、模型训练、微服务/Kubernetes 和公开发布均不属于本次内测。

**只有一个 Web 版**：对话、「她」、安排、手记、读书、经期、装扮和设置对所有人开放。托管的 Web 版经 [本机助手](docs/architecture/local-bridge-20260919.md)（`apps/bridge`，用户电脑上主动外连的小程序）在用户授权的文件夹里看目录、读文本文件、新建文件；助手不在线时这些能力不出现。隔离 Python、独立浏览器、生图与后台任务暂时仍只在 API 本身跑在用户电脑上时开放（`APP_DISTRIBUTION=local` 且 `BIND_ADDRESS=127.0.0.1`；前端 `VITE_APP_DISTRIBUTION=local` 只决定是否显示附文件与后台执行入口）。

## 仓库结构

| 路径 | 作用 |
| --- | --- |
| `apps/web` | React/Vite 主应用 |
| `apps/api` | Express/Prisma API 与 PostgreSQL 迁移 |
| `apps/bridge` | 本机助手：装在用户电脑上、主动连到 Amie 的零依赖 Node 程序 |
| `packages/llm-gateway` | 非流式与 SSE 流式 OpenAI-compatible 模型网关 |
| `packages/design-tokens` | 主应用及未来能力共享的四色语义令牌 |
| `deploy` | Nginx TLS 配置、环境示例与部署手册 |
| `tools` | 数据准备与采集工具：`data-pipeline`=数据准备工具；`mediacrawler`=采集工具，不属于主应用构建 |
| `docs` | 产品、架构、合规、用户文档，索引与状态标签见 `docs/README.md` |
| `.github` | Issue 模板与 PR 模板（合规与安全必查清单） |

当前视觉与插画规范见 [`docs/UI设计系统规范_V3.0.md`](docs/UI设计系统规范_V3.0.md)。

## 本地验证

要求 Node.js 24（见 `.nvmrc`）与 pnpm 11.5.1。仓库只维护根级 `pnpm-lock.yaml`。

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

未设置 `TEST_DATABASE_URL` 时，`pnpm test` 会跳过真实 PostgreSQL 套件；不能把这个结果记作数据库门禁通过。覆盖率与浏览器检查分别使用包内 `test:coverage` 和 `pnpm --filter cyber-sister-client e2e`，CI 定义见 [CI/CD 流水线](docs/04-开发/CI-CD流水线.md)。

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

从仓库根目录执行以下 PowerShell 示例。密钥路径先解析成绝对路径，后续命令共享当前终端的环境变量；不要将示例指向个人或生产数据库执行初始化。

```powershell
$amieSecrets = (Resolve-Path '../.local-secrets').Path
$env:APP_ENV = 'internal'
$env:NODE_ENV = 'development'
$env:PORT = '3000'
$env:DATABASE_HOST = 'localhost'
$env:POSTGRES_USER = 'cyber_sister'
$env:POSTGRES_DB = 'cyber_sister'
$env:DATABASE_PASSWORD_FILE = Join-Path $amieSecrets 'postgres_password'
$env:JWT_SECRET_FILE = Join-Path $amieSecrets 'jwt_secret'
$env:JWT_REFRESH_SECRET_FILE = Join-Path $amieSecrets 'jwt_refresh_secret'
$env:INTERNAL_TEST_CODE_FILE = Join-Path $amieSecrets 'internal_test_code'
$env:INTERNAL_TEST_PHONES_FILE = Join-Path $amieSecrets 'internal_test_phones'
$env:INSTANCE_ADMIN_PHONES_FILE = Join-Path $amieSecrets 'instance_admin_phones'
$env:CORS_ORIGIN = 'https://internal.example.test'
$env:APP_DOMAIN = 'internal.example.test'
$env:BIND_ADDRESS = '127.0.0.1'
$env:IMAGE_TAG = 'local-dev-1'

# 仅初始化独立开发库；已有数据库先按部署手册确认备份与迁移范围。
pnpm --filter cyber-sister-server db:migrate:deploy
if ($LASTEXITCODE -ne 0) { throw '数据库迁移失败' }
pnpm --filter cyber-sister-server db:seed
if ($LASTEXITCODE -ne 0) { throw '开发数据初始化失败' }
pnpm dev
```

聊天需要云端供应商：在启动 `pnpm dev` 前设置 `GATEWAY_QWEN_BASE_URL`（HTTPS OpenAI 兼容端点）、`GATEWAY_QWEN_MODEL` 和 `GATEWAY_QWEN_API_KEY_FILE`（仓库外 `qwen_api_key` 的绝对路径）。未配置供应商时聊天返回 `LLM_UNAVAILABLE`；首次进入聊天须经同意门授权。代码中的 `QWEN` 是兼容配置槽名，不限制供应商品牌。

注意：运行 `pnpm test` 前先停掉 dev API——`node --watch` 进程会占用 Prisma 引擎文件，导致 `pretest` 的 `prisma generate` 在 Windows 上 EPERM 失败。

另起终端从仓库根目录运行 `pnpm dev:web`（Vite 把 `/api` 代理到 `localhost:3000`），用白名单手机号 + 固定码登录。需要本地生活功能时，在 API 终端设置 `$env:APP_DISTRIBUTION='local'`、在 Web 终端设置 `$env:VITE_APP_DISTRIBUTION='local'` 后各自启动。


业务服务只通过 `prisma migrate deploy` 应用数据库迁移，禁止使用 `prisma db push`。运行配置示例见 [`deploy/internal.env.example`](deploy/internal.env.example)；数据库口令、JWT、手机号白名单、固定码和云端供应商 Key 只通过仓库外的只读 secret 文件挂载。

## 内测部署

当前部署入口是 `compose.yaml` + `deploy/compose.server.yaml`，由 `.github/workflows/ci.yml` 验证、`deploy.yml` 接力部署；见 [CI/CD 流水线](docs/04-开发/CI-CD流水线.md)和[内测部署手册](docs/deployment/internal-runbook.md)。旧 Sites + 独立 API 方案仅保留为迁移历史。域名、证书、只读密钥与经批准的危机文案仍须按部署手册配置；装扮已改为收藏，构建产物里不再有 MediaPipe/WASM 模型或 3D 查看器。

审查发现的发布失败回滚缺口已修复，`pnpm test:deploy` 用隔离命令覆盖 8 种发布场景；Windows 需将 `BASH_BINARY` 指向 Git Bash 的 `bash.exe`。这不替代真实主机的镜像/数据库恢复演练，见[修复记录](docs/architecture/project-review-20260917.md)。本轮未连接部署主机，未确认线上服务状态。

该版本是 VPN/可信私网中的受限内测，不代表公开生产发布、医疗服务或法律合规认证。
