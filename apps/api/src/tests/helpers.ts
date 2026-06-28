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
