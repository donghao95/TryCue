import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { prisma } from "@trycue/db";
import { buildApp } from "../app.js";
import { loadConfig, resolveWorkspacePath } from "../config.js";
import type { AgentProvider } from "../agents/types.js";
import { AiTaskRunner } from "../agents/taskRunner.js";
import { appendInitialObservation, buildPostObservation } from "../runtime/agentSessions.js";
import { generateReportAndCompleteRun, buildFallbackReportOutput } from "../runtime/report.js";
import { Scheduler } from "../runtime/scheduler.js";
import type { StepResult, ToolSet } from "ai";
import { persistStep } from "../tools/toolExecutor.js";
import { PROMPT_VERSION_AGENT } from "../agents/promptVersions.js";
import { createToolTestBundle, resetDatabase } from "./helpers.js";
import { recordLiveEvent } from "../liveEvents.js";
import { DEFAULT_CAPACITY_SETTINGS } from "../llm/capacityPresets.js";

const testLlmConfig = {
  provider: "openai-compatible" as const,
  runtimeMode: "mock" as const,
  models: {},
  capacity: DEFAULT_CAPACITY_SETTINGS
};

describe("TryCue API integration", () => {
  const llmConfigPath = resolve("config/llm.integration-test.yaml");

  beforeEach(async () => {
    await resetDatabase();
    await rm(llmConfigPath, { force: true });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates, starts, completes, and reports a quick mock run", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: true });
    const bodyText = "宝宝出生前我也跟风买了一堆东西，后来才发现很多真的用不上。这篇只说我自己踩过的坑，给新手爸妈做参考。我的建议是先少买、住进去再补，真正高频的东西会自己浮出来。";
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "这 8 个宝宝用品千万别乱买",
        coverImageUrl: "/uploads/test.png",
        imageUrls: ["/uploads/test.png", "/uploads/detail.png"],
        bodyText,
        scale: "quick"
      }
    });
    expect(createResponse.statusCode).toBe(200);
    const createBody = createResponse.json();
    expect(createBody.success).toBe(true);
    const runId = createBody.data.runId as string;
    const overview = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().data.contentVersion.imageUrls).toEqual(["/uploads/test.png", "/uploads/detail.png"]);
    expect(overview.json().data.contentVersion.bodyText).toBe(bodyText);
    expect(overview.json().data.contentVersion.bodyPreview).toBe(bodyText.slice(0, 120));

    await prepareAudienceReady(app, runId);

    const startResponse = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/start`,
      payload: { force: false }
    });
    expect(startResponse.statusCode).toBe(200);

    await waitFor(async () => {
      const run = await prisma.testRun.findUniqueOrThrow({ where: { id: runId } });
      return run.status === "completed";
    });

    expect(await prisma.runParticipant.count({ where: { runId } })).toBe(12);
    expect(await prisma.agentTurn.count({ where: { runId, status: "completed" } })).toBeGreaterThan(0);
    expect(await prisma.agentToolCall.count({ where: { runId, status: "committed" } })).toBeGreaterThan(0);
    expect(await prisma.liveEvent.count({ where: { runId } })).toBeGreaterThan(0);
    const contentVersion = await prisma.contentVersion.findUniqueOrThrow({ where: { runId } });
    expect(await prisma.simulatedComment.count({ where: { contentVersionId: contentVersion.id } })).toBeGreaterThan(0);

    // Verify audience-seats endpoint
    const seatsResponse = await app.inject({ method: "GET", url: `/api/runs/${runId}/audience-seats` });
    expect(seatsResponse.statusCode).toBe(200);
    const seatsBody = seatsResponse.json();
    expect(seatsBody.success).toBe(true);
    expect(seatsBody.data.seats).toHaveLength(12);
    const firstSeat = seatsBody.data.seats[0];
    expect(firstSeat).toHaveProperty("participantId");
    expect(firstSeat).toHaveProperty("name");
    expect(firstSeat).toHaveProperty("segment");
    expect(firstSeat).toHaveProperty("status");
    expect(firstSeat).toHaveProperty("hasOpened");
    expect(firstSeat).toHaveProperty("hasLiked");
    expect(firstSeat).toHaveProperty("hasFavorited");
    expect(firstSeat).toHaveProperty("hasCommented");

    // Verify audience detail endpoint
    const participantId = firstSeat.participantId;
    const detailResponse = await app.inject({ method: "GET", url: `/api/runs/${runId}/participants/${participantId}` });
    expect(detailResponse.statusCode).toBe(200);
    const detailBody = detailResponse.json();
    expect(detailBody.success).toBe(true);
    expect(detailBody.data.participantId).toBe(participantId);
    expect(detailBody.data.persona).toHaveProperty("name");
    expect(detailBody.data.persona).toHaveProperty("segment");
    expect(detailBody.data.journey).toHaveProperty("status");
    expect(Array.isArray(detailBody.data.timeline)).toBe(true);
    expect(Array.isArray(detailBody.data.interactions)).toBe(true);
    expect(Array.isArray(detailBody.data.comments)).toBe(true);

    // Verify audience events exist
    const audienceEvents = await prisma.liveEvent.findMany({
      where: { runId, eventType: { in: ["audience.status_updated", "audience.action_happened"] } }
    });
    expect(audienceEvents.length).toBeGreaterThan(0);

    const reportResponse = await app.inject({ method: "GET", url: `/api/runs/${runId}/report` });
    expect(reportResponse.statusCode).toBe(200);
    const reportText = reportResponse.body;
    // Hard boundary: no precise scores, no real-platform prediction claims.
    expect(reportText).not.toContain("预测点击率");
    expect(reportText).not.toContain("真实平台表现");
    expect(reportText).not.toContain("发布后会获得");
    expect(reportText).not.toContain("一定会爆");
    const report = await prisma.report.findUniqueOrThrow({ where: { runId } });
    // New schema: reportOutputJson + evidencePackJson (no legacy evidenceIndexJson).
    const evidencePack = report.evidencePackJson as Record<string, unknown>;
    expect(evidencePack).toHaveProperty("funnel");
    expect(evidencePack).toHaveProperty("evidenceIndex");
    expect(evidencePack).toHaveProperty("meta");
    const reportOutput = report.reportOutputJson as Record<string, unknown>;
    expect(reportOutput).toHaveProperty("verdict");
    expect(reportOutput).toHaveProperty("segments");
    expect(reportOutput).toHaveProperty("diagnostics");
    expect(reportOutput).toHaveProperty("revisionPlan");
    expect(reportOutput).toHaveProperty("retestPlan");
    const journeys = await prisma.agentJourney.findMany({ where: { runId } });
    const openPostCounts = await Promise.all(
      journeys.map((j) => prisma.socialInteractionEvent.count({
        where: { journeyId: j.id, interactionType: "open_post" }
      }))
    );
    // Some journeys should have opened the post (post phase), some should not (feed phase / skipped).
    expect(openPostCounts.some((c) => c > 0)).toBe(true);
    expect(openPostCounts.some((c) => c === 0)).toBe(true);
    await app.close();
  }, 30000);

  it("paginates run logs with a stable newest-first cursor", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const { run } = await createToolTestBundle();
    const baseCreatedAt = new Date("2026-01-01T00:00:00.000Z");
    await prisma.runLog.createMany({
      data: [
        { runId: run.id, logType: "control", message: "first", simulatedTime: 1, metadataJson: {}, createdAt: new Date(baseCreatedAt.getTime() + 1000) },
        { runId: run.id, logType: "control", message: "second", simulatedTime: 2, metadataJson: {}, createdAt: new Date(baseCreatedAt.getTime() + 2000) },
        { runId: run.id, logType: "control", message: "third", simulatedTime: 3, metadataJson: {}, createdAt: new Date(baseCreatedAt.getTime() + 3000) }
      ]
    });

    const firstPage = await app.inject({ method: "GET", url: `/api/runs/${run.id}/run-logs?limit=2&order=desc` });
    expect(firstPage.statusCode).toBe(200);
    const firstBody = firstPage.json();
    expect(firstBody.data.logs.map((log: { message: string }) => log.message)).toEqual(["third", "second"]);
    expect(firstBody.data.hasMore).toBe(true);
    expect(firstBody.data.nextCursor).toEqual(expect.any(String));

    const secondPage = await app.inject({
      method: "GET",
      url: `/api/runs/${run.id}/run-logs?limit=2&order=desc&cursor=${encodeURIComponent(firstBody.data.nextCursor)}`
    });
    expect(secondPage.statusCode).toBe(200);
    const secondBody = secondPage.json();
    expect(secondBody.data.logs.map((log: { message: string }) => log.message)).toEqual(["first"]);
    expect(secondBody.data.hasMore).toBe(false);
    expect(secondBody.data.nextCursor).toBeNull();

    const invalidLimit = await app.inject({ method: "GET", url: `/api/runs/${run.id}/run-logs?limit=NaN&order=desc` });
    expect(invalidLimit.statusCode).toBe(200);
    expect(invalidLimit.json().data.logs.map((log: { message: string }) => log.message)).toEqual(["third", "second", "first"]);
    expect(invalidLimit.json().data.hasMore).toBe(false);

    const clampedLimit = await app.inject({ method: "GET", url: `/api/runs/${run.id}/run-logs?limit=-1&order=desc` });
    expect(clampedLimit.statusCode).toBe(200);
    expect(clampedLimit.json().data.logs.map((log: { message: string }) => log.message)).toEqual(["third"]);
    expect(clampedLimit.json().data.hasMore).toBe(true);
    expect(clampedLimit.json().data.nextCursor).toEqual(expect.any(String));

    await app.close();
  });

  it("uses explicit mock mode even when real LLM fields are complete", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const settings = await app.inject({
      method: "PUT",
      url: "/api/settings/llm",
      payload: {
        provider: "openai-compatible",
        runtimeMode: "mock",
        apiKey: "test-key",
        baseUrl: "https://api.example.com/v1",
        models: { fast: "fast-model", pro: "pro-model" }
      }
    });
    expect(settings.statusCode).toBe(200);
    expect(settings.json().data.runtimeMode).toBe("mock");
    expect(settings.json().data.isRealConfigComplete).toBe(true);
    expect(settings.json().data.isConfigured).toBe(false);

    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "测试标题",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这是一段超过二十个字的正文，用于创建试映任务并测试显式 mock 模式。",
        scale: "quick"
      }
    });
    const runId = create.json().data.runId as string;
    const run = await prisma.testRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.configJson).toMatchObject({ runtimeMode: "mock" });

    await prepareAudienceReady(app, runId);
    const start = await app.inject({ method: "POST", url: `/api/runs/${runId}/start`, payload: {} });
    expect(start.statusCode).toBe(200);
    expect(start.json().data.status).toBe("running");
    await app.close();
  });

  it("creates a custom audience-count run", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "自定义观众试映",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这是一段超过二十个字的正文，用于创建自定义观众数的试映任务。",
        scale: "custom",
        audienceCount: 10000
      }
    });
    expect(create.statusCode).toBe(200);
    const runId = create.json().data.runId as string;
    const run = await prisma.testRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.audienceCount).toBe(10000);
    expect(run.configJson).toMatchObject({ scale: "custom", audienceCount: 10000 });
    await app.close();
  });

  it("enforces one content version per run at the database boundary", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "单内容版本约束测试",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这是一段超过二十个字的正文，用于验证一个 run 只能有一个内容版本。",
        scale: "quick"
      }
    });
    expect(create.statusCode).toBe(200);
    const runId = create.json().data.runId as string;

    await expect(prisma.contentVersion.create({
      data: {
        runId,
        versionName: "version_b",
        title: "第二个版本",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这个版本不应该被允许写入，因为 V1 固定一个 run 只有一个内容版本。",
        scale: "quick"
      }
    })).rejects.toThrow();

    await app.close();
  });

  it("lists recent runs for the history page", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const first = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "第一条历史试映",
        coverImageUrl: "/uploads/history-first.png",
        bodyText: "这是一段超过二十个字的正文，用于验证历史列表第一条试映。",
        scale: "quick"
      }
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "第二条历史试映",
        coverImageUrl: "/uploads/history-second.png",
        bodyText: "这是一段超过二十个字的正文，用于验证历史列表第二条试映。",
        scale: "standard"
      }
    });
    const firstRunId = first.json().data.runId as string;
    const secondRunId = second.json().data.runId as string;

    const list = await app.inject({ method: "GET", url: "/api/runs?limit=10" });
    expect(list.statusCode).toBe(200);
    const runs = list.json().data.runs as Array<{ runId: string; title: string; coverImageUrl: string; audienceTotal: number; hasReport: boolean }>;
    expect(runs.map((run) => run.runId)).toEqual([secondRunId, firstRunId]);
    expect(runs[0]).toMatchObject({
      title: "第二条历史试映",
      coverImageUrl: "/uploads/history-second.png",
      audienceTotal: 30,
      hasReport: false
    });
    await app.close();
  });

  it("hard-deletes a prepared run with cascade, run-local identities, and unreferenced local assets", async () => {
    const uploadDir = resolveWorkspacePath("apps/api/uploads");
    await mkdir(uploadDir, { recursive: true });
    const localFile = resolve(uploadDir, "history-delete.png");
    await writeFile(localFile, "fake image bytes", "utf8");
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "待删除历史试映",
        coverImageUrl: "/uploads/history-delete.png",
        bodyText: "这是一段超过二十个字的正文，用于验证硬删除会清理试映相关数据。",
        scale: "quick"
      }
    });
    const runId = create.json().data.runId as string;
    await prepareAudienceReady(app, runId);
    const content = await prisma.contentVersion.findUniqueOrThrow({ where: { runId } });
    const profileCount = await prisma.audienceProfile.count({ where: { runId, identityStatus: "identity_ready" } });
    expect(profileCount).toBeGreaterThan(0);
    const asset = await prisma.asset.findUniqueOrThrow({ where: { url: "/uploads/history-delete.png" } });

    const deleted = await app.inject({ method: "DELETE", url: `/api/runs/${runId}` });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data).toMatchObject({ status: "deleted" });
    expect(await prisma.testRun.count({ where: { id: runId } })).toBe(0);
    expect(await prisma.contentVersion.count({ where: { id: content.id } })).toBe(0);
    expect(await prisma.runParticipant.count({ where: { runId } })).toBe(0);
    expect(await prisma.audienceSamplingPlan.count({ where: { runId } })).toBe(0);
    expect(await prisma.audienceSamplingDirective.count({ where: { plan: { runId } } })).toBe(0);
    expect(await prisma.audienceProfile.count({ where: { runId } })).toBe(0);
    expect(await prisma.audienceGenerationJob.count({ where: { runId } })).toBe(0);
    expect(await prisma.contentVersionImage.count({ where: { contentVersionId: content.id } })).toBe(0);
    expect(await prisma.asset.count({ where: { id: asset.id } })).toBe(0);
    expect(await prisma.agent.count({ where: { retentionPolicy: "delete_with_origin_run" } })).toBe(0);
    await expect(access(localFile)).rejects.toThrow();
    await app.close();
  });

  it("rejects hard-delete for running runs", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const { run } = await createToolTestBundle();
    const deleted = await app.inject({ method: "DELETE", url: `/api/runs/${run.id}` });
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json().error.code).toBe("RUN_DELETE_BLOCKED");
    expect(await prisma.testRun.count({ where: { id: run.id } })).toBe(1);
    await app.close();
  });

  it("accepts complete explicit real LLM settings without calling the provider", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const settings = await app.inject({
      method: "PUT",
      url: "/api/settings/llm",
      payload: {
        provider: "openai-compatible",
        runtimeMode: "real",
        apiKey: "test-key",
        baseUrl: "https://api.example.com/v1",
        models: { fast: "fast-model", pro: "pro-model" }
      }
    });
    expect(settings.statusCode).toBe(200);
    expect(settings.json().data).toMatchObject({
      runtimeMode: "real",
      isRealConfigComplete: true,
      isConfigured: true
    });
    expect(settings.json().data.execution).toBeUndefined();
    await app.close();
  });

  it("rejects LLM execution-pool settings", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const settings = await app.inject({
      method: "PUT",
      url: "/api/settings/llm",
      payload: {
        provider: "openai-compatible",
        runtimeMode: "mock",
        models: { fast: "", pro: "" },
        execution: { maxConcurrentAiTasks: 3, taskTimeoutSeconds: 90, maxRetry: 1 }
      }
    });
    expect(settings.statusCode).toBe(400);
    expect(settings.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("rejects partial explicit real LLM config", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const settings = await app.inject({
      method: "PUT",
      url: "/api/settings/llm",
      payload: {
        provider: "openai-compatible",
        runtimeMode: "real",
        baseUrl: "",
        models: { fast: "", pro: "" }
      }
    });
    expect(settings.statusCode).toBe(400);
    expect(settings.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("rejects legacy LLM settings requests without runtimeMode", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const settings = await app.inject({
      method: "PUT",
      url: "/api/settings/llm",
      payload: {
        provider: "openai-compatible",
        baseUrl: "",
        models: { fast: "", pro: "" }
      }
    });
    expect(settings.statusCode).toBe(400);
    expect(settings.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("rejects legacy LLM config files without runtimeMode", async () => {
    await writeFile(
      llmConfigPath,
      ["provider: openai-compatible", "apiKey: ''", "baseUrl: ''", "models:", "  fast: ''", "  pro: ''", ""].join("\n"),
      "utf8"
    );
    await expect(buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false })).rejects.toThrow();
  });

  it("marks the journey as failed and completes the run when agent provider fails", async () => {
    const bundle = await createToolTestBundle(true);
    await prisma.agentTurn.update({ where: { id: bundle.action.id }, data: { status: "created" } });
    const failingProvider: AgentProvider = {
      async generateAudienceSamplingPlan() {
        throw new Error("not used");
      },
      async generateAudienceSamplingPlanRevision() {
        throw new Error("not used");
      },
      async generateAudienceSeatRevision() {
        throw new Error("not used");
      },
      async expandAudienceProfiles(_input) {
        throw new Error("not used");
      },
      async generateAudiencePersona() {
        throw new Error("not used");
      },
      async runAudienceTurn() {
        throw new Error("agent provider failed");
      }
    };
    const scheduler = new Scheduler(
      { ...loadConfig(), appEnv: "test", schedulerMaxRetry: 0, enableScheduler: false },
      () => testLlmConfig,
      () => failingProvider,
      new AiTaskRunner(() => testLlmConfig)
    );

    await scheduler.drain(bundle.run.id);

    // A single agent failure no longer pauses the run.
    // With no remaining active journeys or ready participants,
    // the scheduler generates a report and completes the run.
    const run = await prisma.testRun.findUniqueOrThrow({ where: { id: bundle.run.id } });
    expect(run.status).toBe("completed");
    expect(await prisma.report.count({ where: { runId: bundle.run.id } })).toBe(1);
    const journey = await prisma.agentJourney.findUniqueOrThrow({ where: { id: bundle.journey.id } });
    expect(journey.status).toBe("failed");
    expect(journey.errorMessage).toContain("agent provider failed");
    expect(await prisma.liveEvent.count({ where: { runId: bundle.run.id, eventType: "run.paused" } })).toBe(0);
    const participant = await prisma.runParticipant.findUniqueOrThrow({ where: { id: bundle.audience.id } });
    expect(participant.runtimeStatus).toBe("failed");
    const exceptionLog = await prisma.runLog.findFirst({ where: { runId: bundle.run.id, logType: "exception" } });
    expect(exceptionLog).not.toBeNull();
    expect(exceptionLog!.message).toContain("agent provider failed");
    expect(exceptionLog!.participantId).toBe(bundle.audience.id);
  });

  it("marks two independent journeys as failed individually and completes the run with a report", async () => {
    const bundle1 = await createToolTestBundle(true);

    // Create a second independent participant + journey on the same run
    const user2 = await prisma.user.create({ data: { userType: "agent", nickname: "测试用户二" } });
    const personaJson2 = {
      profile: "测试用户二，32岁，二线城市，另一个测试背景。",
      personality: "另一个测试性格特征。",
      mbtiType: "ESTJ",
      responseStyle: "另一种表达风格。"
    };
    const agent2 = await prisma.agent.create({ data: { userId: user2.id, personaJson: personaJson2 } });
    const platformAccount2 = await prisma.platformAccount.create({ data: { userId: user2.id, platform: "xiaohongshu" } });
    const audience2 = await prisma.runParticipant.create({
      data: {
        runId: bundle1.run.id,
        userId: user2.id,
        agentId: agent2.id,
        platformAccountId: platformAccount2.id,
        displayNameSnapshot: "测试用户二",
        avatarUrlSnapshot: null,
        profileSnapshotJson: { samplingLabel: "测试用户二" },
        platformAccountSnapshotJson: { platform: "xiaohongshu", platformAccountId: platformAccount2.id },
        runtimeStatus: "queued",
        agentSnapshotJson: personaJson2
      }
    });
    const postState = await prisma.simulatedPostState.findUniqueOrThrow({ where: { contentVersionId: bundle1.content.id } });
    const journey2 = await prisma.agentJourney.create({
      data: {
        runId: bundle1.run.id,
        participantId: audience2.id,
        actorUserId: audience2.userId,
        platformAccountId: audience2.platformAccountId,
        contentVersionId: bundle1.content.id,
        promptVersion: PROMPT_VERSION_AGENT
      }
    });
    await appendInitialObservation(prisma, journey2.id, bundle1.run.id, buildPostObservation(bundle1.content, postState, { liked: false, favorited: false }));
    await prisma.agentTurn.create({
      data: {
        runId: bundle1.run.id,
        participantId: audience2.id,
        actorUserId: audience2.userId,
        platformAccountId: audience2.platformAccountId,
        journeyId: journey2.id,
        contentVersionId: bundle1.content.id,
        stepIndex: 0,
        queueSeq: 2,
        status: "created"
      }
    });
    await prisma.agentTurn.update({ where: { id: bundle1.action.id }, data: { status: "created" } });

    // Both journeys will fail because the provider always throws.
    const failingProvider: AgentProvider = {
      async generateAudienceSamplingPlan() { throw new Error("not used"); },
      async generateAudienceSamplingPlanRevision() { throw new Error("not used"); },
      async generateAudienceSeatRevision() { throw new Error("not used"); },
      async expandAudienceProfiles() { throw new Error("not used"); },
      async generateAudiencePersona() { throw new Error("not used"); },
      async runAudienceTurn() { throw new Error("agent provider failed"); }
    };
    const scheduler = new Scheduler(
      { ...loadConfig(), appEnv: "test", schedulerMaxRetry: 0, enableScheduler: false },
      () => testLlmConfig,
      () => failingProvider,
      new AiTaskRunner(() => testLlmConfig)
    );

    await scheduler.drain(bundle1.run.id);

    // Both journeys fail independently; the run still completes with a report.
    const run = await prisma.testRun.findUniqueOrThrow({ where: { id: bundle1.run.id } });
    expect(run.status).toBe("completed");
    expect(await prisma.report.count({ where: { runId: bundle1.run.id } })).toBe(1);
    const pausedEvents = await prisma.liveEvent.findMany({ where: { runId: bundle1.run.id, eventType: "run.paused" } });
    expect(pausedEvents).toHaveLength(0);

    // Each journey is independently marked as failed.
    const j1 = await prisma.agentJourney.findUniqueOrThrow({ where: { id: bundle1.journey.id } });
    expect(j1.status).toBe("failed");
    expect(j1.errorMessage).toContain("agent provider failed");
    const j2 = await prisma.agentJourney.findUniqueOrThrow({ where: { id: journey2.id } });
    expect(j2.status).toBe("failed");
    expect(j2.errorMessage).toContain("agent provider failed");

    // Both participants are marked as failed.
    const rp1 = await prisma.runParticipant.findUniqueOrThrow({ where: { id: bundle1.audience.id } });
    expect(rp1.runtimeStatus).toBe("failed");
    const rp2 = await prisma.runParticipant.findUniqueOrThrow({ where: { id: audience2.id } });
    expect(rp2.runtimeStatus).toBe("failed");

    // Each failed journey produces its own exception log.
    const exceptionLogs = await prisma.runLog.findMany({ where: { runId: bundle1.run.id, logType: "exception" } });
    expect(exceptionLogs).toHaveLength(2);
    expect(new Set(exceptionLogs.map(log => log.participantId))).toEqual(
      new Set([bundle1.audience.id, audience2.id]),
    );
  });

  it("fails a timed out action with partial model audit instead of replaying tools", async () => {
    const bundle = await createToolTestBundle(false);
    await persistStep(bundle.action.id, {
      text: "",
      toolCalls: [{ toolCallId: "call-timeout", toolName: "open_post", input: {} }],
      finishReason: "tool_calls",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      request: {},
      response: {},
      model: { modelId: "test-model" }
    } as unknown as StepResult<ToolSet>);
    await prisma.agentTurn.update({
      where: { id: bundle.action.id },
      data: {
        status: "model_calling",
        lockedAt: new Date(Date.now() - 60_000),
        lockedBy: "dead-worker",
        startedAt: new Date(Date.now() - 60_000)
      }
    });
    const exitProvider: AgentProvider = {
      async generateAudienceSamplingPlan() {
        throw new Error("not used");
      },
      async generateAudienceSamplingPlanRevision() {
        throw new Error("not used");
      },
      async generateAudienceSeatRevision() {
        throw new Error("not used");
      },
      async expandAudienceProfiles(_input) {
        throw new Error("not used");
      },
      async generateAudiencePersona() {
        throw new Error("not used");
      },
      async runAudienceTurn() {
        return {
          thoughtText: "我还是不想继续看，直接退出。",
          toolCalls: [{ toolName: "exit_browsing", args: {} }],
          managedRuntime: true,
          rawOutput: { provider: "test" },
          model: "test-model",
          promptVersion: PROMPT_VERSION_AGENT
        };
      }
    };
    const scheduler = new Scheduler(
      { ...loadConfig(), appEnv: "test", schedulerMaxRetry: 2, enableScheduler: false },
      () => testLlmConfig,
      () => exitProvider,
      new AiTaskRunner(() => testLlmConfig)
    );

    await scheduler.drain(bundle.run.id);

    const recoveredAction = await prisma.agentTurn.findUniqueOrThrow({ where: { id: bundle.action.id } });
    expect(recoveredAction.status).toBe("failed");
    expect(recoveredAction.errorMessage).toContain("partial model output");
    expect(recoveredAction.retryCount).toBe(0);
    const actions = await prisma.agentTurn.findMany({ where: { journeyId: bundle.journey.id }, orderBy: { stepIndex: "asc" } });
    expect(actions).toHaveLength(1);
    const journey = await prisma.agentJourney.findUniqueOrThrow({ where: { id: bundle.journey.id } });
    expect(journey.status).toBe("failed");
    expect(journey.errorMessage).toContain("partial model output");
    expect(await prisma.agentToolCall.count({ where: { agentTurnId: bundle.action.id } })).toBe(0);
  });

  it("caps model call timeout by remaining AgentJourney timeout and aborts the provider call", async () => {
    const bundle = await createToolTestBundle(false);
    let timeoutMsReceived: number | undefined;
    const blockingProvider: AgentProvider = {
      async generateAudienceSamplingPlan() {
        throw new Error("not used");
      },
      async generateAudienceSamplingPlanRevision() {
        throw new Error("not used");
      },
      async generateAudienceSeatRevision() {
        throw new Error("not used");
      },
      async expandAudienceProfiles(_input) {
        throw new Error("not used");
      },
      async generateAudiencePersona() {
        throw new Error("not used");
      },
      async runAudienceTurn(context) {
        timeoutMsReceived = context.timeoutMs;
        if (!context.timeoutMs) throw new Error("timeoutMs not provided");
        return new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error("provider timeout")), context.timeoutMs!);
          context.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("provider aborted"));
          }, { once: true });
        });
      }
    };
    const scheduler = new Scheduler(
      {
        ...loadConfig(),
        appEnv: "test",
        modelCallTimeoutSeconds: 30,
        agentJourneyTimeoutSeconds: 1,
        enableScheduler: false
      },
      () => testLlmConfig,
      () => blockingProvider,
      new AiTaskRunner(() => testLlmConfig)
    );

    await scheduler.drain(bundle.run.id);

    expect(timeoutMsReceived).toBeDefined();
    expect(timeoutMsReceived!).toBeGreaterThan(900);
    expect(timeoutMsReceived!).toBeLessThanOrEqual(1000); // min(30s, ~1s journey remaining)
    const journey = await prisma.agentJourney.findUniqueOrThrow({ where: { id: bundle.journey.id } });
    expect(journey.status).toBe("failed");
    expect(journey.errorMessage).toContain("provider");
  }, 5000);

  it("does not overwrite a terminal journey when failure handling runs late", async () => {
    const bundle = await createToolTestBundle(false);
    await prisma.agentJourney.update({
      where: { id: bundle.journey.id },
      data: { status: "finished", runnerStatus: "running", completedAt: new Date() }
    });
    await prisma.runParticipant.update({
      where: { id: bundle.audience.id },
      data: { runtimeStatus: "finished" }
    });
    const scheduler = new Scheduler(
      { ...loadConfig(), appEnv: "test", enableScheduler: false },
      () => testLlmConfig,
      () => {
        throw new Error("not used");
      },
      new AiTaskRunner(() => testLlmConfig)
    );

    await (scheduler as unknown as { handleAgentJourneyFailure: (journeyId: string, error: unknown) => Promise<void> })
      .handleAgentJourneyFailure(bundle.journey.id, new Error("late release failure"));

    const journey = await prisma.agentJourney.findUniqueOrThrow({ where: { id: bundle.journey.id } });
    const participant = await prisma.runParticipant.findUniqueOrThrow({ where: { id: bundle.audience.id } });
    expect(journey.status).toBe("finished");
    expect(journey.runnerStatus).toBe("idle");
    expect(journey.errorMessage).toBeNull();
    expect(participant.runtimeStatus).toBe("finished");
  });

  it("continue_retry preserves transcript items, appends system_notice, sets journey active + queued, advances step, deletes report", async () => {
    const bundle = await createToolTestBundle(true);
    // Create a stale report
    const cv = await prisma.contentVersion.findUniqueOrThrow({ where: { runId: bundle.run.id } });
    await prisma.report.create({
      data: { runId: bundle.run.id, contentVersionId: cv.id, recommendation: "recommend_publish", reportOutputJson: {}, evidencePackJson: {}, model: "test", promptVersion: "test" }
    });
    await prisma.agentJourney.update({
      where: { id: bundle.journey.id },
      data: { status: "failed", errorMessage: "agent timeout" }
    });
    await prisma.agentTurn.update({
      where: { id: bundle.action.id },
      data: { status: "failed", errorMessage: "agent timeout" }
    });
    await prisma.runParticipant.update({
      where: { id: bundle.audience.id },
      data: { runtimeStatus: "failed" }
    });

    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const response = await app.inject({
      method: "POST",
      url: `/api/runs/${bundle.run.id}/retry`,
      payload: { participantId: bundle.audience.id, strategy: "continue_retry" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.strategy).toBe("continue_retry");
    expect(body.data.participantId).toBe(bundle.audience.id);
    expect(body.data.status).toBe("running");

    // Stale report deleted
    expect(await prisma.report.count({ where: { runId: bundle.run.id } })).toBe(0);

    // Journey transcript has system_notice appended
    const transcriptItems = await prisma.agentTranscriptItem.findMany({
      where: { journeyId: bundle.journey.id },
      orderBy: { seq: "asc" }
    });
    const notice = transcriptItems.find((item) => item.itemType === "system_notice");
    expect(notice).toBeDefined();
    expect(notice!.content).toContain("agent timeout");

    // Journey active + runnerStatus queued
    const journey = await prisma.agentJourney.findUniqueOrThrow({ where: { id: bundle.journey.id } });
    expect(journey.status).toBe("active");
    expect(journey.runnerStatus).toBe("queued");
    expect(journey.errorMessage).toBeNull();
    expect(journey.completedAt).toBeNull();
    expect(journey.lockedBy).toBeNull();

    // currentStepIndex advanced past max action stepIndex
    expect(journey.currentStepIndex).toBe(bundle.action.stepIndex + 1);

    // Participant queued
    const updatedParticipant = await prisma.runParticipant.findUniqueOrThrow({ where: { id: bundle.audience.id } });
    expect(updatedParticipant.runtimeStatus).toBe("queued");

    // Run status running
    const run = await prisma.testRun.findUniqueOrThrow({ where: { id: bundle.run.id } });
    expect(run.status).toBe("running");
    expect(run.completedAt).toBeNull();
    expect(run.terminalReason).toBeNull();

    await app.close();
  });

  it("clean_retry deletes only target participant runtime facts, preserves other participant, resets ready, recomputes postState", async () => {
    const bundle = await createToolTestBundle(true);
    // Create a stale report
    const cv2 = await prisma.contentVersion.findUniqueOrThrow({ where: { runId: bundle.run.id } });
    await prisma.report.create({
      data: { runId: bundle.run.id, contentVersionId: cv2.id, recommendation: "recommend_publish", reportOutputJson: {}, evidencePackJson: {}, model: "test", promptVersion: "test" }
    });
    await prisma.agentJourney.update({
      where: { id: bundle.journey.id },
      data: { status: "failed", errorMessage: "agent crash" }
    });
    await prisma.runParticipant.update({
      where: { id: bundle.audience.id },
      data: { runtimeStatus: "failed" }
    });

    // Create a second participant with its own journey that should be preserved
    const otherUser = await prisma.user.create({ data: { userType: "agent", nickname: "其他用户" } });
    const otherAgent = await prisma.agent.create({ data: { userId: otherUser.id, personaJson: { profile: "p", personality: "p", mbtiType: "ISFJ", responseStyle: "r" } } });
    const otherPa = await prisma.platformAccount.create({ data: { userId: otherUser.id, platform: "xiaohongshu" } });
    const otherParticipant = await prisma.runParticipant.create({
      data: {
        runId: bundle.run.id,
        userId: otherUser.id,
        agentId: otherAgent.id,
        platformAccountId: otherPa.id,
        displayNameSnapshot: "其他用户",
        avatarUrlSnapshot: null,
        profileSnapshotJson: {},
        platformAccountSnapshotJson: {},
        runtimeStatus: "finished",
        agentSnapshotJson: {}
      }
    });
    const otherJourney = await prisma.agentJourney.create({
      data: {
        runId: bundle.run.id,
        participantId: otherParticipant.id,
        actorUserId: otherUser.id,
        platformAccountId: otherPa.id,
        contentVersionId: bundle.contentVersion.id,
        promptVersion: PROMPT_VERSION_AGENT,
        status: "finished",
        runnerStatus: "idle"
      }
    });

    // Add a comment from the other participant to verify it's preserved
    await prisma.simulatedComment.create({
      data: {
        contentVersionId: bundle.contentVersion.id,
        journeyId: otherJourney.id,
        participantId: otherParticipant.id,
        actorUserId: otherUser.id,
        agentId: otherAgent.id,
        platformAccountId: otherPa.id,
        source: "agent_tool",
        commentText: "其他用户的评论",
        simulatedTime: 10
      }
    });

    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const response = await app.inject({
      method: "POST",
      url: `/api/runs/${bundle.run.id}/retry`,
      payload: { participantId: bundle.audience.id, strategy: "clean_retry" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.strategy).toBe("clean_retry");
    expect(body.data.deleted).toBeDefined();
    expect(body.data.deleted.agentJourneys).toBe(1); // Only target participant's journey deleted

    // Stale report deleted
    expect(await prisma.report.count({ where: { runId: bundle.run.id } })).toBe(0);

    // Target participant journey/actions deleted
    expect(await prisma.agentJourney.count({ where: { participantId: bundle.audience.id } })).toBe(0);
    expect(await prisma.agentTurn.count({ where: { participantId: bundle.audience.id } })).toBe(0);
    expect(await prisma.actionLog.count({ where: { participantId: bundle.audience.id } })).toBe(0);

    // Other participant preserved
    expect(await prisma.agentJourney.count({ where: { participantId: otherParticipant.id } })).toBe(1);
    const otherJourneyAfter = await prisma.agentJourney.findUniqueOrThrow({ where: { id: otherJourney.id } });
    expect(otherJourneyAfter.status).toBe("finished");
    const otherComment = await prisma.simulatedComment.findFirst({ where: { participantId: otherParticipant.id } });
    expect(otherComment).toBeDefined();
    expect(otherComment!.commentText).toBe("其他用户的评论");

    // Target participant reset to ready
    const targetAfter = await prisma.runParticipant.findUniqueOrThrow({ where: { id: bundle.audience.id } });
    expect(targetAfter.runtimeStatus).toBe("ready");

    // PostState recomputed (only other participant's comment remains)
    const postState = await prisma.simulatedPostState.findUniqueOrThrow({ where: { contentVersionId: bundle.contentVersion.id } });
    expect(postState.commentCount).toBe(1); // Only the other participant's comment
    expect(postState.exposureCount).toBe(1); // Only the other journey
    expect(postState.currentPhase).toBe("running");

    // Run status running
    const run = await prisma.testRun.findUniqueOrThrow({ where: { id: bundle.run.id } });
    expect(run.status).toBe("running");

    await app.close();
  });

  it("rejects retry when run status, participant, or failed journey is invalid", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });

    // Draft run -> 409 INVALID_RUN_STATUS
    const draftRun = await prisma.testRun.create({
      data: { status: "draft", audienceCount: 1, configJson: {} }
    });
    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/runs/${draftRun.id}/retry`,
      payload: { participantId: "any" }
    });
    expect(draftResponse.statusCode).toBe(409);

    // Paused run with invalid participant -> 409 INVALID_RETRY_TARGET
    const pausedRun = await prisma.testRun.create({
      data: { status: "paused", audienceCount: 1, configJson: {} }
    });
    const noParticipantResponse = await app.inject({
      method: "POST",
      url: `/api/runs/${pausedRun.id}/retry`,
      payload: { participantId: "nonexistent" }
    });
    expect(noParticipantResponse.statusCode).toBe(409);

    // Paused run with valid participant but no failed journey -> 409 INVALID_RETRY_TARGET
    const bundle = await createToolTestBundle(true);
    await prisma.testRun.update({ where: { id: bundle.run.id }, data: { status: "paused" } });
    // Journey is active, not failed
    const noFailedResponse = await app.inject({
      method: "POST",
      url: `/api/runs/${bundle.run.id}/retry`,
      payload: { participantId: bundle.audience.id }
    });
    expect(noFailedResponse.statusCode).toBe(409);

    await app.close();
  });

  it("clean_retry recreates missing simulatedPostState via upsert", async () => {
    const bundle = await createToolTestBundle(true);
    const cv = await prisma.contentVersion.findUniqueOrThrow({ where: { runId: bundle.run.id } });
    await prisma.report.create({
      data: { runId: bundle.run.id, contentVersionId: cv.id, recommendation: "recommend_publish", reportOutputJson: {}, evidencePackJson: {}, model: "test", promptVersion: "test" }
    });
    await prisma.agentJourney.update({
      where: { id: bundle.journey.id },
      data: { status: "failed", errorMessage: "agent crash" }
    });
    await prisma.runParticipant.update({
      where: { id: bundle.audience.id },
      data: { runtimeStatus: "failed" }
    });

    // Delete simulatedPostState so clean_retry must recreate it via upsert
    await prisma.simulatedPostState.delete({ where: { contentVersionId: cv.id } });

    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const response = await app.inject({
      method: "POST",
      url: `/api/runs/${bundle.run.id}/retry`,
      payload: { participantId: bundle.audience.id, strategy: "clean_retry" }
    });

    // Transaction succeeds - upsert recreates the missing row
    expect(response.statusCode).toBe(200);

    // simulatedPostState recreated with recomputed counts and currentPhase running
    const postState = await prisma.simulatedPostState.findUniqueOrThrow({ where: { contentVersionId: cv.id } });
    expect(postState.exposureCount).toBe(0);
    expect(postState.commentCount).toBe(0);
    expect(postState.currentPhase).toBe("running");

    // Report deleted, journey cleaned, participant reset
    expect(await prisma.report.count({ where: { runId: bundle.run.id } })).toBe(0);
    expect(await prisma.agentJourney.count({ where: { participantId: bundle.audience.id } })).toBe(0);
    const participant = await prisma.runParticipant.findUniqueOrThrow({ where: { id: bundle.audience.id } });
    expect(participant.runtimeStatus).toBe("ready");

    await app.close();
  });

  it("converts local upload image urls before sending audience turn messages to the model", async () => {
    const uploadDir = resolveWorkspacePath("apps/api/uploads");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(resolve(uploadDir, "test.png"), Buffer.from([1, 2, 3]));
    const bundle = await createToolTestBundle(false);
    await prisma.agentTurn.update({ where: { id: bundle.action.id }, data: { status: "created" } });

    let capturedImageUrl: string | null = null;
    const provider: AgentProvider = {
      async generateAudienceSamplingPlan() {
        throw new Error("not used");
      },
      async generateAudienceSamplingPlanRevision() {
        throw new Error("not used");
      },
      async generateAudienceSeatRevision() {
        throw new Error("not used");
      },
      async expandAudienceProfiles(_input) {
        throw new Error("not used");
      },
      async generateAudiencePersona() {
        throw new Error("not used");
      },
      async runAudienceTurn(context) {
        const content = context.messages[0]?.content;
        if (Array.isArray(content)) {
          const image = content.find((part) => part.type === "image");
          capturedImageUrl = typeof image?.image === "string" ? image.image : null;
        }
        return {
          thoughtText: "我不想继续看，退出。",
          toolCalls: [{ toolName: "exit_browsing", args: { reasonCategory: "not_interested", readingDepth: "feed_only", interestLevel: "low", trustLevel: "low" } }],
          rawOutput: { provider: "test" },
          model: "test-model",
          promptVersion: PROMPT_VERSION_AGENT
        };
      }
    };
    const scheduler = new Scheduler(
      { ...loadConfig(), appEnv: "test", enableScheduler: false },
      () => testLlmConfig,
      () => provider,
      new AiTaskRunner(() => testLlmConfig),
      uploadDir
    );

    await scheduler.drain(bundle.run.id);

    expect(capturedImageUrl).toBe("data:image/png;base64,AQID");
  });

  it("converts local upload image urls before sending report images to the model", async () => {
    const uploadDir = resolveWorkspacePath("apps/api/uploads");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(resolve(uploadDir, "test.png"), Buffer.from([4, 5, 6]));
    const bundle = await createToolTestBundle(true);

    let capturedImageUrls: string[] | undefined;
    await generateReportAndCompleteRun(
      bundle.run.id,
      "real-report-model",
      true,
      "test-key",
      "http://example.invalid/v1",
      {
        uploadDir,
        reportGenerator: async (input) => {
          capturedImageUrls = input.imageUrls;
          const reportOutput = buildFallbackReportOutput(
            input.evidencePack,
            input.recommendationCandidate,
            input.mainBlocker,
            false
          );
          // Override headline to verify the mock return is persisted as-is.
          reportOutput.verdict.headline = "模型生成的解释性摘要";
          return {
            reportOutput,
            recommendation: reportOutput.verdict.recommendation,
            model: "real-report-model",
            promptVersion: "report_decision_dashboard_v1"
          };
        }
      }
    );

    expect(capturedImageUrls).toEqual(["data:image/png;base64,BAUG"]);
    const report = await prisma.report.findUniqueOrThrow({ where: { runId: bundle.run.id } });
    const reportOutput = report.reportOutputJson as Record<string, unknown>;
    const verdict = reportOutput.verdict as Record<string, unknown>;
    expect(verdict.headline).toBe("模型生成的解释性摘要");
    expect(report.model).toBe("real-report-model");
    expect(report.promptVersion).toBe("report_decision_dashboard_v1");
  });

  it("does not fall back to a mock report when real report generation fails", async () => {
    const bundle = await createToolTestBundle(true);
    const failingGenerator = async () => { throw new Error("模拟 LLM 连接失败"); };

    await expect(
      generateReportAndCompleteRun(
        bundle.run.id,
        "real-report-model",
        true,
        "test-key",
        "http://127.0.0.1:1/v1",
        { reportGenerator: failingGenerator }
      )
    ).rejects.toThrow("真实报告生成失败");

    const run = await prisma.testRun.findUniqueOrThrow({ where: { id: bundle.run.id } });
    expect(run.status).toBe("paused");
    expect(run.errorMessage).toBeTruthy();
    expect(await prisma.report.count({ where: { runId: bundle.run.id } })).toBe(0);
    const pausedEvent = await prisma.liveEvent.findFirst({ where: { runId: bundle.run.id, eventType: "run.paused" } });
    expect(pausedEvent?.payload).toMatchObject({
      reason: "system_error",
      error: { code: "REPORT_GENERATION_FAILED" }
    });
  }, 10000);

  it("returns frontend comment like state and supports idempotent unlike", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "评论点赞测试",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这是一段超过二十个字的正文，用来测试前端用户评论点赞和取消点赞。",
        scale: "quick"
      }
    });
    expect(create.statusCode).toBe(200);
    const runId = create.json().data.runId as string;
    const commentResponse = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/comments`,
      payload: { content: "这条评论用于测试点赞状态" }
    });
    expect(commentResponse.statusCode).toBe(200);
    const commentId = commentResponse.json().data.comment.id as string;

    const liked = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/comments/${commentId}/like`,
      payload: { active: true }
    });
    expect(liked.statusCode).toBe(200);
    expect(liked.json().data.comment).toMatchObject({ id: commentId, likeCount: 1, likedByMe: true });
    const likeUpdateEvent = await prisma.liveEvent.findFirstOrThrow({
      where: { runId, eventType: "comment.updated" },
      orderBy: { sequence: "desc" }
    });
    const likeUpdatePayload = likeUpdateEvent.payload as Record<string, unknown>;
    expect(likeUpdatePayload.commentId).toBe(commentId);
    expect(likeUpdatePayload.comment).toBeUndefined();
    expect(likeUpdatePayload.patch).toMatchObject({ likeCount: 1, replyCount: 0 });

    const listAfterLike = await app.inject({ method: "GET", url: `/api/runs/${runId}/comments` });
    expect(listAfterLike.statusCode).toBe(200);
    expect(listAfterLike.json().data.comments[0]).toMatchObject({ id: commentId, likeCount: 1, likedByMe: true });

    const unliked = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/comments/${commentId}/like`,
      payload: { active: false }
    });
    expect(unliked.statusCode).toBe(200);
    expect(unliked.json().data.comment).toMatchObject({ id: commentId, likeCount: 0, likedByMe: false });

    const repeatedUnlike = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/comments/${commentId}/like`,
      payload: { active: false }
    });
    expect(repeatedUnlike.statusCode).toBe(200);
    expect(repeatedUnlike.json().data.comment).toMatchObject({ id: commentId, likeCount: 0, likedByMe: false });
    const content = await prisma.contentVersion.findUniqueOrThrow({ where: { runId } });
    expect(await prisma.socialReaction.count({ where: { contentVersionId: content.id, targetType: "comment", targetId: commentId, reactionType: "like" } })).toBe(1);

    await app.close();
  });

  it("starts after a frontend post interaction has already created post state", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "启动前互动测试",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这是一段超过二十个字的正文，用来测试启动前用户互动不会阻塞试映启动。",
        scale: "quick"
      }
    });
    expect(create.statusCode).toBe(200);
    const runId = create.json().data.runId as string;
    const liked = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/post/like`,
      payload: { active: true }
    });
    expect(liked.statusCode).toBe(200);

    await prepareAudienceReady(app, runId);
    const startResponse = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/start`,
      payload: { force: false }
    });
    expect(startResponse.statusCode).toBe(200);
    const content = await prisma.contentVersion.findUniqueOrThrow({ where: { runId } });
    const postState = await prisma.simulatedPostState.findUniqueOrThrow({ where: { contentVersionId: content.id } });
    expect(postState.likeCount).toBe(1);
    expect(postState.currentPhase).toBe("running");

    await app.close();
  });

  it("enforces unique image URLs within one content version", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "图片引用唯一约束测试",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这是一段超过二十个字的正文，用来验证同一内容版本不能重复引用同一个图片 URL。",
        scale: "quick"
      }
    });
    expect(create.statusCode).toBe(200);
    const runId = create.json().data.runId as string;
    const content = await prisma.contentVersion.findUniqueOrThrow({ where: { runId } });
    const image = await prisma.contentVersionImage.findFirstOrThrow({ where: { contentVersionId: content.id } });

    await expect(prisma.contentVersionImage.create({
      data: {
        contentVersionId: content.id,
        assetId: image.assetId,
        url: image.url,
        sortOrder: image.sortOrder + 1
      }
    })).rejects.toMatchObject({ code: "P2002" });

    await app.close();
  });

  it("tracks frontend post reaction state and makes share idempotent", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "帖子互动状态测试",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这是一段超过二十个字的正文，用来测试前端用户点赞收藏分享状态。",
        scale: "quick"
      }
    });
    expect(create.statusCode).toBe(200);
    const runId = create.json().data.runId as string;

    const liked = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/post/like`,
      payload: { active: true }
    });
    expect(liked.statusCode).toBe(200);
    expect(liked.json().data.postState).toMatchObject({ likeCount: 1, likedByMe: true });

    const unliked = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/post/like`,
      payload: { active: false }
    });
    expect(unliked.statusCode).toBe(200);
    expect(unliked.json().data.postState).toMatchObject({ likeCount: 0, likedByMe: false });

    const favorited = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/post/favorite`,
      payload: { active: true }
    });
    expect(favorited.statusCode).toBe(200);
    expect(favorited.json().data.postState).toMatchObject({ favoriteCount: 1, favoritedByMe: true });

    const unfavorited = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/post/favorite`,
      payload: { active: false }
    });
    expect(unfavorited.statusCode).toBe(200);
    expect(unfavorited.json().data.postState).toMatchObject({ favoriteCount: 0, favoritedByMe: false });

    const shared = await app.inject({ method: "POST", url: `/api/runs/${runId}/post/share` });
    expect(shared.statusCode).toBe(200);
    expect(shared.json().data.postState).toMatchObject({ shareCount: 1, sharedByMe: true });

    const repeatedShare = await app.inject({ method: "POST", url: `/api/runs/${runId}/post/share` });
    expect(repeatedShare.statusCode).toBe(200);
    expect(repeatedShare.json().data.postState).toMatchObject({ shareCount: 1, sharedByMe: true });

    const state = await app.inject({ method: "GET", url: `/api/runs/${runId}/post-state` });
    expect(state.statusCode).toBe(200);
    expect(state.json().data.postState).toMatchObject({
      likeCount: 0,
      likedByMe: false,
      favoriteCount: 0,
      favoritedByMe: false,
      shareCount: 1,
      sharedByMe: true
    });

    await app.close();
  });

  it("returns validation error when uploaded image exceeds the API file limit", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const boundary = "----trycue-upload-limit-test";
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="too-large.png"\r\nContent-Type: image/png\r\n\r\n`);
    const fileBytes = Buffer.alloc(6 * 1024 * 1024, 0x61);
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const payload = Buffer.concat([head, fileBytes, tail]);

    const response = await app.inject({
      method: "POST",
      url: "/api/upload",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": String(payload.length)
      },
      payload
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("rejects unsupported model-list base URL schemes", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const response = await app.inject({
      method: "POST",
      url: "/api/settings/llm/models",
      payload: {
        apiKey: "test-key",
        baseUrl: "file:///etc"
      }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("returns latestLiveEventSequence in run overview", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "事件序列测试",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这是一段超过二十个字的正文，用于验证 overview 返回 latestLiveEventSequence。",
        scale: "quick"
      }
    });
    expect(create.statusCode).toBe(200);
    const runId = create.json().data.runId as string;

    const beforeEvents = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
    expect(beforeEvents.statusCode).toBe(200);
    expect(beforeEvents.json().data.latestLiveEventSequence).toBeNull();

    await prisma.liveEvent.create({
      data: { runId, eventType: "run.started", payload: { type: "run.started", runId, eventId: "0", createdAt: new Date().toISOString() } }
    });
    await prisma.liveEvent.create({
      data: { runId, eventType: "run_log.created", payload: { type: "run_log.created", runId, eventId: "0", createdAt: new Date().toISOString() } }
    });

    const afterEvents = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
    expect(afterEvents.statusCode).toBe(200);
    const latestSeq = afterEvents.json().data.latestLiveEventSequence as string;
    expect(latestSeq).toBeTruthy();
    const allEvents = await prisma.liveEvent.findMany({ where: { runId }, orderBy: { sequence: "desc" }, take: 1 });
    expect(allEvents).toHaveLength(1);
    expect(latestSeq).toBe(allEvents[0]!.sequence.toString());

    await app.close();
  });

  it("returns only events after the given sequence via listLiveEvents", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "SSE after 查询测试",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这是一段超过二十个字的正文，用于验证 SSE ?after= 查询只返回之后的事件。",
        scale: "quick"
      }
    });
    expect(create.statusCode).toBe(200);
    const runId = create.json().data.runId as string;

    const ev1 = await prisma.liveEvent.create({
      data: { runId, eventType: "run.started", payload: { type: "run.started", runId, eventId: "0", createdAt: new Date().toISOString() } }
    });
    const ev2 = await prisma.liveEvent.create({
      data: { runId, eventType: "run_log.created", payload: { type: "run_log.created", runId, eventId: "0", createdAt: new Date().toISOString() } }
    });
    const ev3 = await prisma.liveEvent.create({
      data: { runId, eventType: "run.completed", payload: { type: "run.completed", runId, eventId: "0", createdAt: new Date().toISOString() } }
    });

    const { listLiveEvents } = await import("../liveEvents.js");

    const allEvents = await listLiveEvents(runId);
    expect(allEvents).toHaveLength(3);
    expect(allEvents.map((e) => e.eventType)).toEqual(["run.started", "run_log.created", "run.completed"]);

    const afterFirst = await listLiveEvents(runId, ev1.sequence.toString());
    expect(afterFirst).toHaveLength(2);
    expect(afterFirst[0]!.sequence).toBe(ev2.sequence.toString());
    expect(afterFirst[1]!.sequence).toBe(ev3.sequence.toString());

    const afterSecond = await listLiveEvents(runId, ev2.sequence.toString());
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]!.eventType).toBe("run.completed");

    const afterLast = await listLiveEvents(runId, ev3.sequence.toString());
    expect(afterLast).toHaveLength(0);

    const afterUndefined = await listLiveEvents(runId, undefined);
    expect(afterUndefined).toHaveLength(3);

    await app.close();
  });

  it("guards durable live_events from debug events and malformed plan frames", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "事件分层测试",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这是一段超过二十个字的正文，用于验证 durable live_events 的事件分层边界。",
        scale: "quick"
      }
    });
    expect(create.statusCode).toBe(200);
    const runId = create.json().data.runId as string;

    await expect(recordLiveEvent(prisma, {
      runId,
      eventType: "audience.plan.reasoning.delta",
      payload: { jobId: "job-1", delta: "debug token" } as never
    })).rejects.toThrow("not allowed in durable live_events");

    await expect(recordLiveEvent(prisma, {
      runId,
      eventType: "audience.plan.frame",
      payload: { jobId: "job-1", frame: {}, preview: {} } as never
    })).rejects.toThrow("frameSeq");

    const frameEvent = await recordLiveEvent(prisma, {
      runId,
      eventType: "audience.plan.frame",
      payload: { jobId: "job-1", previewId: "job-1", frameSeq: 0, frame: {}, preview: {} } as never
    });
    expect(frameEvent.eventType).toBe("audience.plan.frame");
    expect(await prisma.liveEvent.count({ where: { runId } })).toBe(1);

    await app.close();
  });

  it("resets runtime facts on a completed run and returns audience_ready", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: true });
    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "重置运行时测试",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这是一段超过二十个字的正文，用于验证重置运行时接口可以清除运行时数据。",
        scale: "quick"
      }
    });
    expect(create.statusCode).toBe(200);
    const runId = create.json().data.runId as string;

    await prepareAudienceReady(app, runId);

    // Snapshot audience_profiles and contentVersion before starting
    const profileCountBeforeStart = await prisma.audienceProfile.count({ where: { runId } });
    expect(profileCountBeforeStart).toBeGreaterThan(0);
    const contentVersion = await prisma.contentVersion.findUniqueOrThrow({ where: { runId } });

    const startResponse = await app.inject({ method: "POST", url: `/api/runs/${runId}/start`, payload: { force: false } });
    expect(startResponse.statusCode).toBe(200);

    await waitFor(async () => {
      const run = await prisma.testRun.findUniqueOrThrow({ where: { id: runId } });
      return run.status === "completed";
    });

    // Confirm runtime data exists
    expect(await prisma.runParticipant.count({ where: { runId } })).toBeGreaterThan(0);
    expect(await prisma.agentTurn.count({ where: { runId } })).toBeGreaterThan(0);
    expect(await prisma.actionLog.count({ where: { runId } })).toBeGreaterThan(0);
    expect(await prisma.liveEvent.count({ where: { runId } })).toBeGreaterThan(0);
    expect(await prisma.report.count({ where: { runId } })).toBe(1);

    // Reset runtime
    const resetResponse = await app.inject({ method: "POST", url: `/api/runs/${runId}/reset-runtime` });
    expect(resetResponse.statusCode).toBe(200);
    const resetBody = resetResponse.json();
    expect(resetBody.success).toBe(true);
    expect(resetBody.data.status).toBe("audience_ready");
    expect(resetBody.data.deleted).toBeDefined();
    expect(resetBody.data.deleted.liveEvents).toBeGreaterThan(0);
    expect(resetBody.data.deleted.runParticipants).toBeGreaterThan(0);
    expect(resetBody.data.deleted.agentJourneys).toBeGreaterThan(0);
    expect(resetBody.data.deleted.actionLogs).toBeGreaterThan(0);

    // Runtime facts are gone
    expect(await prisma.runParticipant.count({ where: { runId } })).toBe(0);
    expect(await prisma.agentTurn.count({ where: { runId } })).toBe(0);
    expect(await prisma.agentToolCall.count({ where: { runId } })).toBe(0);
    expect(await prisma.agentTranscriptItem.count({ where: { runId } })).toBe(0);
    const resetClockEvents = await prisma.liveEvent.findMany({ where: { runId } });
    expect(resetClockEvents).toHaveLength(1);
    expect(resetClockEvents[0]!.eventType).toBe("run.clock.updated");
    expect(resetClockEvents[0]!.payload).toMatchObject({
      type: "run.clock.updated",
      reason: "reset",
      status: "audience_ready",
      clock: { clockElapsedMs: 0, clockAnchorAt: null }
    });
    expect(await prisma.report.count({ where: { runId } })).toBe(0);
    expect(await prisma.runLog.count({ where: { runId } })).toBe(0);
    expect(await prisma.actionLog.count({ where: { runId } })).toBe(0);
    expect(await prisma.agentJourney.count({ where: { runId } })).toBe(0);

    // ContentVersion remains
    expect(await prisma.contentVersion.count({ where: { id: contentVersion.id } })).toBe(1);

    // AudienceProfiles and generated identities remain
    expect(await prisma.audienceProfile.count({ where: { runId } })).toBe(profileCountBeforeStart);

    // TestRun is reset to audience_ready
    const run = await prisma.testRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe("audience_ready");
    expect(run.clockElapsedMs).toBe(0);
    expect(run.clockAnchorAt).toBeNull();
    expect(run.startedAt).toBeNull();
    expect(run.completedAt).toBeNull();
    expect(run.terminalReason).toBeNull();
    expect(run.errorMessage).toBeNull();

    await app.close();
  }, 30000);

  it("resets runtime facts on a paused run created via createToolTestBundle", async () => {
    const bundle = await createToolTestBundle(true);
    const runId = bundle.run.id;
    // Move to paused status
    await prisma.testRun.update({ where: { id: runId }, data: { status: "paused" } });

    // Seed runtime data
    await prisma.liveEvent.create({ data: { runId, eventType: "run.paused", payload: {} } });
    await prisma.runLog.create({ data: { runId, logType: "control", message: "paused", metadataJson: {} } });
    await prisma.simulatedPostState.upsert({
      where: { contentVersionId: bundle.content.id },
      create: { contentVersionId: bundle.content.id, exposureCount: 5 },
      update: { exposureCount: 5 }
    });
    await prisma.report.create({
      data: {
        runId,
        contentVersionId: bundle.content.id,
        recommendation: "test",
        reportOutputJson: {},
        evidencePackJson: {},
        model: "test",
        promptVersion: "v1"
      }
    });

    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const resetResponse = await app.inject({ method: "POST", url: `/api/runs/${runId}/reset-runtime` });
    expect(resetResponse.statusCode).toBe(200);
    const data = resetResponse.json().data;
    expect(data.status).toBe("audience_ready");

    // Runtime facts gone
    const resetClockEvents = await prisma.liveEvent.findMany({ where: { runId } });
    expect(resetClockEvents).toHaveLength(1);
    expect(resetClockEvents[0]!.eventType).toBe("run.clock.updated");
    expect(resetClockEvents[0]!.payload).toMatchObject({
      type: "run.clock.updated",
      reason: "reset",
      status: "audience_ready",
      clock: { clockElapsedMs: 0, clockAnchorAt: null }
    });
    expect(await prisma.runLog.count({ where: { runId } })).toBe(0);
    expect(await prisma.report.count({ where: { runId } })).toBe(0);
    expect(await prisma.simulatedPostState.count({ where: { contentVersionId: bundle.content.id } })).toBe(0);
    expect(await prisma.runParticipant.count({ where: { runId } })).toBe(0);
    expect(await prisma.agentTurn.count({ where: { runId } })).toBe(0);
    expect(await prisma.agentToolCall.count({ where: { runId } })).toBe(0);

    // ContentVersion, audience profiles, and identity rows remain
    expect(await prisma.contentVersion.count({ where: { id: bundle.content.id } })).toBe(1);
    expect(await prisma.user.count({ where: { id: bundle.audience.userId } })).toBe(1);
    expect(await prisma.agent.count({ where: { id: bundle.audience.agentId } })).toBe(1);
    expect(await prisma.platformAccount.count({ where: { id: bundle.audience.platformAccountId } })).toBe(1);

    await app.close();
  });

  it("rejects reset-runtime for running status", async () => {
    const bundle = await createToolTestBundle(true);
    const runId = bundle.run.id;
    // Status is "running" from createToolTestBundle

    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const resetResponse = await app.inject({ method: "POST", url: `/api/runs/${runId}/reset-runtime` });
    expect(resetResponse.statusCode).toBe(409);
    expect(resetResponse.json().error.code).toBe("INVALID_RUN_STATUS");

    // Run unchanged
    const run = await prisma.testRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe("running");

    await app.close();
  });
});

async function prepareAudienceReady(app: FastifyInstance, runId: string) {
  const planJob = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/audience-sampling-plan`,
    payload: { replaceActive: true }
  });
  expect(planJob.statusCode).toBe(200);
  await waitFor(async () => {
    const [activeJob, plan] = await Promise.all([
      prisma.audienceGenerationJob.findFirst({ where: { runId, active: true } }),
      prisma.audienceSamplingPlan.findUnique({ where: { runId } })
    ]);
    return !activeJob && plan?.status === "ready_for_review";
  });

  const confirmed = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/audience-sampling-plan/confirm`,
    payload: {}
  });
  expect(confirmed.statusCode).toBe(200);
  await waitFor(async () => {
    const activeJob = await prisma.audienceGenerationJob.findFirst({ where: { runId, active: true } });
    const [readyCount, totalCount, plan] = await Promise.all([
      prisma.audienceProfile.count({ where: { runId, identityStatus: "identity_ready" } }),
      prisma.audienceProfile.count({ where: { runId } }),
      prisma.audienceSamplingPlan.findUnique({ where: { runId } })
    ]);
    return !activeJob && totalCount > 0 && readyCount === totalCount && plan?.status === "ready";
  });
}

async function waitFor(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for condition.");
}
