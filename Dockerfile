# syntax=docker/dockerfile:1.7
# AnchorRead — 多阶段构建，产物为 Next.js standalone server
# 构建：docker build -t anchorread .
# 运行：docker run -p 3000:3000 -e ANCHORREAD_API_KEY=xxx anchorread

FROM node:22-alpine AS deps
WORKDIR /app
# 关闭 corepack 首次下载 pnpm 的交互确认，避免非交互构建挂起
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# 项目使用 pnpm-lock.yaml（lockfileVersion 9.0），经 corepack 固定 pnpm 9.15.9 并按锁文件安装，保证构建依赖与本地一致
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* values are embedded into the browser bundle at build time.
# The deployment harness passes these from the persistent server environment.
ARG NEXT_PUBLIC_SENTRY_DSN=
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
ARG NEXT_PUBLIC_SENTRY_RELEASE=
ARG NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.2
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=${NEXT_PUBLIC_SENTRY_ENVIRONMENT}
ENV NEXT_PUBLIC_SENTRY_RELEASE=${NEXT_PUBLIC_SENTRY_RELEASE}
ENV NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=${NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE}
RUN --mount=type=secret,id=sentry_env,required=false \
  if [ -f /run/secrets/sentry_env ]; then \
    sentry_env_value() { key="$1"; awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); value=$0 } END { print value }' /run/secrets/sentry_env; }; \
    export SENTRY_AUTH_TOKEN="$(sentry_env_value SENTRY_AUTH_TOKEN)"; \
    export SENTRY_ORG="$(sentry_env_value SENTRY_ORG)"; \
    export SENTRY_PROJECT="$(sentry_env_value SENTRY_PROJECT)"; \
  fi; \
  pnpm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV ANCHORREAD_MCP_PAIRING_STORE_PATH=/data/diagram-mcp-pairings.json
ENV ANCHORREAD_MCP_OAUTH_STORE_PATH=/data/diagram-mcp-oauth.json
ENV ANCHORREAD_DIAGRAM_REMOTE_BRIDGE=true
ENV SENTRY_ENVIRONMENT=production
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
ENV SENTRY_TRACES_SAMPLE_RATE=0.2
ENV NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.2

# 以非 root 用户运行（node 镜像自带 node 用户）
RUN mkdir -p /data && chown node:node /data
COPY --from=builder /app/public ./public
COPY --from=builder /app/docs/openapi.yaml ./docs/openapi.yaml
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

USER node

EXPOSE 3000
CMD ["node", "server.js"]
