#!/usr/bin/env bash
# 部署脚本共用部分：compose 调用、运行配置读取、健康检查。
# 约定：只读取运行配置里的「路径」和域名，绝不打印任何密钥内容。
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="${STATE_DIR:-/opt/amie}"
HEALTH_RETRIES="${HEALTH_RETRIES:-10}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"

log()  { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
fail() { printf '[%s] 错误：%s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

require_env_file() {
  [ -n "${RUNTIME_ENV_FILE:-}" ] || fail "未设置 RUNTIME_ENV_FILE（运行配置文件的绝对路径）"
  [ -r "$RUNTIME_ENV_FILE" ] || fail "运行配置文件不可读：$RUNTIME_ENV_FILE"
}

# 从运行配置里取一个键的值；文件是 KEY=VALUE 格式，这里不 source，避免执行其中内容。
env_value() {
  local key="$1"
  sed -n "s/^[[:space:]]*${key}=//p" "$RUNTIME_ENV_FILE" | tail -n 1 | sed 's/^"//; s/"$//; s/\r$//'
}

compose() {
  docker compose \
    -f "$REPO_ROOT/compose.yaml" \
    -f "$REPO_ROOT/deploy/compose.server.yaml" \
    --env-file "$RUNTIME_ENV_FILE" \
    "$@"
}

# 所有 *_FILE 与证书路径必须存在且可读；只看得见路径，不读内容。
check_secret_paths() {
  local missing=0 key value
  while IFS= read -r line; do
    case "$line" in
      \#*|'') continue ;;
    esac
    key="${line%%=*}"
    case "$key" in
      *_FILE|TLS_CERT_PATH|TLS_KEY_PATH) ;;
      *) continue ;;
    esac
    value="$(printf '%s' "${line#*=}" | sed 's/^"//; s/"$//; s/\r$//')"
    # 容器内路径（/run/secrets/...）由 compose 注入，宿主机上不存在，跳过
    case "$value" in
      /run/secrets/*|'') continue ;;
    esac
    if [ ! -r "$value" ]; then
      printf '  不可读：%s（来自 %s）\n' "$value" "$key" >&2
      missing=1
    fi
  done < "$RUNTIME_ENV_FILE"
  [ "$missing" -eq 0 ] || fail "运行密钥或证书文件不可读，见上面的清单"
}

# 健康检查：先看 api 容器自身的 healthcheck，再从宿主机经 edge 走一次真实请求。
wait_healthy() {
  local attempt=1 container status bind domain code
  bind="$(env_value BIND_ADDRESS)"
  domain="$(env_value APP_DOMAIN)"
  [ -n "$bind" ] || fail "运行配置缺少 BIND_ADDRESS"
  [ -n "$domain" ] || fail "运行配置缺少 APP_DOMAIN"

  while [ "$attempt" -le "$HEALTH_RETRIES" ]; do
    container="$(compose ps -q api || true)"
    if [ -n "$container" ]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || echo unknown)"
      if [ "$status" = "healthy" ]; then
        # 自签证书用 -k：没有域名之前证书不是公共 CA 签发的
        # --noproxy：回环请求不能走宿主机上可能配置的 HTTP 代理
        code="$(curl -sk --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 10 \
          -H "Host: $domain" "https://$bind/api/health/ready" || echo 000)"
        if [ "$code" = "200" ]; then
          log "健康检查通过：api 容器 healthy，edge 上 /api/health/ready 返回 200"
          return 0
        fi
        log "api 容器已 healthy，但经 edge 请求返回 $code（第 $attempt/$HEALTH_RETRIES 次）"
      else
        log "等待 api 容器健康：当前 $status（第 $attempt/$HEALTH_RETRIES 次）"
      fi
    else
      log "api 容器尚未创建（第 $attempt/$HEALTH_RETRIES 次）"
    fi
    attempt=$((attempt + 1))
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

# 部署末尾如实播报模型状态：ready 只代表进程与数据库可用，不代表聊天可用。
report_llm_status() {
  local bind domain body
  bind="$(env_value BIND_ADDRESS)"
  domain="$(env_value APP_DOMAIN)"
  body="$(curl -sk --noproxy '*' --max-time 10 -H "Host: $domain" "https://$bind/api/llm/status" || true)"
  case "$body" in
    '') log "模型状态：未取到 /api/llm/status 响应" ;;
    *未登录*) log "模型状态：该接口需登录后查看，部署脚本不持有账号；聊天是否可用请人工验证" ;;
    *) log "模型状态（仅供参考，不作为部署成功条件）：$body" ;;
  esac
}
