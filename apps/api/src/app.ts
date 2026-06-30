import { mkdir } from "node:fs/promises";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
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

  await app.register(cors, { origin: config.appUrl });
  await app.register(multipart, {
    limits: { fileSize: config.maxCoverImageSizeMb * 1024 * 1024, files: 1 }
  });
  await mkdir(uploadDir, { recursive: true });
  await app.register(fastifyStatic, {
    root: uploadDir,
    prefix: "/uploads/"
  });

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
