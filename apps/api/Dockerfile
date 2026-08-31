# syntax=docker/dockerfile:1.7
# Build context must be the repository root so workspace:* packages are available.
FROM node:20.19-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.5.1 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/llm-gateway/package.json packages/llm-gateway/package.json
COPY packages/makeup-skill/package.json packages/makeup-skill/package.json

RUN pnpm install --frozen-lockfile --prod --filter cyber-sister-server...

COPY --chown=node:node apps/api apps/api
COPY --chown=node:node packages/llm-gateway packages/llm-gateway

RUN pnpm --filter cyber-sister-server exec prisma generate --schema src/prisma/schema.prisma

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "--filter", "cyber-sister-server", "start"]
