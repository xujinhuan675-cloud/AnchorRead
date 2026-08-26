# AnchorRead — 多阶段构建，产物为 Next.js standalone server
# 构建：docker build -t anchorread .
# 运行：docker run -p 3000:3000 -e ANCHORREAD_API_KEY=xxx anchorread

FROM node:22-alpine AS deps
WORKDIR /app
# 关闭 corepack 首次下载 pnpm 的交互确认，避免非交互构建挂起
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# 项目使用 pnpm-lock.yaml（lockfileVersion 9.0），经 corepack 固定 pnpm 9 并按锁文件安装，保证构建依赖与本地一致
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV ANCHORREAD_MCP_PAIRING_STORE_PATH=/data/diagram-mcp-pairings.json
ENV ANCHORREAD_DIAGRAM_REMOTE_BRIDGE=true

# 以非 root 用户运行（node 镜像自带 node 用户）
RUN mkdir -p /data && chown node:node /data
COPY --from=builder /app/public ./public
COPY --from=builder /app/docs/openapi.yaml ./docs/openapi.yaml
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

USER node

EXPOSE 3000
CMD ["node", "server.js"]
