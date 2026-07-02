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

# ─── Stage 2: Prod deps ───
# 独立阶段只装 prod 依赖，避免 .pnpm store 保留 dev 依赖导致 runner 镜像膨胀。
# better-sqlite3 在此阶段重新编译 native binding（builder 的编译工具链不跨阶段）。
FROM node:24-slim AS prod-deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
# prisma schema 生成 client 时需要
COPY packages/db/prisma/schema.prisma packages/db/prisma/schema.prisma

# 只装 prod 依赖（不含 typescript/tsx/vite/@types/* 等 dev 依赖）
RUN pnpm install --prod --frozen-lockfile

# 注意：Prisma generated client（query engine binary）不在此阶段生成。
# prisma CLI 是 devDependency，--prod 不装；改为在 runner 阶段从 builder 复制已生成的
# .prisma/client 目录，避免 npx 绕过 lockfile 在线下载（离线/内网构建可用性 + 供应链完整性）。

# ─── Stage 3: Runtime ───
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
ENV API_PORT=2671
# 容器内必须绑 0.0.0.0 才能被宿主机端口映射访问。
# V1 不提供应用层接口鉴权；公网部署请通过反向代理或网络层 ACL 保护写操作 endpoint。
ENV API_HOST=0.0.0.0

# 从 prod-deps 复制整个 /app：
# - 根 node_modules（含 .pnpm store，实际依赖文件）
# - 各 workspace 包的 node_modules（符号链接，指向 .pnpm store）
# - package.json 们 + pnpm-workspace.yaml + schema.prisma
# pnpm workspace 的包依赖通过 packages/*/node_modules 符号链接解析，
# 只复制根 node_modules 会丢失这些链接，导致 ERR_MODULE_NOT_FOUND。
COPY --from=prod-deps /app .

# 从 builder 复制构建产物和运行时必需的资源（覆盖 prod-deps 的空目录）
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/uploads ./apps/api/uploads
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
# migrations 目录只在 builder 有（prod-deps 只复制了 schema.prisma）
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma
# Prisma generated client（query engine binary）：builder 阶段 pnpm db:generate 已生成。
# prod-deps 阶段不跑 prisma generate（prisma CLI 是 devDep），所以必须从 builder 复制。
# @prisma/client runtime 已由 prod-deps 的 pnpm install --prod 装好（在 dependencies）。
COPY --from=builder /app/packages/db/node_modules/.prisma ./packages/db/node_modules/.prisma
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/config/llm.example.yaml ./config/

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

EXPOSE 2671

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:2671/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

# 启动时自动应用 migration，然后启动 API
CMD ["sh", "-c", "node packages/db/dist/applyMigrations.js && node apps/api/dist/index.js"]
