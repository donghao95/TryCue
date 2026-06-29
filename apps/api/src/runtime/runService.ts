import { unlink } from "node:fs/promises";
import { prisma, Prisma, type AudienceGenerationJob, type AudienceGenerationJobStatus, type RunStatus } from "@trycue/db";
import type {
  AudienceGenerationProgressView,
  AudienceGenerationJobView,
  AudiencePlanFrame,
  AudiencePlanPreview,
  AudiencePlanProgressEvent,
  AudiencePersonaJson,
  AudienceProfileView,
  AudienceSamplingDirective,
  CreateAudienceProfileRequest,
  CreateAudienceSamplingPlanRevisionSuggestionRequest,
  CreateAudienceSeatRevisionSuggestionRequest,
  CreateAudienceSamplingDirectiveRequest,
  CreateAudienceSamplingPlanRequest,
  CreateRunRequest,
  FavoriteAudienceIdentityRequest,
  RetryAudienceIdentitiesRequest,
  RetryRunRequest,
  RuntimeLogItem,
  RunHistoryItem,
  AudienceSamplingPlanView,
  StartRunRequest,
  UpdateAudienceIdentityRequest,
  UpdateAudienceSamplingDirectiveRequest,
  UpdateAudienceSamplingPlanRequest
} from "@trycue/shared";
import type { AppConfig } from "../config.js";
import { ApiError } from "../errors.js";
import { log } from "../logger.js";
import type { AgentProvider, AudienceProfilePlan, AudienceSamplingDirectiveView, AudienceSamplingPlanDraft, AudienceSamplingPlanViewForProvider } from "../agents/types.js";
import type { LlmRuntimeConfig } from "../llmConfigStore.js";
import { shouldUseRealLlm } from "../llmConfigStore.js";
import { recordLiveEvent, pushLiveEvent } from "../liveEvents.js";
import { Scheduler } from "./scheduler.js";
import { recordRunClockUpdatedEvent } from "./clock.js";
import { createAgentIdentity } from "./identity.js";
import { admitWaitingAudiences } from "./queue.js";
import { requireSingleContentVersion } from "./contentVersions.js";
import { cleanupRuntimeFacts, cleanupParticipantRuntimeFacts } from "./runDataLifecycle.js";
import { createRunLogWithEvent } from "./runLogs.js";
import { appendSystemNoticeItem } from "./agentSessions.js";
import { localAssetPathForStorageKey, localStorageKeyFromUrl, prepareModelImageUrls } from "./modelImages.js";

/** Duration in ms before an audience generation job lock expires if the worker stops heartbeating. */
const AUDIENCE_JOB_LOCK_DURATION_MS = 10 * 60 * 1000;

const activeAudienceGenerationJobStatuses: AudienceGenerationJobStatus[] = ["queued", "planning", "generating"];
const terminalAudienceGenerationJobStatuses: AudienceGenerationJobStatus[] = ["completed", "failed", "canceled"];
const audienceEditableRunStatuses: RunStatus[] = ["draft", "planning_audience", "generating_audience", "audience_ready"];
const canceledIdentityGenerationMessage = "Audience identity generation was canceled.";
const interruptedIdentityGenerationMessage = "Audience identity generation was interrupted and recovered.";

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const concurrency = Math.max(1, Math.min(limit, items.length || 1));
  const results: R[] = new Array(items.length);
  const settled: Array<PromiseSettledResult<R>> = new Array(items.length);
  const activePromises = new Set<Promise<void>>();
  let firstRejection: unknown;
  for (const [i, item] of items.entries()) {
    if (firstRejection) break;
    const p = fn(item, i)
      .then((value) => { results[i] = value; settled[i] = { status: "fulfilled", value }; })
      .catch((err) => {
        settled[i] = { status: "rejected", reason: err };
        firstRejection ??= err;
      })
      .then(() => { activePromises.delete(p); });
    activePromises.add(p);
    if (activePromises.size >= concurrency) await Promise.race(activePromises);
  }
  await Promise.all(activePromises);
  if (firstRejection) throw firstRejection;
  return results;
}

export class RunService {
  private readonly activeGenerationJobs = new Set<string>();
  private readonly generationWorkerId = `audience-generator-${process.pid}`;

  constructor(
    private readonly config: AppConfig,
    private readonly getLlmConfig: () => LlmRuntimeConfig,
    private readonly getAgentProvider: () => AgentProvider,
    private readonly scheduler: Scheduler,
    private readonly uploadDir: string
  ) {}

  async createRun(input: CreateRunRequest) {
    const audienceCount = this.resolveAudienceCount(input);
    const imageUrls = normalizeInputImageUrls(input);
    const run = await prisma.$transaction(async (tx) => {
      const createdRun = await tx.testRun.create({
        data: {
          status: "draft",
          audienceCount,
          configJson: {
            scale: input.scale,
            audienceCount,
            imageCount: imageUrls.length,
            runtimeMode: shouldUseRealLlm(this.getLlmConfig()) ? "real" : "mock"
          },
          contentVersionCount: 1
        }
      });
      const contentVersion = await tx.contentVersion.create({
        data: {
          runId: createdRun.id,
          versionName: "version_a",
          title: input.title,
          coverImageUrl: imageUrls[0],
          imageUrlsJson: imageUrls,
          bodyText: input.bodyText,
          scale: input.scale
        }
      });
      await linkContentVersionImages(tx, contentVersion.id, imageUrls);
      return createdRun;
    });
    return {
      runId: run.id,
      status: run.status,
      createdAt: run.createdAt.toISOString()
    };
  }

  private resolveAudienceCount(input: CreateRunRequest) {
    if (input.scale === "custom") return input.audienceCount!;
    return input.scale === "quick" ? this.config.defaultQuickAudienceCount : this.config.defaultStandardAudienceCount;
  }

  async listRuns(input: { limit: number; cursor: number }): Promise<{ runs: RunHistoryItem[]; hasMore: boolean; nextCursor: number | null }> {
    const limit = Math.min(Math.max(input.limit, 1), 200);
    const cursor = Math.max(input.cursor, 0);
    const runs = await prisma.testRun.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: cursor,
      take: limit + 1,
      include: {
        contentVersions: {
          take: 1,
          include: { images: { orderBy: { sortOrder: "asc" } } }
        },
        _count: {
          select: {
            audienceProfiles: true,
            runParticipants: true,
            reports: true,
            journeys: true
          }
        }
      }
    });
    const page = runs.slice(0, limit);
    const readyCounts = await prisma.audienceProfile.groupBy({
      by: ["runId"],
      where: { runId: { in: page.map((run) => run.id) }, identityStatus: "identity_ready" },
      _count: { _all: true }
    });
    const readyByRun = new Map(readyCounts.map((item) => [item.runId, item._count._all]));
    return {
      runs: page.map((run) => {
        const content = run.contentVersions[0] ?? null;
        const imageUrls = content?.images.length
          ? content.images.map((image) => image.url)
          : content
            ? normalizeStoredImageUrls(content.imageUrlsJson, content.coverImageUrl)
            : [];
        return {
          runId: run.id,
          status: run.status,
          title: content?.title ?? "未命名试映",
          coverImageUrl: imageUrls[0] ?? content?.coverImageUrl ?? null,
          imageUrls,
          bodyPreview: content?.bodyText.slice(0, 120) ?? "",
          audienceTotal: run.audienceCount,
          participantCount: run._count.runParticipants,
          identityReadyCount: readyByRun.get(run.id) ?? 0,
          journeyCount: run._count.journeys,
          hasReport: run._count.reports > 0,
          createdAt: run.createdAt.toISOString(),
          startedAt: run.startedAt?.toISOString() ?? null,
          completedAt: run.completedAt?.toISOString() ?? null
        };
      }),
      hasMore: runs.length > limit,
      nextCursor: runs.length > limit ? cursor + limit : null
    };
  }

  async resetRuntime(runId: string) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    const allowed: RunStatus[] = ["paused", "completed", "audience_ready"];
    if (!allowed.includes(run.status as RunStatus)) {
      throw new ApiError("INVALID_RUN_STATUS", "只有暂停、完成或就绪的试映才能重置运行时", 409);
    }
    const activeJob = await prisma.audienceGenerationJob.findFirst({ where: { runId, active: true } });
    if (activeJob) throw new ApiError("AUDIENCE_GENERATION_ACTIVE", "观众生成任务仍在执行，请等待完成或取消后再重置", 409);

    const { deleted, clockEvent } = await prisma.$transaction(async (tx) => {
      const counts = await cleanupRuntimeFacts(tx, runId);
      const existingConfig = run.configJson && typeof run.configJson === "object" && !Array.isArray(run.configJson)
        ? { ...(run.configJson as Record<string, unknown>) }
        : {};
      delete existingConfig.controlState;
      delete existingConfig.startedAudienceCount;
      delete existingConfig.excludedProfileCount;
      const updated = await tx.testRun.update({
        where: { id: runId },
        data: {
          status: "audience_ready",
          clockElapsedMs: 0,
          clockAnchorAt: null,
          startedAt: null,
          completedAt: null,
          terminalReason: null,
          errorMessage: null,
          configJson: { ...existingConfig, controlState: "none" }
        }
      });
      const event = await recordRunClockUpdatedEvent(tx, {
        runId,
        reason: "reset",
        status: "audience_ready",
        run: updated
      });
      return { deleted: counts, clockEvent: event };
    });
    pushLiveEvent(runId, clockEvent);

    return { runId, status: "audience_ready", deleted };
  }

  async deleteRun(runId: string) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    if (["running", "pausing", "report_generating"].includes(run.status)) {
      throw new ApiError("RUN_DELETE_BLOCKED", "运行中、暂停中或报告生成中的试映不能直接删除", 409);
    }
    const activeJob = await prisma.audienceGenerationJob.findFirst({ where: { runId, active: true } });
    if (activeJob) throw new ApiError("RUN_DELETE_BLOCKED", "观众生成任务仍在执行，请等待完成或取消后再删除", 409);

    const [profiles, participants, assets] = await Promise.all([
      prisma.audienceProfile.findMany({
        where: { runId },
        select: { generatedUserId: true, generatedAgentId: true, generatedPlatformAccountId: true }
      }),
      prisma.runParticipant.findMany({
        where: { runId },
        select: { userId: true, agentId: true, platformAccountId: true }
      }),
      prisma.contentVersionImage.findMany({
        where: { contentVersion: { runId } },
        include: { asset: true }
      })
    ]);
    const userIds = unique([...profiles.map((item) => item.generatedUserId), ...participants.map((item) => item.userId)].filter(isString));
    const agentIds = unique([...profiles.map((item) => item.generatedAgentId), ...participants.map((item) => item.agentId)].filter(isString));
    const platformAccountIds = unique([...profiles.map((item) => item.generatedPlatformAccountId), ...participants.map((item) => item.platformAccountId)].filter(isString));
    const assetIds = unique(assets.map((item) => item.assetId).filter(isString));

    await prisma.testRun.delete({ where: { id: runId } });
    const assetCleanup = await this.cleanupUnreferencedAssets(assetIds);
    const identityCleanup = await cleanupUnreferencedRunLocalIdentities({ userIds, agentIds, platformAccountIds });
    return {
      runId,
      status: "deleted",
      deletedAssets: assetCleanup.deletedAssets,
      deletedLocalFiles: assetCleanup.deletedLocalFiles,
      deletedUsers: identityCleanup.deletedUsers,
      deletedAgents: identityCleanup.deletedAgents,
      deletedPlatformAccounts: identityCleanup.deletedPlatformAccounts
    };
  }

  private async cleanupUnreferencedAssets(assetIds: string[]) {
    if (assetIds.length === 0) return { deletedAssets: 0, deletedLocalFiles: 0 };

    // Batch: find all referenced asset IDs in one query
    const referencedRows = await prisma.contentVersionImage.findMany({
      where: { assetId: { in: assetIds } },
      select: { assetId: true },
      distinct: ["assetId"]
    });
    const referencedIds = new Set(referencedRows.map((r) => r.assetId));
    const unreferencedIds = assetIds.filter((id) => !referencedIds.has(id));
    if (unreferencedIds.length === 0) return { deletedAssets: 0, deletedLocalFiles: 0 };

    // Batch: fetch all unreferenced assets
    const assets = await prisma.asset.findMany({ where: { id: { in: unreferencedIds } } });

    // Batch: delete all unreferenced assets
    await prisma.asset.deleteMany({ where: { id: { in: unreferencedIds } } });

    // Clean up local files
    let deletedLocalFiles = 0;
    for (const asset of assets) {
      if (asset.storage === "local" && asset.storageKey) {
        const filePath = localAssetPathForStorageKey(this.uploadDir, asset.storageKey);
        if (filePath) {
          const removed = await unlink(filePath).then(() => true).catch(() => false);
          if (removed) deletedLocalFiles += 1;
        }
      }
    }
    return { deletedAssets: assets.length, deletedLocalFiles };
  }

  private async prepareAgentImageUrls(imageUrls: string[]) {
    return prepareModelImageUrls(imageUrls, this.uploadDir);
  }

  async createAudienceSamplingPlan(runId: string, input: CreateAudienceSamplingPlanRequest) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    if (!input.replaceActive && !["draft", "planning_audience"].includes(run.status)) {
      throw new ApiError("INVALID_RUN_STATUS", `当前状态 ${run.status} 不允许生成观众计划`, 409);
    }
    if (input.replaceActive && !audienceEditableRunStatuses.includes(run.status)) {
      throw new ApiError("INVALID_RUN_STATUS", `当前状态 ${run.status} 不允许重新生成观众计划`, 409);
    }
    const activeJob = await prisma.audienceGenerationJob.findFirst({ where: { runId, active: true }, orderBy: { createdAt: "desc" } });
    if (activeJob) throw new ApiError("AUDIENCE_GENERATION_ACTIVE", "已有观众生成任务正在执行，请等待完成或先取消任务", 409, jobView(activeJob));

    const existingPlan = await prisma.audienceSamplingPlan.findUnique({ where: { runId } });
    if (existingPlan && !input.replaceActive) {
      throw new ApiError("AUDIENCE_SAMPLING_PLAN_EXISTS", "当前试映已存在观众采样计划", 409, await this.getAudienceSamplingPlan(runId));
    }
    if (input.replaceActive) {
      await this.assertNoRuntimeAudienceReferences(runId);
    }

    // Guard: re-check activeJob inside the write transaction to handle concurrent calls.
    const job = await prisma.$transaction(async (tx) => {
      const concurrentActiveJob = await tx.audienceGenerationJob.findFirst({
        where: { runId, active: true, status: { in: activeAudienceGenerationJobStatuses } },
        orderBy: { createdAt: "desc" }
      });
      if (concurrentActiveJob) {
        throw new ApiError("AUDIENCE_GENERATION_ACTIVE", "已有观众生成任务正在执行，请等待完成或先取消任务", 409, jobView(concurrentActiveJob));
      }
      if (input.replaceActive) {
        await cleanupProfilesForReplan(tx, runId);
        await tx.audienceSamplingPlan.deleteMany({ where: { runId } });
      }
      await tx.testRun.update({
        where: { id: runId },
        data: {
          status: "planning_audience",
          errorMessage: null,
          ...(input.replaceActive ? { audienceRevision: { increment: 1 } } : {})
        }
      });
      return tx.audienceGenerationJob.create({
        data: {
          runId,
          scope: "sampling_plan",
          targetCount: run.audienceCount,
          batchSize: 1
        }
      });
    });
    this.startAudienceGenerationJob(job.id);
    const latestJob = await prisma.audienceGenerationJob.findUnique({ where: { id: job.id } });
    return { runId, job: jobView(latestJob ?? job) };
  }

  async cancelAudienceGenerationJob(runId: string, jobId: string) {
    const job = await prisma.audienceGenerationJob.findUnique({ where: { id: jobId } });
    if (!job || job.runId !== runId) throw new ApiError("JOB_NOT_FOUND", "观众生成任务不存在", 404);
    if (["completed", "failed", "canceled"].includes(job.status)) return { runId, job: jobView(job), progress: await this.getAudienceGeneration(runId) };
    const compensatedProfileIds: string[] = [];
    const updated = await prisma.$transaction(async (tx) => {
      await tx.audienceGenerationJob.updateMany({
        where: { id: jobId, runId, active: true, status: { in: activeAudienceGenerationJobStatuses } },
        data: { status: "canceled", active: false, canceledAt: new Date(), lockedUntil: null, lockedBy: null }
      });
      const latest = await tx.audienceGenerationJob.findUniqueOrThrow({ where: { id: jobId } });
      compensatedProfileIds.push(...await compensateProfilesForAudienceGenerationJob(tx, latest, canceledIdentityGenerationMessage));
      await this.reconcileAudiencePreparationRunStatus(tx, runId, canceledIdentityGenerationMessage);
      return latest;
    });
    await this.emitCompensatedProfileUpdates(runId, compensatedProfileIds);
    const event = await recordLiveEvent(prisma, { runId, eventType: "audience.generation.job.canceled", payload: { jobId } });
    pushLiveEvent(runId, event);
    return { runId, job: jobView(updated), progress: await this.getAudienceGeneration(runId) };
  }

  async recoverAudienceGenerationJobs() {
    const now = new Date();
    const orphanRunIds = await this.repairOrphanAudienceProfiles(interruptedIdentityGenerationMessage);
    const jobs = await prisma.audienceGenerationJob.findMany({
      where: {
        active: true,
        status: { in: activeAudienceGenerationJobStatuses },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }]
      },
      orderBy: { createdAt: "asc" }
    });
    const staleRunIds = new Set(orphanRunIds);
    for (const job of jobs) {
      if (!(await this.isAudienceGenerationJobRecoverable(job))) {
        const failed = await this.failAudienceGenerationJob(job.id, interruptedIdentityGenerationMessage, { requireWorkerLock: false });
        staleRunIds.add(job.runId);
        await this.emitCompensatedProfileUpdates(job.runId, failed?.profileIds ?? []);
        continue;
      }
      const profileIds = await prisma.$transaction(async (tx) => {
        const compensated = await compensateProfilesForAudienceGenerationJob(tx, job, interruptedIdentityGenerationMessage);
        await this.reconcileAudiencePreparationRunStatus(tx, job.runId, interruptedIdentityGenerationMessage);
        return compensated;
      });
      staleRunIds.add(job.runId);
      await this.emitCompensatedProfileUpdates(job.runId, profileIds);
      this.startAudienceGenerationJob(job.id);
    }
    for (const runId of staleRunIds) {
      await prisma.$transaction(async (tx) => {
        await this.reconcileAudiencePreparationRunStatus(tx, runId, interruptedIdentityGenerationMessage);
      });
    }
    await this.recoverCompletedSamplingPlanJobs();
    await this.recoverMissingIdentityGenerationJobs();
  }

  private startAudienceGenerationJob(jobId: string) {
    if (this.activeGenerationJobs.has(jobId)) return;
    this.activeGenerationJobs.add(jobId);
    void this.runAudienceGenerationJob(jobId).finally(() => this.activeGenerationJobs.delete(jobId));
  }

  private async createInternalAudienceGenerationJob(
    runId: string,
    input: { scope: "identities"; targetCount: number; batchSize: number }
  ) {
    if (input.targetCount <= 0) {
      await this.updateAudienceReadiness(runId);
      return null;
    }
    return prisma.$transaction(async (tx) => {
      const activeJob = await tx.audienceGenerationJob.findFirst({
        where: { runId, active: true, status: { in: activeAudienceGenerationJobStatuses } },
        orderBy: { createdAt: "desc" }
      });
      if (activeJob) return null;
      const plan = await tx.audienceSamplingPlan.findUnique({ where: { runId } });
      await tx.testRun.update({ where: { id: runId }, data: { status: "generating_audience", errorMessage: null } });
      return tx.audienceGenerationJob.create({
        data: {
          runId,
          scope: input.scope,
          samplingPlanId: plan?.id,
          targetCount: input.targetCount,
          batchSize: input.batchSize
        }
      });
    });
  }

  private async runAudienceGenerationJob(jobId: string) {
    const lockUntil = new Date(Date.now() + AUDIENCE_JOB_LOCK_DURATION_MS);
    const claimed = await prisma.audienceGenerationJob.updateMany({
      where: {
        id: jobId,
        active: true,
        status: { in: ["queued", "planning", "generating"] },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }, { lockedBy: this.generationWorkerId }]
      },
      data: {
        status: "planning",
        lockedBy: this.generationWorkerId,
        lockedUntil: lockUntil,
        heartbeatAt: new Date(),
        startedAt: new Date(),
        attemptCount: { increment: 1 }
      }
    });
    if (claimed.count === 0) return;

    const job = await prisma.audienceGenerationJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    const runId = job.runId;
    try {
      await this.emitGenerationEvent(runId, "audience.generation.job.started", { jobId, scope: job.scope });
      if (job.scope === "sampling_plan") {
        await this.emitGenerationEvent(runId, "audience.plan.started", { jobId, scope: job.scope, targetCount: job.targetCount });
        await this.createAudiencePlanForJob(job.id);
      } else {
        if (!(await this.isAudienceGenerationJobHeldByCurrentWorker(job.id))) {
          await this.compensateInactiveAudienceGenerationJob(job.id);
          return;
        }
        const movedToGenerating = await prisma.audienceGenerationJob.updateMany({
          where: { id: job.id, active: true, status: { in: ["planning", "generating"] }, lockedBy: this.generationWorkerId },
          data: { status: "generating", heartbeatAt: new Date(), lockedUntil: new Date(Date.now() + AUDIENCE_JOB_LOCK_DURATION_MS) }
        });
        if (movedToGenerating.count === 0) {
          await this.compensateInactiveAudienceGenerationJob(job.id);
          return;
        }
        if (job.scope === "profile_expansion") await this.runPipelineJob(job.id);
        if (job.scope === "identities") await this.generateIdentitiesForJob(job.id);
        if (job.scope === "single_identity") await this.generateSingleIdentityForJob(job.id);
      }
      if (!(await this.isAudienceGenerationJobHeldByCurrentWorker(job.id))) {
        await this.compensateInactiveAudienceGenerationJob(job.id);
        return;
      }
      const failedCount = await prisma.audienceProfile.count({ where: { runId, generationJobId: job.id, identityStatus: "identity_failed" } });
      const completed = await this.completeAudienceGenerationJob(job.id);
      if (!completed) return;
      await this.updateAudienceReadiness(runId);
      if (job.scope === "sampling_plan") await this.markAudienceSamplingPlanReady(job.id);
      await this.emitGenerationEvent(runId, "audience.generation.job.completed", { jobId: job.id, scope: job.scope, failedCount, job: jobView(completed) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        const failed = await this.failAudienceGenerationJob(job.id, message, { requireWorkerLock: true });
        if (!failed) return;
        await this.emitCompensatedProfileUpdates(runId, failed.profileIds);
        await this.emitGenerationEvent(runId, "audience.generation.job.failed", { jobId: job.id, scope: job.scope, message, job: jobView(failed.job) });
        if (job.scope === "sampling_plan") await this.emitGenerationEvent(runId, "audience.plan.failed", { jobId: job.id, message });
      } catch (innerErr) {
        log.error({ err: innerErr, jobId }, "[RunService] Failed to mark generation job as failed");
      }
    }
  }

  private async isAudienceGenerationJobHeldByCurrentWorker(jobId: string) {
    const job = await prisma.audienceGenerationJob.findUnique({ where: { id: jobId } });
    return Boolean(
      job?.active &&
      activeAudienceGenerationJobStatuses.includes(job.status) &&
      job.lockedBy === this.generationWorkerId &&
      job.lockedUntil &&
      job.lockedUntil > new Date()
    );
  }

  private async completeAudienceGenerationJob(jobId: string) {
    const completedAt = new Date();
    const completed = await prisma.$transaction(async (tx) => {
      const result = await tx.audienceGenerationJob.updateMany({
        where: { id: jobId, active: true, status: { in: ["planning", "generating"] }, lockedBy: this.generationWorkerId, lockedUntil: { gt: new Date() } },
        data: { status: "completed", active: false, completedAt, lockedBy: null, lockedUntil: null, heartbeatAt: completedAt }
      });
      if (result.count === 0) return null;
      return tx.audienceGenerationJob.findUniqueOrThrow({ where: { id: jobId } });
    });
    return completed;
  }

  private async failAudienceGenerationJob(jobId: string, message: string, options: { requireWorkerLock: boolean }) {
    const failedAt = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.audienceGenerationJob.findUnique({ where: { id: jobId } });
      if (!current) return null;
      const failed = await tx.audienceGenerationJob.updateMany({
        where: {
          id: jobId,
          active: true,
          status: { in: activeAudienceGenerationJobStatuses },
          ...(options.requireWorkerLock ? { lockedBy: this.generationWorkerId, lockedUntil: { gt: new Date() } } : {})
        },
        data: { status: "failed", active: false, errorMessage: message, lockedBy: null, lockedUntil: null, completedAt: failedAt }
      });
      if (failed.count === 0) return null;
      const job = await tx.audienceGenerationJob.findUniqueOrThrow({ where: { id: jobId } });
      const profileIds = await compensateProfilesForAudienceGenerationJob(tx, job, message);
      if (job.scope === "profile_expansion") {
        if (job.samplingPlanId) {
          await tx.audienceSamplingPlan.updateMany({
            where: { id: job.samplingPlanId, status: "failed" },
            data: { errorMessage: message }
          });
        }
        await tx.testRun.updateMany({
          where: { id: job.runId, status: { in: ["planning_audience", "generating_audience", "audience_ready"] } },
          data: { status: "generating_audience", errorMessage: message }
        });
      } else {
        await this.reconcileAudiencePreparationRunStatus(tx, job.runId, message);
      }
      return { job, profileIds };
    });
    return result;
  }

  private async compensateInactiveAudienceGenerationJob(jobId: string) {
    const job = await prisma.audienceGenerationJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    const profileIds = await prisma.$transaction(async (tx) => {
      const compensated = await compensateProfilesForAudienceGenerationJob(tx, job, job.status === "canceled" ? canceledIdentityGenerationMessage : interruptedIdentityGenerationMessage);
      await this.reconcileAudiencePreparationRunStatus(tx, job.runId, job.status === "canceled" ? canceledIdentityGenerationMessage : interruptedIdentityGenerationMessage);
      return compensated;
    });
    await this.emitCompensatedProfileUpdates(job.runId, profileIds);
  }

  private async isAudienceGenerationJobRecoverable(job: AudienceGenerationJob) {
    if (!job.active || !activeAudienceGenerationJobStatuses.includes(job.status)) return false;
    if (job.attemptCount >= this.config.schedulerMaxRetry) return false;
    if (job.scope === "sampling_plan") return true;
    if (job.scope === "single_identity") {
      if (!job.profileId) return false;
      const profile = await prisma.audienceProfile.findUnique({ where: { id: job.profileId } });
      return Boolean(profile && profile.runId === job.runId);
    }
    return (await prisma.audienceSamplingPlan.count({ where: { runId: job.runId, confirmedAt: { not: null } } })) > 0;
  }

  private async repairOrphanAudienceProfiles(message: string) {
    const candidates = await prisma.audienceProfile.findMany({
      where: { identityStatus: { in: ["identity_queued", "identity_generating"] } },
      include: { generationJob: true }
    });
    const orphanProfiles = candidates.filter((profile) =>
      !profile.generationJob ||
      !profile.generationJob.active ||
      terminalAudienceGenerationJobStatuses.includes(profile.generationJob.status)
    );
    if (!orphanProfiles.length) return [];
    const runIds = unique(orphanProfiles.map((profile) => profile.runId));
    const byRun = new Map<string, string[]>();
    await prisma.$transaction(async (tx) => {
      for (const profile of orphanProfiles) {
        const data = hasCompleteProfileIdentity(profile)
          ? { identityStatus: "identity_ready" as const, identityError: message, generationJobId: null }
          : profile.identityStatus === "identity_queued"
            ? { identityStatus: "profile_only" as const, identityError: null, generationJobId: null }
            : { identityStatus: "identity_failed" as const, identityError: message, generationJobId: null };
        await tx.audienceProfile.update({ where: { id: profile.id }, data });
        byRun.set(profile.runId, [...(byRun.get(profile.runId) ?? []), profile.id]);
      }
      for (const runId of runIds) await this.reconcileAudiencePreparationRunStatus(tx, runId, message);
    });
    for (const [runId, profileIds] of byRun) await this.emitCompensatedProfileUpdates(runId, profileIds);
    return runIds;
  }

  private async reconcileAudiencePreparationRunStatus(tx: Prisma.TransactionClient, runId: string, message?: string) {
    const run = await tx.testRun.findUnique({ where: { id: runId } });
    if (!run || !["planning_audience", "generating_audience", "audience_ready"].includes(run.status)) return;
    const activeJob = await tx.audienceGenerationJob.findFirst({
      where: { runId, active: true, status: { in: activeAudienceGenerationJobStatuses } },
      orderBy: { createdAt: "desc" }
    });
    if (activeJob) {
      const nextActiveStatus = activeJob.scope === "sampling_plan" ? "planning_audience" : "generating_audience";
      if (run.status !== nextActiveStatus) await tx.testRun.update({ where: { id: runId }, data: { status: nextActiveStatus, errorMessage: null } });
      return;
    }
    const plan = await tx.audienceSamplingPlan.findUnique({ where: { runId } }).catch(() => null);
    const [totalCount, readyCount, failedCount] = await Promise.all([
      tx.audienceProfile.count({ where: { runId } }),
      tx.audienceProfile.count({ where: { runId, identityStatus: "identity_ready" } }),
      tx.audienceProfile.count({ where: { runId, identityStatus: "identity_failed" } })
    ]);
    if (plan && totalCount > 0) {
      if (plan.status === "failed") {
        if (message && plan.errorMessage !== message) await tx.audienceSamplingPlan.update({ where: { id: plan.id }, data: { errorMessage: message } });
        if (run.status !== "generating_audience" || message) {
          await tx.testRun.update({
            where: { id: runId },
            data: { status: "generating_audience", errorMessage: message ?? run.errorMessage }
          });
        }
        return;
      }
      const pendingCount = totalCount - readyCount - failedCount;
      const planStatus = totalCount === readyCount
        ? "ready"
        : pendingCount === 0 && (readyCount > 0 || failedCount > 0)
          ? "ready_with_failures"
          : "generating_identities";
      await tx.audienceSamplingPlan.update({ where: { id: plan.id }, data: { status: planStatus, errorMessage: planStatus === "ready" ? null : (message ?? plan.errorMessage) } });
    }
    const nextStatus = plan && !plan.confirmedAt
      ? "planning_audience"
      : totalCount === 0
        ? run.status === "planning_audience" && message
          ? "planning_audience"
          : "draft"
        : readyCount > 0
          ? "audience_ready"
          : "generating_audience";
    if (run.status !== nextStatus || message) {
      await tx.testRun.update({
        where: { id: runId },
        data: { status: nextStatus, errorMessage: nextStatus === "audience_ready" ? null : (message ?? run.errorMessage) }
      });
    }
  }

  private async emitCompensatedProfileUpdates(runId: string, profileIds: string[]) {
    for (const profileId of unique(profileIds)) {
      const profile = await prisma.audienceProfile.findUnique({ where: { id: profileId } });
      if (!profile) continue;
      await this.emitProfileUpdated(runId, profile.id, profile.samplingLabel, profile.identityStatus);
    }
  }

  private async createAudiencePlanForJob(jobId: string) {
    const job = await prisma.audienceGenerationJob.findUnique({ where: { id: jobId } });
    if (!job) throw new ApiError("JOB_NOT_FOUND", "观众生成任务不存在", 404);
    const run = await prisma.testRun.findUnique({ where: { id: job.runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    const contentVersion = await this.requireContentVersion(job.runId);
    const imageUrls = contentImageUrls(contentVersion.imageUrlsJson, contentVersion.coverImageUrl);
    let frameSeq = 0;
    const draft = await this.generateAudienceSamplingPlanOrFail({
      runId: job.runId,
      jobId: job.id,
      title: contentVersion.title,
      coverImageUrl: contentVersion.coverImageUrl ?? "",
      imageUrls,
      bodyText: contentVersion.bodyText,
      count: job.targetCount,
      onReasoningDelta: async (_delta, meta) => {
        if (!(await this.isAudienceGenerationJobHeldByCurrentWorker(job.id))) return;
        const tokens = meta?.tokenEstimate ?? 0;
        if (!tokens) return;
        pushLiveEvent(job.runId, {
          sequence: "0",
          eventType: "audience.plan.progress",
          payload: {
            eventId: `reasoning-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: "audience.plan.progress",
            runId: job.runId,
            jobId: job.id,
            progress: {
              stage: "public_reasoning",
              label: "思考中",
              targetCount: job.targetCount,
              reasoningTokens: tokens,
              reasoningEstimated: true
            }
          }
        });
      },
      onProgress: async (progress) => {
        if (!(await this.isAudienceGenerationJobHeldByCurrentWorker(job.id))) return;
        await this.emitGenerationEvent(job.runId, "audience.plan.progress", { jobId: job.id, progress });
      },
      onFrame: async (frame, preview) => {
        if (!(await this.isAudienceGenerationJobHeldByCurrentWorker(job.id))) return;
        const currentFrameSeq = frameSeq++;
        await this.emitGenerationEvent(job.runId, "audience.plan.frame", {
          jobId: job.id,
          previewId: job.id,
          frameSeq: currentFrameSeq,
          frameIndex: currentFrameSeq,
          frame,
          preview
        });
      }
    });
    if (!(await this.isAudienceGenerationJobHeldByCurrentWorker(job.id))) {
      await this.compensateInactiveAudienceGenerationJob(job.id);
      return;
    }

    let planId = "";
    await prisma.$transaction(async (tx) => {
      await tx.audienceSamplingPlan.deleteMany({ where: { runId: job.runId } });
      const plan = await tx.audienceSamplingPlan.create({
        data: {
          runId: job.runId,
          generationJobId: job.id,
          totalCount: draft.totalCount,
          status: "planning",
          planMarkdown: draft.planMarkdown,
          dimensionsJson: cleanStrings(draft.dimensions),
          directives: {
            create: draft.directives.map((directive, index) => ({
              sortOrder: index,
              name: directive.name.trim(),
              description: directive.description.trim(),
              quantity: directive.quantity,
              diversityAxesJson: cleanStrings(directive.diversityAxes),
              rationale: directive.rationale.trim()
            }))
          }
        }
      });
      planId = plan.id;
      await tx.testRun.update({ where: { id: job.runId }, data: { status: "planning_audience", audienceCount: draft.totalCount } });
    });
    if (!planId) throw new ApiError("AUDIENCE_PLAN_FAILED", "观众采样计划未能写入", 500);
  }

  private async markAudienceSamplingPlanReady(jobId: string) {
    const job = await prisma.audienceGenerationJob.findUnique({ where: { id: jobId } });
    if (!job) throw new ApiError("JOB_NOT_FOUND", "观众生成任务不存在", 404);
    const plan = await prisma.audienceSamplingPlan.findFirst({
      where: { runId: job.runId, generationJobId: job.id },
      include: { directives: { orderBy: { sortOrder: "asc" } } }
    });
    if (!plan) throw new ApiError("AUDIENCE_PLAN_REQUIRED", "需要先生成观众采样计划", 409);
    const contentVersion = await this.requireContentVersion(job.runId);
    await prisma.audienceSamplingPlan.update({ where: { id: plan.id }, data: { status: "ready_for_review", errorMessage: null } });
    const view = await this.getAudienceSamplingPlan(job.runId);
    await this.emitGenerationEvent(job.runId, "audience.plan.ready", { jobId: job.id, contentVersionId: contentVersion.id, planId: plan.id, plan: view.plan });
    await this.writeRunLog(job.runId, "generation", `观众采样计划已生成，共 ${view.plan?.directives.length ?? 0} 类人群、${view.plan?.totalCount ?? 0} 位目标观众`);
  }

  private async runPipelineJob(jobId: string) {
    const job = await prisma.audienceGenerationJob.findUnique({ where: { id: jobId } });
    if (!job) throw new ApiError("JOB_NOT_FOUND", "观众生成任务不存在", 404);
    const plan = await prisma.audienceSamplingPlan.findFirst({
      where: { id: job.samplingPlanId ?? undefined, runId: job.runId },
      include: { directives: { orderBy: { sortOrder: "asc" } } }
    });
    if (!plan || !plan.confirmedAt) throw new ApiError("AUDIENCE_PLAN_REQUIRED", "需要先确认观众采样计划", 409);
    const contentVersion = await this.requireContentVersion(job.runId);
    const imageUrls = contentImageUrls(contentVersion.imageUrlsJson, contentVersion.coverImageUrl);
    const allDirectives = job.samplingDirectiveId
      ? plan.directives.filter((directive) => directive.id === job.samplingDirectiveId)
      : plan.directives;
    if (!allDirectives.length) throw new ApiError("DIRECTIVE_NOT_FOUND", "人群计划项不存在", 404);

    await prisma.audienceSamplingPlan.update({ where: { id: plan.id }, data: { status: "expanding_profiles" } });
    await this.emitGenerationEvent(job.runId, "audience.profile.expansion.started", { jobId: job.id, planId: plan.id });
    const planView = await this.buildProviderPlanView(plan.id);
    const concurrency = Math.max(job.batchSize, 1);
    const chunkSize = 10; // Default chunk size for profile expansion

    let expansionFinished = false;
    let identityPoolError: unknown;
    const identityPoolPromise = this.startIdentityGenerationPool(job.id, job.runId, () => expansionFinished)
      .catch((error) => {
        identityPoolError = error;
      });

    let firstError: unknown;
    try {
      await mapWithConcurrency(allDirectives, concurrency, async (directive) => {
        if (!(await this.isAudienceGenerationJobHeldByCurrentWorker(job.id))) {
          await this.compensateInactiveAudienceGenerationJob(job.id);
          throw new ApiError("JOB_INACTIVE", "任务已被其他 worker 接管或已取消", 409);
        }
        await prisma.audienceSamplingDirective.update({ where: { id: directive.id }, data: { expansionStatus: "generating", expansionError: null } });
        await this.emitGenerationEvent(job.runId, "audience.profile.expansion.directive_started", { jobId: job.id, planId: plan.id, directiveId: directive.id });
        try {
          await prisma.$transaction(async (tx) => {
            const oldProfiles = await tx.audienceProfile.findMany({
              where: { runId: job.runId, samplingDirectiveId: directive.id },
              select: { id: true, generatedUserId: true, generatedAgentId: true, generatedPlatformAccountId: true }
            });
            for (const oldProfile of oldProfiles) await cleanupProfileIdentity(tx, oldProfile);
            await tx.audienceProfile.deleteMany({ where: { runId: job.runId, samplingDirectiveId: directive.id } });
          });
          // Expand profiles in chunks
          const totalQuantity = directive.quantity;
          for (let chunkStart = 0; chunkStart < totalQuantity; chunkStart += chunkSize) {
            if (!(await this.isAudienceGenerationJobHeldByCurrentWorker(job.id))) {
              await this.compensateInactiveAudienceGenerationJob(job.id);
              throw new ApiError("JOB_INACTIVE", "任务已被其他 worker 接管或已取消", 409);
            }
            const chunkCount = Math.min(chunkSize, totalQuantity - chunkStart);
            const createdCount = await this.expandAudienceProfilesChunk({
              title: contentVersion.title,
              coverImageUrl: contentVersion.coverImageUrl ?? "",
              imageUrls,
              bodyText: contentVersion.bodyText,
              plan: planView,
              directive: directiveToProviderView(directive),
              chunkStart,
              chunkCount,
              jobId: job.id,
              runId: job.runId,
              planId: plan.id
            });
            if (createdCount !== chunkCount) {
              throw new Error(`AUDIENCE_PROFILE_EXPANSION_FAILED: chunk ${chunkStart} expected ${chunkCount} profiles, received ${createdCount}.`);
            }
          }

          await prisma.audienceSamplingDirective.update({
            where: { id: directive.id },
            data: { expansionStatus: "ready", expansionError: null }
          });
          await this.emitGenerationEvent(job.runId, "audience.profile.expansion.directive_ready", {
            jobId: job.id,
            planId: plan.id,
            directiveId: directive.id,
            profileCreatedCount: directive.quantity,
            directiveProgress: await this.buildDirectiveProgress(directive.id)
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await prisma.audienceSamplingDirective.update({
            where: { id: directive.id },
            data: { expansionStatus: "failed", expansionError: message }
          });
          await this.emitGenerationEvent(job.runId, "audience.profile.expansion.directive_failed", { jobId: job.id, planId: plan.id, directiveId: directive.id, errorMessage: message });
          throw error;
        }
      });
    } catch (error) {
      firstError = error;
    } finally {
      expansionFinished = true;
    }

    if (firstError) {
      const message = firstError instanceof Error ? firstError.message : String(firstError);
      await prisma.audienceSamplingPlan.update({ where: { id: plan.id }, data: { status: "failed", errorMessage: message } });
      throw firstError;
    }
    await identityPoolPromise;
    if (identityPoolError) throw identityPoolError;
    if (!(await this.isAudienceGenerationJobHeldByCurrentWorker(job.id))) {
      await this.compensateInactiveAudienceGenerationJob(job.id);
      return;
    }
    await prisma.audienceSamplingPlan.update({ where: { id: plan.id }, data: { status: "ready", errorMessage: null } });
    await this.emitGenerationEvent(job.runId, "audience.profile.expansion.ready", { jobId: job.id, planId: plan.id });
  }

  private async startIdentityGenerationPool(jobId: string, runId: string, isExpansionFinished: () => boolean): Promise<void> {
    const batchSize = 10;

    const processProfiles = async () => {
      while (true) {
        if (!(await this.isAudienceGenerationJobHeldByCurrentWorker(jobId))) {
          break;
        }

        // Claim profiles atomically
        const claimed = await prisma.$transaction(async (tx) => {
          const profiles = await tx.audienceProfile.findMany({
            where: {
              runId,
              generationJobId: jobId,
              identityStatus: "profile_only"
            },
            orderBy: { sortOrder: "asc" },
            take: batchSize
          });

          if (!profiles.length) return [];

          await tx.audienceProfile.updateMany({
            where: { id: { in: profiles.map(p => p.id) }, identityStatus: "profile_only" },
            data: { generationJobId: jobId, identityStatus: "identity_queued", identityError: null }
          });

          return profiles;
        });

        if (!claimed.length) {
          const pendingCount = await prisma.audienceProfile.count({
            where: {
              runId,
              generationJobId: jobId,
              identityStatus: { in: ["profile_only", "identity_queued", "identity_generating"] }
            }
          });
          if (pendingCount === 0 && isExpansionFinished()) break;
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }

        // Generate identities concurrently
        await mapWithConcurrency(claimed, batchSize, async (profile) => {
          if (!(await this.isAudienceGenerationJobHeldByCurrentWorker(jobId))) {
            return;
          }
          await this.generateAudienceIdentityInternal(runId, profile.id, { jobId, continueOnFailure: true });
        });
      }
    };

    await processProfiles();
  }

  private async expandAudienceProfilesChunk(input: {
    title: string;
    coverImageUrl: string;
    imageUrls: string[];
    bodyText: string;
    plan: AudienceSamplingPlanViewForProvider;
    directive: AudienceSamplingDirectiveView;
    chunkStart: number;
    chunkCount: number;
    jobId: string;
    runId: string;
    planId: string;
  }): Promise<number> {
    const provider = this.getAgentProvider();
    let createdCount = 0;
    const seenIndexes = new Set<number>();
    const createProfile = async (sampleIndex: number, profile: AudienceProfilePlan) => {
      if (!(await this.isAudienceGenerationJobHeldByCurrentWorker(input.jobId))) {
        throw new ApiError("JOB_INACTIVE", "任务已被其他 worker 接管或已取消", 409);
      }
      if (sampleIndex < input.chunkStart || sampleIndex >= input.chunkStart + input.chunkCount) {
        throw new Error(`AUDIENCE_PROFILE_EXPANSION_FAILED: sampleIndex ${sampleIndex} outside chunk range.`);
      }
      if (seenIndexes.has(sampleIndex)) {
        throw new Error(`AUDIENCE_PROFILE_EXPANSION_FAILED: duplicate sampleIndex ${sampleIndex}.`);
      }
      seenIndexes.add(sampleIndex);
      const missingFields = REQUIRED_DEMOGRAPHICS_FIELDS.filter(f => !(f in (profile.demographics ?? {})));
      if (missingFields.length > 0) {
        throw new Error(`Profile missing required demographics fields: ${missingFields.join(', ')}`);
      }
      const created = await prisma.audienceProfile.create({
        data: {
          runId: input.runId,
          samplingPlanId: input.planId,
          samplingDirectiveId: input.directive.id,
          sampleIndex,
          generationJobId: input.jobId,
          sortOrder: input.directive.sortOrder * 1000 + sampleIndex,
          samplingLabel: profile.samplingLabel,
          demographicsJson: profile.demographics as Prisma.InputJsonValue,
          identityStatus: "profile_only"
        },
        select: { id: true }
      });
      createdCount += 1;
      await this.emitGenerationEvent(input.runId, "audience.profile.created", {
        jobId: input.jobId,
        planId: input.planId,
        profileId: created.id,
        directiveId: input.directive.id,
        sampleIndex,
        samplingLabel: profile.samplingLabel,
        demographics: profile.demographics
      });
    };

    const preparedImageUrls = await this.prepareAgentImageUrls(input.imageUrls);
    await provider.expandAudienceProfiles({
      title: input.title,
      coverImageUrl: preparedImageUrls[0] ?? input.coverImageUrl,
      imageUrls: preparedImageUrls,
      bodyText: input.bodyText,
      plan: input.plan,
      directive: input.directive,
      chunkStart: input.chunkStart,
      chunkCount: input.chunkCount,
      trace: {
        runId: input.runId,
        jobId: input.jobId,
        metadata: { directiveId: input.directive.id }
      },
      onFrame: async (frame: import("@trycue/shared").AudienceProfileExpansionFrame) => {
        if (frame.type !== "profile_completed") {
          throw new Error(`AUDIENCE_PROFILE_EXPANSION_FAILED: ${frame.message}`);
        }
        await createProfile(frame.sampleIndex, frame.profile);
      }
    });
    if (createdCount !== input.chunkCount) {
      throw new Error(`AUDIENCE_PROFILE_EXPANSION_FAILED: chunk ${input.chunkStart} expected ${input.chunkCount} profiles, received ${createdCount}.`);
    }
    return createdCount;
  }

  private async generateIdentitiesForJob(jobId: string) {
    const job = await prisma.audienceGenerationJob.findUnique({ where: { id: jobId } });
    if (!job) throw new ApiError("JOB_NOT_FOUND", "观众生成任务不存在", 404);
    const directives = await prisma.audienceSamplingDirective.findMany({
      where: { plan: { runId: job.runId } },
      orderBy: { sortOrder: "asc" }
    });
    for (const directive of directives) {
      while (true) {
        if (!(await this.isAudienceGenerationJobHeldByCurrentWorker(job.id))) {
          await this.compensateInactiveAudienceGenerationJob(job.id);
          return;
        }
        const heartbeat = await prisma.audienceGenerationJob.updateMany({
          where: { id: job.id, active: true, status: "generating", lockedBy: this.generationWorkerId, lockedUntil: { gt: new Date() } },
          data: { heartbeatAt: new Date(), lockedUntil: new Date(Date.now() + AUDIENCE_JOB_LOCK_DURATION_MS) }
        });
        if (heartbeat.count === 0) {
          await this.compensateInactiveAudienceGenerationJob(job.id);
          return;
        }
        const batch = await prisma.audienceProfile.findMany({
          where: {
            runId: job.runId,
            samplingDirectiveId: directive.id,
            OR: [
              { identityStatus: "profile_only" },
              {
                identityStatus: "identity_failed",
                OR: [{ generationJobId: null }, { generationJobId: { not: job.id } }]
              }
            ]
          },
          orderBy: { sortOrder: "asc" },
          take: job.batchSize
        });
        if (!batch.length) break;
        await prisma.audienceProfile.updateMany({
          where: { id: { in: batch.map((profile) => profile.id) } },
          data: { generationJobId: job.id, identityStatus: "identity_queued", identityError: null }
        });
        await this.emitGenerationEvent(job.runId, "audience.identity.started", {
          jobId: job.id,
          directiveId: directive.id,
          profileIds: batch.map((profile) => profile.id),
          directiveProgress: await this.buildDirectiveProgress(directive.id)
        });
        await mapWithConcurrency(batch, Math.max(job.batchSize, 1), async (profile) => {
          if (!(await this.isAudienceGenerationJobHeldByCurrentWorker(job.id))) {
            await this.compensateInactiveAudienceGenerationJob(job.id);
            throw new ApiError("JOB_INACTIVE", "任务已被其他 worker 接管或已取消", 409);
          }
          await this.generateAudienceIdentityInternal(job.runId, profile.id, { jobId: job.id, continueOnFailure: true });
        });
        if (!(await this.isAudienceGenerationJobHeldByCurrentWorker(job.id))) {
          await this.compensateInactiveAudienceGenerationJob(job.id);
          return;
        }
      }
    }
  }

  private async generateSingleIdentityForJob(jobId: string) {
    const job = await prisma.audienceGenerationJob.findUnique({ where: { id: jobId } });
    if (!job) throw new ApiError("JOB_NOT_FOUND", "观众生成任务不存在", 404);
    if (!job.profileId) throw new ApiError("VALIDATION_ERROR", "单个人设生成任务缺少 profileId", 400);
    const profile = await prisma.audienceProfile.findUnique({ where: { id: job.profileId } });
    if (!profile || profile.runId !== job.runId) throw new ApiError("PROFILE_NOT_FOUND", "画像不存在", 404);
    if (!(await this.isAudienceGenerationJobHeldByCurrentWorker(job.id))) {
      await this.compensateInactiveAudienceGenerationJob(job.id);
      return;
    }
    const queued = await prisma.audienceProfile.updateMany({
      where: {
        id: profile.id,
        runId: job.runId,
        OR: [
          { identityStatus: { in: ["profile_only", "identity_failed", "identity_ready"] } },
          { identityStatus: "identity_queued", generationJobId: job.id }
        ]
      },
      data: { generationJobId: job.id, identityStatus: "identity_queued", identityError: null }
    });
    if (queued.count === 0) throw new ApiError("INVALID_IDENTITY_STATUS", "只有未生成、已生成或生成失败的画像才能生成人设", 409);
    await this.generateAudienceIdentityInternal(job.runId, profile.id, { jobId: job.id, continueOnFailure: true });
  }

  private async emitGenerationEvent(runId: string, eventType: Parameters<typeof recordLiveEvent>[1]["eventType"], payload: Record<string, unknown>) {
    const run = await prisma.testRun.findUnique({ where: { id: runId }, select: { audienceRevision: true } });
    const event = await recordLiveEvent(prisma, {
      runId,
      eventType,
      payload: { ...payload, audienceRevision: run?.audienceRevision ?? 0 }
    });
    pushLiveEvent(runId, event);
  }

  private async isAudienceGenerationJobActive(jobId: string) {
    const job = await prisma.audienceGenerationJob.findUnique({ where: { id: jobId } });
    return Boolean(job?.active && !["completed", "failed", "canceled"].includes(job.status));
  }

  async getAudienceSamplingPlan(runId: string): Promise<{ runId: string; plan: AudienceSamplingPlanView | null }> {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    const plan = await this.buildAudienceSamplingPlanView(runId);
    return { runId, plan };
  }

  async suggestAudienceSamplingPlanRevision(runId: string, input: CreateAudienceSamplingPlanRevisionSuggestionRequest) {
    const plan = await this.requireEditableSamplingPlan(runId);
    if (plan.status !== "ready_for_review") {
      throw new ApiError("INVALID_PLAN_STATUS", "只有待确认的观众计划可以优化分布", 409);
    }
    const planView = await this.buildProviderPlanView(plan.id);
    const directiveIds = new Set(planView.directives.map((directive) => directive.id));
    for (const message of input.messages) {
      for (const mention of message.hiddenMentionContexts) {
        if (!directiveIds.has(mention.directiveId)) {
          throw new ApiError("VALIDATION_ERROR", "引用的人群分组不属于当前采样计划", 400, { directiveId: mention.directiveId });
        }
      }
    }
    const contentVersion = await this.requireContentVersion(runId);
    const imageUrls = await this.prepareAgentImageUrls(contentImageUrls(contentVersion.imageUrlsJson, contentVersion.coverImageUrl));
    const proposal = await this.getAgentProvider().generateAudienceSamplingPlanRevision({
      title: contentVersion.title,
      coverImageUrl: imageUrls[0] ?? contentVersion.coverImageUrl ?? "",
      imageUrls,
      bodyText: contentVersion.bodyText,
      plan: planView,
      messages: input.messages,
      trace: { runId }
    });
    return { runId, proposal };
  }

  async suggestAudienceSeatRevision(runId: string, input: CreateAudienceSeatRevisionSuggestionRequest) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    if (!["generating_audience", "audience_ready"].includes(run.status)) {
      throw new ApiError("INVALID_RUN_STATUS", `当前状态 ${run.status} 不支持打磨观众人设`, 409);
    }
    const participantCount = await prisma.runParticipant.count({ where: { runId } });
    if (participantCount > 0) throw new ApiError("AUDIENCE_ALREADY_STARTED", "观众已入场，生成阶段观众人设已锁定", 409);
    const plan = await prisma.audienceSamplingPlan.findUnique({ where: { runId } });
    if (!plan?.confirmedAt) throw new ApiError("AUDIENCE_PLAN_REQUIRED", "需要先确认观众采样计划", 409);
    const [planView, progress, contentVersion] = await Promise.all([
      this.buildProviderPlanView(plan.id),
      this.getAudienceGeneration(runId),
      this.requireContentVersion(runId)
    ]);
    const directiveIds = new Set(planView.directives.map((directive) => directive.id));
    const profileIds = new Set(progress.profiles.flatMap((profile) => [profile.id, profile.profileId]));
    for (const message of input.messages) {
      for (const mention of message.hiddenMentionContexts) {
        if (mention.kind === "directive" && !directiveIds.has(mention.directiveId)) {
          throw new ApiError("VALIDATION_ERROR", "引用的人群分组不属于当前采样计划", 400, { directiveId: mention.directiveId });
        }
        if (mention.kind === "profile" && !profileIds.has(mention.profileId)) {
          throw new ApiError("VALIDATION_ERROR", "引用的观众不属于当前试映", 400, { profileId: mention.profileId });
        }
      }
    }
    const imageUrls = await this.prepareAgentImageUrls(contentImageUrls(contentVersion.imageUrlsJson, contentVersion.coverImageUrl));
    const proposal = await this.getAgentProvider().generateAudienceSeatRevision({
      title: contentVersion.title,
      coverImageUrl: imageUrls[0] ?? contentVersion.coverImageUrl ?? "",
      imageUrls,
      bodyText: contentVersion.bodyText,
      plan: planView,
      progress,
      messages: input.messages,
      trace: { runId }
    });
    return { runId, proposal };
  }

  async updateAudienceSamplingPlan(runId: string, input: UpdateAudienceSamplingPlanRequest) {
    const plan = await this.requireEditableSamplingPlan(runId);
    const updated = await prisma.audienceSamplingPlan.update({
      where: { id: plan.id },
      data: {
        ...(input.planMarkdown !== undefined ? { planMarkdown: input.planMarkdown } : {}),
        ...(input.dimensions !== undefined ? { dimensionsJson: cleanStrings(input.dimensions) } : {})
      }
    });
    const view = await this.buildAudienceSamplingPlanViewById(updated.id);
    await this.emitGenerationEvent(runId, "audience.plan.updated", { plan: view, validation: view.validation });
    return { runId, plan: view };
  }

  async createAudienceSamplingDirective(runId: string, input: CreateAudienceSamplingDirectiveRequest) {
    const plan = await this.requireEditableSamplingPlan(runId);
    const sortOrder = input.sortOrder ?? ((await prisma.audienceSamplingDirective.aggregate({
      where: { planId: plan.id },
      _max: { sortOrder: true }
    }))._max.sortOrder ?? -1) + 1;
    await prisma.$transaction(async (tx) => {
      await tx.audienceSamplingDirective.create({
        data: {
          planId: plan.id,
          sortOrder,
          name: input.name,
          description: input.description,
          quantity: input.quantity,
          diversityAxesJson: cleanStrings(input.diversityAxes),
          rationale: input.rationale
        }
      });
      await syncEditableSamplingPlanTotal(tx, runId, plan.id);
    });
    const view = await this.buildAudienceSamplingPlanViewById(plan.id);
    await this.emitGenerationEvent(runId, "audience.plan.updated", { plan: view, validation: view.validation });
    return { runId, plan: view };
  }

  async updateAudienceSamplingDirective(runId: string, directiveId: string, input: UpdateAudienceSamplingDirectiveRequest) {
    const plan = await this.requireEditableSamplingPlan(runId);
    const directive = await prisma.audienceSamplingDirective.findUnique({ where: { id: directiveId } });
    if (!directive || directive.planId !== plan.id) throw new ApiError("DIRECTIVE_NOT_FOUND", "人群计划项不存在", 404);
    await prisma.$transaction(async (tx) => {
      await tx.audienceSamplingDirective.update({
        where: { id: directiveId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
          ...(input.diversityAxes !== undefined ? { diversityAxesJson: cleanStrings(input.diversityAxes) } : {}),
          ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {})
        }
      });
      await syncEditableSamplingPlanTotal(tx, runId, plan.id);
    });
    const view = await this.buildAudienceSamplingPlanViewById(plan.id);
    await this.emitGenerationEvent(runId, "audience.plan.updated", { plan: view, validation: view.validation });
    return { runId, plan: view };
  }

  async deleteAudienceSamplingDirective(runId: string, directiveId: string) {
    const plan = await this.requireEditableSamplingPlan(runId);
    const directive = await prisma.audienceSamplingDirective.findUnique({ where: { id: directiveId } });
    if (!directive || directive.planId !== plan.id) throw new ApiError("DIRECTIVE_NOT_FOUND", "人群计划项不存在", 404);
    await prisma.$transaction(async (tx) => {
      await tx.audienceSamplingDirective.delete({ where: { id: directiveId } });
      await syncEditableSamplingPlanTotal(tx, runId, plan.id);
    });
    const view = await this.buildAudienceSamplingPlanViewById(plan.id);
    await this.emitGenerationEvent(runId, "audience.plan.updated", { plan: view, validation: view.validation });
    return { runId, plan: view };
  }

  async confirmAudienceSamplingPlan(runId: string) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    this.assertAudienceEditableRun(run.status);
    // Guard: SQLite serializes write transactions; the plan.status check below prevents duplicate expansion jobs.
    const job = await prisma.$transaction(async (tx) => {
      const activeJob = await tx.audienceGenerationJob.findFirst({
        where: { runId, active: true, status: { in: activeAudienceGenerationJobStatuses } }
      });
      if (activeJob) throw new ApiError("AUDIENCE_GENERATION_ACTIVE", "观众生成任务仍在执行，请等待完成或取消后再开始试映", 409, jobView(activeJob));
      const plan = await tx.audienceSamplingPlan.findUnique({ where: { runId }, include: { directives: true } });
      if (!plan) throw new ApiError("AUDIENCE_PLAN_REQUIRED", "需要先生成观众采样计划", 409);
      if (plan.status !== "ready_for_review") throw new ApiError("INVALID_PLAN_STATUS", "只有待确认的观众计划可以确认", 409);
      const quantityTotal = directiveQuantityTotal(plan.directives);
      const validation = samplingPlanValidation(quantityTotal ?? plan.totalCount, plan.directives);
      if (!validation.isQuantityValid || plan.directives.length === 0) throw new ApiError("AUDIENCE_PLAN_INVALID", "人群计划数量不合法", 400, validation);
      await tx.audienceSamplingPlan.update({
        where: { id: plan.id },
        data: {
          confirmedAt: new Date(),
          status: "expanding_profiles",
          totalCount: quantityTotal,
          errorMessage: null
        }
      });
      await tx.testRun.update({ where: { id: runId }, data: { status: "generating_audience", audienceCount: quantityTotal, errorMessage: null } });
      return tx.audienceGenerationJob.create({
        data: {
          runId,
          scope: "profile_expansion",
          samplingPlanId: plan.id,
          targetCount: quantityTotal,
          batchSize: 10
        }
      });
    });
    await this.emitGenerationEvent(runId, "audience.plan.confirmed", { planId: job.samplingPlanId, totalCount: job.targetCount });
    this.startAudienceGenerationJob(job.id);
    return { runId, job: jobView(job), progress: await this.getAudienceGeneration(runId) };
  }

  async clearGeneratedAudience(runId: string) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    this.assertAudienceEditableRun(run.status);
    await this.assertNoActiveAudienceGenerationJob(runId);
    await this.assertNoRuntimeAudienceReferences(runId);

    const plan = await prisma.audienceSamplingPlan.findUnique({ where: { runId }, include: { directives: true } });
    if (!plan) throw new ApiError("AUDIENCE_PLAN_REQUIRED", "需要先生成观众采样计划", 409);
    if (!plan.confirmedAt) throw new ApiError("PLAN_NOT_CONFIRMED", "当前观众结构尚未确认，无需清空观众", 409);

    // Guard: concurrent clear calls are effectively idempotent — second call finds no profiles to delete.
    await prisma.$transaction(async (tx) => {
      const activeJob = await tx.audienceGenerationJob.findFirst({
        where: { runId, active: true, status: { in: activeAudienceGenerationJobStatuses } }
      });
      if (activeJob) throw new ApiError("AUDIENCE_GENERATION_ACTIVE", "观众生成任务仍在执行，请等待完成或取消后再清空观众", 409, jobView(activeJob));
      await cleanupProfilesForReplan(tx, runId);
      await tx.audienceSamplingDirective.updateMany({
        where: { planId: plan.id },
        data: { expansionStatus: "pending", expansionError: null }
      });
      await tx.audienceSamplingPlan.update({
        where: { id: plan.id },
        data: { confirmedAt: null, status: "ready_for_review", errorMessage: null }
      });
      await tx.testRun.update({
        where: { id: runId },
        data: { status: "planning_audience", audienceCount: plan.totalCount, errorMessage: null, audienceRevision: { increment: 1 } }
      });
    });

    const view = await this.buildAudienceSamplingPlanViewById(plan.id);
    await this.emitGenerationEvent(runId, "audience.plan.updated", { plan: view, validation: view.validation });
    await this.writeRunLog(runId, "control", "已清空观众，回到观众结构审阅");
    return { runId, plan: view, progress: await this.getAudienceGeneration(runId) };
  }

  async retryAudienceDirectiveExpansion(runId: string, directiveId: string) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    if (["running", "paused", "report_generating", "completed"].includes(run.status)) {
      throw new ApiError("INVALID_RUN_STATUS", "当前状态不允许重试人群展开", 409);
    }
    await this.assertNoActiveAudienceGenerationJob(runId);
    const directive = await prisma.audienceSamplingDirective.findUnique({ where: { id: directiveId }, include: { plan: true } });
    if (!directive || directive.plan.runId !== runId) throw new ApiError("DIRECTIVE_NOT_FOUND", "人群计划项不存在", 404);
    if (!directive.plan.confirmedAt) throw new ApiError("INVALID_PLAN_STATUS", "只有确认后的计划可以重试人群展开", 409);
    if (directive.expansionStatus !== "failed") throw new ApiError("INVALID_DIRECTIVE_STATUS", "只有展开失败的人群计划项可以重试", 409);
    const job = await prisma.$transaction(async (tx) => {
      const profiles = await tx.audienceProfile.findMany({ where: { runId, samplingDirectiveId: directive.id } });
      for (const profile of profiles) await cleanupProfileIdentity(tx, profile);
      await tx.audienceProfile.deleteMany({ where: { runId, samplingDirectiveId: directive.id } });
      await tx.audienceSamplingDirective.update({ where: { id: directive.id }, data: { expansionStatus: "pending", expansionError: null } });
      await tx.audienceSamplingPlan.update({ where: { id: directive.planId }, data: { status: "expanding_profiles", errorMessage: null } });
      await tx.testRun.update({ where: { id: runId }, data: { status: "generating_audience", errorMessage: null } });
      return tx.audienceGenerationJob.create({
        data: {
          runId,
          scope: "profile_expansion",
          samplingPlanId: directive.planId,
          samplingDirectiveId: directive.id,
          targetCount: directive.quantity,
          batchSize: 10
        }
      });
    });
    this.startAudienceGenerationJob(job.id);
    return { runId, job: jobView(job), progress: await this.getAudienceGeneration(runId) };
  }

  async retryAudienceIdentities(runId: string, input: RetryAudienceIdentitiesRequest) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    this.assertAudienceEditableRun(run.status);
    await this.assertNoActiveAudienceGenerationJob(runId);
    const requestedProfileIds = unique(input.profileIds);
    const where: Prisma.AudienceProfileWhereInput = requestedProfileIds.length
      ? { runId, id: { in: requestedProfileIds }, identityStatus: "identity_failed" }
      : { runId, identityStatus: "identity_failed" };
    const profiles = await prisma.audienceProfile.findMany({ where, orderBy: [{ samplingDirectiveId: "asc" }, { sortOrder: "asc" }] });
    const targetCount = profiles.length;
    if (requestedProfileIds.length && targetCount !== requestedProfileIds.length) {
      throw new ApiError("INVALID_PROFILE_IDS", "只能重试当前试映下生成失败的人设", 400, {
        requestedProfileIds,
        retryableProfileIds: profiles.map((profile) => profile.id)
      });
    }
    if (targetCount === 0) throw new ApiError("NO_FAILED_AUDIENCE_IDENTITIES", "没有可重试的人设", 409);
    const plan = await prisma.audienceSamplingPlan.findUnique({ where: { runId } });
    if (requestedProfileIds.length) {
      const jobs = await prisma.$transaction(async (tx) => {
        await tx.testRun.update({ where: { id: runId }, data: { status: "generating_audience", errorMessage: null } });
        const createdJobs: AudienceGenerationJob[] = [];
        for (const profile of profiles) {
          createdJobs.push(await tx.audienceGenerationJob.create({
            data: {
              runId,
              scope: "single_identity",
              profileId: profile.id,
              samplingPlanId: plan?.id,
              samplingDirectiveId: profile.samplingDirectiveId,
              targetCount: 1,
              batchSize: 1
            }
          }));
        }
        return createdJobs;
      });
      for (const job of jobs) this.startAudienceGenerationJob(job.id);
      return { runId, job: jobView(jobs[0]!), jobs: jobs.map(jobView), progress: await this.getAudienceGeneration(runId) };
    }
    const job = await prisma.$transaction(async (tx) => {
      await tx.testRun.update({ where: { id: runId }, data: { status: "generating_audience", errorMessage: null } });
      return tx.audienceGenerationJob.create({
        data: {
          runId,
          scope: "identities",
          samplingPlanId: plan?.id,
          targetCount,
          batchSize: 10
        }
      });
    });
    this.startAudienceGenerationJob(job.id);
    return { runId, job: jobView(job), progress: await this.getAudienceGeneration(runId) };
  }

  async regenerateAudienceIdentity(runId: string, profileId: string) {
    const profile = await this.requireMutableProfile(runId, profileId);
    if (!["profile_only", "identity_failed", "identity_ready"].includes(profile.identityStatus)) {
      throw new ApiError("INVALID_IDENTITY_STATUS", "只有未生成、已生成或生成失败的画像才能生成人设", 409);
    }
    await this.assertNoActiveAudienceGenerationJob(runId);
    const plan = await prisma.audienceSamplingPlan.findUnique({ where: { runId } });
    const job = await prisma.$transaction(async (tx) => {
      await tx.testRun.update({ where: { id: runId }, data: { status: "generating_audience", errorMessage: null } });
      return tx.audienceGenerationJob.create({
        data: {
          runId,
          scope: "single_identity",
          profileId: profile.id,
          samplingPlanId: plan?.id,
          samplingDirectiveId: profile.samplingDirectiveId,
          targetCount: 1,
          batchSize: 1
        }
      });
    });
    this.startAudienceGenerationJob(job.id);
    return { runId, job: jobView(job), progress: await this.getAudienceGeneration(runId) };
  }

  async getAudienceGeneration(runId: string): Promise<AudienceGenerationProgressView> {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    return this.buildAudienceGenerationProgress(runId);
  }

  async listAudiences(runId: string) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    const participants = await prisma.runParticipant.findMany({ where: { runId }, orderBy: [{ samplingDirectiveId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] });
    return { participants: participants.map(participantView) };
  }

  async updateAudienceIdentity(runId: string, profileId: string, input: UpdateAudienceIdentityRequest) {
    const profile = await this.requireMutableProfile(runId, profileId);
    if (profile.identityStatus !== "identity_ready" || !profile.generatedAgentId || !profile.generatedPlatformAccountId || !profile.generatedUserId) {
      throw new ApiError("IDENTITY_NOT_READY", "只有已生成人设的画像才能编辑人设", 409);
    }
    const updated = await prisma.$transaction(async (tx) => {
      if (input.displayName !== undefined) {
        await tx.user.update({ where: { id: profile.generatedUserId! }, data: { nickname: input.displayName } });
      }
      if (input.avatarUrl !== undefined) {
        await tx.user.update({ where: { id: profile.generatedUserId! }, data: { avatarUrl: input.avatarUrl } });
      }
      if (input.personaJson !== undefined) {
        await tx.agent.update({ where: { id: profile.generatedAgentId! }, data: { personaJson: input.personaJson as Prisma.InputJsonValue } });
      }
      if (input.favorited !== undefined) {
        await tx.agent.update({ where: { id: profile.generatedAgentId! }, data: { favoritedAt: input.favorited ? new Date() : null } });
      }
      await tx.testRun.update({ where: { id: runId }, data: { audienceRevision: { increment: 1 } } });
      return tx.audienceProfile.findUniqueOrThrow({
        where: { id: profile.id },
        include: profileViewInclude
      });
    });
    await this.writeRunLog(runId, "control", `人设 ${updated.samplingLabel} 已编辑`);
    return profileView(updated);
  }

  async favoriteAudienceIdentity(runId: string, profileId: string, input: FavoriteAudienceIdentityRequest) {
    const profile = await this.requireMutableProfile(runId, profileId);
    if (profile.identityStatus !== "identity_ready" || !profile.generatedAgentId || !profile.generatedPlatformAccountId || !profile.generatedUserId) {
      throw new ApiError("IDENTITY_NOT_READY", "只有已生成人设的画像才能收藏人设", 409);
    }
    const updated = await prisma.$transaction(async (tx) => {
      await tx.agent.update({ where: { id: profile.generatedAgentId! }, data: { favoritedAt: input.favorited ? new Date() : null } });
      await tx.testRun.update({ where: { id: runId }, data: { audienceRevision: { increment: 1 } } });
      return tx.audienceProfile.findUniqueOrThrow({ where: { id: profile.id }, include: profileViewInclude });
    });
    await this.writeRunLog(runId, "control", `人设 ${updated.samplingLabel} 已${input.favorited ? "收藏为可复用身份" : "取消收藏"}`);
    return profileView(updated);
  }

  async createAudienceProfile(runId: string, input: CreateAudienceProfileRequest) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    this.assertAudienceEditableRun(run.status);
    const participantCount = await prisma.runParticipant.count({ where: { runId } });
    if (participantCount > 0) throw new ApiError("AUDIENCE_ALREADY_STARTED", "观众已入场，不能再新增生成阶段观众", 409);
    const activeJob = await prisma.audienceGenerationJob.findFirst({
      where: { runId, active: true, status: { in: activeAudienceGenerationJobStatuses } },
      orderBy: { createdAt: "desc" }
    });
    if (activeJob && ["sampling_plan", "profile_expansion"].includes(activeJob.scope)) {
      throw new ApiError("AUDIENCE_GENERATION_ACTIVE", "观众分组仍在展开，请等待完成后再新增观众", 409, jobView(activeJob));
    }
    const plan = await prisma.audienceSamplingPlan.findUnique({ where: { runId } });
    if (!plan?.confirmedAt) throw new ApiError("AUDIENCE_PLAN_REQUIRED", "需要先确认观众采样计划", 409);
    const directive = await prisma.audienceSamplingDirective.findUnique({ where: { id: input.directiveId } });
    if (!directive || directive.planId !== plan.id) throw new ApiError("DIRECTIVE_NOT_FOUND", "人群计划项不存在", 404);

    // Guard: SQLite serializes write transactions; the aggregate query re-reads max(sampleIndex) inside the
    // transaction, so a concurrent caller that waits will see the updated value. The unique constraint
    // ux_audience_profiles_directive_sample on (samplingDirectiveId, sampleIndex) provides a final safety net.
    const { profile, job } = await prisma.$transaction(async (tx) => {
      const lockedPlan = await tx.audienceSamplingPlan.findUniqueOrThrow({ where: { id: plan.id } });
      const lockedDirective = await tx.audienceSamplingDirective.findUniqueOrThrow({ where: { id: directive.id } });
      if (lockedDirective.planId !== lockedPlan.id) throw new ApiError("DIRECTIVE_NOT_FOUND", "人群计划项不存在", 404);
      const aggregate = await tx.audienceProfile.aggregate({
        where: { samplingDirectiveId: lockedDirective.id },
        _max: { sampleIndex: true }
      });
      const sampleIndex = (aggregate._max.sampleIndex ?? -1) + 1;
      const samplingLabel = input.samplingLabel?.trim() || `${lockedDirective.name || "新增观众"} ${sampleIndex + 1}`;
      const created = await tx.audienceProfile.create({
        data: {
          runId,
          samplingPlanId: lockedPlan.id,
          samplingDirectiveId: lockedDirective.id,
          sampleIndex,
          sortOrder: lockedDirective.sortOrder * 1000 + sampleIndex,
          samplingLabel,
          demographicsJson: input.demographics as Prisma.InputJsonValue,
          identityStatus: "profile_only"
        }
      });
      const nextPlanTotal = lockedPlan.totalCount + 1;
      await tx.audienceSamplingDirective.update({
        where: { id: lockedDirective.id },
        data: { quantity: { increment: 1 } }
      });
      await tx.audienceSamplingPlan.update({
        where: { id: lockedPlan.id },
        data: {
          totalCount: nextPlanTotal,
          status: "generating_identities",
          errorMessage: null
        }
      });
      await tx.testRun.update({ where: { id: runId }, data: { audienceCount: nextPlanTotal, status: "generating_audience", errorMessage: null, audienceRevision: { increment: 1 } } });
      const generationJob = await tx.audienceGenerationJob.create({
        data: {
          runId,
          scope: "single_identity",
          profileId: created.id,
          samplingPlanId: lockedPlan.id,
          samplingDirectiveId: lockedDirective.id,
          targetCount: 1,
          batchSize: 1
        }
      });
      const queued = await tx.audienceProfile.update({
        where: { id: created.id },
        data: { generationJobId: generationJob.id, identityStatus: "identity_queued", identityError: null },
        include: profileViewInclude
      });
      return { profile: queued, job: generationJob };
    });

    const planView = await this.buildAudienceSamplingPlanViewById(plan.id);
    await this.emitGenerationEvent(runId, "audience.plan.updated", { plan: planView, validation: planView.validation });
    await this.emitProfileUpdated(runId, profile.id, profile.samplingLabel, profile.identityStatus, job.id);
    await this.writeRunLog(runId, "control", `新增观众 ${profile.samplingLabel}，已开始生成人设`);
    this.startAudienceGenerationJob(job.id);
    return { profile: profileView(profile), plan: planView, job: jobView(job), progress: await this.getAudienceGeneration(runId) };
  }

  async deleteAudienceProfile(runId: string, profileId: string) {
    const profile = await this.requireMutableProfile(runId, profileId);
    const identityIds = profileIdentityIds(profile);
    let planIdToEmit: string | null = null;
    // Guard: SQLite serializes write transactions; concurrent delete calls will read the updated totalCount.
    await prisma.$transaction(async (tx) => {
      if (profile.samplingPlanId && profile.samplingDirectiveId) {
        const lockedPlan = await tx.audienceSamplingPlan.findUnique({ where: { id: profile.samplingPlanId } });
        const lockedDirective = await tx.audienceSamplingDirective.findUnique({ where: { id: profile.samplingDirectiveId } });
        if (lockedPlan && lockedDirective && lockedDirective.planId === lockedPlan.id) {
          const nextPlanTotal = Math.max(0, lockedPlan.totalCount - 1);
          await tx.audienceSamplingDirective.update({
            where: { id: lockedDirective.id },
            data: { quantity: Math.max(0, lockedDirective.quantity - 1) }
          });
          await tx.audienceSamplingPlan.update({
            where: { id: lockedPlan.id },
            data: { totalCount: nextPlanTotal }
          });
          await tx.testRun.update({ where: { id: runId }, data: { audienceCount: nextPlanTotal, audienceRevision: { increment: 1 } } });
          planIdToEmit = lockedPlan.id;
        }
      }
      await tx.audienceProfile.delete({ where: { id: profileId } });
      if (!planIdToEmit) {
        await tx.testRun.update({ where: { id: runId }, data: { audienceRevision: { increment: 1 } } });
      }
    });
    await cleanupUnreferencedRunLocalIdentities(identityIds);
    await this.updateAudienceReadiness(runId);
    if (planIdToEmit) {
      const planView = await this.buildAudienceSamplingPlanViewById(planIdToEmit);
      await this.emitGenerationEvent(runId, "audience.plan.updated", { plan: planView, validation: planView.validation });
    }
    await this.writeRunLog(runId, "control", `观众 ${profile.samplingLabel} 已删除`);
    return { profileId, status: "deleted" };
  }

  private async generateAudienceIdentityInternal(runId: string, profileId: string, options: { jobId?: string; continueOnFailure: boolean }) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    this.assertAudienceEditableRun(run.status);
    const profile = await prisma.audienceProfile.findUnique({ where: { id: profileId } });
    if (!profile || profile.runId !== runId) throw new ApiError("PROFILE_NOT_FOUND", "画像不存在", 404);
    if (profile.identityStatus === "identity_generating") throw new ApiError("IDENTITY_GENERATING", "该画像人设正在生成中", 409);
    if (!["profile_only", "identity_queued", "identity_failed", "identity_ready"].includes(profile.identityStatus)) {
      throw new ApiError("INVALID_IDENTITY_STATUS", "只有未生成、已生成或生成失败的画像才能生成人设", 409);
    }
    await prisma.audienceProfile.update({
      where: { id: profileId },
      data: { identityStatus: "identity_generating", identityError: null, generationJobId: options.jobId }
    });
    await this.emitProfileUpdated(runId, profile.id, profile.samplingLabel, "identity_generating", options.jobId, "audience.identity.started");

    try {
      const detail = await this.generateAudiencePersonaOrFail({
        profile: {
          profileId: profile.id,
          demographics: objectRecord(profile.demographicsJson)
        },
        trace: { runId, jobId: options.jobId, profileId: profile.id }
      });
      const latestRun = await prisma.testRun.findUnique({ where: { id: runId } });
      if (!latestRun || !this.isAudienceEditableRunStatus(latestRun.status)) {
        if (options.jobId) await this.failAudienceGenerationJob(options.jobId, `当前状态 ${latestRun?.status ?? "deleted"} 不允许继续生成人设`, { requireWorkerLock: false });
        return profileView(await prisma.audienceProfile.findUniqueOrThrow({ where: { id: profile.id }, include: profileViewInclude }));
      }
      if (options.jobId && !(await this.isAudienceGenerationJobHeldByCurrentWorker(options.jobId))) {
        await this.compensateInactiveAudienceGenerationJob(options.jobId);
        return profileView(await prisma.audienceProfile.findUniqueOrThrow({ where: { id: profile.id }, include: profileViewInclude }));
      }
      const updated = await prisma.$transaction(async (tx) => {
        await cleanupProfileIdentity(tx, profile);
        const personaJson = normalizePersonaJson(detail.persona);
        const displayName = detail.displayName?.trim() || profile.samplingLabel;
        const identity = await createAgentIdentity(tx, {
          displayName,
          personaJson: personaJson as Prisma.InputJsonValue,
          originRunId: runId,
          sourceProfileId: profile.id
        });
        const updatedProfile = await tx.audienceProfile.update({
          where: { id: profile.id },
          data: {
            identityStatus: "identity_ready",
            identityGeneratedAt: new Date(),
            identityError: null,
            generationJobId: options.jobId,
            generatedUserId: identity.userId,
            generatedAgentId: identity.agentId,
            generatedPlatformAccountId: identity.platformAccountId
          },
          include: profileViewInclude
        });
        await tx.testRun.update({ where: { id: runId }, data: { audienceRevision: { increment: 1 } } });
        return updatedProfile;
      });
      await this.updateAudienceReadiness(runId);
      await this.emitProfileUpdated(runId, updated.id, updated.samplingLabel, updated.identityStatus, options.jobId, "audience.identity.ready");
      await this.writeRunLog(runId, "generation", `画像 ${updated.samplingLabel} 的人设已生成`);
      return profileView(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await prisma.$transaction(async (tx) => {
        const failedProfile = await tx.audienceProfile.update({
          where: { id: profileId },
          data: hasCompleteProfileIdentity(profile)
            ? { identityStatus: "identity_ready", identityError: message, generationJobId: null }
            : { identityStatus: "identity_failed", identityError: message },
          include: profileViewInclude
        });
        await tx.testRun.update({ where: { id: runId }, data: { audienceRevision: { increment: 1 } } });
        return failedProfile;
      });
      await this.updateAudienceReadiness(runId);
      await this.emitProfileUpdated(runId, failed.id, failed.samplingLabel, failed.identityStatus, options.jobId, "audience.identity.failed");
      if (options.continueOnFailure) return profileView(failed);
      throw error instanceof ApiError ? error : new ApiError("AGENT_RUN_FAILED", message, 502, profileView(failed));
    }
  }

  async startRun(runId: string, input: StartRunRequest) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    if (!["generating_audience", "audience_ready"].includes(run.status)) {
      throw new ApiError("INVALID_RUN_STATUS", `当前状态 ${run.status} 不能启动试映`, 409);
    }
    await this.assertNoActiveAudienceGenerationJob(runId);
    const contentVersion = await this.requireContentVersion(runId);
    const [readyProfiles, existingMissingCount, plan] = await Promise.all([
      prisma.audienceProfile.findMany({
        where: { runId, identityStatus: "identity_ready" },
        orderBy: [{ samplingDirectiveId: "asc" }, { sortOrder: "asc" }],
        include: profileViewInclude
      }),
      prisma.audienceProfile.count({ where: { runId, identityStatus: { not: "identity_ready" } } }),
      prisma.audienceSamplingPlan.findUnique({ where: { runId } }).catch(() => null)
    ]);
    const expectedAudienceCount = plan?.confirmedAt ? plan.totalCount : readyProfiles.length + existingMissingCount;
    const missingCount = Math.max(existingMissingCount, expectedAudienceCount - readyProfiles.length);
    if (readyProfiles.length === 0) throw new ApiError("NO_READY_AUDIENCES", "没有已生成人设的画像可以开始试映", 409);
    if (missingCount > 0 && !input.allowPartialAudience) {
      throw new ApiError("AUDIENCE_IDENTITY_INCOMPLETE", `还有 ${missingCount} 个画像未生成人设`, 409, {
        readyCount: readyProfiles.length,
        missingCount
      });
    }

    const startedAt = new Date();
    const initialAdmissionLimit = Math.min(readyProfiles.length, Math.max(this.config.schedulerDefaultConcurrency, 1));
    let clockEvent: Awaited<ReturnType<typeof recordRunClockUpdatedEvent>>;
    let startedEvent: Awaited<ReturnType<typeof recordLiveEvent>>;
    let initialPendingActions = 0;
    // Guard: SQLite serializes write transactions; the lockedRun.status check inside the transaction
    // prevents duplicate run_participants — a concurrent caller will see status='running' and fail.
    await prisma.$transaction(async (tx) => {
      const lockedRun = await tx.testRun.findUnique({ where: { id: runId } });
      if (!lockedRun) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
      if (!["generating_audience", "audience_ready"].includes(lockedRun.status)) {
        throw new ApiError("INVALID_RUN_STATUS", `当前状态 ${lockedRun.status} 不能启动试映`, 409);
      }
      const activeJob = await tx.audienceGenerationJob.findFirst({
        where: { runId, active: true, status: { in: activeAudienceGenerationJobStatuses } }
      });
      if (activeJob) throw new ApiError("AUDIENCE_GENERATION_ACTIVE", "观众生成任务仍在执行，请等待完成或取消后再开始试映", 409, jobView(activeJob));
      await tx.runParticipant.deleteMany({ where: { runId } });
      for (const [index, profile] of readyProfiles.entries()) {
        if (!profile.generatedUserId || !profile.generatedAgentId || !profile.generatedPlatformAccountId || !profile.generatedAgent || !profile.generatedPlatformAccount || !profile.generatedUser) {
          throw new ApiError("IDENTITY_NOT_READY", `画像 ${profile.samplingLabel} 缺少完整身份引用`, 409);
        }
        await tx.runParticipant.create({
          data: {
            runId,
            sourceProfileId: profile.id,
            samplingDirectiveId: profile.samplingDirectiveId,
            sortOrder: index,
            userId: profile.generatedUserId,
            agentId: profile.generatedAgentId,
            platformAccountId: profile.generatedPlatformAccountId,
            source: profile.generatedAgent.favoritedAt ? "saved_agent" : "generated",
            displayNameSnapshot: profile.generatedUser.nickname || profile.samplingLabel,
            avatarUrlSnapshot: profile.generatedUser.avatarUrl,
            profileSnapshotJson: profileSnapshot(profile) as Prisma.InputJsonValue,
            agentSnapshotJson: jsonInputOrEmpty(profile.generatedAgent.personaJson),
            platformAccountSnapshotJson: platformAccountSnapshot(profile.generatedPlatformAccount) as Prisma.InputJsonValue,
            runtimeStatus: "ready"
          }
        });
      }
      const updatedRun = await tx.testRun.update({
        where: { id: runId },
        data: {
          status: "running",
          startedAt,
          clockElapsedMs: 0,
          clockAnchorAt: startedAt,
          clockScale: this.config.runClockScale,
          errorMessage: null,
          configJson: { ...objectRecord(run.configJson), controlState: "none", startedAudienceCount: readyProfiles.length, excludedProfileCount: missingCount }
        }
      });
      clockEvent = await recordRunClockUpdatedEvent(tx, {
        runId,
        reason: "started",
        status: "running",
        run: updatedRun,
        now: startedAt
      });
      await tx.simulatedPostState.upsert({
        where: { contentVersionId: contentVersion.id },
        create: { contentVersionId: contentVersion.id, exposureCount: 0, currentPhase: "running" },
        update: { currentPhase: "running" }
      });
      initialPendingActions = await admitWaitingAudiences(tx, { runId, contentVersionId: contentVersion.id, limit: initialAdmissionLimit });
      startedEvent = await recordLiveEvent(tx, {
        runId,
        eventType: "run.started",
        payload: { contentVersionId: contentVersion.id, audienceCount: readyProfiles.length, excludedProfileCount: missingCount, startedAt: startedAt.toISOString(), clockScale: this.config.runClockScale }
      });
    });
    pushLiveEvent(runId, clockEvent!);
    pushLiveEvent(runId, startedEvent!);
    await this.writeRunLog(runId, "control", `试映已启动，${initialPendingActions} / ${readyProfiles.length} 位观众先入场，${missingCount} 个画像未参与`);
    if (this.config.enableScheduler) this.scheduler.start(runId);
    return { runId, status: "running", audienceCount: readyProfiles.length, excludedProfileCount: missingCount, initialPendingActions, startedAt: startedAt.toISOString() };
  }

  async pauseRun(runId: string) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    if (run.status === "paused") return { runId, status: "paused" };
    if (run.status === "pausing") return { runId, status: "pausing" };
    if (run.status !== "running") throw new ApiError("INVALID_RUN_STATUS", "只有运行中的试映才能暂停", 409);
    const configJson = objectRecord(run.configJson);
    await prisma.testRun.update({ where: { id: runId }, data: { status: "pausing", configJson: { ...configJson, controlState: "pause_requested" } } });
    const event = await recordLiveEvent(prisma, { runId, eventType: "run.pausing", payload: {} });
    pushLiveEvent(runId, event);
    await this.writeRunLog(runId, "control", "用户请求暂停，已开始的观众将完成完整旅程后暂停");
    return { runId, status: "pausing" };
  }

  async resumeRun(runId: string) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    if (run.status !== "paused") throw new ApiError("INVALID_RUN_STATUS", "只有暂停的试映才能继续", 409);
    const configJson = objectRecord(run.configJson);
    const resumedAt = new Date();
    const events = await prisma.$transaction(async (tx) => {
      const updated = await tx.testRun.update({
        where: { id: runId },
        data: { status: "running", clockAnchorAt: resumedAt, errorMessage: null, configJson: { ...configJson, controlState: "none" } }
      });
      const clockEvent = await recordRunClockUpdatedEvent(tx, {
        runId,
        reason: "resumed",
        status: "running",
        run: updated,
        now: resumedAt
      });
      const resumedEvent = await recordLiveEvent(tx, { runId, eventType: "run.resumed", payload: {} });
      return { clockEvent, resumedEvent };
    });
    pushLiveEvent(runId, events.clockEvent);
    pushLiveEvent(runId, events.resumedEvent);
    await this.writeRunLog(runId, "control", "试映已继续");
    if (this.config.enableScheduler) this.scheduler.start(runId);
    return { runId, status: "running" };
  }

  async getRunLogs(runId: string, options?: { logType?: string; limit?: number; cursor?: string; order?: "asc" | "desc" }): Promise<{ logs: RuntimeLogItem[]; hasMore: boolean; nextCursor: string | null }> {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    const limit = normalizeRunLogLimit(options?.limit);
    const order = options?.order ?? "asc";
    const offset = decodeOffsetCursor(options?.cursor);

    // Fetch run logs (control, generation, etc.)
    // Use take to bound the query — we fetch offset+limit rows from each table,
    // which is enough to fill the merged page (may return slightly more than needed).
    const fetchCount = offset + limit + 1;
    const fetchRunLogs = !options?.logType || options.logType !== 'action';
    const fetchActionLogs = !options?.logType || options.logType === 'action';

    const runLogWhere: Prisma.RunLogWhereInput = { runId };
    if (options?.logType) runLogWhere.logType = options.logType;
    const runLogs = fetchRunLogs ? await prisma.runLog.findMany({
      where: runLogWhere,
      orderBy: [{ simulatedTime: order }, { createdAt: order }, { id: order }],
      take: fetchCount,
    }) : [];

    // Fetch action logs (per-audience actions/thoughts)
    const actionLogs = fetchActionLogs ? await prisma.actionLog.findMany({
      where: { runId },
      orderBy: [{ simulatedTime: order }, { createdAt: order }, { id: order }],
      take: fetchCount,
    }) : [];

    // Get audiences for action log display names
    const audiences = await prisma.runParticipant.findMany({ where: { runId } });
    const audienceById = new Map(audiences.map((a) => [a.id, a]));

    // Normalize run logs
    const normalizedRunLogs: RuntimeLogItem[] = runLogs.map((log) => ({
      id: log.id,
      logType: log.logType,
      message: log.message,
      participantId: log.participantId,
      metadata: log.metadataJson,
      simulatedTime: log.simulatedTime,
      createdAt: log.createdAt.toISOString()
    }));

    // Normalize action logs
    const normalizedActionLogs: RuntimeLogItem[] = actionLogs.map((log) => ({
      id: log.id,
      logType: "action",
      text: log.logText,
      action: log.action,
      participantId: log.participantId,
      audienceName: log.participantId ? (audienceById.get(log.participantId)?.displayNameSnapshot ?? "AI 观众") : "AI 观众",
      simulatedTime: log.simulatedTime,
      createdAt: log.createdAt.toISOString()
    }));

    // Merge and sort
    const allLogs = [...normalizedRunLogs, ...normalizedActionLogs];
    allLogs.sort((a, b) => {
      const timeA = a.simulatedTime ?? 0;
      const timeB = b.simulatedTime ?? 0;
      if (timeA !== timeB) return order === "asc" ? timeA - timeB : timeB - timeA;
      const dateA = a.createdAt ?? "";
      const dateB = b.createdAt ?? "";
      if (dateA !== dateB) return order === "asc" ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
      return a.id.localeCompare(b.id);
    });

    // Apply pagination
    const page = allLogs.slice(offset, offset + limit);
    const hasMore = offset + limit < allLogs.length;
    const nextCursor = hasMore ? encodeOffsetCursor(offset + limit) : null;

    return { logs: page, hasMore, nextCursor };
  }

  async retryRun(runId: string, input: RetryRunRequest) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    const allowedStatuses: RunStatus[] = ["running", "paused", "completed"];
    if (!allowedStatuses.includes(run.status as RunStatus)) {
      throw new ApiError("INVALID_RUN_STATUS", `当前状态 ${run.status} 不允许重试`, 409);
    }

    const participant = await prisma.runParticipant.findFirst({ where: { runId, id: input.participantId } });
    if (!participant) throw new ApiError("INVALID_RETRY_TARGET", "参与者不属于当前试映", 409);

    const failedJourney = await prisma.agentJourney.findFirst({
      where: { runId, participantId: input.participantId, status: "failed" }
    });
    if (!failedJourney) throw new ApiError("INVALID_RETRY_TARGET", "该参与者没有失败的旅程", 409);

    const strategy = input.strategy ?? "continue_retry";

    let clockEvent: Awaited<ReturnType<typeof recordRunClockUpdatedEvent>>;
    if (strategy === "continue_retry") {
      clockEvent = await this.continueRetry(runId, run, participant, failedJourney);
    } else {
      const { deleted, clockEvent: event } = await this.cleanRetry(runId, run, participant, failedJourney);
      pushLiveEvent(runId, event);
      return { runId, status: "running", participantId: input.participantId, strategy, deleted };
    }
    pushLiveEvent(runId, clockEvent!);

    return { runId, status: "running", participantId: input.participantId, strategy };
  }

  private async continueRetry(
    runId: string,
    run: { configJson: unknown },
    participant: { id: string },
    journey: { id: string; participantId: string; actorUserId: string; platformAccountId: string; contentVersionId: string; errorMessage: string | null }
  ) {
    const retryStartedAt = new Date();
    const clockEvent = await prisma.$transaction(async (tx) => {
      // Delete stale report inside transaction so it survives only if mutation succeeds
      await tx.report.deleteMany({ where: { runId } });

      // Append a system notice about the retry into the journey transcript
      const errorReason = journey.errorMessage ?? "unknown error";
      await appendSystemNoticeItem(tx, journey.id, runId,
        `[Retry] Previous attempt failed with: ${errorReason}. Continuing this journey.`,
        { retryType: "continue_retry", previousError: errorReason } as Prisma.InputJsonValue
      );

      // Advance currentStepIndex past the max existing action stepIndex
      const lastAction = await tx.agentTurn.findFirst({
        where: { journeyId: journey.id },
        orderBy: { stepIndex: "desc" }
      });
      const nextStep = (lastAction?.stepIndex ?? 0) + 1;

      await tx.agentJourney.update({
        where: { id: journey.id },
        data: {
          status: "active",
          runnerStatus: "queued",
          lockedBy: null,
          lockedAt: null,
          heartbeatAt: null,
          errorMessage: null,
          completedAt: null,
          currentStepIndex: nextStep
        }
      });

      await tx.runParticipant.update({
        where: { id: participant.id },
        data: { runtimeStatus: "queued" }
      });

      // Set run status to running inside the same transaction
      const configJson = objectRecord(run.configJson);
      const updated = await tx.testRun.update({
        where: { id: runId },
        data: {
          status: "running",
          clockAnchorAt: retryStartedAt,
          completedAt: null,
          terminalReason: null,
          errorMessage: null,
          configJson: { ...configJson, controlState: "none" }
        }
      });
      return recordRunClockUpdatedEvent(tx, {
        runId,
        reason: "retry_started",
        status: "running",
        run: updated,
        now: retryStartedAt
      });
    });

    // scheduler.start remains after transaction
    if (this.config.enableScheduler) this.scheduler.start(runId);
    return clockEvent;
  }

  private async cleanRetry(
    runId: string,
    run: { configJson: unknown },
    participant: { id: string; userId: string; agentId: string; platformAccountId: string },
    journey: { id: string; contentVersionId: string }
  ) {
    const retryStartedAt = new Date();
    const { deleted, clockEvent } = await prisma.$transaction(async (tx) => {
      // Delete stale report inside transaction so it survives only if mutation succeeds
      await tx.report.deleteMany({ where: { runId } });

      const counts = await cleanupParticipantRuntimeFacts(tx, runId, participant.id);

      // Recompute simulatedPostState counts from remaining facts
      const cvId = journey.contentVersionId;
      const [openCount, shareCount, exitCount, commentCount, likeCount, favoriteCount, exposureCount] = await Promise.all([
        tx.socialInteractionEvent.count({ where: { contentVersionId: cvId, interactionType: "open_post" } }),
        tx.socialInteractionEvent.count({ where: { contentVersionId: cvId, interactionType: "share_post" } }),
        tx.socialInteractionEvent.count({ where: { contentVersionId: cvId, interactionType: "exit_browsing" } }),
        tx.simulatedComment.count({ where: { contentVersionId: cvId } }),
        tx.socialReaction.count({ where: { contentVersionId: cvId, targetType: "post", targetId: cvId, reactionType: "like", active: true } }),
        tx.socialReaction.count({ where: { contentVersionId: cvId, targetType: "post", targetId: cvId, reactionType: "favorite", active: true } }),
        tx.agentJourney.count({ where: { runId, contentVersionId: cvId } })
      ]);

      await tx.simulatedPostState.upsert({
        where: { contentVersionId: cvId },
        create: { contentVersionId: cvId, openCount, shareCount, exitCount, commentCount, likeCount, favoriteCount, exposureCount, currentPhase: "running" },
        update: { openCount, shareCount, exitCount, commentCount, likeCount, favoriteCount, exposureCount, currentPhase: "running" }
      });

      // Reset participant to ready so normal admission creates a new journey
      await tx.runParticipant.update({
        where: { id: participant.id },
        data: { runtimeStatus: "ready" }
      });

      // Set run status to running inside the same transaction, reset simulation clock
      const configJson = objectRecord(run.configJson);
      const updated = await tx.testRun.update({
        where: { id: runId },
        data: {
          status: "running",
          clockAnchorAt: retryStartedAt,
          clockElapsedMs: 0,
          completedAt: null,
          terminalReason: null,
          errorMessage: null,
          configJson: { ...configJson, controlState: "none" }
        }
      });

      const event = await recordRunClockUpdatedEvent(tx, {
        runId,
        reason: "retry_started",
        status: "running",
        run: updated,
        now: retryStartedAt
      });
      return { deleted: counts, clockEvent: event };
    });

    // scheduler.start remains after transaction
    if (this.config.enableScheduler) this.scheduler.start(runId);

    return { deleted, clockEvent };
  }

  private assertAudienceEditableRun(status: string) {
    if (!this.isAudienceEditableRunStatus(status)) {
      throw new ApiError("INVALID_RUN_STATUS", `当前状态 ${status} 不允许修改观众`, 409);
    }
  }

  private isAudienceEditableRunStatus(status: string) {
    return (audienceEditableRunStatuses as string[]).includes(status);
  }

  private async assertNoActiveAudienceGenerationJob(runId: string) {
    const activeJob = await prisma.audienceGenerationJob.findFirst({
      where: { runId, active: true, status: { in: activeAudienceGenerationJobStatuses } }
    });
    if (activeJob) throw new ApiError("AUDIENCE_GENERATION_ACTIVE", "观众生成任务仍在执行，请等待完成或取消后再开始试映", 409, jobView(activeJob));
  }

  private async requireContentVersion(runId: string) {
    return requireSingleContentVersion(prisma, runId);
  }

  private async requireMutableProfile(runId: string, profileId: string) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    this.assertAudienceEditableRun(run.status);
    const profile = await prisma.audienceProfile.findUnique({ where: { id: profileId } });
    if (!profile || profile.runId !== runId) throw new ApiError("PROFILE_NOT_FOUND", "画像不存在", 404);
    if (["identity_queued", "identity_generating"].includes(profile.identityStatus)) throw new ApiError("IDENTITY_GENERATING", "该画像人设正在生成中", 409);
    const participantCount = await prisma.runParticipant.count({ where: { runId, sourceProfileId: profileId } });
    if (participantCount > 0) throw new ApiError("PROFILE_LOCKED", "画像已入场，不能修改生成阶段身份", 409);
    const activeJob = await prisma.audienceGenerationJob.findFirst({ where: { runId, active: true } });
    if (activeJob?.scope === "sampling_plan" || (activeJob && profile.generationJobId === activeJob.id)) {
      throw new ApiError("AUDIENCE_GENERATION_ACTIVE", "观众生成任务正在执行，请等待完成或先取消任务", 409);
    }
    return profile;
  }

  private async updateAudienceReadiness(runId: string) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run || !["draft", "planning_audience", "generating_audience", "audience_ready"].includes(run.status)) return;
    const plan = await prisma.audienceSamplingPlan.findUnique({ where: { runId } }).catch(() => null);
    const activeJob = await prisma.audienceGenerationJob.findFirst({
      where: { runId, active: true, status: { in: activeAudienceGenerationJobStatuses } },
      orderBy: { createdAt: "desc" }
    });
    if (activeJob) {
      const nextRunStatus = activeJob.scope === "sampling_plan" ? "planning_audience" : "generating_audience";
      const nextPlanStatus =
        activeJob.scope === "sampling_plan"
          ? "planning"
          : activeJob.scope === "profile_expansion"
            ? "expanding_profiles"
            : "generating_identities";
      await Promise.all([
        run.status !== nextRunStatus
          ? prisma.testRun.update({ where: { id: runId }, data: { status: nextRunStatus, errorMessage: null } })
          : Promise.resolve(),
        plan && plan.confirmedAt && plan.status !== nextPlanStatus
          ? prisma.audienceSamplingPlan.update({ where: { id: plan.id }, data: { status: nextPlanStatus, errorMessage: null } })
          : Promise.resolve()
      ]);
      return;
    }
    const [readyCount, missingCount, failedCount] = await Promise.all([
      prisma.audienceProfile.count({ where: { runId, identityStatus: "identity_ready" } }),
      prisma.audienceProfile.count({ where: { runId, identityStatus: { not: "identity_ready" } } }),
      prisma.audienceProfile.count({ where: { runId, identityStatus: "identity_failed" } })
    ]);
    if (plan && readyCount + missingCount > 0) {
      const planStatus = missingCount === 0 ? "ready" : readyCount > 0 || failedCount > 0 ? "ready_with_failures" : plan.status;
      await prisma.audienceSamplingPlan.update({ where: { id: plan.id }, data: { status: planStatus } });
    }
    if (readyCount + missingCount === 0) return;
    const nextStatus = readyCount > 0 ? "audience_ready" : "generating_audience";
    if (run.status !== nextStatus) await prisma.testRun.update({ where: { id: runId }, data: { status: nextStatus } });
  }

  private async emitProfileUpdated(
    runId: string,
    profileId: string,
    samplingLabel: string,
    identityStatus: string,
    jobId?: string,
    eventType: "audience.updated" | "audience.identity.started" | "audience.identity.ready" | "audience.identity.failed" = "audience.updated"
  ) {
    const profile = await prisma.audienceProfile.findUnique({ where: { id: profileId }, include: profileViewInclude });
    const event = await recordLiveEvent(prisma, {
      runId,
      eventType,
      payload: {
        jobId,
        profileId,
        samplingLabel,
        identityStatus,
        profile: profile ? profileView(profile) : undefined,
        directiveId: profile?.samplingDirectiveId ?? undefined,
        directiveProgress: profile?.samplingDirectiveId ? await this.buildDirectiveProgress(profile.samplingDirectiveId) : undefined
      }
    });
    pushLiveEvent(runId, event);
  }

  private async writeRunLog(runId: string, logType: string, message: string, participantId?: string) {
    const event = await createRunLogWithEvent(prisma, { runId, logType, message, participantId });
    pushLiveEvent(runId, event);
  }

  private async buildAudienceSamplingPlanView(runId: string) {
    const plan = await prisma.audienceSamplingPlan.findUnique({
      where: { runId },
      include: { directives: { orderBy: { sortOrder: "asc" } } }
    });
    return plan ? samplingPlanView(plan) : null;
  }

  private async buildAudienceSamplingPlanViewById(planId: string) {
    const plan = await prisma.audienceSamplingPlan.findUniqueOrThrow({
      where: { id: planId },
      include: { directives: { orderBy: { sortOrder: "asc" } } }
    });
    return samplingPlanView(plan);
  }

  private async buildAudienceGenerationProgress(runId: string): Promise<AudienceGenerationProgressView> {
    const [plan, profiles, activeJob] = await Promise.all([
      prisma.audienceSamplingPlan.findUnique({
        where: { runId },
        include: { directives: { orderBy: { sortOrder: "asc" } } }
      }).catch(() => null),
      prisma.audienceProfile.findMany({ where: { runId }, orderBy: [{ samplingDirectiveId: "asc" }, { sortOrder: "asc" }], include: profileViewInclude }),
      prisma.audienceGenerationJob.findFirst({ where: { runId, active: true }, orderBy: { createdAt: "desc" } })
    ]);
    const profilesByDirective = new Map<string, typeof profiles>();
    for (const profile of profiles) {
      const key = profile.samplingDirectiveId ?? "";
      profilesByDirective.set(key, [...(profilesByDirective.get(key) ?? []), profile]);
    }
    const directiveProgress = plan?.directives.map((directive) => {
      const directiveProfiles = profilesByDirective.get(directive.id) ?? [];
      return directiveProgressView(directive, directiveProfiles);
    }) ?? [];
    return {
      runId,
      planId: plan?.id ?? null,
      status: plan?.status ?? "not_started",
      total: plan?.totalCount ?? 0,
      profileCreatedCount: profiles.length,
      identityReadyCount: profiles.filter((profile) => profile.identityStatus === "identity_ready").length,
      identityFailedCount: profiles.filter((profile) => profile.identityStatus === "identity_failed").length,
      activeJob: activeJob ? jobView(activeJob) : null,
      directives: directiveProgress,
      profiles: profiles.map(profileView)
    };
  }

  private async buildDirectiveProgress(directiveId: string) {
    const directive = await prisma.audienceSamplingDirective.findUniqueOrThrow({ where: { id: directiveId } });
    const profiles = await prisma.audienceProfile.findMany({ where: { samplingDirectiveId: directiveId } });
    return directiveProgressView(directive, profiles);
  }

  private async requireEditableSamplingPlan(runId: string) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
    this.assertAudienceEditableRun(run.status);
    const plan = await prisma.audienceSamplingPlan.findUnique({ where: { runId } });
    if (!plan) throw new ApiError("AUDIENCE_PLAN_REQUIRED", "需要先生成观众采样计划", 409);
    if (plan.confirmedAt) throw new ApiError("PLAN_CONFIRMED", "观众计划已确认，不能直接修改人群计划项", 409);
    const activeJob = await prisma.audienceGenerationJob.findFirst({ where: { runId, active: true } });
    if (activeJob) throw new ApiError("AUDIENCE_GENERATION_ACTIVE", "观众生成任务正在执行，请等待完成或先取消任务", 409, jobView(activeJob));
    return plan;
  }

  private async recoverCompletedSamplingPlanJobs() {
    const plans = await prisma.audienceSamplingPlan.findMany({
      where: {
        status: "planning",
        confirmedAt: null,
        generationJob: { status: "completed", active: false }
      },
      select: { generationJobId: true }
    });
    for (const plan of plans) {
      if (plan.generationJobId) await this.markAudienceSamplingPlanReady(plan.generationJobId);
    }
  }

  private async recoverMissingIdentityGenerationJobs() {
    const plans = await prisma.audienceSamplingPlan.findMany({
      where: {
        confirmedAt: { not: null },
        status: { in: ["generating_identities", "ready_with_failures", "ready"] },
        run: { status: { in: ["generating_audience", "audience_ready"] } }
      },
      select: { id: true, runId: true }
    });
    for (const plan of plans) {
      const profileOnlyCount = await prisma.audienceProfile.count({ where: { runId: plan.runId, identityStatus: "profile_only" } });
      if (profileOnlyCount === 0) continue;
      // Guard: inner activeJob check prevents duplicate recovery jobs.
      const job = await prisma.$transaction(async (tx) => {
        const activeJob = await tx.audienceGenerationJob.findFirst({
          where: { runId: plan.runId, active: true, status: { in: activeAudienceGenerationJobStatuses } },
          orderBy: { createdAt: "desc" }
        });
        if (activeJob) return null;
        const targetCount = await tx.audienceProfile.count({
          where: { runId: plan.runId, identityStatus: { in: ["profile_only", "identity_failed"] } }
        });
        if (targetCount === 0) return null;
        await tx.audienceSamplingPlan.update({ where: { id: plan.id }, data: { status: "generating_identities", errorMessage: null } });
        await tx.testRun.update({ where: { id: plan.runId }, data: { status: "generating_audience", errorMessage: null } });
        return tx.audienceGenerationJob.create({
          data: {
            runId: plan.runId,
            scope: "identities",
            samplingPlanId: plan.id,
            targetCount,
            batchSize: 10
          }
        });
      });
      if (job) this.startAudienceGenerationJob(job.id);
    }
  }

  private async buildProviderPlanView(planId: string): Promise<AudienceSamplingPlanViewForProvider> {
    const view = await this.buildAudienceSamplingPlanViewById(planId);
    return {
      planId: view.planId,
      runId: view.runId,
      totalCount: view.totalCount,
      status: view.status,
      planMarkdown: view.planMarkdown,
      dimensions: view.dimensions,
      directives: view.directives.map((directive) => ({
        id: directive.id,
        sortOrder: directive.sortOrder,
        name: directive.name,
        description: directive.description,
        quantity: directive.quantity,
        diversityAxes: directive.diversityAxes,
        rationale: directive.rationale,
        expansionStatus: directive.expansionStatus,
        expansionError: directive.expansionError
      }))
    };
  }

  private async assertNoRuntimeAudienceReferences(runId: string) {
    const participantCount = await prisma.runParticipant.count({ where: { runId } });
    if (participantCount > 0) {
      throw new ApiError("REPLAN_BLOCKED", "已有观众入场或试映历史引用，不能破坏性重新规划", 409);
    }
  }

  private async generateAudienceSamplingPlanOrFail(input: {
    runId: string;
    jobId?: string;
    title: string;
    coverImageUrl: string;
    imageUrls: string[];
    bodyText: string;
    count: number;
    onReasoningDelta?: (delta: string, meta?: { tokens?: number; tokenEstimate?: number }) => void | Promise<void>;
    onProgress?: (event: AudiencePlanProgressEvent) => void | Promise<void>;
    onFrame?: (frame: AudiencePlanFrame, preview: AudiencePlanPreview) => void | Promise<void>;
  }) {
    try {
      const imageUrls = await this.prepareAgentImageUrls(input.imageUrls);
      const plan = await this.getAgentProvider().generateAudienceSamplingPlan({
        ...input,
        imageUrls,
        coverImageUrl: imageUrls[0] ?? input.coverImageUrl,
        trace: { runId: input.runId, jobId: input.jobId }
      });
      validateAudienceSamplingPlanDraft(plan, input.count);
      return plan;
    } catch (error) {
      throw new ApiError("AGENT_RUN_FAILED", simplifyProviderError(error instanceof Error ? error.message : String(error)), 502);
    }
  }

  private async generateAudiencePersonaOrFail(input: {
    profile: { profileId: string; demographics: Record<string, unknown> };
    platformName?: string;
    trace?: { runId?: string; jobId?: string; profileId?: string };
  }) {
    try {
      return await this.getAgentProvider().generateAudiencePersona(input);
    } catch (error) {
      throw new ApiError("AGENT_RUN_FAILED", simplifyProviderError(error instanceof Error ? error.message : String(error)), 502);
    }
  }
}

function normalizeInputImageUrls(input: CreateRunRequest) {
  return uniqueNonEmptyStrings([input.coverImageUrl, ...(input.imageUrls ?? [])]).slice(0, 9);
}

function contentImageUrls(imageUrlsJson: unknown, coverImageUrl: string | null) {
  const stored = Array.isArray(imageUrlsJson) ? imageUrlsJson : [];
  return uniqueNonEmptyStrings([...stored, coverImageUrl]);
}

function uniqueNonEmptyStrings(values: unknown[]) {
  return [...new Set(values.filter(isString).map((value) => value.trim()).filter(Boolean))];
}

const profileViewInclude = {
  generatedAgent: true,
  generatedPlatformAccount: true,
  generatedUser: true
} satisfies Prisma.AudienceProfileInclude;

function profileView(profile: {
  id: string;
  samplingPlanId?: string | null;
  samplingDirectiveId: string | null;
  sampleIndex?: number;
  generationJobId?: string | null;
  sortOrder: number;
  samplingLabel: string;
  demographicsJson?: unknown;
  identityStatus: string;
  identityError: string | null;
  identityGeneratedAt: Date | null;
  generatedUserId: string | null;
  generatedAgentId: string | null;
  generatedPlatformAccountId: string | null;
  generatedAgent?: {
    id: string;
    userId: string;
    personaJson: unknown;
    memorySummary: string | null;
    retentionPolicy: string;
    favoritedAt: Date | null;
  } | null;
  generatedUser?: { id: string; userType: string; nickname: string; avatarUrl: string | null } | null;
  generatedPlatformAccount?: { id: string; userId: string; platform: string } | null;
  createdAt: Date;
  updatedAt: Date;
}): AudienceProfileView {
  return {
    id: profile.id,
    profileId: profile.id,
    samplingPlanId: profile.samplingPlanId ?? null,
    samplingDirectiveId: profile.samplingDirectiveId,
    sampleIndex: profile.sampleIndex ?? 0,
    generationJobId: profile.generationJobId,
    sortOrder: profile.sortOrder,
    samplingLabel: profile.samplingLabel,
    demographicsJson: normalizeDemographics(profile.demographicsJson),
    identityStatus: profile.identityStatus as AudienceProfileView["identityStatus"],
    identityError: profile.identityError,
    identityGeneratedAt: profile.identityGeneratedAt?.toISOString() ?? null,
    generatedUserId: profile.generatedUserId,
    generatedAgentId: profile.generatedAgentId,
    generatedPlatformAccountId: profile.generatedPlatformAccountId,
    identity: profile.generatedAgent
      ? {
          user: profile.generatedUser
            ? {
                id: profile.generatedUser.id,
                userType: profile.generatedUser.userType,
                nickname: profile.generatedUser.nickname,
                avatarUrl: profile.generatedUser.avatarUrl
              }
            : null,
          agent: {
            id: profile.generatedAgent.id,
            userId: profile.generatedAgent.userId,
            memorySummary: profile.generatedAgent.memorySummary
          },
          platformAccount: profile.generatedPlatformAccount
            ? {
                id: profile.generatedPlatformAccount.id,
                userId: profile.generatedPlatformAccount.userId,
                platform: profile.generatedPlatformAccount.platform
              }
            : null,
          personaJson: objectRecord(profile.generatedAgent.personaJson),
          retentionPolicy: profile.generatedAgent.retentionPolicy,
          favorited: Boolean(profile.generatedAgent.favoritedAt),
          saved: Boolean(profile.generatedAgent.favoritedAt)
        }
      : null,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString()
  };
}

function participantView(participant: {
  id: string;
  sourceProfileId: string | null;
  samplingDirectiveId: string | null;
  sortOrder: number;
  userId: string;
  agentId: string;
  platformAccountId: string;
  source: string;
  displayNameSnapshot: string;
  avatarUrlSnapshot: string | null;
  profileSnapshotJson: unknown;
  agentSnapshotJson: unknown;
  platformAccountSnapshotJson: unknown;
  runtimeStatus: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    participantId: participant.id,
    id: participant.id,
    sourceProfileId: participant.sourceProfileId,
    samplingDirectiveId: participant.samplingDirectiveId,
    sortOrder: participant.sortOrder,
    userId: participant.userId,
    agentId: participant.agentId,
    platformAccountId: participant.platformAccountId,
    source: participant.source,
    displayName: participant.displayNameSnapshot,
    avatarUrl: participant.avatarUrlSnapshot,
    profileSnapshot: participant.profileSnapshotJson,
    agentSnapshot: participant.agentSnapshotJson,
    platformAccountSnapshot: participant.platformAccountSnapshotJson,
    runtimeStatus: participant.runtimeStatus,
    createdAt: participant.createdAt.toISOString(),
    updatedAt: participant.updatedAt.toISOString()
  };
}

function jobView(job: {
  id: string;
  runId: string;
  scope: string;
  status: string;
  active: boolean;
  profileId: string | null;
  samplingPlanId?: string | null;
  samplingDirectiveId?: string | null;
  targetCount: number;
  batchSize: number;
  errorMessage: string | null;
  attemptCount: number;
  heartbeatAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AudienceGenerationJobView {
  return {
    id: job.id,
    runId: job.runId,
    scope: job.scope as AudienceGenerationJobView["scope"],
    status: job.status as AudienceGenerationJobView["status"],
    active: job.active,
    profileId: job.profileId,
    samplingPlanId: job.samplingPlanId ?? null,
    samplingDirectiveId: job.samplingDirectiveId ?? null,
    targetCount: job.targetCount,
    batchSize: job.batchSize,
    errorMessage: job.errorMessage,
    attemptCount: job.attemptCount,
    heartbeatAt: job.heartbeatAt?.toISOString() ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    canceledAt: job.canceledAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString()
  };
}

function directiveProgressView(
  directive: { id: string; description: string; quantity: number; expansionStatus: string; expansionError: string | null },
  profiles: Array<{ identityStatus: string }>
) {
  return {
    directiveId: directive.id,
    description: directive.description,
    targetCount: directive.quantity,
    profileCreatedCount: profiles.length,
    identityReadyCount: profiles.filter((profile) => profile.identityStatus === "identity_ready").length,
    identityFailedCount: profiles.filter((profile) => profile.identityStatus === "identity_failed").length,
    generationStatus: directive.expansionStatus as "pending" | "generating" | "ready" | "failed",
    generationError: directive.expansionError
  };
}

function samplingPlanView(plan: {
  id: string;
  runId: string;
  totalCount: number;
  status: string;
  planMarkdown: string;
  dimensionsJson: unknown;
  confirmedAt: Date | null;
  directives: Array<{
    id: string;
    sortOrder: number;
    name: string;
    description: string;
    quantity: number;
    diversityAxesJson: unknown;
    rationale: string;
    groupRole: string;
    samplingReason: string;
    expansionStatus: string;
    expansionError: string | null;
  }>;
}): AudienceSamplingPlanView {
  const directives = plan.directives.map((directive) => ({
    id: directive.id,
    sortOrder: directive.sortOrder,
    name: directive.name,
    description: directive.description,
    quantity: directive.quantity,
    diversityAxes: jsonStringArray(directive.diversityAxesJson),
    rationale: directive.rationale,
    groupRole: directive.groupRole as AudienceSamplingDirective["groupRole"],
    samplingReason: directive.samplingReason,
    expansionStatus: directive.expansionStatus as "pending" | "generating" | "ready" | "failed",
    expansionError: directive.expansionError
  }));
  return {
    planId: plan.id,
    runId: plan.runId,
    totalCount: plan.totalCount,
    status: plan.status as AudienceSamplingPlanView["status"],
    planMarkdown: plan.planMarkdown,
    dimensions: jsonStringArray(plan.dimensionsJson),
    confirmedAt: plan.confirmedAt?.toISOString() ?? null,
    directives,
    validation: samplingPlanValidation(plan.totalCount, plan.directives)
  };
}

function samplingPlanValidation(totalCount: number, directives: Array<{ quantity: number }>) {
  const quantityTotal = directiveQuantityTotal(directives);
  const issues: string[] = [];
  if (!directives.length) issues.push("至少需要一条人群计划项");
  for (const [index, directive] of directives.entries()) {
    if (!Number.isInteger(directive.quantity) || directive.quantity < 0) issues.push(`第 ${index + 1} 条人群数量不能为负数`);
  }
  return {
    quantityTotal,
    expectedTotal: totalCount,
    isQuantityValid: issues.length === 0,
    issues
  };
}

function directiveQuantityTotal(directives: Array<{ quantity: number }>) {
  return directives.reduce((sum, directive) => sum + directive.quantity, 0);
}

async function syncEditableSamplingPlanTotal(tx: Prisma.TransactionClient, runId: string, planId: string) {
  const directives = await tx.audienceSamplingDirective.findMany({
    where: { planId },
    select: { quantity: true }
  });
  const quantityTotal = directiveQuantityTotal(directives);
  await tx.audienceSamplingPlan.update({
    where: { id: planId },
    data: {
      ...(quantityTotal > 0 ? { totalCount: quantityTotal } : {})
    }
  });
  if (quantityTotal > 0) {
    await tx.testRun.update({ where: { id: runId }, data: { audienceCount: quantityTotal } });
  }
}

function directiveToProviderView(directive: {
  id: string;
  sortOrder: number;
  name: string;
  description: string;
  quantity: number;
  diversityAxesJson: unknown;
  rationale: string;
  expansionStatus?: string | null;
  expansionError?: string | null;
}): AudienceSamplingDirectiveView {
  return {
    id: directive.id,
    sortOrder: directive.sortOrder,
    name: directive.name,
    description: directive.description,
    quantity: directive.quantity,
    diversityAxes: jsonStringArray(directive.diversityAxesJson),
    rationale: directive.rationale,
    expansionStatus: directive.expansionStatus ?? undefined,
    expansionError: directive.expansionError ?? null
  };
}

function validateAudienceSamplingPlanDraft(plan: AudienceSamplingPlanDraft, count: number) {
  if (!plan || typeof plan !== "object") throw new Error("AUDIENCE_PLAN_FAILED: provider did not return a plan object.");
  if (plan.totalCount !== count) throw new Error("AUDIENCE_PLAN_FAILED: totalCount must match requested audience count.");
  if (!Array.isArray(plan.directives) || plan.directives.length === 0) throw new Error("AUDIENCE_PLAN_FAILED: directives must be non-empty.");
  const total = plan.directives.reduce((sum, directive) => sum + Number(directive.quantity ?? 0), 0);
  if (total !== count) throw new Error("AUDIENCE_PLAN_FAILED: directive quantities must match requested audience count.");
  for (const directive of plan.directives) {
    if (!directive.name?.trim() || !directive.description?.trim() || !directive.rationale?.trim()) {
      throw new Error("AUDIENCE_PLAN_FAILED: directive fields are incomplete.");
    }
    if (!Array.isArray(directive.diversityAxes) || !directive.diversityAxes.length) {
      throw new Error("AUDIENCE_PLAN_FAILED: directive diversityAxes must be non-empty.");
    }
  }
}

function normalizeRunLogLimit(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return 50;
  return Math.min(Math.max(Math.trunc(value), 1), 200);
}

function encodeOffsetCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString("base64url");
}

function decodeOffsetCursor(value?: string | null): number {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { offset?: number };
    if (typeof parsed.offset !== "number" || !Number.isFinite(parsed.offset) || parsed.offset < 0) return 0;
    return Math.trunc(parsed.offset);
  } catch {
    return 0;
  }
}

function jsonStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function cleanStrings(value: unknown) {
  return jsonStringArray(Array.isArray(value) ? value : []);
}

async function linkContentVersionImages(tx: Prisma.TransactionClient, contentVersionId: string, imageUrls: string[]) {
  for (const [index, url] of imageUrls.entries()) {
    const asset = await ensureAssetForUrl(tx, url);
    await tx.contentVersionImage.create({
      data: {
        contentVersionId,
        assetId: asset.id,
        url,
        sortOrder: index
      }
    });
  }
}

async function ensureAssetForUrl(tx: Prisma.TransactionClient, url: string) {
  const local = localStorageKeyFromUrl(url);
  return tx.asset.upsert({
    where: { url },
    create: {
      url,
      storage: local ? "local" : "external",
      storageKey: local
    },
    update: {}
  });
}

function normalizeStoredImageUrls(imageUrlsJson: unknown, coverImageUrl?: string | null) {
  const urls = Array.isArray(imageUrlsJson)
    ? imageUrlsJson.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  if (coverImageUrl && !urls.includes(coverImageUrl)) urls.unshift(coverImageUrl);
  return [...new Set(urls)];
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeDemographics(value: unknown): AudienceProfileView["demographicsJson"] {
  const record = objectRecord(value);
  return {
    gender: isString(record.gender) ? record.gender : "不限定",
    ageRange: isString(record.ageRange) ? record.ageRange : "不限定",
    cityTier: isString(record.cityTier) ? record.cityTier : "不限定",
    lifeStage: isString(record.lifeStage) ? record.lifeStage : "不限定",
    role: isString(record.role) ? record.role : "不限定",
    spendingPower: isString(record.spendingPower) ? record.spendingPower : "不限定"
  };
}

const VALID_MBTI_TYPES = new Set(["INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP", "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP"]);
const REQUIRED_DEMOGRAPHICS_FIELDS = ["gender", "ageRange", "cityTier", "lifeStage", "role", "spendingPower"];

function normalizePersonaJson(value: unknown): AudiencePersonaJson {
  const persona = objectRecord(value);
  return {
    profile: requirePersonaString(persona.profile, "profile"),
    personality: requirePersonaString(persona.personality, "personality"),
    mbtiType: requireMbtiType(persona.mbtiType) as AudiencePersonaJson["mbtiType"],
    responseStyle: requirePersonaString(persona.responseStyle, "responseStyle")
  };
}

function requireMbtiType(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!VALID_MBTI_TYPES.has(raw)) {
    throw new Error(`AUDIENCE_GENERATION_FAILED: persona.mbtiType must be one of 16 MBTI types, received "${value}".`);
  }
  return raw;
}

function requirePersonaString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`AUDIENCE_GENERATION_FAILED: persona.${field} must be a non-empty string.`);
  }
  return value.trim();
}

function jsonInputOrEmpty(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined) return {};
  return value as Prisma.InputJsonValue;
}

function profileSnapshot(profile: {
  id: string;
  samplingPlanId: string | null;
  samplingDirectiveId: string | null;
  samplingLabel: string;
  demographicsJson: unknown;
}) {
  return {
    profileId: profile.id,
    samplingPlanId: profile.samplingPlanId,
    samplingDirectiveId: profile.samplingDirectiveId,
    samplingLabel: profile.samplingLabel,
    demographicsJson: profile.demographicsJson
  };
}

function platformAccountSnapshot(platformAccount: { id: string; platform: string }) {
  return {
    platformAccountId: platformAccount.id,
    platform: platformAccount.platform
  };
}

function profileIdentityIds(profile: { generatedUserId: string | null; generatedAgentId: string | null; generatedPlatformAccountId: string | null }) {
  return {
    userIds: profile.generatedUserId ? [profile.generatedUserId] : [],
    agentIds: profile.generatedAgentId ? [profile.generatedAgentId] : [],
    platformAccountIds: profile.generatedPlatformAccountId ? [profile.generatedPlatformAccountId] : []
  };
}

function shouldDeleteAgentIdentity(agent: { retentionPolicy: string; favoritedAt: Date | null }) {
  return agent.retentionPolicy === "delete_with_origin_run" && !agent.favoritedAt;
}

function hasCompleteProfileIdentity(profile: { generatedUserId: string | null; generatedAgentId: string | null; generatedPlatformAccountId: string | null }) {
  return Boolean(profile.generatedUserId && profile.generatedAgentId && profile.generatedPlatformAccountId);
}

async function compensateProfilesForAudienceGenerationJob(tx: Prisma.TransactionClient, job: { id: string; runId: string }, message: string) {
  const profiles = await tx.audienceProfile.findMany({
    where: { runId: job.runId, generationJobId: job.id, identityStatus: { in: ["identity_queued", "identity_generating"] } },
    select: {
      id: true,
      identityStatus: true,
      generatedUserId: true,
      generatedAgentId: true,
      generatedPlatformAccountId: true
    }
  });
  for (const profile of profiles) {
    const data = hasCompleteProfileIdentity(profile)
      ? { identityStatus: "identity_ready" as const, identityError: message, generationJobId: null }
      : profile.identityStatus === "identity_queued"
        ? { identityStatus: "profile_only" as const, identityError: null, generationJobId: null }
        : { identityStatus: "identity_failed" as const, identityError: message, generationJobId: null };
    await tx.audienceProfile.update({ where: { id: profile.id }, data });
  }
  return profiles.map((profile) => profile.id);
}

async function cleanupProfilesForReplan(tx: Prisma.TransactionClient, runId: string) {
  const profiles = await tx.audienceProfile.findMany({
    where: { runId },
    select: { generatedUserId: true, generatedAgentId: true, generatedPlatformAccountId: true }
  });
  await tx.audienceProfile.deleteMany({ where: { runId } });
  for (const profile of profiles) {
    await cleanupIdentityByIds(tx, profileIdentityIds(profile));
  }
}

async function cleanupProfileIdentity(tx: Prisma.TransactionClient, profile: { generatedUserId: string | null; generatedAgentId: string | null; generatedPlatformAccountId: string | null }) {
  await cleanupIdentityByIds(tx, profileIdentityIds(profile));
}

async function cleanupIdentityByIds(tx: Prisma.TransactionClient, input: { userIds: string[]; agentIds: string[]; platformAccountIds: string[] }) {
  const agent = input.agentIds.length ? await tx.agent.findFirst({ where: { id: { in: input.agentIds } } }) : null;
  if (!agent) return;
  const referenced = await isIdentityReferencedTx(tx, input);
  if (!referenced && shouldDeleteAgentIdentity(agent)) {
    await tx.platformAccount.deleteMany({ where: { id: { in: input.platformAccountIds } } });
    await tx.agent.deleteMany({ where: { id: { in: input.agentIds } } });
    await tx.user.deleteMany({ where: { id: { in: input.userIds } } });
  } else {
    await tx.agent.updateMany({ where: { id: { in: input.agentIds } }, data: { sourceProfileId: null } });
  }
}

async function cleanupUnreferencedRunLocalIdentities(input: { userIds: string[]; agentIds: string[]; platformAccountIds: string[] }) {
  let deletedPlatformAccounts = 0;
  let deletedAgents = 0;
  let deletedUsers = 0;

  const agents = await prisma.agent.findMany({ where: { id: { in: input.agentIds } } });

  for (const agent of agents) {
    const platformAccounts = await prisma.platformAccount.findMany({
      where: {
        userId: agent.userId,
        ...(input.platformAccountIds.length ? { id: { in: input.platformAccountIds } } : {})
      },
      select: { id: true }
    });
    const identityIds = {
      userIds: [agent.userId],
      agentIds: [agent.id],
      platformAccountIds: platformAccounts.map((account) => account.id)
    };
    const referenced = await isIdentityReferenced(identityIds);
    if (!referenced && shouldDeleteAgentIdentity(agent)) {
      const platformResult = await prisma.platformAccount.deleteMany({ where: { id: { in: identityIds.platformAccountIds } } });
      const agentResult = await prisma.agent.deleteMany({ where: { id: agent.id } });
      const userResult = await prisma.user.deleteMany({ where: { id: agent.userId } });
      deletedPlatformAccounts += platformResult.count;
      deletedAgents += agentResult.count;
      deletedUsers += userResult.count;
    }
  }

  return { deletedUsers, deletedAgents, deletedPlatformAccounts };
}

async function isIdentityReferenced(input: { userIds: string[]; agentIds: string[]; platformAccountIds: string[] }) {
  for (const id of input.platformAccountIds) if (await isPlatformAccountReferenced(id)) return true;
  for (const id of input.agentIds) if (await isAgentReferenced(id)) return true;
  for (const id of input.userIds) if (await isUserRuntimeReferenced(id)) return true;
  return false;
}

async function isIdentityReferencedTx(tx: Prisma.TransactionClient, input: { userIds: string[]; agentIds: string[]; platformAccountIds: string[] }) {
  const checks = [
    ...input.platformAccountIds.map((id) => isPlatformAccountReferencedTx(tx, id)),
    ...input.agentIds.map((id) => isAgentReferencedTx(tx, id)),
    ...input.userIds.map((id) => isUserRuntimeReferencedTx(tx, id))
  ];
  const results = await Promise.all(checks);
  return results.some(Boolean);
}

async function isPlatformAccountReferenced(platformAccountId: string) {
  if (await prisma.audienceProfile.count({ where: { generatedPlatformAccountId: platformAccountId } })) return true;
  if (await prisma.runParticipant.count({ where: { platformAccountId } })) return true;
  if (await prisma.agentJourney.count({ where: { platformAccountId } })) return true;
  if (await prisma.agentTurn.count({ where: { platformAccountId } })) return true;
  if (await prisma.agentToolCall.count({ where: { platformAccountId } })) return true;
  if (await prisma.socialInteractionEvent.count({ where: { platformAccountId } })) return true;
  if (await prisma.socialReaction.count({ where: { platformAccountId } })) return true;
  if (await prisma.loadedCommentPage.count({ where: { platformAccountId } })) return true;
  if (await prisma.simulatedComment.count({ where: { platformAccountId } })) return true;
  if (await prisma.actionLog.count({ where: { platformAccountId } })) return true;
  return (await prisma.runLog.count({ where: { platformAccountId } })) > 0;
}

async function isAgentReferenced(agentId: string) {
  if (await prisma.audienceProfile.count({ where: { generatedAgentId: agentId } })) return true;
  if (await prisma.runParticipant.count({ where: { agentId } })) return true;
  if (await prisma.socialInteractionEvent.count({ where: { agentId } })) return true;
  if (await prisma.socialReaction.count({ where: { agentId } })) return true;
  return (await prisma.simulatedComment.count({ where: { agentId } })) > 0;
}

async function isUserRuntimeReferenced(userId: string) {
  if (await prisma.runParticipant.count({ where: { userId } })) return true;
  if (await prisma.agentJourney.count({ where: { actorUserId: userId } })) return true;
  if (await prisma.agentTurn.count({ where: { actorUserId: userId } })) return true;
  if (await prisma.agentToolCall.count({ where: { actorUserId: userId } })) return true;
  if (await prisma.socialInteractionEvent.count({ where: { actorUserId: userId } })) return true;
  if (await prisma.socialReaction.count({ where: { actorUserId: userId } })) return true;
  if (await prisma.loadedCommentPage.count({ where: { actorUserId: userId } })) return true;
  if (await prisma.simulatedComment.count({ where: { actorUserId: userId } })) return true;
  if (await prisma.actionLog.count({ where: { actorUserId: userId } })) return true;
  return (await prisma.runLog.count({ where: { actorUserId: userId } })) > 0;
}

async function isPlatformAccountReferencedTx(tx: Prisma.TransactionClient, platformAccountId: string) {
  const counts = await Promise.all([
    tx.runParticipant.count({ where: { platformAccountId } }),
    tx.agentJourney.count({ where: { platformAccountId } }),
    tx.agentTurn.count({ where: { platformAccountId } }),
    tx.agentToolCall.count({ where: { platformAccountId } }),
    tx.socialInteractionEvent.count({ where: { platformAccountId } }),
    tx.socialReaction.count({ where: { platformAccountId } }),
    tx.loadedCommentPage.count({ where: { platformAccountId } }),
    tx.simulatedComment.count({ where: { platformAccountId } }),
    tx.actionLog.count({ where: { platformAccountId } }),
    tx.runLog.count({ where: { platformAccountId } })
  ]);
  return counts.some((count) => count > 0);
}

async function isAgentReferencedTx(tx: Prisma.TransactionClient, agentId: string) {
  const counts = await Promise.all([
    tx.runParticipant.count({ where: { agentId } }),
    tx.socialInteractionEvent.count({ where: { agentId } }),
    tx.socialReaction.count({ where: { agentId } }),
    tx.simulatedComment.count({ where: { agentId } })
  ]);
  return counts.some((count) => count > 0);
}

async function isUserRuntimeReferencedTx(tx: Prisma.TransactionClient, userId: string) {
  const counts = await Promise.all([
    tx.runParticipant.count({ where: { userId } }),
    tx.agentJourney.count({ where: { actorUserId: userId } }),
    tx.agentTurn.count({ where: { actorUserId: userId } }),
    tx.agentToolCall.count({ where: { actorUserId: userId } }),
    tx.socialInteractionEvent.count({ where: { actorUserId: userId } }),
    tx.socialReaction.count({ where: { actorUserId: userId } }),
    tx.loadedCommentPage.count({ where: { actorUserId: userId } }),
    tx.simulatedComment.count({ where: { actorUserId: userId } }),
    tx.actionLog.count({ where: { actorUserId: userId } }),
    tx.runLog.count({ where: { actorUserId: userId } })
  ]);
  return counts.some((count) => count > 0);
}

function simplifyProviderError(message: string) {
  if (/<html[\s>]/i.test(message) || /openresty/i.test(message)) {
    return "模型服务返回了 HTML 404。请检查 API base URL 是否是 OpenAI-compatible chat completions 地址，当前服务可能不支持所请求的接口。";
  }
  return message;
}
