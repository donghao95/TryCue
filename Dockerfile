# syntax=docker/dockerfile:1.7

# ─── Stage 1: Builder ───
# 装全部依赖、生成 Prisma client、构建 api + web
FROM node:24-slim AS builder

# better-sqlite3 编译需要 python3 + make + g++
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# 启用 corepack 以使用 pnpm
RUN corepack enable

WORKDIR /app

# 先拷依赖清单，利用 docker 缓存
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile

# 拷源码
COPY . .

# 生成 Prisma client + 构建所有包
RUN pnpm db:generate
RUN pnpm build

# ─── Stage 2: Runtime ───
# 只保留生产依赖 + 构建产物，镜像更小
FROM node:24-slim AS runner

# better-sqlite3 运行时仍需要 native binding，runner 阶段重新安装生产依赖以编译 binding
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app

ENV NODE_ENV=production
ENV DATABASE_URL=file:/app/data/trycue.db
ENV LLM_CONFIG_PATH=/app/config/llm.local.yaml
ENV SERVE_WEB=true
ENV WEB_DIST_PATH=/app/apps/web/dist
ENV ENABLE_SCHEDULER=true
ENV ENABLE_REPORT_GENERATION=true
ENV LOG_LEVEL=info
ENV API_PORT=4000

# 拷贝依赖清单 + workspace 配置
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/web/package.json ./apps/web/
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/shared/package.json ./packages/shared/

# 安装生产依赖（重新编译 better-sqlite3 native binding）
RUN pnpm install --frozen-lockfile --prod

# 拷贝构建产物
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# 拷贝 Prisma schema + migrations（运行时迁移需要）
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma

# 拷贝默认配置模板（用户可通过 volume 覆盖）
COPY --from=builder /app/config/llm.example.yaml ./config/llm.local.yaml

# 数据目录（SQLite 数据库文件）
RUN mkdir -p /app/data /app/config /app/apps/api/uploads

# 非 root 用户运行容器，减少攻击面
RUN groupadd -r app && useradd -r -g app -d /app -s /sbin/nologin app && \
    chown -R app:app /app/data /app/config /app/apps/api/uploads
USER app

VOLUME ["/app/data", "/app/config"]

EXPOSE 4000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:4000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

# 启动时自动应用 migration，然后启动 API
CMD ["sh", "-c", "node packages/db/dist/applyMigrations.js && node apps/api/dist/index.js"]
