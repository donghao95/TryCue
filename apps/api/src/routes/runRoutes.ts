import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@trycue/db";
import { CreateRunRequestSchema, RetryRunRequestSchema, StartRunRequestSchema } from "@trycue/shared/run";
import { ApiError } from "../errors.js";
import { getLatestLiveEventSequence } from "../liveEvents.js";
import { shouldUseRealLlm, type LlmRuntimeConfig } from "../llmConfigStore.js";
import { generateReportAndCompleteRun } from "../runtime/report.js";
import { RunService } from "../runtime/runService.js";
import { requireSingleContentVersion } from "../runtime/contentVersions.js";
import { insightView, logView, reportView, runOverviewView } from "../views.js";
import { AiTaskRunner } from "../agents/taskRunner.js";
import { getRunId, parsePageQuery, wrapHandler } from "./routeHelpers.js";

/**
 * Deps injected from buildApp.
 */
export interface RunRoutesDeps {
  runService: RunService;
  getLlmConfig: () => LlmRuntimeConfig;
  aiTaskRunner: AiTaskRunner;
  uploadDir: string;
}

/**
 * Registers run lifecycle, control, logs, insights, and report routes.
 *
 * Routes migrated from app.ts:
 * - POST   /api/runs
 * - GET    /api/runs
 * - GET    /api/runs/:runId
 * - DELETE /api/runs/:runId
 * - POST   /api/runs/:runId/start
 * - POST   /api/runs/:runId/reset-runtime
 * - POST   /api/runs/:runId/retry
 * - POST   /api/runs/:runId/pause
 * - POST   /api/runs/:runId/resume
 * - GET    /api/runs/:runId/logs
 * - GET    /api/runs/:runId/insights
 * - GET    /api/runs/:runId/report
 * - POST   /api/runs/:runId/report
 * - GET    /api/runs/:runId/run-logs
 *
 * All handlers use `wrapHandler` (try/catch → ok → sendApiError) because none
 * of them have special error branches — schema validation failures and
 * business-rule failures both throw `ApiError`, which `wrapHandler` passes
 * through to `sendApiError` unchanged.
 *
 * `report` GET/POST stay here (not a separate `reportRoutes.ts`) because:
 * 1. only two endpoints — splitting now is "pure for the sake of pure";
 * 2. POST report tightly couples to run lifecycle (checks paused/completed,
 *    calls generateReportAndCompleteRun);
 * 3. stage 11 (not stage 7) handles report/agent boundary splits.
 */
export function runRoutes(deps: RunRoutesDeps): FastifyPluginAsync {
  const { runService, getLlmConfig, aiTaskRunner, uploadDir } = deps;
  return async (app) => {
    app.post("/api/runs", wrapHandler(async (request) => {
      const parsed = CreateRunRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return runService.createRun(parsed.data);
    }));

    app.get("/api/runs", wrapHandler(async (request) => {
      return runService.listRuns(parsePageQuery(request.query, 20));
    }));

    app.get("/api/runs/:runId", wrapHandler(async (request) => {
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
      return runOverviewView({ run, contentVersion, journeys, postState, audienceProgress, latestLiveEventSequence });
    }));

    app.delete("/api/runs/:runId", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      return runService.deleteRun(runId);
    }));

    app.post("/api/runs/:runId/start", wrapHandler(async (request) => {
      const parsed = StartRunRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      const runId = getRunId(request.params);
      return runService.startRun(runId, parsed.data);
    }));

    app.post("/api/runs/:runId/reset-runtime", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      return runService.resetRuntime(runId);
    }));

    app.post("/api/runs/:runId/retry", wrapHandler(async (request) => {
      const parsed = RetryRunRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return runService.retryRun(getRunId(request.params), parsed.data);
    }));

    app.post("/api/runs/:runId/pause", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      return runService.pauseRun(runId);
    }));

    app.post("/api/runs/:runId/resume", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      return runService.resumeRun(runId);
    }));

    app.get("/api/runs/:runId/logs", wrapHandler(async (request) => {
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
      return {
        logs: logs.map((log) => ({ ...logView(log, log.participantId ? audienceById.get(log.participantId) : undefined), logType: "action" })),
        nextCursor: logs.length === limit ? String(cursor + logs.length) : null
      };
    }));

    app.get("/api/runs/:runId/insights", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      const content = await requireSingleContentVersion(prisma, runId);
      const insights = await prisma.insight.findMany({
        where: { contentVersionId: content.id },
        orderBy: [{ simulatedTime: "asc" }, { createdAt: "asc" }]
      });
      return { insights: insights.map(insightView) };
    }));

    app.get("/api/runs/:runId/report", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      const report = await prisma.report.findFirst({ where: { runId } });
      if (!report) throw new ApiError("REPORT_NOT_READY", "试映报告尚未生成", 409);
      return reportView(report);
    }));

    app.post("/api/runs/:runId/report", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      const regenerate = (request.query as { regenerate?: string }).regenerate === "true";
      const existing = await prisma.report.findFirst({ where: { runId } });
      // Without ?regenerate=true, an existing report is returned as-is (idempotent GET-like behavior).
      if (existing && !regenerate) return reportView(existing);
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
      return reportView(report);
    }));

    app.get("/api/runs/:runId/run-logs", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      const query = request.query as { logType?: string; limit?: string; cursor?: string; order?: string };
      return runService.getRunLogs(runId, {
        logType: query.logType,
        limit: query.limit ? Number(query.limit) : undefined,
        cursor: query.cursor,
        order: query.order === "desc" ? "desc" : "asc"
      });
    }));
  };
}
