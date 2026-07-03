import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@trycue/db";
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
import { ApiError } from "../errors.js";
import { requireSingleContentVersion } from "../runtime/contentVersions.js";
import { RunService } from "../runtime/runService.js";
import { audienceDetailView, buildAudienceSeatsView } from "../views.js";
import { getRunId, wrapHandler } from "./routeHelpers.js";

/**
 * Deps injected from buildApp.
 */
export interface AudienceRoutesDeps {
  runService: RunService;
}

/**
 * Registers audience-related routes: audience seats view, participant detail,
 * sampling plan + directives, audience generation, and audience profiles.
 *
 * Routes migrated from app.ts:
 * - GET    /api/runs/:runId/audience-seats
 * - GET    /api/runs/:runId/participants
 * - GET    /api/runs/:runId/participants/:participantId
 * - POST   /api/runs/:runId/audience-sampling-plan
 * - GET    /api/runs/:runId/audience-sampling-plan
 * - PATCH  /api/runs/:runId/audience-sampling-plan
 * - POST   /api/runs/:runId/audience-sampling-plan/revision-suggestions
 * - POST   /api/runs/:runId/audience-sampling-plan/directives
 * - PATCH  /api/runs/:runId/audience-sampling-plan/directives/:directiveId
 * - DELETE /api/runs/:runId/audience-sampling-plan/directives/:directiveId
 * - POST   /api/runs/:runId/audience-sampling-plan/directives/:directiveId/retry-expansion
 * - POST   /api/runs/:runId/audience-sampling-plan/confirm
 * - POST   /api/runs/:runId/audience-sampling-plan/clear-audience
 * - GET    /api/runs/:runId/audience-generation
 * - POST   /api/runs/:runId/audience-generation/retry-identities
 * - POST   /api/runs/:runId/audience-profiles/revision-suggestions
 * - POST   /api/runs/:runId/audience-profiles
 * - PATCH  /api/runs/:runId/audience-profiles/:profileId/identity
 * - POST   /api/runs/:runId/audience-profiles/:profileId/identity/regenerate
 * - POST   /api/runs/:runId/audience-profiles/:profileId/identity/favorite
 * - DELETE /api/runs/:runId/audience-profiles/:profileId
 *
 * `audience-seats`, `participants`, and `participants/:participantId` are grouped
 * here (not in runRoutes) because they return audience-perspective views:
 * `buildAudienceSeatsView` aggregates audiences/journeys/interactions/riskLogs/
 * lastLogs into seat statistics (commented/favorited/skipped/doubt/riskExit/
 * finished), and `audienceDetailView` returns the audience detail drawer payload.
 *
 * All handlers use `wrapHandler` — schema validation and business rules throw
 * `ApiError`, which passes through `sendApiError` unchanged.
 *
 * `hasDoubtRisk` is migrated from app.ts module-level helper — only consumed by
 * the audience-seats handler.
 */
export function audienceRoutes(deps: AudienceRoutesDeps): FastifyPluginAsync {
  const { runService } = deps;
  return async (app) => {
    // ── Audience seats + participants (read views) ──

    app.get("/api/runs/:runId/audience-seats", wrapHandler(async (request) => {
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
      return {
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
      };
    }));

    app.get("/api/runs/:runId/participants", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      return runService.listAudiences(runId);
    }));

    app.get("/api/runs/:runId/participants/:participantId", wrapHandler(async (request) => {
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
      return audienceDetailView({ audience, journey: journey ?? undefined, timeline, interactions, comments, toolCalls });
    }));

    // ── Audience sampling plan ──

    app.post("/api/runs/:runId/audience-sampling-plan", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      const parsed = CreateAudienceSamplingPlanRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return runService.createAudienceSamplingPlan(runId, parsed.data);
    }));

    app.get("/api/runs/:runId/audience-sampling-plan", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      return runService.getAudienceSamplingPlan(runId);
    }));

    app.patch("/api/runs/:runId/audience-sampling-plan", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      const parsed = UpdateAudienceSamplingPlanRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return runService.updateAudienceSamplingPlan(runId, parsed.data);
    }));

    app.post("/api/runs/:runId/audience-sampling-plan/revision-suggestions", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      const parsed = CreateAudienceSamplingPlanRevisionSuggestionRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return runService.suggestAudienceSamplingPlanRevision(runId, parsed.data);
    }));

    app.post("/api/runs/:runId/audience-sampling-plan/directives", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      const parsed = CreateAudienceSamplingDirectiveRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return runService.createAudienceSamplingDirective(runId, parsed.data);
    }));

    app.patch("/api/runs/:runId/audience-sampling-plan/directives/:directiveId", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      const directiveId = (request.params as { directiveId?: string }).directiveId;
      if (!directiveId) throw new ApiError("VALIDATION_ERROR", "人群计划项 ID 缺失", 400);
      const parsed = UpdateAudienceSamplingDirectiveRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return runService.updateAudienceSamplingDirective(runId, directiveId, parsed.data);
    }));

    app.delete("/api/runs/:runId/audience-sampling-plan/directives/:directiveId", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      const directiveId = (request.params as { directiveId?: string }).directiveId;
      if (!directiveId) throw new ApiError("VALIDATION_ERROR", "人群计划项 ID 缺失", 400);
      return runService.deleteAudienceSamplingDirective(runId, directiveId);
    }));

    app.post("/api/runs/:runId/audience-sampling-plan/directives/:directiveId/retry-expansion", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      const directiveId = (request.params as { directiveId?: string }).directiveId;
      if (!directiveId) throw new ApiError("VALIDATION_ERROR", "人群计划项 ID 缺失", 400);
      return runService.retryAudienceDirectiveExpansion(runId, directiveId);
    }));

    app.post("/api/runs/:runId/audience-sampling-plan/confirm", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      return runService.confirmAudienceSamplingPlan(runId);
    }));

    app.post("/api/runs/:runId/audience-sampling-plan/clear-audience", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      return runService.clearGeneratedAudience(runId);
    }));

    // ── Audience generation ──

    app.get("/api/runs/:runId/audience-generation", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      return runService.getAudienceGeneration(runId);
    }));

    app.post("/api/runs/:runId/audience-generation/retry-identities", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      const parsed = RetryAudienceIdentitiesRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return runService.retryAudienceIdentities(runId, parsed.data);
    }));

    // ── Audience profiles ──

    app.post("/api/runs/:runId/audience-profiles/revision-suggestions", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      const parsed = CreateAudienceSeatRevisionSuggestionRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return runService.suggestAudienceSeatRevision(runId, parsed.data);
    }));

    app.post("/api/runs/:runId/audience-profiles", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      const parsed = CreateAudienceProfileRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return runService.createAudienceProfile(runId, parsed.data);
    }));

    app.patch("/api/runs/:runId/audience-profiles/:profileId/identity", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      const profileId = (request.params as { profileId?: string }).profileId;
      if (!profileId) throw new ApiError("VALIDATION_ERROR", "画像 ID 缺失", 400);
      const parsed = UpdateAudienceIdentityRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return runService.updateAudienceIdentity(runId, profileId, parsed.data);
    }));

    app.post("/api/runs/:runId/audience-profiles/:profileId/identity/regenerate", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      const profileId = (request.params as { profileId?: string }).profileId;
      if (!profileId) throw new ApiError("VALIDATION_ERROR", "画像 ID 缺失", 400);
      return runService.regenerateAudienceIdentity(runId, profileId);
    }));

    app.post("/api/runs/:runId/audience-profiles/:profileId/identity/favorite", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      const profileId = (request.params as { profileId?: string }).profileId;
      if (!profileId) throw new ApiError("VALIDATION_ERROR", "画像 ID 缺失", 400);
      const parsed = FavoriteAudienceIdentityRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
      return runService.favoriteAudienceIdentity(runId, profileId, parsed.data);
    }));

    app.delete("/api/runs/:runId/audience-profiles/:profileId", wrapHandler(async (request) => {
      const runId = getRunId(request.params);
      const profileId = (request.params as { profileId?: string }).profileId;
      if (!profileId) throw new ApiError("VALIDATION_ERROR", "画像 ID 缺失", 400);
      return runService.deleteAudienceProfile(runId, profileId);
    }));
  };
}

/**
 * Detect whether an action log's risk tags contain a doubt risk.
 * "doubt" is a general concept covering both ad_concern (广告嫌疑) and
 * trust_evidence (要求具体来源/依据) — both indicate the audience is
 * questioning the content and should trigger the hesitating seat status.
 */
function hasDoubtRisk(tags: unknown) {
  return Array.isArray(tags) && tags.some((tag) => tag === "ad_concern" || tag === "trust_evidence");
}
