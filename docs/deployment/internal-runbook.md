# 单机内测部署与回滚手册

本文面向全新 Linux 主机上的白名单内测部署。所有外部调用、证书、凭据和受控二进制均由运维在构建或运行时注入，不进入 Git。

## 1. 前置条件

- Docker Engine 与支持 `service_completed_successfully` 的 Docker Compose v2。
- 指向主机的内测域名，以及该域名对应的 PEM 证书和私钥。
- 聊天模型只走云端：经批准的云端模型（供应商槽 `GATEWAY_QWEN_*`）及其 Base URL、模型名和 Key 文件。
- 产品负责人批准的 `cloud-primary-v1` 云端模型同意文案与危机资源清单；资源记录官方来源和核验日期。

内测仅允许白名单成年测试者从 VPN 或可信私网访问。

## 2. 准备运行配置

复制 `deploy/internal.env.example` 到主机上的私密运行配置文件，并设置至少以下值：

- `APP_ENV=internal`
- `POSTGRES_DB`、`POSTGRES_USER`
- `POSTGRES_PASSWORD_FILE`、`DATABASE_PASSWORD_FILE`、`JWT_SECRET_FILE`、`JWT_REFRESH_SECRET_FILE`
- `INTERNAL_TEST_PHONES_FILE`、`INSTANCE_ADMIN_PHONES_FILE`、`INTERNAL_TEST_CODE_FILE`
- `APP_DOMAIN`、`BIND_ADDRESS`、`IMAGE_TAG`、`TLS_CERT_PATH`、`TLS_KEY_PATH`

每个 `*_FILE` 都指向仓库外的独立只读文件：数据库口令、两个至少 32 字符的 JWT 密钥、六位内测码、逗号分隔的手机号白名单和其中作为实例管理员的手机号。`POSTGRES_PASSWORD_FILE` 与 `DATABASE_PASSWORD_FILE` 内容必须相同，但必须是两个独立文件，以便分别授予 PostgreSQL 容器用户和 API 容器用户读取权限。文件内容不加引号，末尾换行会被安全移除。Compose 以只读 secret 挂载到对应容器，凭据不会作为环境变量注入。

聊天模型为云端唯一路径：必须提供 Qwen Base URL、模型名和 Key 文件（`GATEWAY_QWEN_*`），并在所有 Compose 命令中追加 `-f compose.yaml -f compose.qwen.yaml`。同意版本为 `cloud-primary-v1`，旧的外部同意版本不会沿用，用户进入聊天首屏需重新同意；未同意时云端调用次数为零。

模型调用的总预算固定为 60 秒；Nginx 与主 Web API 客户端等待 75 秒。这个顺序不得倒置，否则客户端可能先报失败，而服务端稍后仍持久化成功结果。

file-backed Compose secrets 会保留宿主机数值 UID/权限。固定镜像中的 Node 用户为 UID/GID `1000:1000`；在普通 rootful Docker 主机上，应由管理员把 `DATABASE_PASSWORD_FILE`、两个 JWT、固定码、测试手机号和实例管理员这六个文件设为 `1000:1000`、模式 `0400`。`POSTGRES_PASSWORD_FILE` 单独授予固定 PostgreSQL 镜像中的 postgres 用户读取权限并保持 `0400`。私密目录只允许管理员和对应映射用户遍历。TLS 私钥需让 edge 镜像的非 root nginx 用户可读；不要通过放宽为全局可读来解决。rootless/userns-remap 主机必须按其 UID 映射调整，并以启动前预检结果为准。

如配置 `CRISIS_RESOURCES_JSON`，只允许使用已批准的资源，不得加入未经核验的热线号码或“24 小时”等可用性声明。私密运行配置本身也应设为 `0600`。

## 3. 构建、迁移与启动

使用不可变版本标签构建并记录镜像摘要。首次启动由一次性 `migration` 服务先执行 `prisma migrate deploy`，成功后 API 和其他服务才会启动。

```bash
export RUNTIME_ENV_FILE=/absolute/private/internal.env
docker compose --env-file "$RUNTIME_ENV_FILE" build
```

构建后先以镜像的实际运行用户检查可读性，不输出文件内容：

```bash
docker compose --env-file "$RUNTIME_ENV_FILE" run --rm --no-deps api node -e "for (const p of ['/run/secrets/database_password','/run/secrets/jwt_secret','/run/secrets/jwt_refresh_secret','/run/secrets/internal_test_code','/run/secrets/internal_test_phones','/run/secrets/instance_admin_phones']) require('node:fs').accessSync(p, require('node:fs').constants.R_OK)"
docker compose --env-file "$RUNTIME_ENV_FILE" run --rm --no-deps --entrypoint sh postgres -c 'test -r /run/secrets/postgres_password'
docker compose --env-file "$RUNTIME_ENV_FILE" run --rm --no-deps --entrypoint sh edge -c 'test -r /run/tls/tls.crt && test -r /run/tls/tls.key'
```

任一预检失败都必须修正数值 UID/权限后重试。随后启动：

```bash
docker compose --env-file "$RUNTIME_ENV_FILE" up -d --pull never
docker compose --env-file "$RUNTIME_ENV_FILE" ps
```

`BIND_ADDRESS` 必须是 VPN 或可信私网接口地址，不能使用 `0.0.0.0`。同一个私密文件供 Compose 插值并作为 API 的非密钥运行配置；migration 只挂载数据库口令，所有模型调用统一交给主 API。

`IMAGE_TAG` 必须每次唯一（例如发布号加 Git SHA），一经构建不得复用。构建后保存 Compose 镜像清单，并在发布记录中保留 image ID/registry digest；同时离线保留上一组镜像或确认私有仓库仍可按 digest 拉取：

```bash
docker compose --env-file "$RUNTIME_ENV_FILE" images > release-images.txt
docker compose --env-file "$RUNTIME_ENV_FILE" images -q api web | sort -u | xargs docker image inspect --format '{{.Id}} {{json .RepoTags}} {{json .RepoDigests}}'
```

如需预置白名单用户，可在迁移完成后幂等执行：

```bash
docker compose --env-file "$RUNTIME_ENV_FILE" run --rm api pnpm --filter cyber-sister-server db:seed
```

不得用 `prisma db push` 替代迁移。首次基线之后，每次数据库迁移都必须是增量迁移。

## 4. 启动验收

至少验证：

- `http://域名` 强制跳转到 HTTPS，refresh cookie 保持 `Secure`。
- `/api/health/live` 返回进程存活；`/api/health/ready` 在 PostgreSQL 可用时成功。
- 数据库不可用时 ready 失败，恢复后无需重启即可重新成功。
- `/api/llm/status` 恒为 `external_primary`；`local` 段固定为 `{ configured:false, state:'removed' }`。
- 登录、刷新、退出、云端模型同意（`cloud-primary-v1`，重新同意与撤回拦截）、聊天、人格、记忆和危机阻断完成冒烟测试。
- 日志不含提示词、聊天/记忆正文、手机号、凭据或图片。

真实外部模型只用于人工风格验收，并且必须在密钥已提供后再次获得外部调用批准。未同意（未选择）或撤回授权时都必须验证云端调用为零。

## 5. 备份与回滚

每个后续迁移前执行并验证备份：

```bash
docker compose --env-file "$RUNTIME_ENV_FILE" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > cyber-sister-before-migration.dump
test -s cyber-sister-before-migration.dump
docker compose --env-file "$RUNTIME_ENV_FILE" exec -T postgres pg_restore --list < cyber-sister-before-migration.dump > /dev/null
```

在停止写入前，先恢复到隔离验证库，确认归档可读且关键表存在；`RESTORE_DB` 只能使用新建的安全标识符：

```bash
export RESTORE_DB=cyber_sister_restore_check_20260829
[[ "$RESTORE_DB" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || { echo "RESTORE_DB 非法" >&2; exit 1; }
docker compose --env-file "$RUNTIME_ENV_FILE" exec -T -e RESTORE_DB="$RESTORE_DB" postgres sh -c 'createdb -U "$POSTGRES_USER" "$RESTORE_DB"'
docker compose --env-file "$RUNTIME_ENV_FILE" exec -T -e RESTORE_DB="$RESTORE_DB" postgres sh -c 'pg_restore --exit-on-error -U "$POSTGRES_USER" -d "$RESTORE_DB"' < cyber-sister-before-migration.dump
docker compose --env-file "$RUNTIME_ENV_FILE" exec -T -e RESTORE_DB="$RESTORE_DB" postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$RESTORE_DB" -c "\dt public.users" -c "\dt public._prisma_migrations"'
```

验证完成后可删除隔离验证库。真正回滚时先停止所有写入入口，恢复到另一个新数据库，修改私密配置中的 `POSTGRES_DB` 指向该恢复库，再启动旧镜像；原数据库保留到回滚验收完成：

```bash
docker compose --env-file "$RUNTIME_ENV_FILE" stop edge api
export RESTORE_DB=cyber_sister_restore_release_20260829
[[ "$RESTORE_DB" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || { echo "RESTORE_DB 非法" >&2; exit 1; }
docker compose --env-file "$RUNTIME_ENV_FILE" exec -T -e RESTORE_DB="$RESTORE_DB" postgres sh -c 'createdb -U "$POSTGRES_USER" "$RESTORE_DB"'
docker compose --env-file "$RUNTIME_ENV_FILE" exec -T -e RESTORE_DB="$RESTORE_DB" postgres sh -c 'pg_restore --exit-on-error -U "$POSTGRES_USER" -d "$RESTORE_DB"' < cyber-sister-before-migration.dump
```

编辑私密文件中的 `POSTGRES_DB` 与上一唯一 `IMAGE_TAG` 后，先用 `docker image inspect` 对照发布记录确认旧 image ID/digest 在本机，再执行下方 `--pull never` 回滚并完成健康、登录、聊天、人格、记忆验收。

应用回滚使用上一不可变镜像标签。若新迁移与旧代码不兼容，停止写入流量，在独立恢复演练确认过的数据库上执行恢复，再启动旧镜像。不得把“容器能启动”视为回滚成功；必须重新验证认证、聊天、记忆基础查询。

将私密文件中的 `IMAGE_TAG` 改为已记录的上一标签后，禁止重新构建并显式启动旧镜像：

```bash
docker compose --env-file "$RUNTIME_ENV_FILE" up -d --no-build --pull never
```

初始内测没有历史数据，可重建基线数据库；进入基线后不得重写已发布迁移。备份文件包含用户数据，必须按敏感数据保管，禁止提交仓库。

## 6. 发布门禁

- lint、typecheck、单元/集成测试和构建全部通过。
- 真实 PostgreSQL 迁移、重启、备份与恢复演练通过。
- 核心 E2E、关键页面 axe 自动检查和人工键盘/缩放/reduced-motion 验收通过。
- 危机与人格冻结输入集通过。
- 只读代码审查没有未解决的 P0/P1。
- 产品负责人已书面批准云端模型同意文案（`cloud-primary-v1`）和危机资源清单。

任何一项未满足，都不能标记为可发布内测镜像。
