#!/usr/bin/env bash
# 回滚到指定镜像标签（缺省读 $STATE_DIR/previous-tag）：只回代码与镜像，不动数据库。
#
# 用法：
#   RUNTIME_ENV_FILE=/opt/amie/runtime.env deploy/scripts/rollback.sh [IMAGE_TAG]
#
# 数据回滚是另一回事：备份在 $STATE_DIR/backups/ 下，按 docs/deployment/internal-runbook.md
# 的 pg_restore 步骤，由人确认后执行。
set -Eeuo pipefail
# shellcheck source=deploy/scripts/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_env_file

TARGET_TAG="${1:-}"
if [ -z "$TARGET_TAG" ] && [ -f "$STATE_DIR/previous-tag" ]; then
  TARGET_TAG="$(cat "$STATE_DIR/previous-tag")"
fi
[ -n "$TARGET_TAG" ] || fail "没有可回滚的标签：既没有传参，$STATE_DIR/previous-tag 也不存在"

export IMAGE_TAG="$TARGET_TAG"
log "回滚到 $TARGET_TAG"

# 镜像必须已经在本机（历次发布构建产物），不重新构建，也不拉取。
# 仓库名缺省时与 compose.yaml 的默认值保持一致。
API_IMAGE="$(env_value API_IMAGE_REPOSITORY)"; API_IMAGE="${API_IMAGE:-cyber-sister-api}"
WEB_IMAGE="$(env_value WEB_IMAGE_REPOSITORY)"; WEB_IMAGE="${WEB_IMAGE:-cyber-sister-web}"
for name in "$API_IMAGE" "$WEB_IMAGE"; do
  docker image inspect "$name:$TARGET_TAG" >/dev/null 2>&1 \
    || fail "本机没有镜像 $name:$TARGET_TAG，无法回滚（可用标签见 $STATE_DIR/releases/）"
done

compose up -d --no-build --remove-orphans

if wait_healthy; then
  printf '%s\n' "$TARGET_TAG" > "$STATE_DIR/current-tag"
  log "回滚完成：$TARGET_TAG"
  log "提醒：数据库没有回滚。若这次发布已应用迁移，请按 runbook 判断是否需要用备份恢复。"
else
  fail "回滚后的健康检查仍未通过，需要人工介入"
fi
