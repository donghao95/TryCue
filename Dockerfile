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
# 直接复用 builder 整个目录（含 node_modules、已编译的 better-sqlite3 native binding、已生成的 Prisma client）
FROM node:24-slim AS runner

# 安装 openssl（Prisma query engine 依赖）+ ca-certificates（HTTPS 请求需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

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

# 从 builder 复制整个构建产物（含 node_modules、dist、prisma client、better-sqlite3 编译产物）
COPY --from=builder /app .

# 在 runner 环境重新生成 Prisma client（确保 query engine binary 匹配运行时 openssl 版本）
RUN cd packages/db && npx prisma generate --schema prisma/schema.prisma

# 拷贝默认配置模板（用户可通过 volume 覆盖）
RUN cp config/llm.example.yaml config/llm.local.yaml

# 数据目录（SQLite 数据库文件）
RUN mkdir -p /app/data /app/config /app/apps/api/uploads

# 创建 app 用户（固定 UID/GID=1001，方便 Linux host 端 chown bind-mounted 目录到匹配值）。
# V1：容器以 root 运行，以兼容 Windows Docker Desktop bind mount 的 uid 映射问题
# （app 用户对 host 挂载的 /app/data 文件只读，导致 SQLite "readonly database" 写入失败）。
# 后续可引入 entrypoint chown + gosu 降权到 app 用户，恢复非 root 运行。
RUN groupadd -r -g 1001 app && useradd -r -u 1001 -g app -d /app -s /sbin/nologin app && \
    chown -R app:app /app

# 注意：/app/config 不声明为 VOLUME。
# 用户通过 compose 或 docker run -v 显式挂载 config 目录。
# 声明 VOLUME 会触发 Docker 创建匿名 volume 覆盖镜像内默认配置。
VOLUME ["/app/data"]

EXPOSE 4000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:4000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

# 启动时自动应用 migration，然后启动 API
CMD ["sh", "-c", "node packages/db/dist/applyMigrations.js && node apps/api/dist/index.js"]
