# Amie · CI/CD 流水线设计

> **文档版本**：V2.0（2026-09-16 重写；V1.0 的 Cloudflare Pages + 独立 VPS 方案从未真正启用，已作废）
> **工具版本**：GitHub Actions（actions/checkout@v4、pnpm/action-setup@v4、actions/setup-node@v4、actions/upload-artifact@v4、actions/download-artifact@v4）、pnpm 11.5.1、Node 24
> **部署形态**：前后端同机——一台 2 核 2G 的服务器上用 Docker Compose 跑 edge nginx + web + api + postgres，nginx 同源发页面并反代 `/api`

---

## 1. 为什么是这套

2026-09-16 之前仓库里有两套互相矛盾的部署事实：工作流部署 `compose.yaml` 全栈到"VPS"并把前端发到 Cloudflare Pages，而线上实际是手工部署的 `deploy/compose.chat.yaml`（仅 API + PostgreSQL），前端在 Sites 托管。镜像名、Node 版本、密钥挂载方式都对不上。现在收敛为一套：

- **一套 compose**：`compose.yaml`（基线）+ `deploy/compose.server.yaml`（小机器的资源、日志与加固覆盖层）。
- **一个 Node 版本**：24（`.nvmrc`、`engines`、两个 Dockerfile、工作流 env 一致）。
- **一处前端**：跟 API 同机同源，不再有跨域与单独的 API 域名。

## 2. 两条流水线

```
push / PR ──→ CI（GitHub 云端 ubuntu-latest）
              ├─ web      lint → typecheck → test:coverage → build → 产物 web-dist
              ├─ api      lint → prisma migrate deploy → test:coverage（含 5 个真实 PostgreSQL 集成套件）
              ├─ packages llm-gateway 的 node --test + test:deploy
              └─ e2e      playwright（desktop + mobile chromium；本地全量 + Web 记忆回归）
                              │ master 上全绿
                              ▼
            Deploy（服务器自建 runner，workflow_run 接力）
              取 CI 的 web-dist → 备份数据库 → 构建 api/web 镜像 → 迁移并起服务
              → 健康检查 → 记录发布 → 失败自动回滚镜像
```

**为什么检查在云端、部署在本机**：部署主机只有 2 核 2G，单测 + e2e 跟线上服务挤在一起会互相拖垮；而部署必须在本机执行（要读只存在于主机上的密钥文件、要操作本机 Docker）。

### 2.1 CI（`.github/workflows/ci.yml`）

| Job | 步骤 | 说明 |
|---|---|---|
| web | lint → typecheck → test:coverage → build | 产物 `web-dist` 留存 7 天，**部署用的就是这份** |
| api | lint → `prisma migrate deploy` → test:coverage | Postgres 16 service 容器；`TEST_DATABASE_URL` 指向维护库，5 个集成套件真跑 |
| packages | 包测试 → `pnpm test:deploy` | 网关测试；实际发布脚本配合隔离假命令，8 种成功/失败场景 |
| e2e | `playwright install --with-deps chromium` → `pnpm e2e` → Web 构建与记忆回归 | `pree2e` 出本地分发构建；另在 Web 构建运行 `shared memory` 用例；失败上传 report 与 trace |

`concurrency: ci-<ref>` + `cancel-in-progress`，同分支新 push 取消旧 run。

### 2.2 Deploy（`.github/workflows/deploy.yml` + `deploy/scripts/`）

触发：CI 在 master 上成功后由 `workflow_run` 接力，或 `workflow_dispatch` 手动。`concurrency: deploy` 且 **`cancel-in-progress: false`**——迁移做到一半不能被打断。

工作流本身很薄，真正的逻辑在仓库里的脚本，可单独执行、可本地演练：

- `deploy/scripts/release.sh`：预检（密钥路径可读、compose 校验、磁盘余量、`IMAGE_TAG` 合法且非 `latest`）→ **备份数据库并校验** → 构建 `api`/`web` → `up -d`（compose 里 `migration` 一次性服务先跑 `db:migrate:deploy`，成功后 api 才起）→ 健康检查 → 写 `releases/<tag>.txt` 与 `current-tag`/`previous-tag`。预检失败直接停止；读取旧标签并注册 EXIT trap 后的失败自动尝试回滚，有旧标签才可回滚，回滚失败需人工处理。
- `deploy/scripts/rollback.sh`：用 `previous-tag`（或指定标签）以 `--no-build` 重新拉起，再做一次健康检查。
- `deploy/scripts/common.sh`：compose 调用、运行配置读取、健康检查、模型状态播报。**只读取路径与域名，任何时候不打印密钥内容。**

镜像标签 `sha-<8位>`，不可变、不用 `latest`（API 启动时 `validateRuntimeConfig` 会直接拒绝 `latest`）。

## 2.3 本地演练发现并修掉的三个缺陷

`compose.yaml` 全栈此前从未真正启动过（线上跑的一直是仅聊天的 `deploy/compose.chat.yaml`），2026-09-16 用 Docker 在本地整栈演练时暴露出三个会让部署必然失败的问题，均已修复：

1. **运行时依赖 pnpm**：`migration` 用 `pnpm ... db:migrate:deploy` 启动，而镜像里的 pnpm 由 corepack 提供，首次调用要联网下载；迁移容器只接 `internal` 网络，必然失败。改为 `node src/prisma/migrateDeploy.js`，API 入口同样改为 `node src/bootstrap.js`（与线上跑通过的 chat 栈一致）。
2. **Prisma 引擎在离线容器里被重新下载**：alpine 缺 openssl 导致引擎目标误判，且 prisma CLI 启动时会校验/补下载引擎。已在镜像内安装 openssl，并把引擎固化到 `/opt/prisma-engines`，用 `PRISMA_SCHEMA_ENGINE_BINARY` / `PRISMA_QUERY_ENGINE_LIBRARY` 显式指定，运行时不再有任何下载或写入。
3. **`BIND_ADDRESS` 一个变量承担了两个含义**：它既是 compose 发布 edge 端口的宿主机地址，又被 API 当成进程监听地址；容器内只听 127.0.0.1 时 nginx 反代必然 502，而校验又禁止 0.0.0.0。现在拆成两个：`BIND_ADDRESS`（宿主机暴露，规则不变）与 `API_LISTEN_ADDRESS`（容器内监听，compose 设为 0.0.0.0）。API 不发布任何宿主机端口，对外暴露仍由 edge 单点控制；本地客户端分发下两者都强制 127.0.0.1。

演练还确认：备份 → 迁移 → 健康检查 → 记录的顺序成立，坏版本会被自动回滚到上一个标签，且数据库不会被自动回滚。

2026-09-18 审查更正：上段是历史演练记录，不能覆盖所有失败分支；后续发现显式 `fail` 会绕过旧 ERR trap。本轮改用 EXIT trap，8 项隔离测试覆盖健康失败、构建/启动失败、空/损坏备份、首次发布、回滚失败与成功路径，保留原失败退出码。未重新演练真实 Docker 部署及数据库恢复。本地可用 `pnpm test:deploy`；Windows 设置 `BASH_BINARY` 指向 Git Bash。浏览器测试可设置 `E2E_DIST_DIR` 指向临时构建目录，默认仍为 `apps/web/dist`。

## 3. 需要配置的密钥与变量

GitHub 侧**不需要任何部署密钥**——runner 就在目标主机上，密钥只存在于主机文件里。

| 位置 | 内容 |
|---|---|
| 服务器 `/opt/amie/runtime.env` | 运行配置，照 `deploy/internal.env.example` 填 |
| 服务器 `/opt/amie/secrets/` | 各类 `*_FILE` 凭据，`0400`、`1000:1000` |
| 服务器 `/opt/amie/backups/` | 自动备份（保留最近 7 份） |
| 服务器 `/opt/amie/releases/` | 每次发布的镜像清单 |
| GitHub → Settings → Actions → Runners | 自建 runner（单并发，装成 systemd 服务） |

若服务器出网受限、runner 连不上 GitHub，退路是改回 `appleboy/ssh-action` 从云端 runner SSH 进来执行同一个 `release.sh`，那时才需要 `VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY` 三个 secrets。脚本不用改。

## 4. 回滚

- **镜像回滚**：`RUNTIME_ENV_FILE=/opt/amie/runtime.env deploy/scripts/rollback.sh [标签]`，缺省回到 `previous-tag`；可用标签见 `/opt/amie/releases/`。
- **数据回滚**：**不自动做**。每次迁移前的备份在 `/opt/amie/backups/pre-<tag>-<时间戳>.dump`，按 `docs/deployment/internal-runbook.md` 的 `pg_restore` 步骤由人确认后执行。发布失败时脚本会把备份路径打出来。
- 建议 master 开启分支保护（要求 CI 绿），从源头减少回滚。

## 5. 如实记录的缺口

1. **`/api/health/ready` 只探数据库**。它返回 200 不代表聊天可用——2026-09-15 就出现过"部署健康、聊天返回 `LLM_UNAVAILABLE`"。部署末尾会打印 `/api/llm/status` 供人判断，但**不作为成功条件**，流水线也不声称"聊天已上线"。
2. **`apps/api` 没有 typecheck**：它没有 tsconfig，`checkJs` 全量打开会带出大量历史报错，属独立整改项。CI 只对 `apps/web` 做 `tsc --noEmit`。
3. **lint 是棘轮不是清零**：`--max-warnings` 取 2026-09-16 实测值（web 22、api 146），只许降不许升。警告本身仍待逐步清理。
4. **覆盖率阈值是地板不是目标**：web 80/80/80/80 已达标（实测 94.8/87.0/82.4/94.8）。api 的阈值设为 82/78/76/71（行/语句/函数/分支），因为它要同时容纳两种跑法：CI 带真实 PostgreSQL 集成套件时实测 93.5/90.0/89.8/83.0，本地没有数据库、5 个套件自动跳过时只有 86.8/82.8/80.9/74.8。想按 CI 口径卡更高的线，就得要求本地也起数据库。
5. **没有镜像仓库**：沿用"在目标主机构建 + 不可变标签 + `docker compose images` 存档"。若服务器构建因内存不足失败，退路是在 CI 里把 api 镜像导成 tar 产物、主机 `docker load`。
6. **Action 版本用主版本标签**（`@v4`）。更高安全要求可改 SHA 锁定 + Dependabot。

## 6. 首次接入清单

- [ ] 服务器上验连通性：`curl -sS -o /dev/null -w '%{http_code}\n' https://api.github.com`（不通就走 SSH 退路）
- [ ] 装 self-hosted runner（单并发、systemd 常驻），标签用默认的 `self-hosted`
- [ ] 建 `/opt/amie/{secrets,backups,releases}`，填好 `runtime.env`，密钥 `0400`
- [ ] 没有公网域名期间：用内部主机名 + 自签证书，`BIND_ADDRESS` 填私网 IP（不能 `0.0.0.0`）
- [ ] 加 2G swap（2G 内存机器构建 api 镜像时需要）
- [ ] 先 `workflow_dispatch` 手动部署一次并验收，再让它跟着 master 自动跑
- [ ] 演练一次回滚（`rollback.sh` 指定上一个标签），确认认证与基础查询仍可用
