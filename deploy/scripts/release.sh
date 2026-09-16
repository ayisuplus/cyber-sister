#!/usr/bin/env bash
# 一次发布：预检 → 备份数据库 → 构建镜像 → 迁移并起服务 → 健康检查 → 记录；失败自动回滚镜像。
#
# 用法（在仓库根目录的检出上执行，前端产物必须已放好）：
#   RUNTIME_ENV_FILE=/opt/amie/runtime.env IMAGE_TAG=sha-1a2b3c4d deploy/scripts/release.sh
#
# 可选环境变量：
#   STATE_DIR         发布状态目录，默认 /opt/amie（存 backups/ releases/ current-tag previous-tag）
#   SKIP_BACKUP=1     仅首次部署（还没有数据库）时使用
#   HEALTH_RETRIES / HEALTH_INTERVAL  健康检查次数与间隔，默认 10 次 × 5 秒
#
# 数据安全：迁移前必备份并校验；回滚只回镜像，绝不自动回滚数据库。
set -Eeuo pipefail
# shellcheck source=deploy/scripts/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

BACKUP_KEEP="${BACKUP_KEEP:-7}"
BACKUP_FILE=""

require_env_file
[ -n "${IMAGE_TAG:-}" ] || fail "未设置 IMAGE_TAG"
[ "$IMAGE_TAG" != "latest" ] || fail "IMAGE_TAG 不能是 latest（API 启动时会拒绝）"
printf '%s' "$IMAGE_TAG" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$' || fail "IMAGE_TAG 格式不合法：$IMAGE_TAG"
export IMAGE_TAG

log "发布 $IMAGE_TAG（配置：$RUNTIME_ENV_FILE，状态目录：$STATE_DIR）"

# ---- 1. 预检 ----
command -v docker >/dev/null || fail "找不到 docker"
docker compose version >/dev/null || fail "docker compose 不可用"
[ -d "$REPO_ROOT/apps/web/dist" ] || fail "缺少 apps/web/dist：前端产物由 CI 构建后下载到这里，服务器不编译前端"
check_secret_paths
compose config -q || fail "compose 配置校验失败"
mkdir -p "$STATE_DIR/backups" "$STATE_DIR/releases"

available_kb="$(df -Pk "$STATE_DIR" | awk 'NR==2 {print $4}')"
[ "${available_kb:-0}" -ge 2097152 ] || fail "磁盘可用空间不足 2G（当前 ${available_kb}K），先清理再发布"

PREVIOUS_TAG=""
[ -f "$STATE_DIR/current-tag" ] && PREVIOUS_TAG="$(cat "$STATE_DIR/current-tag")"

rollback_on_failure() {
  local code=$?
  log "发布失败（退出码 $code）"
  if [ -n "$BACKUP_FILE" ]; then
    log "数据库备份保留在：$BACKUP_FILE（数据回滚需人工确认，脚本不自动执行）"
  fi
  if [ -n "$PREVIOUS_TAG" ] && [ "$PREVIOUS_TAG" != "$IMAGE_TAG" ]; then
    log "回滚到上一个镜像标签：$PREVIOUS_TAG"
    RUNTIME_ENV_FILE="$RUNTIME_ENV_FILE" STATE_DIR="$STATE_DIR" \
      "$REPO_ROOT/deploy/scripts/rollback.sh" "$PREVIOUS_TAG" || log "回滚也失败了，需要人工介入"
  else
    log "没有可回滚的上一个标签（首次部署？），保持现状等待人工处理"
  fi
  exit 1
}
trap rollback_on_failure ERR

# ---- 2. 备份（迁移之前，失败即止）----
if [ "${SKIP_BACKUP:-0}" = "1" ]; then
  log "按 SKIP_BACKUP=1 跳过备份（只应在首次部署时使用）"
elif [ -z "$(compose ps -q postgres 2>/dev/null || true)" ]; then
  log "postgres 容器尚未运行，判定为首次部署，跳过备份"
else
  BACKUP_FILE="$STATE_DIR/backups/pre-$IMAGE_TAG-$(date +%Y%m%d-%H%M%S).dump"
  log "备份数据库 → $BACKUP_FILE"
  compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$BACKUP_FILE"
  [ -s "$BACKUP_FILE" ] || fail "备份文件为空：$BACKUP_FILE"
  compose exec -T postgres pg_restore --list < "$BACKUP_FILE" > /dev/null || fail "备份文件无法被 pg_restore 解析"
  log "备份校验通过（$(du -h "$BACKUP_FILE" | cut -f1)）"
  # 只保留最近 N 份
  ls -1t "$STATE_DIR/backups"/pre-*.dump 2>/dev/null | tail -n "+$((BACKUP_KEEP + 1))" | while read -r old; do
    log "清理旧备份：$old"
    rm -f "$old"
  done
fi

# ---- 3. 构建 ----
log "构建镜像 api、web（web 只是把现成 dist 装进 nginx）"
compose build api web

# ---- 4. 迁移并起服务 ----
# migration 是一次性服务，compose 里已声明 api 依赖它 service_completed_successfully
log "应用迁移并启动服务"
compose up -d --remove-orphans

# ---- 5. 健康检查 ----
if ! wait_healthy; then
  fail "健康检查未通过"
fi

# ---- 6. 记录 ----
compose images > "$STATE_DIR/releases/$IMAGE_TAG.txt"
if [ -n "$PREVIOUS_TAG" ] && [ "$PREVIOUS_TAG" != "$IMAGE_TAG" ]; then
  printf '%s\n' "$PREVIOUS_TAG" > "$STATE_DIR/previous-tag"
fi
printf '%s\n' "$IMAGE_TAG" > "$STATE_DIR/current-tag"
trap - ERR

log "发布完成：$IMAGE_TAG（上一个：${PREVIOUS_TAG:-无}）"
report_llm_status
log "提示：健康检查只证明进程与数据库可用；聊天是否可用要另行验证。"
