# Amie · GitHub CI/CD

> 状态：✅ 当前有效
> 2026-11-06：GitHub 云端检查 + 受限 SSH 发布；仅供已授权的私人内测。任务见 [Issue #4](https://github.com/ayisuplus/cyber-sister/issues/4)。

## 触发与门禁

PR 到 `master` 和 `master` push 都运行 `.github/workflows/ci.yml`：

- Web：lint、类型检查、覆盖率、iOS 配置约束测试、Web 构建。
- API：lint、已提交迁移、覆盖率；真实 PostgreSQL 服务供集成套件创建独立测试库，不允许静默跳过数据库验证。
- Packages：共享包与本机助手测试、部署脚本故障分支测试、发布接收器的不可信输入与恢复测试。
- E2E：桌面与手机 Chromium；本机能力构建跑完整套件，再用 Web 构建验证共享记忆和生活入口。

只有本仓库的 `master push` CI 全部成功，才由 `.github/workflows/deploy.yml` 部署。PR（包括 fork）、失败或未完成 CI 均不能发布。手动运行 Deploy 可填成功 CI 的 `run_id`；留空选最新成功 master push。提交必须仍是当前 master，旧提交会跳过；回滚使用服务器管理员入口。

`master` 分支保护要求以上四项检查通过并要求分支更新，不允许强推或删除。`private-beta` environment 仅允许 master。日常从分支提交 PR，合并后自动发布。

## 同一份已检查产物

Web job 将同一个完整 SHA 的必要源码与编好的 `dist` 打为 `release-bundle`，保留 7 天。归档只选取 Compose、API、共享包、部署目录和 Web 镜像所需文件，排除文档、Git 历史及运行凭据。原生 iOS 代码可参与源码合并，本流水线只发布 Web，不生成或发行 iOS 二进制。

部署 job 和服务器都核对 CI workflow、事件、仓库、分支、当前 master SHA、成功结论与 artifact 元数据。服务器接收原始 ZIP，校验 GitHub 提供的 SHA256，再验证全部解包路径、清单和 Web profile，拒绝越界路径、符号链接、重复项、真实 env、文档或超限归档。

镜像标签是 `sha-<提交前8位>-ci-<run_id>-a<run_attempt>`。同一次 CI 重复部署使用已保存源码和镜像，不重新构建。重新运行 CI 会得到新 attempt 标签，避免覆盖原镜像。无需镜像仓库；API 在主机构建，前端只装入 CI 产物。

## 首次配置

服务器管理员用专用公钥执行 `deploy/scripts/install-github-deploy.sh PUBLIC_KEY EXISTING_SOURCE`：

- 创建锁定密码的 `amie-deploy` 账号，不加入 Docker 组。
- SSH key 使用 `restrict` 与固定命令，仅接受 `deploy`，不能开普通 shell 或转发端口。
- sudo 只允许无参数的 root-owned `/usr/local/sbin/amie-github-deploy`；回滚和初始化参数仅管理员可用。
- 配置在 `/etc/amie/github-deploy.json`；受管源码、私密日志、状态在 `/opt/amie/cicd/`。初始化复制现有 Compose / 代理 / 回滚脚本，登记当前和上一版镜像，不切换服务。

GitHub `private-beta` environment 设置：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Variable | `AMIE_SSH_HOST` | 服务器地址 |
| Variable | `AMIE_SSH_PORT` | SSH 端口 |
| Variable | `AMIE_SSH_USER` | `amie-deploy` |
| Secret | `AMIE_SSH_PRIVATE_KEY` | 仅此次发布使用的私钥，不使用管理员私钥 |
| Secret | `AMIE_SSH_KNOWN_HOSTS` | 从已信任的管理员连接取得的主机公钥，严格校验，不临时信任扫描结果 |

GitHub job 的短期只读 `github.token` 经 SSH stdin 供服务器即时核验 Actions 元数据，不写入文件。应用的 JWT、手机号、模型密钥、数据库凭据继续保留在 `/opt/amie/runtime.env` 与 `/opt/amie/secrets/`，不放 GitHub。详细构建 / 迁移日志仅存服务器私密目录，公开 Actions 只显示脱敏状态和提交标签。

## 发布与恢复

`release.sh` 在迁移前暂停应用写入并备份、校验数据库和附件，然后构建、迁移、启动并检查健康。备份失败不能继续。并发由 GitHub concurrency 和服务器文件锁双重约束；自动发布不主动取消正在发布的任务。

接收器失败恢复使用上一版自己的源码、Compose、代理配置与匹配的临时 runtime 标签，而后恢复 canonical runtime 与状态。数据库从不自动降级；不兼容迁移需要另行审查和数据恢复，不能靠旧镜像保证业务兼容。

管理员回滚上一版：

```sh
sudo /usr/local/sbin/amie-github-deploy --rollback
```

回滚后可在 GitHub 手动运行 Deploy，指定当前 master 的成功 CI `run_id`，恢复已保存的新版本。日志在 `/opt/amie/cicd/logs/`，当前 / 上版源码记录在 `/opt/amie/cicd/active.json`，备份在 `/opt/amie/backups/`。不要直接用旧检出目录的 `release.sh` 绕过接收器；手工更改 current-tag 会被检测并要求管理员先对齐状态。

若发布中断留下无成功 receipt 的目录，不覆盖该目录或镜像，先确认线上健康并重新运行 CI，使用新的 attempt 标签。若 artifact 超过 7 天过期，同样重新运行 CI。

## 验证边界

`/api/health/ready` 只验证进程与数据库，不能代替真实模型聊天验收。CI 不使用真实模型密钥、不调用付费模型。Cloudflare Access 保持本人访问，CI/CD 成功不代表法务签字、危机资源核实、产品发布门或公开发行已获批准；法务草案不进入部署产物。当前模型超时配置问题另见 [Issue #3](https://github.com/ayisuplus/cyber-sister/issues/3)。

API 暂无 typecheck；lint 和 coverage 沿用仓库现有阈值，不为接通流水线降低标准。Actions 仍使用主版本标签，生产 API 镜像基础层仍随 `node:24-alpine` 更新；每次 CI attempt 的发布镜像本身保留唯一标签。
