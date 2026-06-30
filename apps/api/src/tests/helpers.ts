import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { expect } from "vitest";
import { prisma } from "@trycue/db";
import { appendInitialObservation, buildFeedObservation, buildPostObservation } from "../runtime/agentSessions.js";
import { PROMPT_VERSION_AGENT } from "../agents/promptVersions.js";

export async function resetDatabase() {
  assertIntegrationTestDatabase();

  await prisma.report.deleteMany();
  await prisma.insight.deleteMany();
  await prisma.llmCallTrace.deleteMany();
  await prisma.runLlmUsageSummary.deleteMany();
  await prisma.runLog.deleteMany();
  await prisma.actionLog.deleteMany();
  await prisma.simulatedComment.deleteMany();
  await prisma.loadedCommentPage.deleteMany();
  await prisma.socialInteractionEvent.deleteMany();
  await prisma.socialReaction.deleteMany();
  await prisma.simulatedPostState.deleteMany();
  await prisma.liveEvent.deleteMany();
  await prisma.agentToolCall.deleteMany();
  await prisma.agentTurnContext.deleteMany();
  await prisma.agentTurn.deleteMany();
  await prisma.agentJourney.deleteMany();
  await prisma.runParticipant.deleteMany();
  await prisma.platformAccount.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.user.deleteMany();
  await prisma.audienceProfile.deleteMany();
  await prisma.audienceSamplingDirective.deleteMany();
  await prisma.audienceSamplingPlan.deleteMany();
  await prisma.audienceGenerationJob.deleteMany();
  await prisma.contentVersionImage.deleteMany();
  await prisma.contentVersion.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.testRun.deleteMany();
}

function assertIntegrationTestDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests.");
  if (!databaseUrl.includes("test")) {
    throw new Error(`Refusing to reset non-test database "${databaseUrl}". Use a URL containing "test".`);
  }
}

export async function createToolTestBundle(hasOpenedPost: boolean = true) {
  const startedAt = new Date();
  const run = await prisma.testRun.create({
    data: { status: "running", audienceCount: 1, startedAt, clockAnchorAt: startedAt, clockScale: 10, configJson: {} }
  });
  const content = await prisma.contentVersion.create({
    data: {
      runId: run.id,
      title: "测试标题",
      coverImageUrl: "/uploads/test.png",
      bodyText: "这是一段足够长的测试正文，用于工具状态机集成测试。",
      scale: "quick"
    }
  });
  const user = await prisma.user.create({
    data: { userType: "agent", nickname: "测试用户" }
  });
  const personaJson = {
    profile: "测试用户，28岁，一线城市，测试背景。",
    personality: "测试性格特征，关注真实信息。",
    mbtiType: "ISFJ",
    responseStyle: "测试表达风格。"
  };
  const agent = await prisma.agent.create({
    data: {
      userId: user.id,
      personaJson
    }
  });
  const platformAccount = await prisma.platformAccount.create({
    data: { userId: user.id, platform: "xiaohongshu" }
  });
  const audience = await prisma.runParticipant.create({
    data: {
      runId: run.id,
      userId: user.id,
      agentId: agent.id,
      platformAccountId: platformAccount.id,
      displayNameSnapshot: "测试用户",
      avatarUrlSnapshot: null,
      profileSnapshotJson: {
        samplingLabel: "测试用户"
      },
      platformAccountSnapshotJson: {
        platform: "xiaohongshu",
        platformAccountId: platformAccount.id
      },
      runtimeStatus: "queued",
      agentSnapshotJson: personaJson
    }
  });
  const journey = await prisma.agentJourney.create({
    data: {
      runId: run.id,
      participantId: audience.id,
      actorUserId: audience.userId,
      platformAccountId: audience.platformAccountId,
      contentVersionId: content.id,
      promptVersion: PROMPT_VERSION_AGENT
    }
  });
  if (hasOpenedPost) {
    await prisma.socialInteractionEvent.create({
      data: {
        contentVersionId: content.id,
        actorUserId: audience.userId,
        platformAccountId: audience.platformAccountId,
        participantId: audience.id,
        source: "agent_tool",
        journeyId: journey.id,
        interactionType: "open_post",
        targetType: "post",
        targetId: content.id,
        simulatedTime: 0
      }
    });
  }
  const postState = await prisma.simulatedPostState.create({
    data: { contentVersionId: content.id, exposureCount: 1 }
  });
  await prisma.$transaction(async (tx) => {
    const observationJson = hasOpenedPost
      ? buildPostObservation(content, postState, { liked: false, favorited: false })
      : buildFeedObservation(content, postState);
    await appendInitialObservation(tx, journey.id, run.id, observationJson);
  });
  const action = await prisma.agentTurn.create({
    data: {
      runId: run.id,
      participantId: audience.id,
      actorUserId: audience.userId,
      platformAccountId: audience.platformAccountId,
      journeyId: journey.id,
      contentVersionId: content.id,
      stepIndex: 0,
      queueSeq: 1,
      status: "created"
    }
  });
  return { run, content, contentVersion: content, audience, journey, action };
}

export const integrationLlmConfigPath = resolve("config/llm.integration-test.yaml");

export async function cleanupIntegrationTest() {
  await resetDatabase();
  await rm(integrationLlmConfigPath, { force: true });
}

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
export { prepareAudienceReady };

async function createSmallAudienceReadyRun(audienceCount: number) {
  const run = await prisma.testRun.create({
    data: {
      status: "audience_ready",
      audienceCount,
      configJson: { scale: "custom", audienceCount },
      contentVersionCount: 1
    }
  });
  const content = await prisma.contentVersion.create({
    data: {
      runId: run.id,
      title: "小规模 smoke 试映",
      coverImageUrl: "/uploads/test.png",
      imageUrlsJson: ["/uploads/test.png"],
      bodyText: "这是一段用于 smoke 集成测试的正文，覆盖启动、打开帖子和信息流直接退出。",
      scale: "custom"
    }
  });
  const plan = await prisma.audienceSamplingPlan.create({
    data: {
      runId: run.id,
      totalCount: audienceCount,
      status: "ready",
      confirmedAt: new Date(),
      planMarkdown: "小规模 smoke 采样计划",
      dimensionsJson: ["smoke"],
      directives: {
        create: [{
          name: "smoke users",
          description: "用于 smoke 的确定性观众",
          quantity: audienceCount,
          diversityAxesJson: ["smoke"],
          rationale: "覆盖打开和跳过",
          expansionStatus: "ready",
          sortOrder: 0
        }]
      }
    },
    include: { directives: true }
  });
  const directive = plan.directives[0]!;
  for (let index = 0; index < audienceCount; index += 1) {
    const user = await prisma.user.create({ data: { userType: "agent", nickname: `Smoke 用户 ${index + 1}` } });
    const personaJson = {
      profile: `Smoke 用户 ${index + 1}，用于小规模集成测试。`,
      personality: "谨慎务实",
      mbtiType: "ISFJ",
      responseStyle: "自然浏览并根据兴趣决定是否打开帖子。"
    };
    const agent = await prisma.agent.create({ data: { userId: user.id, personaJson } });
    const platformAccount = await prisma.platformAccount.create({ data: { userId: user.id, platform: "xiaohongshu" } });
    await prisma.audienceProfile.create({
      data: {
        runId: run.id,
        samplingPlanId: plan.id,
        samplingDirectiveId: directive.id,
        sampleIndex: index,
        sortOrder: index,
        samplingLabel: `Smoke ${index + 1}`,
        demographicsJson: {
          gender: "不限定",
          ageRange: "不限定",
          cityTier: "不限定",
          lifeStage: "不限定",
          role: "smoke",
          spendingPower: "不限定"
        },
        identityStatus: "identity_ready",
        identityGeneratedAt: new Date(),
        generatedUserId: user.id,
        generatedAgentId: agent.id,
        generatedPlatformAccountId: platformAccount.id
      }
    });
  }
  await prisma.simulatedPostState.create({ data: { contentVersionId: content.id } });
  return run.id;
}
export { createSmallAudienceReadyRun };

async function waitFor(predicate: () => Promise<boolean>, options: { timeoutMs?: number; describe?: () => Promise<string> } = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 25_000);
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const detail = options.describe ? ` ${await options.describe()}` : "";
  throw new Error(`Timed out waiting for condition.${detail}`);
}
export { waitFor };

async function describeRunProgress(runId: string) {
  const [run, participants, journeys, turns, reportCount] = await Promise.all([
    prisma.testRun.findUnique({ where: { id: runId } }),
    prisma.runParticipant.groupBy({ by: ["runtimeStatus"], where: { runId }, _count: true }),
    prisma.agentJourney.groupBy({ by: ["status", "runnerStatus"], where: { runId }, _count: true }),
    prisma.agentTurn.groupBy({ by: ["status"], where: { runId }, _count: true }),
    prisma.report.count({ where: { runId } })
  ]);
  return JSON.stringify({
    runStatus: run?.status,
    terminalReason: run?.terminalReason,
    errorMessage: run?.errorMessage,
    participants,
    journeys,
    turns,
    reportCount
  });
}
export { describeRunProgress };

/**
 * 统计 run 内 readingDepth=feed_only 的 exit_browsing tool call 数量。
 *
 * 不使用 Prisma JSON path filter (`input: { path: "$.readingDepth", equals: "feed_only" }`),
 * 因为 SQLite 下 Prisma 对 JSON path 的支持依赖 json_extract(),行为与 PostgreSQL 不一致,
 * 对类型 coercion 和 nested path 有已知问题。改为先查 tool calls 再在 JS 里过滤,跨库一致。
 */
async function countFeedOnlyExitBrowsingCalls(runId: string) {
  const exitBrowsingCalls = await prisma.agentToolCall.findMany({
    where: { runId, toolName: "exit_browsing" },
    select: { input: true }
  });
  return exitBrowsingCalls.filter(
    (call) => (call.input as { readingDepth?: string } | null)?.readingDepth === "feed_only"
  ).length;
}
export { countFeedOnlyExitBrowsingCalls };
