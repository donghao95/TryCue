import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@trycue/db";
import { buildApp } from "../app.js";
import { loadConfig, resolveWorkspacePath } from "../config.js";
import {
  cleanupIntegrationTest,
  countFeedOnlyExitBrowsingCalls,
  createSmallAudienceReadyRun,
  createToolTestBundle,
  describeRunProgress,
  integrationLlmConfigPath,
  prepareAudienceReady,
  waitFor
} from "./helpers.js";

describe("run lifecycle integration", () => {
  const llmConfigPath = integrationLlmConfigPath;

  beforeEach(cleanupIntegrationTest);

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
    }, { timeoutMs: 60_000, describe: () => describeRunProgress(runId) });

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
    expect(await prisma.agentJourney.count({ where: { runId, exitOutcome: "skipped" } })).toBeGreaterThan(0);
    expect(await countFeedOnlyExitBrowsingCalls(runId)).toBeGreaterThan(0);
    await app.close();
  }, 90_000);

  it("smoke completes a small deterministic mock run with open and feed-only exit", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: true, schedulerDefaultConcurrency: 1 });
    const runId = await createSmallAudienceReadyRun(4);

    const startResponse = await app.inject({ method: "POST", url: `/api/runs/${runId}/start`, payload: { force: false } });
    expect(startResponse.statusCode).toBe(200);

    await waitFor(async () => {
      const run = await prisma.testRun.findUniqueOrThrow({ where: { id: runId } });
      return run.status === "completed";
    }, { timeoutMs: 60_000, describe: () => describeRunProgress(runId) });

    expect(await prisma.runParticipant.count({ where: { runId } })).toBe(4);
    const journeys = await prisma.agentJourney.findMany({ where: { runId } });
    const openPostCounts = await Promise.all(
      journeys.map((j) => prisma.socialInteractionEvent.count({
        where: { journeyId: j.id, interactionType: "open_post" }
      }))
    );
    expect(openPostCounts.some((count) => count > 0)).toBe(true);
    expect(openPostCounts.some((count) => count === 0)).toBe(true);
    expect(await prisma.agentJourney.count({ where: { runId, exitOutcome: "skipped" } })).toBeGreaterThan(0);
    expect(await countFeedOnlyExitBrowsingCalls(runId)).toBeGreaterThan(0);

    await app.close();
  }, 90_000);

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
    }, { timeoutMs: 60_000, describe: () => describeRunProgress(runId) });

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
  }, 90_000);

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
