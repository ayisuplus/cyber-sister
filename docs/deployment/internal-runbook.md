# 单机内测部署与回滚手册

本文面向全新 Linux 主机上的白名单内测部署。所有外部调用、证书、凭据和受控二进制均由运维在构建或运行时注入，不进入 Git。

> **与自动流水线的关系（2026-09-16）**：日常发布由 `.github/workflows/deploy.yml` 在主机自建 runner 上调用 `deploy/scripts/release.sh` 完成，它把本文第 3 节的构建、迁移、启动，第 4 节的启动验收，以及第 5 节的**备份**做成了自动步骤（备份失败即中止，不会进入迁移）。本文仍是唯一的口径来源：
> - 首次部署、换机、排障时按本文手工执行；
> - **数据回滚始终是人工动作**——脚本只回镜像（`deploy/scripts/rollback.sh`），数据库恢复按第 5 节由人确认后执行；
> - 自动发布使用的 compose 命令是 `-f compose.yaml -f deploy/compose.server.yaml`（后者是 2 核 2G 主机的资源与日志覆盖层），手工操作时也应带上同样的两个 `-f`，否则资源限制不生效。

## 1. 前置条件

- Docker Engine 与支持 `service_completed_successfully` 的 Docker Compose v2。
- 指向主机的内测域名，以及该域名对应的 PEM 证书和私钥。
- 聊天模型只走云端：经批准的云端模型（供应商槽 `GATEWAY_QWEN_*`）及其 Base URL、模型名和 Key 文件。
- 模型主密钥文件（`MODEL_CONFIG_KEY_FILE`，只读、64 位十六进制）：实例管理员在设置页「模型供应商」里保存的供应商密钥，用它做 AES-256-GCM 加解密。
- 产品负责人批准的 `cloud-primary-v1` 云端模型同意文案与危机资源清单；资源记录官方来源和核验日期。

内测仅允许白名单成年测试者从 VPN 或可信私网访问。

## 2. 准备运行配置

复制 `deploy/internal.env.example` 到主机上的私密运行配置文件，并设置至少以下值：

- `APP_ENV=internal`
- `POSTGRES_DB`、`POSTGRES_USER`
- `POSTGRES_PASSWORD_FILE`、`DATABASE_PASSWORD_FILE`、`JWT_SECRET_FILE`、`JWT_REFRESH_SECRET_FILE`
- `INTERNAL_TEST_PHONES_FILE`、`INSTANCE_ADMIN_PHONES_FILE`、`INTERNAL_TEST_CODE_FILE`
- `APP_DOMAIN`、`BIND_ADDRESS`、`IMAGE_TAG`、`TLS_CERT_PATH`、`TLS_KEY_PATH`
- `MODEL_CONFIG_KEY_FILE`（模型主密钥，见下）

每个 `*_FILE` 都指向仓库外的独立只读文件：数据库口令、两个至少 32 字符的 JWT 密钥、六位内测码、逗号分隔的手机号白名单、其中作为实例管理员的手机号，以及模型主密钥。`POSTGRES_PASSWORD_FILE` 与 `DATABASE_PASSWORD_FILE` 内容必须相同，但必须是两个独立文件，以便分别授予 PostgreSQL 容器用户和 API 容器用户读取权限。文件内容不加引号（模型主密钥的末尾换行也会被安全去掉）。Compose 以只读 secret 挂载到对应容器，凭据不会作为环境变量注入。

### 模型主密钥 `MODEL_CONFIG_KEY_FILE`（2026-09-22 起）

实例管理员可以在设置页「模型供应商」里配多家 OpenAI 兼容的聊天模型；这些供应商的密钥以 AES-256-GCM 密文存进数据库的 `model_providers.api_key_encrypted`，主密钥单独放在一个只读文件里：

```bash
umask 077
openssl rand -hex 32 > /absolute/private/secrets/model_config_key
wc -c < /absolute/private/secrets/model_config_key   # 65：64 位十六进制 + 一个换行
```

- **格式**：只接受 64 位十六进制（32 字节）。文件内容不加引号。
- **放置**：放在仓库外的私密目录，只给 API 容器用户读（同下面六个文件的 `1000:1000` / `0400` 规则），容器内固定是 `/run/secrets/model_config_key`。**不要**提交、不要写进镜像、不要贴进聊天或工单、不要当成环境变量的值。
- **缺失的后果**：主密钥不在或格式不对时，供应商密钥写不进去（接口 503），库里的旧密文也解不开——此时聊天如实报 `LLM_UNAVAILABLE`，**不会**退回明文，也**不会**偷偷改用环境变量槽里的那一家。
- **备份**：它和 `pg_dump` 必须分别保管、同一时刻能凑齐。备份里的密文没有它解不开；反过来，只有它而没有备份也恢复不了配置。丢了它，已有供应商的密钥全部作废，只能在设置页逐家重填。
- **轮换**：换主密钥等于换一把锁，旧密文一律解不开。步骤是：先按第 5 节做并验证备份 → 写入新的 `/run/secrets/model_config_key`（`0400`、`1000:1000`）→ 重启 API → 到设置页把每一家的密钥重填一遍 → 确认聊天恢复。轮换期间聊天会报 `LLM_UNAVAILABLE`，这是预期的失败方式。

> ✅ **已接线（2026-09-22）**：`compose.yaml` 的 api 服务已有 `MODEL_CONFIG_KEY_FILE: /run/secrets/model_config_key` 与 `secrets: model_config_key`，文件底部 `secrets:` 段由私密 env 文件里的 `MODEL_CONFIG_KEY_FILE` 指到宿主文件，`deploy/internal.env.example` 也加了这一行。内测环境要真正用设置页的「模型供应商」，仍须先把主密钥文件放好并按第 2 节重启 API；一家都没配时行为与以前一致，仍走 `GATEWAY_QWEN_*`。

聊天模型为云端唯一路径：必须提供 Qwen Base URL、模型名和 Key 文件（`GATEWAY_QWEN_*`），并在所有 Compose 命令中追加 `-f compose.yaml -f compose.qwen.yaml`。同意版本为 `cloud-primary-v4`，旧的外部同意版本不会沿用，用户进入聊天首屏需重新同意；未同意时云端调用次数为零。改用设置页的「模型供应商」后，聊天只认数据库里配的那几家、不再用这个槽位（一家都没配时才回退到它）；`compose.qwen.yaml` 目前仍要求 `GATEWAY_QWEN_API_KEY_FILE`，接线方式见上一节。

模型调用的总预算固定为 60 秒；Nginx 与主 Web API 客户端等待 75 秒。这个顺序不得倒置，否则客户端可能先报失败，而服务端稍后仍持久化成功结果。

file-backed Compose secrets 会保留宿主机数值 UID/权限。固定镜像中的 Node 用户为 UID/GID `1000:1000`；在普通 rootful Docker 主机上，应由管理员把 `DATABASE_PASSWORD_FILE`、两个 JWT、固定码、测试手机号、实例管理员和模型主密钥这七个文件设为 `1000:1000`、模式 `0400`。`POSTGRES_PASSWORD_FILE` 单独授予固定 PostgreSQL 镜像中的 postgres 用户读取权限并保持 `0400`。私密目录只允许管理员和对应映射用户遍历。TLS 私钥需让 edge 镜像的非 root nginx 用户可读；不要通过放宽为全局可读来解决。rootless/userns-remap 主机必须按其 UID 映射调整，并以启动前预检结果为准。

如配置 `CRISIS_RESOURCES_JSON`，只允许使用已批准的资源，不得加入未经核验的热线号码或“24 小时”等可用性声明。私密运行配置本身也应设为 `0600`。

## 3. 构建、迁移与启动

使用不可变版本标签构建并记录镜像摘要。首次启动由一次性 `migration` 服务先执行 `prisma migrate deploy`，成功后 API 和其他服务才会启动。

```bash
export RUNTIME_ENV_FILE=/absolute/private/internal.env
docker compose --env-file "$RUNTIME_ENV_FILE" build
```

构建后先以镜像的实际运行用户检查可读性，不输出文件内容：

```bash
docker compose --env-file "$RUNTIME_ENV_FILE" run --rm --no-deps api node -e "for (const p of ['/run/secrets/database_password','/run/secrets/jwt_secret','/run/secrets/jwt_refresh_secret','/run/secrets/internal_test_code','/run/secrets/internal_test_phones','/run/secrets/instance_admin_phones','/run/secrets/model_config_key']) require('node:fs').accessSync(p, require('node:fs').constants.R_OK)"
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
docker compose --env-file "$RUNTIME_ENV_FILE" run --rm api node prisma/seed.js
```

不得用 `prisma db push` 替代迁移。首次基线之后，每次数据库迁移都必须是增量迁移。

## 4. 启动验收

至少验证：

- `http://域名` 强制跳转到 HTTPS，refresh cookie 保持 `Secure`。
- `/api/health/live` 返回进程存活；`/api/health/ready` 在 PostgreSQL 可用时成功。
- 数据库不可用时 ready 失败，恢复后无需重启即可重新成功。
- `/api/llm/status` 恒为 `external_primary`；`local` 段固定为 `{ configured:false, state:'removed' }`。
- 模型供应商：设置页「模型供应商」只对实例管理员出现；配一家后保存不重启即生效，停用后自动换下一家；任何响应、日志和审计里都没有密钥（列表只有 `hasKey`）；`POST /api/admin/model-providers/:id/test` 会真的花一点钱，只在拿到外部调用批准后手工点。一家都没配时聊天仍走 `GATEWAY_QWEN_*`，行为与升级前一致。
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

**用户上传的图片（2026-09-21 起）**：头像、首页/对话背景、聊天里发的照片，以及装扮里收藏的照片（`data/collection/`）存在命名卷 `api-data`（挂在 api 容器的 `/workspace/apps/api/data`），重建容器不再丢失。**上面的 `pg_dump` 不包含这个卷**，`release.sh` 的自动备份也不包含。需要连图片一起备份时另行导出，例如：

```bash
docker run --rm -v cyber-sister-internal_api-data:/data:ro -v "$PWD":/backup alpine tar czf /backup/cyber-sister-api-data.tgz -C /data .
```

卷名以 `docker volume ls` 实际显示为准；导出的归档同样含个人数据，按敏感数据保管。

**模型主密钥不在任何备份里（2026-09-22 起）**：`MODEL_CONFIG_KEY_FILE` 指向的只读文件既不在上面的 `pg_dump` 里，也不在 `release.sh` 的自动备份里；而库里的 `model_providers.api_key_encrypted` 没有它解不开。按第 2 节单独保管一份离线副本，并记下它是哪一天启用、什么时候轮换过。回滚到旧库时，要配回**那个库当时**用的那把主密钥；轮换过的旧密钥在确认不再需要之前不要删。

## 6. 发布门禁

- lint、typecheck、单元/集成测试和构建全部通过。
- 真实 PostgreSQL 迁移、重启、备份与恢复演练通过。
- 核心 E2E、关键页面 axe 自动检查和人工键盘/缩放/reduced-motion 验收通过。
- 危机与人格冻结输入集通过。
- 只读代码审查没有未解决的 P0/P1。
- 产品负责人已书面批准云端模型同意文案（`cloud-primary-v1`）和危机资源清单。

任何一项未满足，都不能标记为可发布内测镜像。
