import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@trycue/db";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { AgentProvider } from "../agents/types.js";
import { AiTaskRunner } from "../agents/taskRunner.js";
import { appendInitialObservation, buildPostObservation } from "../runtime/agentSessions.js";
import { Scheduler } from "../runtime/scheduler.js";
import type { StepResult, ToolSet } from "ai";
import { persistStep } from "../tools/toolExecutor.js";
import { PROMPT_VERSION_AGENT } from "../agents/promptVersions.js";
import { DEFAULT_CAPACITY_SETTINGS } from "../llm/capacityPresets.js";
import {
  cleanupIntegrationTest,
  createToolTestBundle,
  integrationLlmConfigPath
} from "./helpers.js";

const testLlmConfig = {
  provider: "openai-compatible" as const,
  runtimeMode: "mock" as const,
  models: {},
  capacity: DEFAULT_CAPACITY_SETTINGS
};

describe("agent failure and retry integration", () => {
  const llmConfigPath = integrationLlmConfigPath;

  beforeEach(cleanupIntegrationTest);

  afterAll(async () => {
    await prisma.$disconnect();
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
});
