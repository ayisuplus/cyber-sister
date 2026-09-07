# syntax=docker/dockerfile:1.7
# Build context must be the repository root.
FROM node:20.19-alpine AS builder

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.5.1 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/llm-gateway/package.json packages/llm-gateway/package.json
RUN pnpm install --frozen-lockfile --filter cyber-sister-client...

COPY packages/design-tokens packages/design-tokens
COPY apps/web apps/web
RUN pnpm --filter cyber-sister-client build

FROM nginxinc/nginx-unprivileged:1.27.4-alpine AS production

COPY --from=builder --chown=nginx:nginx /workspace/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
