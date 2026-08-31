# syntax=docker/dockerfile:1.7
# Build context must be the repository root. Controlled model assets are staged
# in packages/makeup-skill/.assets and verified before they enter the image.
FROM node:20.19-alpine AS builder

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.5.1 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/llm-gateway/package.json packages/llm-gateway/package.json
COPY packages/makeup-skill/package.json packages/makeup-skill/package.json
RUN pnpm install --frozen-lockfile --filter ai-makeup-tutor...

COPY packages/design-tokens packages/design-tokens
COPY packages/makeup-skill packages/makeup-skill
RUN pnpm --filter ai-makeup-tutor build

FROM node:20.19-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.5.1 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/llm-gateway/package.json packages/llm-gateway/package.json
COPY packages/makeup-skill/package.json packages/makeup-skill/package.json
RUN pnpm install --frozen-lockfile --prod --filter ai-makeup-tutor...

COPY --from=builder --chown=node:node /workspace/packages/makeup-skill/dist packages/makeup-skill/dist
COPY --from=builder --chown=node:node /workspace/packages/makeup-skill/public packages/makeup-skill/public
COPY --from=builder --chown=node:node /workspace/packages/makeup-skill/src/shared/data packages/makeup-skill/src/shared/data

WORKDIR /workspace/packages/makeup-skill
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
