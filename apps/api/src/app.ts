import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { setPrismaLogger } from "@trycue/db";
import { ok } from "@trycue/shared/api";
import { resolveWorkspacePath, type AppConfig } from "./config.js";
import { initLogger, log } from "./logger.js";
import { LlmConfigStore, shouldUseRealLlm } from "./llmConfigStore.js";
import { initSharedCapacityManager, getSharedCapacityManager } from "./llm/rateLimitedFetch.js";
import { LlmCapacityProbeManager } from "./llm/capacityProbeManager.js";
import { createAgentProvider } from "./agents/index.js";
import { AiTaskRunner, withAiTaskRunner } from "./agents/taskRunner.js";
import { Scheduler } from "./runtime/scheduler.js";
import { recoverReportGenerationRuns } from "./runtime/report.js";
import { RunService } from "./runtime/runService.js";
import { postInteractionRoutes } from "./routes/postInteractionRoutes.js";
import { assetRoutes } from "./routes/assetRoutes.js";
import { audienceRoutes } from "./routes/audienceRoutes.js";
import { liveEventRoutes } from "./routes/liveEventRoutes.js";
import { runRoutes } from "./routes/runRoutes.js";
import { settingsRoutes } from "./routes/settingsRoutes.js";

export async function buildApp(config: AppConfig) {
  const app = Fastify({ logger: config.appEnv === "test" ? false : { level: process.env.LOG_LEVEL ?? "info" }, disableRequestLogging: true });
  // Initialize the centralized logger with Fastify's pino instance
  initLogger(app.log as Parameters<typeof initLogger>[0]);
  setPrismaLogger({ warn: log.warn.bind(log), error: log.error.bind(log) });
  log.info({
    schedulerDefaultConcurrency: config.schedulerDefaultConcurrency
  }, "Runtime scheduling config loaded");
  const llmConfigStore = new LlmConfigStore(config.llmConfigPath);
  await llmConfigStore.load();
  initSharedCapacityManager(llmConfigStore.get().capacity);
  log.info({
    capacityMode: llmConfigStore.get().capacity.mode,
    capacityPreset: llmConfigStore.get().capacity.preset,
    effectiveRpm: getSharedCapacityManager().getStatus().effectiveRpm,
    effectiveConcurrency: getSharedCapacityManager().getStatus().effectiveConcurrency
  }, "LLM capacity manager initialized");
  const probeManager = new LlmCapacityProbeManager();
  const getLlmConfig = () => llmConfigStore.get();
  const aiTaskRunner = new AiTaskRunner(getLlmConfig, (record) => {
    if (record.ok) {
      app.log.info({ aiTask: record }, "AI task completed");
    } else {
      app.log.error({ aiTask: record }, "AI task failed");
    }
  });
  const getAgentProvider = () => withAiTaskRunner(createAgentProvider(getLlmConfig()), aiTaskRunner);
  const uploadDir = resolveWorkspacePath("apps/api/uploads");
  const scheduler = new Scheduler(config, getLlmConfig, getAgentProvider, aiTaskRunner, uploadDir);
  const runService = new RunService(config, getLlmConfig, getAgentProvider, scheduler, uploadDir);
  app.addHook("onClose", async () => {
    await runService.stop();
  });

  await app.register(cors, { origin: config.appUrl });
  // 安全头：CSP / X-Content-Type-Options / X-Frame-Options / HSTS 等。
  // contentSecurityPolicy 在 SERVE_WEB 模式下需要允许 inline script/style（Vite 构建产物），
  // 因此用 default-src 'self' + 'unsafe-inline' for scripts/styles。
  // 测试环境关闭 CSP 以免影响测试。
  await app.register(helmet, {
    contentSecurityPolicy: config.appEnv === "test" ? false : {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"]
      }
    },
    // 测试环境可能用 http，关闭 HSTS 强制
    hsts: config.appEnv === "test" ? false : undefined
  });
  // 速率限制：默认 100 req/分钟，高风险 endpoint 在各自路由内设置更严限制。
  // SSE endpoint（/events）通过 allowList 排除，避免长连接被限流。
  // 测试环境跳过注册以避免影响集成测试并发。
  if (config.appEnv !== "test") {
    await app.register(rateLimit, {
      max: 100,
      timeWindow: "1 minute",
      // allowList 返回 true 表示放行（不限流）：SSE、静态资源、健康检查
      // request.url 含 query string（如 /api/runs/x/events?liveOnly=true），需先剥离
      allowList: (request) => {
        const path = request.url.split("?")[0] ?? request.url;
        return (path.startsWith("/api/runs/") && path.endsWith("/events"))
          || path.startsWith("/uploads/")
          || path === "/health";
      }
    });
  }
  await app.register(multipart, {
    limits: { fileSize: config.maxCoverImageSizeMb * 1024 * 1024, files: 1 }
  });
  await mkdir(uploadDir, { recursive: true });

  // 生产模式：先注册前端 SPA 静态资源（需要 decorateReply: true 以便 notFoundHandler 调用 reply.sendFile）
  if (config.serveWeb) {
    const webDist = config.webDistPath;
    if (!existsSync(join(webDist, "index.html"))) {
      throw new Error(`SERVE_WEB=true but apps/web/dist/index.html not found at ${webDist}. Run "pnpm build" first.`);
    }
    // 先注册 webDist：decorateReply: true 装饰 reply.sendFile 绑定到 webDist
    // wildcard: true 注册 GET /* 路由，服务 /assets/* 等静态资源
    // Fastify find-my-way 按特异性匹配，/api/* 和 /uploads/* 比 /* 更具体，会优先匹配
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      wildcard: true
    });
    log.info({ webDist }, "Serving frontend SPA from API");
  }

  // 再注册 uploads：decorateReply: false 避免覆盖 webDist 的 reply.sendFile 装饰
  await app.register(fastifyStatic, {
    root: uploadDir,
    prefix: "/uploads/",
    decorateReply: false
  });

  // SPA fallback：未匹配的 GET 请求（非 /api、非 /uploads）返回 index.html
  // reply.sendFile 绑定到第一次注册的 webDist，路径正确
  if (config.serveWeb) {
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== "GET" || request.url.startsWith("/api") || request.url.startsWith("/uploads")) {
        reply.code(404).send({ error: "Not found" });
        return;
      }
      reply.sendFile("index.html");
    });
  }

  // ── Request logging ──
  app.addHook("onResponse", (request, reply, done) => {
    const { method, url } = request;
    const statusCode = reply.statusCode;
    const elapsed = Math.round(reply.elapsedTime);
    if (statusCode >= 500) {
      log.error({ method, url, statusCode, elapsed }, "request completed");
    } else if (statusCode >= 400) {
      log.warn({ method, url, statusCode, elapsed }, "request completed");
    } else {
      log.info({ method, url, statusCode, elapsed }, "request completed");
    }
    done();
  });

  app.get("/health", async () => ok({ status: "ok" }));

  // ── Write-operation auth (optional token) ──
  // 当 config.apiAuthToken 设置时，所有写操作必须带 X-TryCue-Token 头匹配。
  // 放行的读路径：GET /health（健康检查）、GET /uploads/*（静态资源）、
  // GET /api/runs/:runId/events（SSE — EventSource API 不支持自定义 header）。
  // 未设置 token 时跳过鉴权，依赖 host=127.0.0.1 的网络层约束。
  if (config.apiAuthToken) {
    const expectedToken = config.apiAuthToken;
    app.addHook("onRequest", async (request, reply) => {
      const path = request.url.split("?")[0] ?? request.url;
      // 健康检查、静态资源、SSE 读路径放行
      if (path === "/health"
        || path.startsWith("/uploads/")
        || (path.startsWith("/api/runs/") && path.endsWith("/events"))) return;
      const provided = request.headers["x-trycue-token"];
      const providedStr = Array.isArray(provided) ? provided[0] : provided;
      // 用恒定时间比较防止 timing attack
      if (!providedStr || !safeEqual(providedStr, expectedToken)) {
        reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "缺少或无效的 X-TryCue-Token" } });
        return reply;
      }
    });
  }

  // ── Business routes (registered as plugins) ──
  // Each route module owns its handlers and helpers; app.ts only assembles.
  await app.register(settingsRoutes({ llmConfigStore, probeManager }));
  await app.register(assetRoutes({ uploadDir, maxCoverImageSizeMb: config.maxCoverImageSizeMb }));
  await app.register(liveEventRoutes({ sseHeartbeatIntervalSeconds: config.sseHeartbeatIntervalSeconds }));
  await app.register(runRoutes({ runService, getLlmConfig, aiTaskRunner, uploadDir }));
  await app.register(audienceRoutes({ runService }));
  await app.register(postInteractionRoutes);

  log.info("Starting startup recovery...");
  const startupLlmConfig = getLlmConfig();
  await recoverReportGenerationRuns(
    startupLlmConfig.models.pro ?? "mock-report-generator",
    shouldUseRealLlm(startupLlmConfig),
    startupLlmConfig.apiKey,
    startupLlmConfig.baseUrl,
    { aiTaskRunner, uploadDir }
  );
  await runService.recoverAudienceGenerationJobs();
  log.info("Startup recovery complete");
  app.decorate("scheduler", scheduler);
  return app;
}

/**
 * 恒定时间字符串比较，防止 timing attack 泄露 token 信息。
 * 使用 node:crypto 的 native 实现，避免自实现被 JIT 优化的风险。
 * 长度不同时立即返回 false（token 长度对随机生成的字符串不是敏感信息）。
 */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
