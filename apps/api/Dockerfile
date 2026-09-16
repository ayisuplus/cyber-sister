# syntax=docker/dockerfile:1.7
# Build context must be the repository root so workspace:* packages are available.
FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /workspace

# Prisma 需要 openssl 才能认出正确的引擎目标（linux-musl-openssl-3.0.x）。
# 缺它会误判成 1.1.x，运行时再去下载引擎——而运行用户对 node_modules 只读，必然失败。
RUN apk add --no-cache openssl ca-certificates
RUN corepack enable && corepack prepare pnpm@11.5.1 --activate


COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/llm-gateway/package.json packages/llm-gateway/package.json

RUN pnpm install --frozen-lockfile --prod --filter cyber-sister-server...

COPY --chown=node:node apps/api apps/api
COPY --chown=node:node deploy/runninghub/workflows.json deploy/runninghub/workflows.json
COPY --chown=node:node packages/llm-gateway packages/llm-gateway

RUN pnpm --filter cyber-sister-server exec prisma generate --schema src/prisma/schema.prisma

# 引擎固化到稳定路径并显式指给 Prisma：
# 迁移容器只接 internal 网络，而 prisma CLI 默认会在启动时校验/补下载引擎
# （它自带目录里没有 schema-engine，也没有 .sha256），离线环境必然失败。
# 指定了这两个变量后就直接用镜像内的二进制，不再触发任何下载或写入。
RUN mkdir -p /opt/prisma-engines \
  && cp /workspace/node_modules/.pnpm/@prisma+engines@*/node_modules/@prisma/engines/schema-engine-* /opt/prisma-engines/schema-engine \
  && cp /workspace/node_modules/.pnpm/@prisma+engines@*/node_modules/@prisma/engines/libquery_engine-*.so.node /opt/prisma-engines/libquery_engine.so.node \
  && chmod 0555 /opt/prisma-engines/*
ENV PRISMA_SCHEMA_ENGINE_BINARY=/opt/prisma-engines/schema-engine \
    PRISMA_QUERY_ENGINE_LIBRARY=/opt/prisma-engines/libquery_engine.so.node

USER node
WORKDIR /workspace/apps/api
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 运行时不碰 pnpm：镜像里的 pnpm 由 corepack 提供，corepack 首次调用会联网拉取，
# 而 api / migration 容器只接 internal 网络（无外网），用 pnpm 启动必然失败。直接用 node 入口。
CMD ["node", "src/bootstrap.js"]
