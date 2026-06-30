import { createWriteStream } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { imageSize } from "image-size";
import { prisma, setPrismaLogger } from "@trycue/db";
import {
  ApplyRecommendedRequestSchema,
  ListModelsRequestSchema,
  LlmCapacityProbeRequestSchema,
  LlmSettingsRequestSchema
} from "@trycue/shared/llm";
import {
  CreateRunRequestSchema,
  RetryRunRequestSchema,
  StartRunRequestSchema
} from "@trycue/shared/run";
import {
  CreateAudienceProfileRequestSchema,
  CreateAudienceSamplingDirectiveRequestSchema,
  CreateAudienceSamplingPlanRequestSchema,
  CreateAudienceSamplingPlanRevisionSuggestionRequestSchema,
  CreateAudienceSeatRevisionSuggestionRequestSchema,
  FavoriteAudienceIdentityRequestSchema,
  RetryAudienceIdentitiesRequestSchema,
  UpdateAudienceIdentityRequestSchema,
  UpdateAudienceSamplingDirectiveRequestSchema,
  UpdateAudienceSamplingPlanRequestSchema
} from "@trycue/shared/audience";
import { fail, ok } from "@trycue/shared/api";
import { resolveWorkspacePath, type AppConfig } from "./config.js";
import { sendApiError, ApiError } from "./errors.js";
import { log, initLogger } from "./logger.js";
import { LlmConfigStore, LlmConfigValidationError, shouldUseRealLlm } from "./llmConfigStore.js";
import { initSharedCapacityManager, getSharedCapacityManager, updateSharedCapacityManager } from "./llm/rateLimitedFetch.js";
import { LlmCapacityProbeManager, ProbeAlreadyRunningError } from "./llm/capacityProbeManager.js";
import { encodeSse, getLatestLiveEventSequence, listLiveEvents, onRunLiveEvent } from "./liveEvents.js";
import { createAgentProvider } from "./agents/index.js";
import { AiTaskRunner, withAiTaskRunner } from "./agents/taskRunner.js";
import { Scheduler } from "./runtime/scheduler.js";
import { generateReportAndCompleteRun, recoverReportGenerationRuns } from "./runtime/report.js";
import { RunService } from "./runtime/runService.js";
import { requireSingleContentVersion } from "./runtime/contentVersions.js";
import { postInteractionRoutes } from "./routes/postInteractionRoutes.js";
import { getRunId, parsePageQuery } from "./routes/routeHelpers.js";
import {
  audienceDetailView,
  buildAudienceSeatsView,
  insightView,
  logView,
  reportView,
  runOverviewView
} from "./views.js";

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

  app.get("/api/settings/llm", async () => ok(llmConfigStore.view()));

  app.put("/api/settings/llm", async (request, reply) => {
    try {
      const parsed = LlmSettingsRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      const view = await llmConfigStore.save(parsed.data);
      updateSharedCapacityManager(llmConfigStore.get().capacity);
      return ok(view);
    } catch (error) {
      if (error instanceof LlmConfigValidationError) {
        return sendApiError(reply, new ApiError("VALIDATION_ERROR", error.message, 400));
      }
      return sendApiError(reply, error);
    }
  });

  app.get("/api/settings/llm/capacity/status", async () => {
    return ok(getSharedCapacityManager().getStatus());
  });

  app.post("/api/settings/llm/capacity/probe", async (request, reply) => {
    try {
      const parsed = LlmCapacityProbeRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      const current = llmConfigStore.get();
      const apiKey = parsed.data.apiKey || current.apiKey;
      const baseUrl = parsed.data.baseUrl || current.baseUrl;
      if (!baseUrl) throw new ApiError("VALIDATION_ERROR", "需要先填写 API base URL 才能校准", 400);
      if (!apiKey) throw new ApiError("VALIDATION_ERROR", "需要先填写 API key 才能校准", 400);
      const model = parsed.data.model || current.models.pro || current.models.fast;
      if (!model) throw new ApiError("VALIDATION_ERROR", "需要先选择模型才能校准", 400);
      const startView = probeManager.start({
        apiKey,
        baseUrl,
        model,
        request: {
          mode: parsed.data.mode,
          maxRpm: parsed.data.maxRpm,
          maxConcurrency: parsed.data.maxConcurrency
        },
        hardMaxRpm: current.capacity.shared.hardMaxRpm,
        hardMaxConcurrency: current.capacity.shared.hardMaxConcurrency
      });
      return ok(startView);
    } catch (error) {
      if (error instanceof ProbeAlreadyRunningError) {
        return sendApiError(reply, new ApiError("PROBE_ALREADY_RUNNING", "已有校准任务正在运行", 409, { jobId: error.jobId }));
      }
      return sendApiError(reply, error);
    }
  });

  app.get("/api/settings/llm/capacity/probe/:jobId", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = probeManager.get(jobId);
    if (!job) return sendApiError(reply, new ApiError("NOT_FOUND", "校准任务不存在", 404));
    return ok(job);
  });

  app.post("/api/settings/llm/capacity/probe/:jobId/cancel", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = probeManager.cancel(jobId);
    if (!job) return sendApiError(reply, new ApiError("NOT_FOUND", "校准任务不存在", 404));
    return ok(job);
  });

  app.post("/api/settings/llm/capacity/reset-learning", async () => {
    getSharedCapacityManager().resetLearning();
    return ok(getSharedCapacityManager().getStatus());
  });

  app.post("/api/settings/llm/capacity/apply-recommended", async (request, reply) => {
    try {
      const parsed = ApplyRecommendedRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "需要提供正整数 recommendedRpm 和 recommendedConcurrency", 400, parsed.error.flatten());
      const recommendedRpm = parsed.data.recommendedRpm ?? parsed.data.maxRpm!;
      const recommendedConcurrency = parsed.data.recommendedConcurrency ?? parsed.data.maxConcurrency!;
      getSharedCapacityManager().applyRecommendedValues(recommendedRpm, recommendedConcurrency, {
        rpm: parsed.data.testedMaxRpm,
        concurrency: parsed.data.testedMaxConcurrency
      });
      const updatedCapacity = getSharedCapacityManager().getSettings();
      const current = llmConfigStore.get();
      const view = await llmConfigStore.save({
        provider: current.provider,
        runtimeMode: current.runtimeMode,
        clearApiKey: false,
        baseUrl: current.baseUrl ?? "",
        models: current.models,
        capacity: updatedCapacity
      });
      return ok(view);
    } catch (error) {
      if (error instanceof LlmConfigValidationError) {
        return sendApiError(reply, new ApiError("VALIDATION_ERROR", error.message, 400));
      }
      return sendApiError(reply, error);
    }
  });

  app.post("/api/settings/llm/models", async (request, reply) => {
    try {
      const parsed = ListModelsRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      const current = llmConfigStore.get();
      const apiKey = parsed.data.apiKey || current.apiKey;
      const baseUrl = parsed.data.baseUrl || current.baseUrl;
      if (!baseUrl) throw new ApiError("VALIDATION_ERROR", "需要先填写 API base URL 才能获取模型列表", 400);
      if (!apiKey) throw new ApiError("VALIDATION_ERROR", "需要先填写 API key 才能获取模型列表", 400);
      const models = await fetchOpenAICompatibleModels({
        apiKey,
        baseUrl
      });
      return ok({ models });
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.post("/api/upload", async (request, reply) => {
    try {
      const file = await request.file();
      if (!file) throw new ApiError("VALIDATION_ERROR", "文件缺失", 400);
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
        throw new ApiError("VALIDATION_ERROR", "仅支持 jpg/png/webp", 400);
      }
      const ext = mimeToExt(file.mimetype);
      const assetId = `asset_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const filename = `${assetId}${ext}`;
      const target = join(uploadDir, filename);
      await pipeline(file.file, createWriteStream(target));
      if (isMultipartFileStreamTruncated(file.file)) {
        await unlink(target).catch((err) => log.debug({ err, path: target }, "Failed to unlink truncated upload"));
        throw new ApiError("VALIDATION_ERROR", `图片不能超过 ${config.maxCoverImageSizeMb}MB`, 400);
      }
      const fileBytes = await readFile(target);
      const dimensions = imageSize(fileBytes);
      if ((dimensions.width && dimensions.width > 4096) || (dimensions.height && dimensions.height > 4096)) {
        await unlink(target).catch((err) => log.debug({ err, path: target }, "Failed to unlink oversized upload"));
        throw new ApiError("VALIDATION_ERROR", "图片尺寸过大，请压缩到最长边 4096px 以内", 400);
      }
      const url = `/uploads/${filename}`;
      const asset = await prisma.asset.create({
        data: {
          storage: "local",
          url,
          storageKey: filename,
          originalName: file.filename,
          mimeType: file.mimetype,
          width: dimensions.width,
          height: dimensions.height,
          sizeBytes: fileBytes.byteLength
        }
      });
      return ok({
        url,
        assetId: asset.id,
        width: dimensions.width,
        height: dimensions.height,
        mimeType: file.mimetype
      });
    } catch (error) {
      if (isMultipartFileTooLarge(error)) {
        return sendApiError(reply, new ApiError("VALIDATION_ERROR", `图片不能超过 ${config.maxCoverImageSizeMb}MB`, 400));
      }
      return sendApiError(reply, error);
    }
  });

  app.post("/api/runs", async (request, reply) => {
    try {
      const parsed = CreateRunRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return ok(await runService.createRun(parsed.data));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.get("/api/runs", async (request, reply) => {
    try {
      return ok(await runService.listRuns(parsePageQuery(request.query, 20)));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.post("/api/runs/:runId/start", async (request, reply) => {
    try {
      const parsed = StartRunRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      const runId = getRunId(request.params);
      return ok(await runService.startRun(runId, parsed.data));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.get("/api/runs/:runId", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const run = await prisma.testRun.findUnique({ where: { id: runId } });
      if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
      const contentVersion = await requireSingleContentVersion(prisma, runId);
      const [journeys, postState] = await Promise.all([
        prisma.agentJourney.findMany({ where: { runId } }),
        prisma.simulatedPostState.findUnique({ where: { contentVersionId: contentVersion.id } })
      ]);
      let audienceProgress: { total: number; generated: number; ready: number } | undefined;
      if (["planning_audience", "generating_audience", "audience_ready"].includes(run.status)) {
        const [total, ready] = await Promise.all([
          prisma.audienceProfile.count({ where: { runId } }),
          prisma.audienceProfile.count({ where: { runId, identityStatus: "identity_ready" } })
        ]);
        audienceProgress = { total: total || run.audienceCount, generated: ready, ready };
      }
      const latestLiveEventSequence = await getLatestLiveEventSequence(runId);
      return ok(runOverviewView({ run, contentVersion, journeys, postState, audienceProgress, latestLiveEventSequence }));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.delete("/api/runs/:runId", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      return ok(await runService.deleteRun(runId));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.post("/api/runs/:runId/reset-runtime", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      return ok(await runService.resetRuntime(runId));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.get("/api/runs/:runId/events", async (request, reply) => {
    const runId = getRunId(request.params);
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) {
      return reply.status(404).send(fail("RUN_NOT_FOUND", "试映任务不存在"));
    }
    const lastEventId = request.headers["last-event-id"];
    const query = request.query as { after?: unknown; liveOnly?: unknown };
    const queryAfter = query.after;
    // `liveOnly=true` skips the *initial* historical replay when no cursor is
    // provided — used by subscribers that only need real-time updates (e.g. the
    // report page's `useReportEvents` hook, which loads current state via REST
    // on mount and only cares about future regenerations).
    // However, on browser-driven reconnects EventSource re-sends `Last-Event-ID`,
    // and the client may also pass `?after=`. In those cases we DO replay
    // missed durable events from that cursor forward — otherwise events
    // produced during the disconnect (e.g. a `report.regenerated`) would be
    // permanently lost. So `liveOnly` only suppresses the no-cursor initial
    // replay; it never suppresses cursor-driven replay.
    const liveOnly = typeof query.liveOnly === "string" && query.liveOnly === "true";
    const afterSequence = Array.isArray(lastEventId)
      ? lastEventId[0] || (typeof queryAfter === "string" ? queryAfter : undefined)
      : lastEventId || (typeof queryAfter === "string" ? queryAfter : undefined);
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    const shouldReplay = !liveOnly || afterSequence !== undefined;
    if (shouldReplay) {
      for (const event of await listLiveEvents(runId, afterSequence)) {
        reply.raw.write(encodeSse(event));
      }
    }
    let destroyed = false;
    const safeWrite = (data: string) => {
      if (destroyed) return;
      try { reply.raw.write(data); } catch { /* stream already closed */ }
    };
    const off = onRunLiveEvent(runId, (event) => safeWrite(encodeSse(event)));
    const heartbeat = setInterval(() => {
      safeWrite(`event: heartbeat\ndata: ${JSON.stringify({ now: new Date().toISOString() })}\n\n`);
    }, config.sseHeartbeatIntervalSeconds * 1000);
    request.raw.on("close", () => {
      destroyed = true;
      clearInterval(heartbeat);
      off();
      reply.raw.end();
    });
  });

  await app.register(postInteractionRoutes);

  app.get("/api/runs/:runId/logs", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const content = await requireSingleContentVersion(prisma, runId);
      const { limit, cursor } = parsePageQuery(request.query, 100);
      const logs = await prisma.actionLog.findMany({
        where: { runId, contentVersionId: content.id },
        orderBy: [{ simulatedTime: "asc" }, { createdAt: "asc" }],
        skip: cursor,
        take: limit
      });
      const audiences = await prisma.runParticipant.findMany({ where: { runId } });
      const audienceById = new Map(audiences.map((audience) => [audience.id, audience]));
      return ok({
        logs: logs.map((log) => ({ ...logView(log, log.participantId ? audienceById.get(log.participantId) : undefined), logType: "action" })),
        nextCursor: logs.length === limit ? String(cursor + logs.length) : null
      });
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.get("/api/runs/:runId/insights", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const content = await requireSingleContentVersion(prisma, runId);
      const insights = await prisma.insight.findMany({
        where: { contentVersionId: content.id },
        orderBy: [{ simulatedTime: "asc" }, { createdAt: "asc" }]
      });
      return ok({ insights: insights.map(insightView) });
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.get("/api/runs/:runId/report", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const report = await prisma.report.findFirst({ where: { runId } });
      if (!report) throw new ApiError("REPORT_NOT_READY", "试映报告尚未生成", 409);
      return ok(reportView(report));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.post("/api/runs/:runId/report", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const regenerate = (request.query as { regenerate?: string }).regenerate === "true";
      const existing = await prisma.report.findFirst({ where: { runId } });
      // Without ?regenerate=true, an existing report is returned as-is (idempotent GET-like behavior).
      if (existing && !regenerate) return ok(reportView(existing));
      const run = await prisma.testRun.findUnique({ where: { id: runId } });
      if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
      // First-time generation requires paused status; regeneration requires completed or paused.
      if (!regenerate) {
        if (run.status !== "paused") {
          throw new ApiError("INVALID_RUN_STATUS", "只有已暂停且尚无报告的试映可以结束并生成报告", 409);
        }
      } else {
        if (run.status !== "completed" && run.status !== "paused") {
          throw new ApiError("INVALID_RUN_STATUS", "只有已完成或已暂停的试映可以重新生成报告", 409);
        }
      }
      const llmConfig = getLlmConfig();
      await generateReportAndCompleteRun(
        runId,
        llmConfig.models.pro,
        shouldUseRealLlm(llmConfig),
        llmConfig.apiKey,
        llmConfig.baseUrl,
        { allowPaused: true, aiTaskRunner, uploadDir, regenerate }
      );
      const report = await prisma.report.findFirst({ where: { runId } });
      if (!report) throw new ApiError("REPORT_NOT_READY", "试映报告尚未生成", 409);
      return ok(reportView(report));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.post("/api/runs/:runId/retry", async (request, reply) => {
    try {
      const parsed = RetryRunRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return ok(await runService.retryRun(getRunId(request.params), parsed.data));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.get("/api/runs/:runId/audience-seats", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const run = await prisma.testRun.findUnique({ where: { id: runId } });
      if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
      const content = await requireSingleContentVersion(prisma, runId);
      const [audiences, journeys, interactions, logs] = await Promise.all([
        prisma.runParticipant.findMany({ where: { runId } }),
        prisma.agentJourney.findMany({ where: { runId } }),
        prisma.socialInteractionEvent.findMany({
          where: { contentVersionId: content.id },
          orderBy: [{ simulatedTime: "asc" }, { createdAt: "asc" }]
        }),
        prisma.actionLog.findMany({
          where: { runId, contentVersionId: content.id },
          orderBy: [{ simulatedTime: "asc" }, { createdAt: "asc" }]
        })
      ]);
      const riskLogs = logs.filter((log) => hasDoubtRisk(log.riskTagsJson));
      const latestLogByAudience = new Map<string, { participantId: string; logText: string; simulatedTime: number }>();
      for (const log of logs) {
        if (!log.participantId) continue;
        latestLogByAudience.set(log.participantId, {
          participantId: log.participantId,
          logText: log.logText,
          simulatedTime: log.simulatedTime
        });
      }
      const seats = buildAudienceSeatsView({
          audiences,
          journeys,
          interactions,
          riskLogs,
          lastLogs: [...latestLogByAudience.values()]
        });
      return ok({
        audienceRevision: run.audienceRevision,
        seats,
        summary: {
          total: seats.length,
          activeCount: seats.filter((seat) => !["not_started", "finished", "failed", "skipped", "risk_exit"].includes(seat.status)).length,
          commentedCount: seats.filter((seat) => seat.hasCommented).length,
          favoritedCount: seats.filter((seat) => seat.hasFavorited).length,
          skippedCount: seats.filter((seat) => seat.hasSkipped).length,
          doubtCount: seats.filter((seat) => seat.hasDoubt).length,
          riskExitCount: seats.filter((seat) => seat.status === "risk_exit").length,
          finishedCount: seats.filter((seat) => seat.status === "finished").length
        }
      });
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.get("/api/runs/:runId/participants/:participantId", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const participantId = (request.params as { participantId?: string }).participantId;
      if (!participantId) throw new ApiError("VALIDATION_ERROR", "观众 ID 缺失", 400);
      const audience = await prisma.runParticipant.findUnique({ where: { id: participantId } });
      if (!audience || audience.runId !== runId) throw new ApiError("AUDIENCE_NOT_FOUND", "观众不存在", 404);
      const content = await requireSingleContentVersion(prisma, runId);
      const [journey, timeline, interactions, comments, toolCalls] = await Promise.all([
        prisma.agentJourney.findFirst({ where: { runId, participantId } }),
        prisma.actionLog.findMany({ where: { runId, contentVersionId: content.id, participantId }, orderBy: { simulatedTime: "asc" } }),
        prisma.socialInteractionEvent.findMany({ where: { contentVersionId: content.id, participantId }, orderBy: { simulatedTime: "asc" } }),
        prisma.simulatedComment.findMany({ where: { contentVersionId: content.id, participantId }, orderBy: { simulatedTime: "asc" } }),
        prisma.agentToolCall.findMany({
          where: { runId, participantId, toolName: { in: ["exit_browsing", "write_comment"] } },
          select: { toolName: true, input: true, output: true },
          orderBy: { simulatedTime: "asc" }
        })
      ]);
      return ok(audienceDetailView({ audience, journey: journey ?? undefined, timeline, interactions, comments, toolCalls }));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  // ── Audience generation endpoints ──

  app.post("/api/runs/:runId/audience-sampling-plan", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const parsed = CreateAudienceSamplingPlanRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return ok(await runService.createAudienceSamplingPlan(runId, parsed.data));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.get("/api/runs/:runId/audience-sampling-plan", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      return ok(await runService.getAudienceSamplingPlan(runId));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.patch("/api/runs/:runId/audience-sampling-plan", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const parsed = UpdateAudienceSamplingPlanRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return ok(await runService.updateAudienceSamplingPlan(runId, parsed.data));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.post("/api/runs/:runId/audience-sampling-plan/revision-suggestions", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const parsed = CreateAudienceSamplingPlanRevisionSuggestionRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return ok(await runService.suggestAudienceSamplingPlanRevision(runId, parsed.data));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.post("/api/runs/:runId/audience-sampling-plan/directives", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const parsed = CreateAudienceSamplingDirectiveRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return ok(await runService.createAudienceSamplingDirective(runId, parsed.data));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.patch("/api/runs/:runId/audience-sampling-plan/directives/:directiveId", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const directiveId = (request.params as { directiveId?: string }).directiveId;
      if (!directiveId) throw new ApiError("VALIDATION_ERROR", "人群计划项 ID 缺失", 400);
      const parsed = UpdateAudienceSamplingDirectiveRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return ok(await runService.updateAudienceSamplingDirective(runId, directiveId, parsed.data));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.delete("/api/runs/:runId/audience-sampling-plan/directives/:directiveId", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const directiveId = (request.params as { directiveId?: string }).directiveId;
      if (!directiveId) throw new ApiError("VALIDATION_ERROR", "人群计划项 ID 缺失", 400);
      return ok(await runService.deleteAudienceSamplingDirective(runId, directiveId));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.post("/api/runs/:runId/audience-sampling-plan/directives/:directiveId/retry-expansion", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const directiveId = (request.params as { directiveId?: string }).directiveId;
      if (!directiveId) throw new ApiError("VALIDATION_ERROR", "人群计划项 ID 缺失", 400);
      return ok(await runService.retryAudienceDirectiveExpansion(runId, directiveId));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.post("/api/runs/:runId/audience-sampling-plan/confirm", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      return ok(await runService.confirmAudienceSamplingPlan(runId));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.post("/api/runs/:runId/audience-sampling-plan/clear-audience", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      return ok(await runService.clearGeneratedAudience(runId));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.get("/api/runs/:runId/audience-generation", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      return ok(await runService.getAudienceGeneration(runId));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.post("/api/runs/:runId/audience-generation/retry-identities", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const parsed = RetryAudienceIdentitiesRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return ok(await runService.retryAudienceIdentities(runId, parsed.data));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.post("/api/runs/:runId/audience-profiles/revision-suggestions", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const parsed = CreateAudienceSeatRevisionSuggestionRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return ok(await runService.suggestAudienceSeatRevision(runId, parsed.data));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.post("/api/runs/:runId/audience-profiles", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const parsed = CreateAudienceProfileRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return ok(await runService.createAudienceProfile(runId, parsed.data));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.patch("/api/runs/:runId/audience-profiles/:profileId/identity", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const profileId = (request.params as { profileId?: string }).profileId;
      if (!profileId) throw new ApiError("VALIDATION_ERROR", "画像 ID 缺失", 400);
      const parsed = UpdateAudienceIdentityRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return ok(await runService.updateAudienceIdentity(runId, profileId, parsed.data));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.post("/api/runs/:runId/audience-profiles/:profileId/identity/regenerate", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const profileId = (request.params as { profileId?: string }).profileId;
      if (!profileId) throw new ApiError("VALIDATION_ERROR", "画像 ID 缺失", 400);
      return ok(await runService.regenerateAudienceIdentity(runId, profileId));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.post("/api/runs/:runId/audience-profiles/:profileId/identity/favorite", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const profileId = (request.params as { profileId?: string }).profileId;
      if (!profileId) throw new ApiError("VALIDATION_ERROR", "画像 ID 缺失", 400);
      const parsed = FavoriteAudienceIdentityRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return ok(await runService.favoriteAudienceIdentity(runId, profileId, parsed.data));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.delete("/api/runs/:runId/audience-profiles/:profileId", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const profileId = (request.params as { profileId?: string }).profileId;
      if (!profileId) throw new ApiError("VALIDATION_ERROR", "画像 ID 缺失", 400);
      return ok(await runService.deleteAudienceProfile(runId, profileId));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.get("/api/runs/:runId/participants", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      return ok(await runService.listAudiences(runId));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  // ── Run control endpoints ──

  app.post("/api/runs/:runId/pause", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      return ok(await runService.pauseRun(runId));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  app.post("/api/runs/:runId/resume", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      return ok(await runService.resumeRun(runId));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  // ── Run logs (new unified endpoint) ──

  app.get("/api/runs/:runId/run-logs", async (request, reply) => {
    try {
      const runId = getRunId(request.params);
      const query = request.query as { logType?: string; limit?: string; cursor?: string; order?: string };
      return ok(await runService.getRunLogs(runId, {
        logType: query.logType,
        limit: query.limit ? Number(query.limit) : undefined,
        cursor: query.cursor,
        order: query.order === "desc" ? "desc" : "asc"
      }));
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

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

function mimeToExt(mimeType: string) {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  return ".png";
}

function isMultipartFileTooLarge(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE";
}

function isMultipartFileStreamTruncated(file: unknown) {
  return typeof file === "object" && file !== null && "truncated" in file && Boolean((file as { truncated?: boolean }).truncated);
}

async function fetchOpenAICompatibleModels({ apiKey, baseUrl }: { apiKey: string; baseUrl: string }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const endpoint = modelListEndpoint(baseUrl);
  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new ApiError("MODEL_LIST_FAILED", `模型列表获取失败：HTTP ${response.status}`, 502);
    }
    const text = await response.text();
    const payload = JSON.parse(text) as { data?: Array<{ id?: string; owned_by?: string }> };
    const models = (payload.data ?? [])
      .map((model) => ({ id: model.id ?? "", ownedBy: model.owned_by }))
      .filter((model) => model.id)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (!models.length) throw new ApiError("MODEL_LIST_FAILED", "模型列表为空或响应格式不兼容", 502);
    return models;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiError("MODEL_LIST_FAILED", `模型列表获取失败：${message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

function modelListEndpoint(baseUrl: string) {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new ApiError("VALIDATION_ERROR", "API base URL 格式不正确", 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError("VALIDATION_ERROR", "API base URL 只支持 http 或 https", 400);
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function hasDoubtRisk(tags: unknown) {
  return Array.isArray(tags) && tags.some((tag) => tag === "ad_concern");
}
