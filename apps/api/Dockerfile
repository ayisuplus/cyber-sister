# syntax=docker/dockerfile:1.7
# Build context must be the repository root so workspace:* packages are available.
FROM node:24-alpine AS runtime

ENV NODE_ENV=production
# 产品只在中国区：「今天」「几点」统一按北京时间。不设时区时容器跑在 UTC，
# 北京时间凌晨 0–8 点她会以为还是昨天（工具里的「今天是」、关怀卡片、每周的信都受影响）。
ENV TZ=Asia/Shanghai
WORKDIR /workspace

# Prisma 需要 openssl 才能认出正确的引擎目标（linux-musl-openssl-3.0.x）。
# 缺它会误判成 1.1.x，运行时再去下载引擎——而运行用户对 node_modules 只读，必然失败。
RUN apk add --no-cache openssl ca-certificates tzdata
RUN corepack enable && corepack prepare pnpm@11.5.1 --activate


COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/llm-gateway/package.json packages/llm-gateway/package.json
COPY packages/schedule-logic/package.json packages/schedule-logic/package.json

RUN pnpm install --frozen-lockfile --prod --filter cyber-sister-server...

COPY --chown=node:node apps/api apps/api
COPY --chown=node:node deploy/runninghub/workflows.json deploy/runninghub/workflows.json
COPY --chown=node:node packages/llm-gateway packages/llm-gateway
COPY --chown=node:node packages/schedule-logic packages/schedule-logic

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

# 头像、背景与聊天图片写在 apps/api/data，部署时挂成持久卷（compose.yaml 的 api-data）。
# .dockerignore 排除了这个目录，镜像里本来没有：必须先建好并交给 node，
# 否则新卷挂上来是 root 所有，运行用户写不进去，上传会直接失败。
RUN mkdir -p /workspace/apps/api/data && chown node:node /workspace/apps/api/data

USER node
WORKDIR /workspace/apps/api
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 运行时不碰 pnpm：镜像里的 pnpm 由 corepack 提供，corepack 首次调用会联网拉取，
# 而 api / migration 容器只接 internal 网络（无外网），用 pnpm 启动必然失败。直接用 node 入口。
CMD ["node", "src/bootstrap.js"]
