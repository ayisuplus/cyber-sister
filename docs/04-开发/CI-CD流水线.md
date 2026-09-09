# Amie · CI/CD 流水线设计

> **文档版本**：V1.0
> **创建日期**：2026-09-09
> **工具版本**：GitHub Actions（actions/checkout@v4、pnpm/action-setup@v4、actions/setup-node@v4、cloudflare/wrangler-action@v3、appleboy/ssh-action@v1）、pnpm 11.5.1、Node 22
> **成本目标**：全免费档（公开仓库 GitHub Actions 不限量 + Cloudflare Pages/Workers 免费档 + 自有 VPS）

---

## 1. 架构总览

```
┌─────────────┐   push / PR    ┌──────────────────────────────────┐
│   GitHub    │ ─────────────→ │            CI (ci.yml)            │
│ ayisuplus/  │                │  web: lint→typecheck→test→build  │
│ cyber-sister│                │  api: lint→migrate deploy→test   │
└──────┬──────┘                │       (Postgres 16 service 容器)  │
       │                        │  packages: lint→test             │
       │                        └──────────────────────────────────┘
       │ master 合并后
       ▼
┌─────────────────────────┐         ┌──────────────────────────────┐
│ deploy-web.yml          │         │ deploy-api.yml               │
│ vite build →            │         │ SSH → VPS:                   │
│ Cloudflare Pages        │         │  git reset --hard <sha>      │
│ (主站 + /landing 落地页) │         │  compose build（IMAGE_TAG=   │
│                         │         │   sha-xxxxxxxx）             │
│ 免费档：不限带宽/请求，    │         │  compose up（migration 服务   │
│ 500 次构建/月            │         │   先跑 migrate deploy）      │
└─────────────────────────┘         │  健康检查 /api/health/live   │
                                    └──────────────────────────────┘
```

**数据面**：浏览器 → Pages（静态）→ `VITE_API_BASE_URL` 指向 VPS 的 API 域名（HTTPS）。
 Pages 不做 `/api` 反代（免费档 Pages 的 `_redirects` 不支持代理到外部源），跨域由 API 侧 `CORS_ORIGIN` 放行。

## 2. 三条流水线

### 2.1 CI（`.github/workflows/ci.yml`）—— fail fast

每个 PR 和 master push 必跑，三个 job 并行：

| Job | 步骤 | 说明 |
|---|---|---|
| web | lint → typecheck → vitest(579) → vite build | 产物 `web-dist` 留存 7 天 |
| api | lint → `prisma migrate deploy` → vitest | Postgres 16 service 容器，凭据与 vitest.config.js 内一致 |
| packages | llm-gateway / design-tokens 的 lint+test | `--if-present` 容错 |

- pnpm store 缓存（`cache: pnpm`），`--frozen-lockfile` 保证可复现。
- `concurrency` 同分支新 push 自动取消旧 run，省额度。

### 2.2 Web CD（`deploy-web.yml`）—— Cloudflare Pages

- master push（仅 `apps/web`、`packages`、lockfile 变更时）→ 生产部署
- PR → 自动生成 Preview URL（wrangler-action 会回写 deployment 状态到 PR）
- 构建期注入 `VITE_API_BASE_URL`（GitHub Variables），前端经 `api.js` 的 `API_BASE_URL` 读入；未配置时回退同源 `/api`，本地 Docker 开发不受影响
- `apps/web/public/_redirects`（`/* /index.html 200`）兜底 SPA 路由；Pages 静态文件优先，`/landing/` 落地页不受影响

### 2.3 API CD（`deploy-api.yml`）—— SSH + Docker Compose

- 仅 `apps/api`、`packages`、compose 文件变更时触发；`workflow_dispatch` 支持手动补发
- `cancel-in-progress: false`：部署串行，迁移不会被打断
- 镜像标签 `IMAGE_TAG=sha-<8位>`，不用 `latest`，可追溯可回滚
- 主机上沿用 runbook 的 `migration` 一次性服务先跑 `prisma migrate deploy`，成功后再起 API
- 部署后对 `https://<APP_DOMAIN>/api/health/live` 做 10 次×5s 健康检查，失败则流水线红

## 3. 需要配置的密钥与变量

GitHub 仓库 → Settings → Secrets and variables → Actions：

**Secrets**
| 名称 | 用途 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Pages 部署（Cloudflare → My Profile → API Tokens → 用 "Edit Cloudflare Workers" 模板，权限含 Pages:Edit） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID（ dashboard 右侧栏） |
| `VPS_HOST` / `VPS_USER` / `VPS_SSH_KEY` | API 部署机 SSH（建议专用部署用户 + 仅允许 GitHub Actions IP 段或加固 sshd） |
| `VPS_REPO_DIR` | 主机上仓库路径（如 `/opt/cyber-sister`） |
| `VPS_RUNTIME_ENV_FILE` | 主机上私密运行配置绝对路径（见 `docs/deployment/internal-runbook.md`） |
| `APP_DOMAIN` | 健康检查域名 |

**Variables**
| 名称 | 用途 |
|---|---|
| `VITE_API_BASE_URL` | 如 `https://api.example.com/api`；API 侧 `CORS_ORIGIN` 需同步加入 Pages 域名 |

> ⚠️ 以上密钥一律不进 Git；VPS 上的 `*_FILE` 凭据维持 runbook 的 0400/1000:1000 约定不变。

## 4. 回滚方案

- **Web**：Pages 控制台 → 项目 → Deployments → 选中上一个成功部署 → "Rollback"（秒级，静态回滚无状态）
- **API**：SSH 到主机 `git reset --hard <上一个稳定 SHA>` 后重跑 deploy 流水线（或用 `workflow_dispatch` 指定旧 ref）；数据库迁移如需回滚，遵循 `internal-runbook.md` 的备份恢复边界
- 建议：master 开启分支保护（要求 CI 绿 + 1 个 review），从源头减少回滚需求

## 5. 已知取舍与后续加固

1. **Action 版本**：当前用主版本标签（`@v4`）。更高安全性可改为 SHA 锁定 + Dependabot 周更，安全更新不断流。
2. **E2E**：Playwright e2e 较重，未纳入每次 CI；建议后续加 `workflow_dispatch` / nightly 定时跑。
3. **Workers 迁移**：若将来要把 API 也搬进 Cloudflare（Workers + D1/Neon），可彻底省掉 VPS，但 Prisma/Express 需要改造，属独立项目。
4. **免费档限额**：Pages 500 次构建/月、Wrangler 部署含在其中；GitHub Actions 公开仓库不限量。内测体量远低于限额。

## 6. 验证清单（首次接入时）

- [ ] Cloudflare 建 Pages 项目 `amie`（可不连 Git，由 Actions 推送）
- [ ] 配置 3.1 全部 Secrets / Variables
- [ ] VPS 上放好仓库与 `internal.env`（参照 runbook 第 2 节）
- [ ] master 分支保护开启
- [ ] 推一个空 commit 验证三条流水线全绿
- [ ] 演练一次 Pages 回滚与 API 旧 SHA 重部署
