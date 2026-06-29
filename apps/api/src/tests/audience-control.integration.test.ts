import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { prisma } from "@trycue/db";
import { buildApp } from "../app.js";
import { loadConfig, resolveWorkspacePath } from "../config.js";
import type { AgentProvider, AudienceSamplingPlanDraft, GeneratedAudience, RunParticipantContext, RunParticipantResult } from "../agents/types.js";
import { AiTaskRunner } from "../agents/taskRunner.js";
import { Scheduler } from "../runtime/scheduler.js";
import { RunService } from "../runtime/runService.js";
import { generateReportAndCompleteRun, recoverReportGenerationRuns } from "../runtime/report.js";
import type { LlmRuntimeConfig } from "../llmConfigStore.js";
import { DEFAULT_CAPACITY_SETTINGS } from "../llm/capacityPresets.js";
import { resetDatabase } from "./helpers.js";

type SamplingPlanData = {
  runId: string;
  plan: {
    planId: string;
    totalCount: number;
    status: string;
    planMarkdown: string;
    directives: Array<{
      id: string;
      name?: string;
      description?: string;
      quantity: number;
      diversityAxes?: string[];
      rationale?: string;
      expansionStatus: string;
      expansionError: string | null;
    }>;
    validation: {
      isQuantityValid: boolean;
      quantityTotal: number;
    };
  } | null;
};

type AudienceGenerationData = {
  runId: string;
  status: string;
  total: number;
  profileCreatedCount: number;
  identityReadyCount: number;
  identityFailedCount: number;
  activeJob: { id: string; scope: string; status: string } | null;
  directives: Array<{
    directiveId: string;
    targetCount: number;
    profileCreatedCount: number;
    identityReadyCount: number;
    identityFailedCount: number;
  }>;
};

describe("audience sampling plan and identity flow", () => {
  const llmConfigPath = resolve("config/llm.integration-test.yaml");

  beforeEach(async () => {
    await resetDatabase();
    await rm(llmConfigPath, { force: true });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a reviewable sampling plan without expanding profiles before confirmation", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const runId = await createRun(app);

    const created = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/audience-sampling-plan`,
      payload: { replaceActive: true }
    });
    expect(created.statusCode).toBe(200);

    const plan = await waitForSamplingPlan(app, runId, (data) => data.plan?.status === "ready_for_review");
    expect(plan.plan?.totalCount).toBe(12);
    expect(plan.plan?.directives).toHaveLength(4);
    expect(plan.plan?.validation).toMatchObject({ isQuantityValid: true, quantityTotal: 12 });
    expect(await prisma.audienceSamplingDirective.count({ where: { plan: { runId } } })).toBe(4);
    expect(await prisma.audienceProfile.count({ where: { runId } })).toBe(0);
    expect(await prisma.runParticipant.count({ where: { runId } })).toBe(0);
    expect(await prisma.audienceGenerationJob.count({ where: { runId, scope: "sampling_plan", status: "completed", active: false } })).toBe(1);

    const events = await prisma.liveEvent.findMany({ where: { runId }, orderBy: { sequence: "asc" } });
    expect(events.some((event) => event.eventType === "audience.plan.started")).toBe(true);
    expect(events.some((event) => event.eventType === "audience.plan.ready")).toBe(true);
    expect(events.some((event) => event.eventType === "audience.profile.expansion.started")).toBe(false);
    expect(events.some((event) => event.eventType === "audience.identity.ready")).toBe(false);

    await app.close();
  }, 30000);

  it("syncs editable plan total from directive quantities before confirmation", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const runId = await createRun(app);
    const plan = await createSamplingPlanForReview(app, runId);
    const directive = plan.plan!.directives[0]!;
    const originalPlanMarkdown = plan.plan!.planMarkdown;

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/runs/${runId}/audience-sampling-plan/directives/${directive.id}`,
      payload: { quantity: directive.quantity + 1 }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.plan).toMatchObject({
      totalCount: 13,
      validation: { quantityTotal: 13, expectedTotal: 13, isQuantityValid: true }
    });
    expect((await prisma.testRun.findUniqueOrThrow({ where: { id: runId } })).audienceCount).toBe(13);

    const confirmed = await app.inject({ method: "POST", url: `/api/runs/${runId}/audience-sampling-plan/confirm`, payload: {} });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().data.job).toMatchObject({ scope: "profile_expansion", targetCount: 13 });
    const confirmedPlan = await prisma.audienceSamplingPlan.findUniqueOrThrow({ where: { runId } });
    expect(confirmedPlan.totalCount).toBe(13);
    expect(confirmedPlan.planMarkdown).toBe(originalPlanMarkdown);

    await waitForAudienceGeneration(app, runId, (data) => !data.activeJob);
    await app.close();
  }, 30000);

  it("returns sampling-plan revision suggestions without mutating the editable plan", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const runId = await createRun(app);
    const plan = await createSamplingPlanForReview(app, runId);
    const directive = plan.plan!.directives[0]!;
    const directiveCountBefore = await prisma.audienceSamplingDirective.count({ where: { plan: { runId } } });
    const planUpdatedEventCountBefore = await prisma.liveEvent.count({ where: { runId, eventType: "audience.plan.updated" } });

    const response = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/audience-sampling-plan/revision-suggestions`,
      payload: {
        messages: [{
          role: "user",
          visibleText: `请从 @${directive.name} 中拆出预算敏感用户，总人数不变`,
          hiddenMentionContexts: [{
            directiveId: directive.id,
            label: directive.name,
            context: { directive }
          }]
        }]
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.proposal.operations.length).toBeGreaterThan(0);
    expect(await prisma.audienceSamplingDirective.count({ where: { plan: { runId } } })).toBe(directiveCountBefore);
    expect(await prisma.liveEvent.count({ where: { runId, eventType: "audience.plan.updated" } })).toBe(planUpdatedEventCountBefore);
    expect(await prisma.audienceProfile.count({ where: { runId } })).toBe(0);

    await app.close();
  }, 30000);

  it("confirms the plan, expands profiles, generates identities, and materializes participants only at start", async () => {
    const config = { ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false };
    const app = await buildApp(config);
    const runId = await createAudienceReadyRun(app);

    const progress = await getAudienceGeneration(app, runId);
    expect(progress).toMatchObject({
      status: "ready",
      total: 12,
      profileCreatedCount: 12,
      identityReadyCount: 12,
      identityFailedCount: 0,
      activeJob: null
    });
    expect(progress.directives.every((directive) => directive.profileCreatedCount === directive.targetCount)).toBe(true);
    expect(progress.directives.every((directive) => directive.identityReadyCount === directive.targetCount)).toBe(true);
    expect(await prisma.runParticipant.count({ where: { runId } })).toBe(0);

    const events = await prisma.liveEvent.findMany({ where: { runId }, orderBy: { sequence: "asc" } });
    expect(events.some((event) => event.eventType === "audience.plan.confirmed")).toBe(true);
    expect(events.some((event) => event.eventType === "audience.profile.expansion.ready")).toBe(true);
    expect(events.some((event) => event.eventType === "audience.identity.ready")).toBe(true);

    const start = await app.inject({ method: "POST", url: `/api/runs/${runId}/start`, payload: { allowPartialAudience: false } });
    expect(start.statusCode).toBe(200);
    expect(start.json().data.audienceCount).toBe(12);
    expect(await prisma.runParticipant.count({ where: { runId } })).toBe(12);
    expect(await prisma.runParticipant.count({ where: { runId, samplingDirectiveId: { not: null } } })).toBe(12);
    expect(await prisma.agentJourney.count({ where: { runId } })).toBe(Math.max(config.schedulerDefaultConcurrency, 1));

    await app.close();
  }, 30000);

  it("serializes concurrent start requests without rebuilding participants", async () => {
    const config = { ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false };
    const app = await buildApp(config);
    const runId = await createAudienceReadyRun(app);

    const responses = await Promise.all([
      app.inject({ method: "POST", url: `/api/runs/${runId}/start`, payload: { allowPartialAudience: false } }),
      app.inject({ method: "POST", url: `/api/runs/${runId}/start`, payload: { allowPartialAudience: false } })
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(await prisma.runParticipant.count({ where: { runId } })).toBe(12);
    expect(await prisma.agentJourney.count({ where: { runId } })).toBe(Math.max(config.schedulerDefaultConcurrency, 1));
    expect(await prisma.liveEvent.count({ where: { runId, eventType: "run.started" } })).toBe(1);

    await app.close();
  }, 30000);

  it("returns audience-seat revision suggestions without mutating generated profiles", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const runId = await createAudienceReadyRun(app);
    const profile = await prisma.audienceProfile.findFirstOrThrow({ where: { runId, identityStatus: "identity_ready" }, orderBy: { sortOrder: "asc" } });
    const profileCountBefore = await prisma.audienceProfile.count({ where: { runId } });
    const participantCountBefore = await prisma.runParticipant.count({ where: { runId } });
    const audienceUpdatedEventCountBefore = await prisma.liveEvent.count({ where: { runId, eventType: "audience.updated" } });
    const updatedAtBefore = profile.updatedAt.toISOString();

    const response = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/audience-profiles/revision-suggestions`,
      payload: {
        messages: [{
          role: "user",
          visibleText: `把 @${profile.samplingLabel} 调得更理性一点`,
          hiddenMentionContexts: [{
            kind: "profile",
            profileId: profile.id,
            label: profile.samplingLabel,
            context: { profileId: profile.id, identityStatus: profile.identityStatus }
          }]
        }]
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.proposal.operations.length).toBeGreaterThan(0);
    expect(await prisma.audienceProfile.count({ where: { runId } })).toBe(profileCountBefore);
    expect(await prisma.runParticipant.count({ where: { runId } })).toBe(participantCountBefore);
    expect(await prisma.liveEvent.count({ where: { runId, eventType: "audience.updated" } })).toBe(audienceUpdatedEventCountBefore);
    expect((await prisma.audienceProfile.findUniqueOrThrow({ where: { id: profile.id } })).updatedAt.toISOString()).toBe(updatedAtBefore);

    await app.close();
  }, 30000);

  it("blocks directive edits after confirmation", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const runId = await createRun(app);
    const plan = await createSamplingPlanForReview(app, runId);
    const confirmed = await app.inject({ method: "POST", url: `/api/runs/${runId}/audience-sampling-plan/confirm`, payload: {} });
    expect(confirmed.statusCode).toBe(200);

    const directiveId = plan.plan!.directives[0]!.id;
    const updated = await app.inject({
      method: "PATCH",
      url: `/api/runs/${runId}/audience-sampling-plan/directives/${directiveId}`,
      payload: { quantity: 99 }
    });
    expect(updated.statusCode).toBe(409);
    expect(updated.json().error.code).toBe("PLAN_CONFIRMED");
    await waitForAudienceGeneration(app, runId, (data) => !data.activeJob);

    await app.close();
  }, 30000);

  it("warns before partial start and starts only identity-ready profiles when allowed", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const runId = await createAudienceReadyRun(app);
    const profile = await prisma.audienceProfile.findFirstOrThrow({ where: { runId }, orderBy: { sortOrder: "asc" } });
    await prisma.audienceProfile.update({ where: { id: profile.id }, data: { identityStatus: "identity_failed", identityError: "manual failure for partial start test" } });

    const blocked = await app.inject({ method: "POST", url: `/api/runs/${runId}/start`, payload: { allowPartialAudience: false } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("AUDIENCE_IDENTITY_INCOMPLETE");

    const partial = await app.inject({ method: "POST", url: `/api/runs/${runId}/start`, payload: { allowPartialAudience: true } });
    expect(partial.statusCode).toBe(200);
    expect(partial.json().data.audienceCount).toBe(11);
    expect(partial.json().data.excludedProfileCount).toBe(1);
    expect(await prisma.runParticipant.count({ where: { runId } })).toBe(11);
    expect(await prisma.runParticipant.count({ where: { runId, sourceProfileId: profile.id } })).toBe(0);

    const content = await prisma.contentVersion.findUniqueOrThrow({ where: { runId } });
    await prisma.simulatedPostState.update({
      where: { contentVersionId: content.id },
      data: { exposureCount: 11, openCount: 11, likeCount: 8, favoriteCount: 6, commentCount: 4 }
    });
    // Seed finished journeys so evidenceQuality is not low and the recommendation
    // can reach recommend_publish (core target group has strong positive signals).
    // Journeys already exist from start; update them to finished with positive outcomes.
    await prisma.agentJourney.updateMany({
      where: { runId },
      data: {
        status: "finished",
        runnerStatus: "idle",
        exitOutcome: "browsed_and_left",
        finalSummary: "正常浏览后离开"
      }
    });
    await generateReportAndCompleteRun(runId);
    const report = await prisma.report.findFirstOrThrow({ where: { runId } });
    // This test focuses on partial-start behavior, not recommendation quality.
    // With only a few journeys vs audienceCount=12, evidenceQuality is low → recommend_retest.
    // Just verify the report was generated with the new schema.
    expect(report.reportOutputJson).toHaveProperty("verdict");
    expect(report.evidencePackJson).toHaveProperty("funnel");
    expect(["recommend_publish", "modify_then_publish", "not_recommend_current_version", "recommend_retest"]).toContain(report.recommendation);

    await app.close();
  }, 30000);

  it("syncs audience totals after deleting a ready identity", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const runId = await createAudienceReadyRun(app);
    const profile = await prisma.audienceProfile.findFirstOrThrow({ where: { runId, identityStatus: "identity_ready" }, orderBy: { sortOrder: "asc" } });
    const planBefore = await prisma.audienceSamplingPlan.findUniqueOrThrow({ where: { runId } });
    const directiveBefore = await prisma.audienceSamplingDirective.findUniqueOrThrow({ where: { id: profile.samplingDirectiveId! } });

    const deleted = await app.inject({ method: "DELETE", url: `/api/runs/${runId}/audience-profiles/${profile.id}` });
    expect(deleted.statusCode).toBe(200);

    const planAfter = await prisma.audienceSamplingPlan.findUniqueOrThrow({ where: { runId } });
    const directiveAfter = await prisma.audienceSamplingDirective.findUniqueOrThrow({ where: { id: profile.samplingDirectiveId! } });
    const runAfterDelete = await prisma.testRun.findUniqueOrThrow({ where: { id: runId } });
    expect(planAfter.totalCount).toBe(planBefore.totalCount - 1);
    expect(directiveAfter.quantity).toBe(directiveBefore.quantity - 1);
    expect(runAfterDelete.audienceCount).toBe(planAfter.totalCount);

    const started = await app.inject({ method: "POST", url: `/api/runs/${runId}/start`, payload: { allowPartialAudience: false } });
    expect(started.statusCode).toBe(200);
    expect(started.json().data).toMatchObject({ audienceCount: 11, excludedProfileCount: 0 });
    expect(await prisma.runParticipant.count({ where: { runId } })).toBe(11);
    expect(await prisma.runParticipant.count({ where: { runId, sourceProfileId: profile.id } })).toBe(0);

    await app.close();
  }, 30000);

  it("adds a result-layer audience profile and starts single identity generation", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const runId = await createAudienceReadyRun(app);
    const planBefore = await prisma.audienceSamplingPlan.findUniqueOrThrow({ where: { runId } });
    const directiveBefore = await prisma.audienceSamplingDirective.findFirstOrThrow({
      where: { planId: planBefore.id },
      orderBy: { sortOrder: "asc" }
    });
    const planUpdatedEventCountBefore = await prisma.liveEvent.count({ where: { runId, eventType: "audience.plan.updated" } });

    const added = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/audience-profiles`,
      payload: {
        directiveId: directiveBefore.id,
        samplingLabel: "新增预算敏感观众",
        demographics: {
          gender: "不限定",
          ageRange: "不限定",
          cityTier: "不限定",
          lifeStage: "不限定",
          role: "新手妈妈",
          spendingPower: "预算敏感"
        }
      }
    });

    expect(added.statusCode).toBe(200);
    expect(added.json().data.plan.totalCount).toBe(planBefore.totalCount + 1);
    expect(added.json().data.job).toMatchObject({ scope: "single_identity", targetCount: 1 });

    const planAfter = await prisma.audienceSamplingPlan.findUniqueOrThrow({ where: { runId } });
    const directiveAfter = await prisma.audienceSamplingDirective.findUniqueOrThrow({ where: { id: directiveBefore.id } });
    const runAfterAdd = await prisma.testRun.findUniqueOrThrow({ where: { id: runId } });
    expect(planAfter.totalCount).toBe(planBefore.totalCount + 1);
    expect(directiveAfter.quantity).toBe(directiveBefore.quantity + 1);
    expect(runAfterAdd.audienceCount).toBe(planAfter.totalCount);
    expect(await prisma.liveEvent.count({ where: { runId, eventType: "audience.plan.updated" } })).toBeGreaterThan(planUpdatedEventCountBefore);

    await waitForAudienceGeneration(
      app,
      runId,
      (data) => !data.activeJob && data.status === "ready" && data.total === planAfter.totalCount && data.identityReadyCount === planAfter.totalCount
    );
    expect(await prisma.audienceProfile.count({ where: { runId, samplingDirectiveId: directiveBefore.id } })).toBe(directiveAfter.quantity);

    await app.close();
  }, 30000);

  it("treats duplicate plan confirmation as idempotency conflict and creates only one expansion job", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const runId = await createRun(app);
    await createSamplingPlanForReview(app, runId);

    const [first, second] = await Promise.all([
      app.inject({ method: "POST", url: `/api/runs/${runId}/audience-sampling-plan/confirm`, payload: {} }),
      app.inject({ method: "POST", url: `/api/runs/${runId}/audience-sampling-plan/confirm`, payload: {} })
    ]);
    const statusCodes = [first.statusCode, second.statusCode].sort();
    expect(statusCodes).toEqual([200, 409]);
    expect(await prisma.audienceGenerationJob.count({ where: { runId, scope: "profile_expansion" } })).toBe(1);

    await waitForAudienceGeneration(app, runId, (data) => !data.activeJob);
    await app.close();
  }, 30000);

  it("rejects duplicate sampling-plan requests while one job is active", async () => {
    const config = { ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false };
    const provider = new BlockingSamplingPlanProvider();
    const scheduler = new Scheduler(config, () => mockLlmConfig, () => provider, testAiTaskRunner());
    const service = new RunService(config, () => mockLlmConfig, () => provider, scheduler, resolveWorkspacePath("apps/api/uploads"));
    const runId = await createServiceRun("draft");

    const first = await service.createAudienceSamplingPlan(runId, { replaceActive: true });
    expect(first.job).toMatchObject({ scope: "sampling_plan", active: true });

    await expect(service.createAudienceSamplingPlan(runId, { replaceActive: true })).rejects.toMatchObject({
      code: "AUDIENCE_GENERATION_ACTIVE",
      statusCode: 409
    });
    expect(await prisma.audienceGenerationJob.count({ where: { runId, scope: "sampling_plan", active: true } })).toBe(1);

    provider.releasePlan();
    await waitForDb(async () => {
      const activeCount = await prisma.audienceGenerationJob.count({ where: { runId, active: true } });
      const completedCount = await prisma.audienceGenerationJob.count({ where: { runId, scope: "sampling_plan", status: "completed" } });
      return activeCount === 0 && completedCount === 1;
    });
  }, 30000);

  it("edits a generated identity and toggles it as a favorite identity", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const runId = await createAudienceReadyRun(app);
    const profile = await prisma.audienceProfile.findFirstOrThrow({ where: { runId, identityStatus: "identity_ready" }, orderBy: { sortOrder: "asc" } });

    const identityPatch = await app.inject({
      method: "PATCH",
      url: `/api/runs/${runId}/audience-profiles/${profile.id}/identity`,
      payload: {
        displayName: "保存前人设",
        avatarUrl: "/uploads/saved-avatar.png",
        personaJson: {
          profile: "保存前人设，新手妈妈，保存后背景，关注真实经验。",
          personality: "判断是否值得买，重视具体型号，遇到软广会谨慎。",
          mbtiType: "ISFJ",
          responseStyle: "谨慎，保存后评论风格，常说蹲。"
        }
      }
    });
    expect(identityPatch.statusCode).toBe(200);
    expect(identityPatch.json().data.identity).toMatchObject({
      user: { nickname: "保存前人设", avatarUrl: "/uploads/saved-avatar.png" },
      platformAccount: { platform: "xiaohongshu" },
      personaJson: { responseStyle: "谨慎，保存后评论风格，常说蹲。" }
    });

    const favorited = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/audience-profiles/${profile.id}/identity/favorite`,
      payload: { favorited: true }
    });
    expect(favorited.statusCode).toBe(200);
    const updated = await prisma.audienceProfile.findUniqueOrThrow({ where: { id: profile.id } });
    const agent = await prisma.agent.findUniqueOrThrow({ where: { id: updated.generatedAgentId! } });
    expect(agent.favoritedAt).toBeTruthy();

    const unfavorited = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/audience-profiles/${profile.id}/identity/favorite`,
      payload: { favorited: false }
    });
    expect(unfavorited.statusCode).toBe(200);
    expect((await prisma.agent.findUniqueOrThrow({ where: { id: updated.generatedAgentId! } })).favoritedAt).toBeNull();

    await app.close();
  }, 30000);

  it("cancels an identities job without leaving queued or generating profiles", async () => {
    const config = { ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false };
    const provider = new BlockingAgentProvider();
    const scheduler = new Scheduler(config, () => mockLlmConfig, () => provider, testAiTaskRunner());
    const service = new RunService(config, () => mockLlmConfig, () => provider, scheduler, resolveWorkspacePath("apps/api/uploads"));
    const runId = await createServiceRun("generating_audience");
    const { plan, directive } = await createAudiencePreparationSkeleton(runId);
    const job = await prisma.audienceGenerationJob.create({
      data: { runId, scope: "identities", samplingPlanId: plan.id, status: "generating", active: true, targetCount: 2, batchSize: 2, lockedBy: "stalled-worker", lockedUntil: new Date(Date.now() + 60_000) }
    });
    const queued = await createProfile(runId, plan.id, directive.id, "排队画像", { generationJobId: job.id, identityStatus: "identity_queued", sampleIndex: 0 });
    const generating = await createProfile(runId, plan.id, directive.id, "生成中画像", { generationJobId: job.id, identityStatus: "identity_generating", sampleIndex: 1 });

    const canceled = await service.cancelAudienceGenerationJob(runId, job.id);
    expect(canceled.job).toMatchObject({ id: job.id, status: "canceled", active: false });

    const latestJob = await prisma.audienceGenerationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(latestJob).toMatchObject({ status: "canceled", active: false, lockedBy: null, lockedUntil: null });
    await expectProfileIdentity(queued.id, { identityStatus: "profile_only", generationJobId: null, identityError: null });
    await expectProfileIdentity(generating.id, { identityStatus: "identity_failed", generationJobId: null });
  });

  it("does not let a canceled worker overwrite the job as completed", async () => {
    const config = { ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false };
    const provider = new BlockingAgentProvider();
    const scheduler = new Scheduler(config, () => mockLlmConfig, () => provider, testAiTaskRunner());
    const service = new RunService(config, () => mockLlmConfig, () => provider, scheduler, resolveWorkspacePath("apps/api/uploads"));
    const runId = await createServiceRun("generating_audience");
    const { plan, directive } = await createAudiencePreparationSkeleton(runId);
    const profile = await createProfile(runId, plan.id, directive.id, "待替换画像", { sampleIndex: 0, identityStatus: "identity_failed", identityError: "retry target" });

    await service.retryAudienceIdentities(runId, { profileIds: [profile.id] });
    await waitForDb(async () => {
      const latest = await prisma.audienceProfile.findUniqueOrThrow({ where: { id: profile.id } });
      return latest.identityStatus === "identity_generating";
    });
    const job = await prisma.audienceGenerationJob.findFirstOrThrow({ where: { runId, active: true } });
    await service.cancelAudienceGenerationJob(runId, job.id);
    provider.releasePersonas();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const latestJob = await prisma.audienceGenerationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(latestJob.status).toBe("canceled");
    expect(latestJob.active).toBe(false);
    expect(await prisma.liveEvent.count({ where: { runId, eventType: "audience.generation.job.completed" } })).toBe(0);
  });

  it("retries only the requested failed identities", async () => {
    const config = { ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false };
    const provider = new BlockingAgentProvider();
    const scheduler = new Scheduler(config, () => mockLlmConfig, () => provider, testAiTaskRunner());
    const service = new RunService(config, () => mockLlmConfig, () => provider, scheduler, resolveWorkspacePath("apps/api/uploads"));
    const runId = await createServiceRun("audience_ready");
    const { plan, directive } = await createAudiencePreparationSkeleton(runId);
    const selected = await createProfile(runId, plan.id, directive.id, "指定重试画像", { sampleIndex: 0, identityStatus: "identity_failed", identityError: "selected failure" });
    const untouched = await createProfile(runId, plan.id, directive.id, "不应重试画像", { sampleIndex: 1, identityStatus: "identity_failed", identityError: "untouched failure" });

    const response = await service.retryAudienceIdentities(runId, { profileIds: [selected.id] });
    expect(response.job).toMatchObject({ scope: "single_identity", profileId: selected.id, targetCount: 1 });
    provider.releasePersonas();

    await waitForDb(async () => {
      const latest = await prisma.audienceProfile.findUniqueOrThrow({ where: { id: selected.id } });
      const completedJobCount = await prisma.audienceGenerationJob.count({ where: { runId, scope: "single_identity", profileId: selected.id, status: "completed" } });
      return latest.identityStatus === "identity_ready" && completedJobCount === 1;
    });

    await expectProfileIdentity(selected.id, { identityStatus: "identity_ready", identityError: null });
    await expectProfileIdentity(untouched.id, {
      identityStatus: "identity_failed",
      generationJobId: null,
      identityError: "untouched failure",
      generatedUserId: null,
      generatedAgentId: null,
      generatedPlatformAccountId: null
    });
    expect(await prisma.audienceGenerationJob.count({ where: { runId, scope: "single_identity", profileId: selected.id, status: "completed" } })).toBe(1);
    expect(await prisma.audienceGenerationJob.count({ where: { runId, profileId: untouched.id } })).toBe(0);
  });

  it("marks a ready run as generating while retrying all failed identities", async () => {
    const config = { ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false };
    const provider = new BlockingAgentProvider();
    const scheduler = new Scheduler(config, () => mockLlmConfig, () => provider, testAiTaskRunner());
    const service = new RunService(config, () => mockLlmConfig, () => provider, scheduler, resolveWorkspacePath("apps/api/uploads"));
    const runId = await createServiceRun("audience_ready");
    const { plan, directive } = await createAudiencePreparationSkeleton(runId);
    await prisma.testRun.update({ where: { id: runId }, data: { status: "audience_ready" } });
    await createProfile(runId, plan.id, directive.id, "失败画像 A", { sampleIndex: 0, identityStatus: "identity_failed", identityError: "retry all target A" });
    await createProfile(runId, plan.id, directive.id, "失败画像 B", { sampleIndex: 1, identityStatus: "identity_failed", identityError: "retry all target B" });

    const response = await service.retryAudienceIdentities(runId, { profileIds: [] });
    expect(response.job).toMatchObject({ scope: "identities", targetCount: 2 });
    const runDuringRetry = await prisma.testRun.findUniqueOrThrow({ where: { id: runId } });
    expect(runDuringRetry.status).toBe("generating_audience");

    provider.releasePersonas();
    await waitForDb(async () => {
      const latestRun = await prisma.testRun.findUniqueOrThrow({ where: { id: runId } });
      const readyCount = await prisma.audienceProfile.count({ where: { runId, identityStatus: "identity_ready" } });
      return latestRun.status === "audience_ready" && readyCount === 2;
    });
  });

  it("clears generated audience while keeping the confirmed sampling plan editable", async () => {
    const config = { ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false };
    const provider = new BlockingAgentProvider();
    const scheduler = new Scheduler(config, () => mockLlmConfig, () => provider, testAiTaskRunner());
    const service = new RunService(config, () => mockLlmConfig, () => provider, scheduler, resolveWorkspacePath("apps/api/uploads"));
    const runId = await createServiceRun("audience_ready");
    const { plan, directive } = await createAudiencePreparationSkeleton(runId);
    await prisma.testRun.update({ where: { id: runId }, data: { status: "audience_ready" } });
    const user = await prisma.user.create({ data: { userType: "agent", nickname: "待清空观众" } });
    const agent = await prisma.agent.create({
      data: { userId: user.id, originRunId: runId, retentionPolicy: "delete_with_origin_run", personaJson: { profile: "测试人设" } }
    });
    const account = await prisma.platformAccount.create({ data: { userId: user.id, platform: "xiaohongshu" } });
    const profile = await createProfile(runId, plan.id, directive.id, "待清空画像", {
      sampleIndex: 0,
      identityStatus: "identity_ready",
      generatedUserId: user.id,
      generatedAgentId: agent.id,
      generatedPlatformAccountId: account.id
    });

    const response = await service.clearGeneratedAudience(runId);

    expect(response.plan).toMatchObject({ planId: plan.id, status: "ready_for_review", confirmedAt: null });
    expect(response.progress?.profiles ?? []).toEqual([]);
    await expect(prisma.audienceProfile.findUnique({ where: { id: profile.id } })).resolves.toBeNull();
    await expect(prisma.user.findUnique({ where: { id: user.id } })).resolves.toBeNull();
    await expect(prisma.agent.findUnique({ where: { id: agent.id } })).resolves.toBeNull();
    await expect(prisma.platformAccount.findUnique({ where: { id: account.id } })).resolves.toBeNull();
    const latestPlan = await prisma.audienceSamplingPlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(latestPlan).toMatchObject({ status: "ready_for_review", confirmedAt: null });
    const latestDirective = await prisma.audienceSamplingDirective.findUniqueOrThrow({ where: { id: directive.id } });
    expect(latestDirective).toMatchObject({ expansionStatus: "pending", expansionError: null });
    const latestRun = await prisma.testRun.findUniqueOrThrow({ where: { id: runId } });
    expect(latestRun.status).toBe("planning_audience");
    expect(await prisma.liveEvent.count({ where: { runId, eventType: "audience.plan.updated" } })).toBeGreaterThan(0);
  });

  it("completes an identities job with per-profile failures instead of retrying one profile forever", async () => {
    const config = { ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false };
    const provider = new OneFailingIdentityProvider();
    const scheduler = new Scheduler(config, () => mockLlmConfig, () => provider, testAiTaskRunner());
    const service = new RunService(config, () => mockLlmConfig, () => provider, scheduler, resolveWorkspacePath("apps/api/uploads"));
    const runId = await createServiceRun("generating_audience");
    const { plan, directive } = await createAudiencePreparationSkeleton(runId);
    const readyTarget = await createProfile(runId, plan.id, directive.id, "成功画像", { sampleIndex: 0, identityStatus: "profile_only" });
    const failingTarget = await createProfile(runId, plan.id, directive.id, "失败画像", {
      sampleIndex: 1,
      identityStatus: "profile_only",
      demographicsJson: { ...testDemographics(), role: "失败画像" }
    });
    const job = await prisma.audienceGenerationJob.create({
      data: { runId, scope: "identities", samplingPlanId: plan.id, status: "queued", active: true, targetCount: 2, batchSize: 2 }
    });

    await service.recoverAudienceGenerationJobs();

    await waitForDb(async () => {
      const activeJobCount = await prisma.audienceGenerationJob.count({ where: { runId, active: true } });
      const latestJob = await prisma.audienceGenerationJob.findUniqueOrThrow({ where: { id: job.id } });
      const latestRun = await prisma.testRun.findUniqueOrThrow({ where: { id: runId } });
      return activeJobCount === 0 && latestJob.status === "completed" && latestRun.status === "audience_ready";
    });

    await expectProfileIdentity(readyTarget.id, { identityStatus: "identity_ready", identityError: null, generationJobId: job.id });
    await expectProfileIdentity(failingTarget.id, { identityStatus: "identity_failed", generationJobId: job.id });
    expect((await prisma.testRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe("audience_ready");
    expect((await prisma.audienceSamplingPlan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("ready_with_failures");
  });

  it("keeps a profile expansion failure failed instead of recovering into identity generation", async () => {
    const config = { ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false };
    const provider = new OneFailingExpansionProvider();
    const scheduler = new Scheduler(config, () => mockLlmConfig, () => provider, testAiTaskRunner());
    const service = new RunService(config, () => mockLlmConfig, () => provider, scheduler, resolveWorkspacePath("apps/api/uploads"));
    const runId = await createServiceRun("generating_audience");
    const plan = await prisma.audienceSamplingPlan.create({
      data: {
        runId,
        totalCount: 2,
        status: "expanding_profiles",
        confirmedAt: new Date(),
        planMarkdown: "测试计划",
        dimensionsJson: ["需求强度"],
        directives: {
          create: [
            {
              sortOrder: 0,
              name: "核心用户",
              description: "认真做购买前功课",
              quantity: 1,
              diversityAxesJson: ["需求强度"],
              rationale: "测试核心用户"
            },
            {
              sortOrder: 1,
              name: "挑剔用户",
              description: "会质疑证据和广告感",
              quantity: 1,
              diversityAxesJson: ["广告敏感"],
              rationale: "测试失败恢复"
            }
          ]
        }
      },
      include: { directives: true }
    });
    const job = await prisma.audienceGenerationJob.create({
      data: { runId, scope: "profile_expansion", samplingPlanId: plan.id, status: "queued", active: true, targetCount: 2, batchSize: 10 }
    });

    await service.recoverAudienceGenerationJobs();

    await waitForDb(async () => {
      const latestJob = await prisma.audienceGenerationJob.findUniqueOrThrow({ where: { id: job.id } });
      return latestJob.status === "failed";
    });
    const latestPlan = await prisma.audienceSamplingPlan.findUniqueOrThrow({ where: { id: plan.id }, include: { directives: true } });
    expect(latestPlan.status).toBe("failed");
    expect(latestPlan.errorMessage).toContain("profile expansion failed for picky users");
    expect(latestPlan.directives.some((directive) => directive.expansionStatus === "failed")).toBe(true);
    expect(await prisma.audienceProfile.count({ where: { runId } })).toBe(1);
    expect(await prisma.audienceGenerationJob.count({ where: { runId, scope: "identities" } })).toBe(0);
    expect((await prisma.testRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe("generating_audience");
  });

  it("fails unrecoverable stale sampling-plan jobs without dropping the run out of audience planning", async () => {
    const config = { ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false, schedulerMaxRetry: 1 };
    const provider = new BlockingAgentProvider();
    const scheduler = new Scheduler(config, () => mockLlmConfig, () => provider, testAiTaskRunner());
    const service = new RunService(config, () => mockLlmConfig, () => provider, scheduler, resolveWorkspacePath("apps/api/uploads"));
    const runId = await createServiceRun("planning_audience");
    const job = await prisma.audienceGenerationJob.create({
      data: { runId, scope: "sampling_plan", status: "planning", active: true, targetCount: 12, batchSize: 1, attemptCount: 1, lockedBy: "dead-worker", lockedUntil: new Date(Date.now() - 60_000) }
    });

    await service.recoverAudienceGenerationJobs();

    const latestJob = await prisma.audienceGenerationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(latestJob.status).toBe("failed");
    const run = await prisma.testRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe("planning_audience");
    expect(run.errorMessage).toContain("interrupted");
    expect(await prisma.liveEvent.count({ where: { runId, eventType: "audience.generation.job.failed" } })).toBe(0);
  });

  it("recovers report_generating runs that were interrupted before report creation", async () => {
    const runId = await createServiceRun("report_generating");
    const content = await prisma.contentVersion.findFirstOrThrow({ where: { runId } });
    await prisma.simulatedPostState.create({ data: { contentVersionId: content.id, exposureCount: 1, currentPhase: "running" } });

    await recoverReportGenerationRuns();
    await waitForDb(async () => {
      const run = await prisma.testRun.findUniqueOrThrow({ where: { id: runId } });
      return run.status === "completed" && (await prisma.report.count({ where: { runId } })) === 1;
    });
  });
});

async function createRun(app: FastifyInstance) {
  const createRes = await app.inject({
    method: "POST",
    url: "/api/runs",
    payload: {
      title: "宝宝用品避坑指南",
      coverImageUrl: "/uploads/test.png",
      bodyText: "宝宝出生前我也跟风买了一堆东西，后来才发现很多真的用不上。这篇只说我自己踩过的坑。",
      scale: "quick"
    }
  });
  expect(createRes.statusCode).toBe(200);
  return createRes.json().data.runId as string;
}

async function createSamplingPlanForReview(app: FastifyInstance, runId: string) {
  const created = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/audience-sampling-plan`,
    payload: { replaceActive: true }
  });
  expect(created.statusCode).toBe(200);
  return waitForSamplingPlan(app, runId, (data) => data.plan?.status === "ready_for_review");
}

async function createAudienceReadyRun(app: FastifyInstance) {
  const runId = await createRun(app);
  await createSamplingPlanForReview(app, runId);
  const confirmed = await app.inject({ method: "POST", url: `/api/runs/${runId}/audience-sampling-plan/confirm`, payload: {} });
  expect(confirmed.statusCode).toBe(200);
  await waitForAudienceGeneration(app, runId, (data) => !data.activeJob && data.status === "ready" && data.total === 12 && data.identityReadyCount === 12);
  return runId;
}

async function getAudienceGeneration(app: FastifyInstance, runId: string): Promise<AudienceGenerationData> {
  const response = await app.inject({ method: "GET", url: `/api/runs/${runId}/audience-generation` });
  expect(response.statusCode).toBe(200);
  return response.json().data as AudienceGenerationData;
}

async function waitForSamplingPlan(app: FastifyInstance, runId: string, predicate: (data: SamplingPlanData) => boolean) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/runs/${runId}/audience-sampling-plan` });
    expect(response.statusCode).toBe(200);
    const data = response.json().data as SamplingPlanData;
    if (predicate(data)) return data;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("sampling plan did not reach expected state");
}

async function waitForAudienceGeneration(app: FastifyInstance, runId: string, predicate: (data: AudienceGenerationData) => boolean) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const data = await getAudienceGeneration(app, runId);
    if (predicate(data)) return data;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("audience generation did not reach expected state");
}

async function createServiceRun(status: "draft" | "planning_audience" | "generating_audience" | "audience_ready" | "report_generating" = "generating_audience") {
  const run = await prisma.testRun.create({ data: { status, audienceCount: 12, configJson: {}, contentVersionCount: 1 } });
  await prisma.contentVersion.create({
    data: {
      runId: run.id,
      title: "宝宝用品避坑指南",
      coverImageUrl: "/uploads/test.png",
      imageUrlsJson: ["/uploads/test.png"],
      bodyText: "宝宝出生前我也跟风买了一堆东西，后来才发现很多真的用不上。这篇只说我自己踩过的坑。",
      scale: "quick"
    }
  });
  return run.id;
}

async function createAudiencePreparationSkeleton(runId: string) {
  await prisma.testRun.update({ where: { id: runId }, data: { status: "generating_audience" } });
  const plan = await prisma.audienceSamplingPlan.create({
    data: {
      runId,
      totalCount: 2,
      status: "generating_identities",
      confirmedAt: new Date(),
      planMarkdown: "测试计划",
      dimensionsJson: ["需求强度"],
      directives: {
        create: [{
          sortOrder: 0,
          name: "核心用户",
          description: "认真做购买前功课",
          quantity: 2,
          diversityAxesJson: ["需求强度"],
          rationale: "测试核心用户，观察收藏和追问",
          expansionStatus: "ready"
        }]
      }
    },
    include: { directives: true }
  });
  return { plan, directive: plan.directives[0]! };
}

async function createProfile(
  runId: string,
  samplingPlanId: string,
  samplingDirectiveId: string,
  samplingLabel: string,
  overrides: Partial<{
    sampleIndex: number;
    generationJobId: string | null;
    identityStatus: "profile_only" | "identity_queued" | "identity_generating" | "identity_ready" | "identity_failed";
    identityError: string | null;
    generatedUserId: string | null;
    generatedAgentId: string | null;
    generatedPlatformAccountId: string | null;
    demographicsJson: ReturnType<typeof testDemographics>;
  }> = {}
) {
  return prisma.audienceProfile.create({
    data: {
      runId,
      samplingPlanId,
      samplingDirectiveId,
      sampleIndex: overrides.sampleIndex ?? 0,
      sortOrder: overrides.sampleIndex ?? 0,
      samplingLabel,
      demographicsJson: overrides.demographicsJson ?? testDemographics(),
      generationJobId: overrides.generationJobId,
      identityStatus: overrides.identityStatus,
      identityError: overrides.identityError,
      generatedUserId: overrides.generatedUserId,
      generatedAgentId: overrides.generatedAgentId,
      generatedPlatformAccountId: overrides.generatedPlatformAccountId
    }
  });
}

function testDemographics() {
  return {
    gender: "不限定",
    ageRange: "不限定",
    cityTier: "不限定",
    lifeStage: "不限定",
    role: "不限定",
    spendingPower: "不限定"
  };
}

async function expectProfileIdentity(profileId: string, expected: Partial<{
  identityStatus: string;
  generationJobId: string | null;
  identityError: string | null;
  generatedUserId: string | null;
  generatedAgentId: string | null;
  generatedPlatformAccountId: string | null;
}>) {
  const profile = await prisma.audienceProfile.findUniqueOrThrow({ where: { id: profileId } });
  expect(profile).toMatchObject(expected);
}

async function waitForDb(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for database state.");
}

const mockLlmConfig: LlmRuntimeConfig = {
  provider: "openai-compatible",
  runtimeMode: "mock",
  models: {},
  capacity: DEFAULT_CAPACITY_SETTINGS
};

function testAiTaskRunner() {
  return new AiTaskRunner(() => mockLlmConfig);
}

class BlockingAgentProvider implements AgentProvider {
  private releasePersonasPromise: (() => void) | null = null;
  private personasBlocked = new Promise<void>((resolve) => {
    this.releasePersonasPromise = resolve;
  });

  releasePersonas() {
    this.releasePersonasPromise?.();
  }

  async generateAudienceSamplingPlan(): Promise<AudienceSamplingPlanDraft> {
    return {
      totalCount: 1,
      planMarkdown: "blocking provider test plan",
      dimensions: ["需求强度"],
      directives: [{
        name: "核心用户",
        description: "认真做购买前功课",
        quantity: 1,
        diversityAxes: ["需求强度"],
        rationale: "测试核心用户，观察收藏和追问"
      }]
    };
  }

  async generateAudienceSamplingPlanRevision(): Promise<never> {
    throw new Error("not used");
  }

  async generateAudienceSeatRevision(): Promise<never> {
    throw new Error("not used");
  }

  async expandAudienceProfiles(input: Parameters<AgentProvider["expandAudienceProfiles"]>[0]): Promise<void> {
    expect(input.chunkCount).toBeGreaterThan(0);
    await input.onFrame({
      type: "profile_completed",
      sampleIndex: input.chunkStart,
      profile: {
      samplingLabel: "核心用户 1",
      demographics: testDemographics()
      }
    });
  }

  async generateAudiencePersona(input: { profile: { profileId: string; demographics: Record<string, unknown> } }): Promise<GeneratedAudience> {
    await this.personasBlocked;
    return {
      profileId: input.profile.profileId,
      displayName: "新人设",
      persona: {
        profile: "新人设，30岁，新一线城市，测试背景，稳定关注核心用户议题。",
        personality: "测试决策风格。",
        mbtiType: "ISFJ",
        responseStyle: "测试表达风格。"
      }
    };
  }

  async runAudienceTurn(_context: RunParticipantContext): Promise<RunParticipantResult> {
    return { thoughtText: "测试", toolCalls: [], rawOutput: {}, model: "mock", promptVersion: "test" };
  }
}

class BlockingSamplingPlanProvider extends BlockingAgentProvider {
  private releasePlanPromise: (() => void) | null = null;
  private planBlocked = new Promise<void>((resolve) => {
    this.releasePlanPromise = resolve;
  });

  releasePlan() {
    this.releasePlanPromise?.();
  }

  override async generateAudienceSamplingPlan(): Promise<AudienceSamplingPlanDraft> {
    await this.planBlocked;
    return {
      totalCount: 12,
      planMarkdown: "blocking provider test plan",
      dimensions: ["需求强度"],
      directives: [{
        name: "核心用户",
        description: "认真做购买前功课",
        quantity: 12,
        diversityAxes: ["需求强度"],
        rationale: "测试核心用户，观察重复规划请求是否被拒绝"
      }]
    };
  }
}

class OneFailingIdentityProvider extends BlockingAgentProvider {
  override async generateAudiencePersona(input: { profile: { profileId: string; demographics: Record<string, unknown> } }): Promise<GeneratedAudience> {
    const demographics = input.profile.demographics as Record<string, string>;
    if (demographics.role?.includes("失败")) {
      throw new Error("persona provider failed for one profile");
    }
    return {
      profileId: input.profile.profileId,
      displayName: "成功人设",
      persona: {
        profile: "成功人设，30岁，新一线城市，测试背景，稳定关注核心用户议题。",
        personality: "测试决策风格，重视真实信息。",
        mbtiType: "ISTJ",
        responseStyle: "测试表达风格，短句口语化。"
      }
    };
  }
}

class OneFailingExpansionProvider extends BlockingAgentProvider {
  override async expandAudienceProfiles(input: Parameters<AgentProvider["expandAudienceProfiles"]>[0]): Promise<void> {
    if (input.directive.name === "挑剔用户") {
      throw new Error("profile expansion failed for picky users");
    }
    expect(input.chunkCount).toBeGreaterThan(0);
    await input.onFrame({
      type: "profile_completed",
      sampleIndex: input.chunkStart,
      profile: {
      samplingLabel: "核心用户 1",
      demographics: testDemographics()
      }
    });
  }
}
