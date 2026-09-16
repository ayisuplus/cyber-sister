# ⚠️ 已被取代（2026-09-16）：改用 apps/api/Dockerfile（node:24-alpine）配合 compose.yaml。
# 保留至首次全栈部署验收通过，届时与 deploy/compose.chat.yaml 一并删除。
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.5.1 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/llm-gateway/package.json packages/llm-gateway/package.json
RUN pnpm install --frozen-lockfile --prod --filter cyber-sister-server...
COPY --chown=node:node apps/api/src apps/api/src
COPY --chown=node:node packages/llm-gateway packages/llm-gateway
COPY --chown=node:node deploy/runninghub/workflows.json deploy/runninghub/workflows.json
RUN pnpm --filter cyber-sister-server exec prisma generate --schema src/prisma/schema.prisma
RUN mkdir -p /workspace/apps/api/data && chown node:node /workspace/apps/api/data
USER node
WORKDIR /workspace/apps/api
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/bootstrap.js"]
