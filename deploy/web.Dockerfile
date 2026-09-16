# syntax=docker/dockerfile:1.7
# 服务器上的 web 镜像：只把 CI 构建好的 dist 装进 nginx，镜像内不装 node、不跑 vite。
# 2 核 2G 的机器同时跑着 api 和 postgres，前端编译放在 GitHub 云端（CI 产物 web-dist）。
# 构建上下文是仓库根目录，且要求 apps/web/dist 已存在（CI 下载产物后再 build）。
FROM nginxinc/nginx-unprivileged:1.27.4-alpine AS production

COPY --chown=nginx:nginx apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
