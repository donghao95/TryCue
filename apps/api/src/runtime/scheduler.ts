import { prisma, type AgentJourney, type AgentTurnStatus, type Prisma } from "@trycue/db";
import { resolveWorkspacePath, type AppConfig } from "../config.js";
import type { AgentProvider, RunParticipantContext } from "../agents/types.js";
import { modelForAiTask, type AiTaskRunner } from "../agents/taskRunner.js";
import type { LlmRuntimeConfig } from "../llmConfigStore.js";
import { shouldUseRealLlm } from "../llmConfigStore.js";
import type { ActionBundle } from "../tools/toolExecutor.js";
import { PROMPT_VERSION_AGENT } from "../agents/promptVersions.js";
import { log } from "../logger.js";
import { generateReportAndCompleteRun } from "./report.js";
import { recordLiveEvent, pushLiveEvent } from "../liveEvents.js";
import { buildSummaryView } from "../views.js";
import { freezeRunClockData, getRunSimulatedTime, recordRunClockUpdatedEvent } from "./clock.js";
import { admitWaitingAudiences } from "./queue.js";
import { requireSingleContentVersion } from "./contentVersions.js";
import { createRunLogWithEvent } from "./runLogs.js";
import {
  ALL_TOOLS,
  appendInitialObservation,
  buildFeedObservation,
  loadJourneyTranscript,
  renderSessionMessages
} from "./agentSessions.js";

const LOOP_IDLE_DELAY_MS = 50;

export class Scheduler {
  private activeRuns = new Set<string>();
  private activeJourneyRunners = new Map<string, Set<string>>();
  private lastHeartbeatAt = new Map<string, number>();

  constructor(
    private readonly config: AppConfig,
    private readonly getLlmConfig: () => LlmRuntimeConfig,
    private readonly getAgentProvider: () => AgentProvider,
    private readonly aiTaskRunner: AiTaskRunner,
    private readonly uploadDir = resolveWorkspacePath("apps/api/uploads")
  ) {}

  private resolveConcurrency(): number {
    return Math.max(this.config.schedulerDefaultConcurrency, 1);
  }

  start(runId: string) {
    if (this.activeRuns.has(runId)) return;
    this.activeRuns.add(runId);
    log.info({ runId }, "[Scheduler] run loop started");
    void this.runLoop(runId)
      .catch(async (err) => {
        log.error({ err, runId }, "[Scheduler] run loop crashed");
        // Revert run status to prevent orphaned 'running' state with no scheduler
        try {
          const errorMsg = `Scheduler crashed: ${err instanceof Error ? err.message : String(err)}`;
          const events = await prisma.$transaction(async (tx) => {
            const run = await tx.testRun.findUnique({ where: { id: runId } });
            if (!run) return null;
            const frozenClock = freezeRunClockData(run);
            const updated = await tx.testRun.update({
              where: { id: runId },
              data: {
                status: "paused",
                ...frozenClock,
                terminalReason: "scheduler_crash",
                errorMessage: errorMsg,
                configJson: { ...((run.configJson as Record<string, unknown>) ?? {}), controlState: "paused" }
              }
            });
            const clockEvent = await recordRunClockUpdatedEvent(tx, {
              runId,
              reason: "error_frozen",
              status: "paused",
              run: updated
            });
            const logEvent = await createRunLogWithEvent(tx, {
              runId,
              logType: "error",
              message: errorMsg,
              simulatedTime: Math.floor(frozenClock.clockElapsedMs / 1000)
            });
            const pausedEvent = await recordLiveEvent(tx, {
              runId,
              eventType: "run.paused",
              payload: {
                reason: "system_error",
                error: { code: "SCHEDULER_CRASH", message: errorMsg },
                simulatedTime: Math.floor(frozenClock.clockElapsedMs / 1000)
              }
            });
            return { clockEvent, logEvent, pausedEvent };
          });
          if (events) {
            pushLiveEvent(runId, events.clockEvent);
            pushLiveEvent(runId, events.logEvent);
            pushLiveEvent(runId, events.pausedEvent);
          }
        } catch (dbErr) {
          log.error({ err: dbErr, runId }, "[Scheduler] Failed to revert run status after crash");
        }
      })
      .finally(() => {
        this.activeRuns.delete(runId);
        this.activeJourneyRunners.delete(runId);
        log.info({ runId }, "[Scheduler] run loop ended");
      });
  }

  async drain(runId: string) {
    if (!this.activeRuns.has(runId)) this.activeRuns.add(runId);
    try {
      await this.runLoop(runId);
    } finally {
      this.activeRuns.delete(runId);
      this.activeJourneyRunners.delete(runId);
    }
  }

  isActive(runId: string): boolean {
    return this.activeRuns.has(runId);
  }

  async recoverAndResume() {
    const interrupted = await this.failInterruptedJourneyRunners();
    if (interrupted > 0) log.warn({ count: interrupted }, "[Scheduler] recovered interrupted journey runners");
    const runningRuns = await prisma.testRun.findMany({ where: { status: { in: ["running", "pausing"] } } });
    log.info({ count: runningRuns.length, runIds: runningRuns.map((r) => r.id) }, "[Scheduler] recovering active runs");
    for (const run of runningRuns) this.start(run.id);
  }

  private async runLoop(runId: string) {
    while (true) {
      const run = await prisma.testRun.findUnique({ where: { id: runId } });
      if (!run) return;

      const configJson = (run.configJson as Record<string, unknown>) ?? {};
      const controlState = (configJson.controlState as string) ?? "none";

      if (controlState === "pause_requested" || run.status === "pausing") {
        const runningJourneys = await prisma.agentJourney.count({
          where: { runId, status: "active", runnerStatus: "running" }
        });
        if (runningJourneys === 0 && this.activeRunnerCount(runId) === 0) {
          await this.freezePausedRun(runId, configJson);
          return;
        }
        await delay(LOOP_IDLE_DELAY_MS);
        continue;
      }

      if (run.status === "paused") return;
      if (run.status !== "running") return;

      await this.syncAdmission(runId);

      const activeCount = this.activeRunnerCount(runId);
      const claimLimit = Math.max(
        0,
        this.resolveConcurrency() - activeCount
      );
      if (claimLimit > 0) {
        const journeys = await this.claimRunnableJourneys(runId, claimLimit);
        for (const journey of journeys) this.startAgentRunner(runId, journey.id);
      }

      const [activeJourneys, readyParticipants] = await Promise.all([
        prisma.agentJourney.count({ where: { runId, status: "active" } }),
        prisma.runParticipant.count({ where: { runId, runtimeStatus: "ready" } })
      ]);
      if (activeJourneys === 0 && readyParticipants === 0 && this.activeRunnerCount(runId) === 0) {
        // Freeze clock immediately so simulation time stops ticking
        const frozenClock = freezeRunClockData(run);

        // Bug 2: detect run-level failure (all journeys failed)
        const [failedJourneys, totalJourneys] = await Promise.all([
          prisma.agentJourney.count({ where: { runId, status: "failed" } }),
          prisma.agentJourney.count({ where: { runId } })
        ]);
        const terminalReason = (failedJourneys > 0 && failedJourneys === totalJourneys)
          ? "all_journeys_failed"
          : (run.terminalReason ?? "all_journeys_finished");

        // Bug 1: use updateMany with status guard to avoid race with retryRun
        const clockEvent = await prisma.$transaction(async (tx) => {
          const { count } = await tx.testRun.updateMany({
            where: { id: runId, status: "running" },
            data: { status: "report_generating", ...frozenClock, terminalReason }
          });
          if (count === 0) return null; // status already changed (e.g. retried), skip report generation
          const updated = await tx.testRun.findUniqueOrThrow({ where: { id: runId } });
          return recordRunClockUpdatedEvent(tx, {
            runId,
            reason: "report_started",
            status: "report_generating",
            run: updated
          });
        });
        if (!clockEvent) return;
        pushLiveEvent(runId, clockEvent);

        const llmConfig = this.getLlmConfig();
        await generateReportAndCompleteRun(
          runId,
          llmConfig.models.pro,
          shouldUseRealLlm(llmConfig),
          llmConfig.apiKey,
          llmConfig.baseUrl,
          { aiTaskRunner: this.aiTaskRunner, uploadDir: this.uploadDir, preFrozenClock: frozenClock }
        );
        return;
      }

      await delay(LOOP_IDLE_DELAY_MS);
    }
  }

  private activeRunnerCount(runId: string) {
    return this.activeJourneyRunners.get(runId)?.size ?? 0;
  }

  private startAgentRunner(runId: string, journeyId: string) {
    let set = this.activeJourneyRunners.get(runId);
    if (!set) {
      set = new Set<string>();
      this.activeJourneyRunners.set(runId, set);
    }
    if (set.has(journeyId)) return;
    set.add(journeyId);
    void this.runAgentJourney(journeyId)
      .catch(async (error) => {
        try {
          await this.handleAgentJourneyFailure(journeyId, error);
        } catch (handlerError) {
          log.error({ journeyId, err: handlerError }, "[Scheduler] failed to handle agent journey failure");
        }
      })
      .finally(() => {
        set?.delete(journeyId);
        this.lastHeartbeatAt.delete(journeyId);
      });
  }

  private async freezePausedRun(runId: string, configJson: Record<string, unknown>) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run || (run.status !== "running" && run.status !== "pausing")) return;
    const frozenClock = freezeRunClockData(run);
    const event = await prisma.$transaction(async (tx) => {
      const { count } = await tx.testRun.updateMany({
        where: { id: runId, status: { in: ["running", "pausing"] } },
        data: {
          status: "paused",
          ...frozenClock,
          configJson: { ...configJson, controlState: "paused" }
        }
      });
      if (count === 0) return null;
      const logEvent = await createRunLogWithEvent(tx, {
        runId,
        logType: "control",
        message: "试映已暂停",
        simulatedTime: Math.floor(frozenClock.clockElapsedMs / 1000)
      });
      const clockEvent = await recordRunClockUpdatedEvent(tx, {
        runId,
        reason: "paused",
        status: "paused",
        run: { clockElapsedMs: frozenClock.clockElapsedMs, clockAnchorAt: null, clockScale: run.clockScale }
      });
      const pausedEvent = await recordLiveEvent(tx, {
        runId,
        eventType: "run.paused",
        payload: { simulatedTime: Math.floor(frozenClock.clockElapsedMs / 1000) }
      });
      return { logEvent, clockEvent, pausedEvent };
    });
    if (event) {
      pushLiveEvent(runId, event.logEvent);
      pushLiveEvent(runId, event.clockEvent);
      pushLiveEvent(runId, event.pausedEvent);
    }
  }

  private async syncAdmission(runId: string) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run || run.status !== "running") return;
    const configJson = (run.configJson as Record<string, unknown>) ?? {};
    const controlState = (configJson.controlState as string) ?? "none";
    if (controlState === "pause_requested" || controlState === "paused") return;

    const activeJourneys = await prisma.agentJourney.count({ where: { runId, status: "active" } });
    const deficit = Math.max(0, Math.min(this.resolveConcurrency(), run.audienceCount) - activeJourneys);
    if (deficit <= 0) return;
    const contentVersion = await requireSingleContentVersion(prisma, runId);
    await prisma.$transaction(async (tx) => {
      await admitWaitingAudiences(tx, { runId, contentVersionId: contentVersion.id, limit: deficit });
    });
  }

  private async claimRunnableJourneys(runId: string, limit: number) {
    const now = new Date();
    // SQLite 3.35+ supports UPDATE...RETURNING — use atomic claim to avoid TOCTOU race
    const rows = await prisma.$queryRaw<Array<{
      id: string;
      run_id: string;
      run_participant_id: string;
    }>>`
      UPDATE agent_journeys
      SET runner_status = 'running',
          locked_by = ${this.config.schedulerWorkerId},
          locked_at = ${now},
          heartbeat_at = ${now},
          started_at = COALESCE(started_at, ${now}),
          updated_at = ${now}
      WHERE id IN (
        SELECT id FROM agent_journeys
        WHERE run_id = ${runId}
          AND status = 'active'
          AND runner_status IN ('queued', 'idle')
        ORDER BY queue_seq ASC, created_at ASC
        LIMIT ${limit}
      )
      AND status = 'active'
      AND runner_status IN ('queued', 'idle')
      RETURNING id, run_id, run_participant_id
    `;
    if (rows.length) {
      await prisma.runParticipant.updateMany({
        where: { id: { in: rows.map((row) => row.run_participant_id) } },
        data: { runtimeStatus: "thinking" }
      });
    }
    return rows.map((row) => ({ id: row.id, runId: row.run_id, participantId: row.run_participant_id }));
  }

  private async runAgentJourney(journeyId: string) {
    const runnerStartedAt = Date.now();
    while (true) {
      await this.heartbeatJourney(journeyId);
      const journey = await prisma.agentJourney.findUnique({ where: { id: journeyId } });
      if (!journey) return;
      if (journey.status !== "active") {
        await this.releaseJourneyRunner(journeyId);
        return;
      }
      this.assertJourneyWithinDeadline(journeyId, runnerStartedAt);
      if (journey.currentStepIndex >= this.config.maxJourneyActionsPerJourney) {
        await this.finishJourneyAtMaxSteps(journey.id);
        await this.releaseJourneyRunner(journey.id);
        return;
      }

      const bundle = await this.createOrLoadRunningTurn(journey.id);
      if (!bundle) {
        await this.releaseJourneyRunner(journey.id);
        return;
      }

      if (!bundle.action.rawAgentOutputJson) {
        const context = await this.recordOrLoadTurnContext(bundle);
        await prisma.agentTurn.update({
          where: { id: bundle.action.id },
          data: { status: "model_calling" }
        });
        const remainingJourneyMs = this.remainingJourneyTimeoutMs(journeyId, runnerStartedAt);
        const modelTimeoutMs = Math.min(this.config.modelCallTimeoutSeconds * 1000, remainingJourneyMs);
        const stepTimeoutMs = Math.min(this.config.modelStepTimeoutSeconds * 1000, remainingJourneyMs);
        const hasOpenedPost = await this.journeyHasOpenedPost(bundle.journey);
        const result = await this.getAgentProvider().runAudienceTurn({
          runId: bundle.action.runId,
          participantId: bundle.action.participantId,
          actionId: bundle.action.id,
          stepIndex: bundle.action.stepIndex,
          journeyId: bundle.journey.id,
          hasOpenedPost,
          displayName: bundle.audience.displayNameSnapshot,
          persona: bundle.audience.agentSnapshotJson as never,
          messages: context.messages,
          availableTools: context.available_tools_now,
          maxSteps: this.config.maxJourneyActionsPerJourney,
          timeoutMs: modelTimeoutMs,
          stepTimeoutMs,
          uploadDir: this.uploadDir
        });
        if (!result.managedRuntime) {
          throw new Error("Agent provider must use the managed AI SDK runtime.");
        }
        await this.emitRunSummary(bundle.action.id);
        await this.releaseJourneyRunner(journey.id);
        return;
      } else {
        throw new Error("Agent turn has partial model output from a previous runtime and cannot be resumed.");
      }
    }
  }

  private async heartbeatJourney(journeyId: string) {
    const now = Date.now();
    const last = this.lastHeartbeatAt.get(journeyId) ?? 0;
    if (now - last < this.config.runnerHeartbeatIntervalSeconds * 1000) return;
    this.lastHeartbeatAt.set(journeyId, now);
    await prisma.agentJourney.updateMany({
      where: { id: journeyId, runnerStatus: "running" },
      data: { heartbeatAt: new Date(now) }
    });
  }

  private assertJourneyWithinDeadline(journeyId: string, startedAtMs: number) {
    this.remainingJourneyTimeoutMs(journeyId, startedAtMs);
  }

  private remainingJourneyTimeoutMs(journeyId: string, startedAtMs: number) {
    const timeoutMs = this.config.agentJourneyTimeoutSeconds * 1000;
    if (timeoutMs <= 0) return Number.POSITIVE_INFINITY;
    const elapsedMs = Date.now() - startedAtMs;
    const remainingMs = timeoutMs - elapsedMs;
    if (remainingMs > 0) return remainingMs;
    throw new Error(`Agent journey ${journeyId} timed out after ${this.config.agentJourneyTimeoutSeconds}s.`);
  }

  /** Derive phase from open_post tool call history (event-driven, not a stored field). */
  private async journeyHasOpenedPost(journey: { id: string; contentVersionId: string; actorUserId: string; platformAccountId: string }): Promise<boolean> {
    const event = await prisma.socialInteractionEvent.findFirst({
      where: {
        contentVersionId: journey.contentVersionId,
        actorUserId: journey.actorUserId,
        platformAccountId: journey.platformAccountId,
        interactionType: "open_post",
        targetType: "post",
        targetId: journey.contentVersionId
      },
      select: { id: true }
    });
    return !!event;
  }

  private async createOrLoadRunningTurn(journeyId: string): Promise<ActionBundle | null> {
    return prisma.$transaction(async (tx) => {
      const journey = await tx.agentJourney.findUnique({ where: { id: journeyId } });
      if (!journey || journey.status !== "active") return null;
      const [audience, contentVersion] = await Promise.all([
        tx.runParticipant.findUniqueOrThrow({ where: { id: journey.participantId } }),
        tx.contentVersion.findUniqueOrThrow({ where: { id: journey.contentVersionId } })
      ]);

      // Ensure initial observation exists for this journey
      const transcriptCount = await tx.agentTranscriptItem.count({ where: { journeyId: journey.id } });
      if (transcriptCount === 0) {
        const postState = await tx.simulatedPostState.findUniqueOrThrow({ where: { contentVersionId: journey.contentVersionId } });
        // New journey has no open_post tool call yet → feed phase observation.
        const observation = buildFeedObservation(contentVersion, postState);
        await appendInitialObservation(tx, journey.id, journey.runId, observation as Prisma.InputJsonValue);
      }

      const existing = await tx.agentTurn.findUnique({
        where: {
          journeyId_stepIndex: {
            journeyId: journey.id,
            stepIndex: journey.currentStepIndex
          }
        }
      });
      const action = existing
        ? await tx.agentTurn.update({
          where: { id: existing.id },
          data: {
            status: existing.status === "completed" ? "completed" : "created",
            lockedBy: null,
            lockedAt: null,
            startedAt: existing.startedAt ?? new Date()
          }
        })
        : await tx.agentTurn.create({
          data: {
            runId: journey.runId,
            participantId: journey.participantId,
            actorUserId: journey.actorUserId,
            platformAccountId: journey.platformAccountId,
            journeyId: journey.id,
            contentVersionId: journey.contentVersionId,
            stepIndex: journey.currentStepIndex,
            queueSeq: BigInt(journey.currentStepIndex),
            status: "created",
            startedAt: new Date()
          }
        });
      return { action, journey, audience, contentVersion };
    });
  }

  private async recordOrLoadTurnContext(bundle: ActionBundle): Promise<RecordedAgentContext> {
    const existing = await prisma.agentTurnContext.findUnique({
      where: { agentTurnId: bundle.action.id }
    });
    if (existing) return coerceRecordedAgentContext(existing.inputContextJson);

    const context = await buildAgentContext(bundle, this.uploadDir, this.config.maxJourneyActionsPerJourney);
    await prisma.agentTurnContext.create({
      data: {
        agentTurnId: bundle.action.id,
        screenBeforeJson: context.current_screen_snapshot,
        postStateBeforeJson: context.simulated_post_state,
        commentsPageJson: context.comments_page,
        thoughtSummary: bundle.journey.thoughtSummary,
        availableToolsJson: context.available_tools_now,
        inputContextJson: context as unknown as Prisma.InputJsonValue,
        model: shouldUseRealLlm(this.getLlmConfig()) ? modelForAiTask(this.getLlmConfig(), "agent_turn") : "mock-audience-agent",
        promptVersion: PROMPT_VERSION_AGENT
      }
    });
    await prisma.agentTurn.update({
      where: { id: bundle.action.id },
      data: { status: "context_recorded" }
    });
    return context;
  }

  private async finishJourneyAtMaxSteps(journeyId: string) {
    await prisma.$transaction(async (tx) => {
      const journey = await tx.agentJourney.findUniqueOrThrow({ where: { id: journeyId } });
      if (journey.status !== "active") return;
      await this.finishJourneyAtMaxStepsTx(tx, journey, journey.currentStepIndex);
    });
  }

  private async finishJourneyAtMaxStepsTx(tx: Prisma.TransactionClient, journey: AgentJourney, nextStep: number) {
    await tx.agentJourney.update({
      where: { id: journey.id },
      data: {
        status: "finished",
        runnerStatus: "idle",
        lockedAt: null,
        lockedBy: null,
        heartbeatAt: null,
        finalSummary: "达到最大试映步数后结束浏览。",
        exitOutcome: "max_steps",
        exitReason: "达到最大试映步数后结束浏览。",
        completedAt: new Date(),
        currentStepIndex: nextStep
      }
    });
    await tx.runParticipant.update({
      where: { id: journey.participantId },
      data: { runtimeStatus: "finished" }
    });
    // Emit live event so frontend seat list updates (matching toolExecutor.ts behavior)
    const lastTurn = await tx.agentTurn.findFirst({
      where: { journeyId: journey.id },
      orderBy: { stepIndex: "desc" }
    });
    if (lastTurn) {
      const simulatedTime = await getRunSimulatedTime(tx, journey.runId);
      const run = await tx.testRun.findUniqueOrThrow({ where: { id: journey.runId }, select: { audienceRevision: true } });
      const event = await recordLiveEvent(tx, {
        runId: journey.runId,
        eventType: "audience.status_updated",
        payload: {
          contentVersionId: lastTurn.contentVersionId,
          audienceRevision: run.audienceRevision,
          simulatedTime,
          participantId: journey.participantId,
          status: "finished",
          exitOutcome: "max_steps",
          exitReason: "达到最大试映步数后结束浏览。"
        }
      });
      pushLiveEvent(journey.runId, event);
    }
  }

  private async releaseJourneyRunner(journeyId: string) {
    await prisma.agentJourney.updateMany({
      where: { id: journeyId },
      data: {
        runnerStatus: "idle",
        lockedBy: null,
        lockedAt: null,
        heartbeatAt: null
      }
    });
  }

  private async handleAgentJourneyFailure(journeyId: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.agentTurn.findFirst({
      where: { journeyId, status: { in: ["created", "context_recorded", "model_calling", "model_returned", "tools_executing"] as AgentTurnStatus[] } },
      orderBy: { stepIndex: "desc" },
      select: { id: true }
    });

    const event = await prisma.$transaction(async (tx) => {
      const journey = await tx.agentJourney.findUnique({ where: { id: journeyId } });
      if (!journey) return null;
      if (journey.status !== "active") {
        await tx.agentJourney.update({
          where: { id: journey.id },
          data: {
            runnerStatus: "idle",
            lockedAt: null,
            lockedBy: null,
            heartbeatAt: null
          }
        });
        return null;
      }
      const action = await tx.agentTurn.findFirst({
        where: { journeyId, status: { in: ["created", "context_recorded", "model_calling", "model_returned", "tools_executing"] as AgentTurnStatus[] } },
        orderBy: { stepIndex: "desc" }
      });
      if (action) {
        await tx.agentTurn.update({
          where: { id: action.id },
          data: { status: "failed", errorMessage: message, lockedAt: null, lockedBy: null }
        });
      }
      await tx.agentJourney.update({
        where: { id: journey.id },
        data: {
          status: "failed",
          runnerStatus: "idle",
          lockedAt: null,
          lockedBy: null,
          heartbeatAt: null,
          errorMessage: message,
          completedAt: new Date()
        }
      });
      await tx.runParticipant.update({
        where: { id: journey.participantId },
        data: { runtimeStatus: "failed" }
      });
      const simulatedTime = await getRunSimulatedTime(tx, journey.runId);
      const run = await tx.testRun.findUniqueOrThrow({ where: { id: journey.runId }, select: { audienceRevision: true } });
      const logEvent = await createRunLogWithEvent(tx, {
        runId: journey.runId,
        logType: "exception",
        message,
        participantId: journey.participantId,
        actorUserId: journey.actorUserId,
        platformAccountId: journey.platformAccountId,
        simulatedTime
      });
      const statusEvent = await recordLiveEvent(tx, {
        runId: journey.runId,
        eventType: "audience.status_updated",
        payload: {
          contentVersionId: journey.contentVersionId,
          audienceRevision: run.audienceRevision,
          simulatedTime,
          participantId: journey.participantId,
          status: "failed",
          errorMessage: message
        }
      });
      return { logEvent, statusEvent };
    });
    if (event) {
      pushLiveEvent(event.logEvent.payload.runId, event.logEvent);
      pushLiveEvent(event.statusEvent.payload.runId, event.statusEvent);
    }
  }

  private async failInterruptedJourneyRunners(): Promise<number> {
    const nonTerminalStatuses: AgentTurnStatus[] = ["created", "context_recorded", "model_calling", "model_returned", "tools_executing"];
    const interruptedJourneys = await prisma.agentJourney.findMany({
      where: {
        status: "active",
        OR: [
          { runnerStatus: "running" },
          { turns: { some: { status: { in: nonTerminalStatuses } } } }
        ]
      },
      select: { id: true }
    });
    for (const journey of interruptedJourneys) {
      log.warn({ journeyId: journey.id }, "[Scheduler] failing interrupted journey runner");
      await this.handleAgentJourneyFailure(journey.id, new Error("Runner interrupted before restart."));
    }
    return interruptedJourneys.length;
  }

  private async emitRunSummary(actionId: string) {
    try {
      const action = await prisma.agentTurn.findUnique({ where: { id: actionId } });
      if (!action) return;
      const [run, postState, journeys, comments] = await Promise.all([
        prisma.testRun.findUniqueOrThrow({ where: { id: action.runId } }),
        prisma.simulatedPostState.findUnique({ where: { contentVersionId: action.contentVersionId } }),
        prisma.agentJourney.findMany({ where: { runId: action.runId } }),
        prisma.simulatedComment.findMany({ where: { contentVersionId: action.contentVersionId }, orderBy: { simulatedTime: "asc" } })
      ]);
      const summary = await buildSummaryView({ run, postState, journeys, comments });
      const event = await recordLiveEvent(prisma, {
        runId: action.runId,
        eventType: "summary.updated",
        payload: {
          contentVersionId: action.contentVersionId,
          simulatedTime: await getRunSimulatedTime(prisma, action.runId),
          summary
        }
      });
      pushLiveEvent(action.runId, event);
    } catch (err) {
      log.warn({ err }, "[Scheduler] emitRunSummary failed (non-critical)");
    }
  }
}

type RecordedAgentContext = {
  persona: unknown;
  displayName: string;
  current_screen_snapshot: Record<string, unknown>;
  simulated_post_state: Record<string, unknown>;
  comments_page: Record<string, unknown>;
  available_tools_now: RunParticipantContext["availableTools"];
  messages: RunParticipantContext["messages"];
  last_action_summary: string;
  run_constraints: Record<string, unknown>;
};

async function buildAgentContext(bundle: ActionBundle, uploadDir: string, maxJourneyActions: number) {
  const items = await loadJourneyTranscript(prisma, bundle.journey.id);
  const hasOpenedPost = Boolean(await prisma.socialInteractionEvent.findFirst({
    where: {
      contentVersionId: bundle.journey.contentVersionId,
      actorUserId: bundle.journey.actorUserId,
      platformAccountId: bundle.journey.platformAccountId,
      interactionType: "open_post",
      targetType: "post",
      targetId: bundle.journey.contentVersionId
    },
    select: { id: true }
  }));
  return {
    persona: bundle.audience.agentSnapshotJson,
    displayName: bundle.audience.displayNameSnapshot,
    current_screen_snapshot: {
      journeyId: bundle.journey.id,
      hasOpenedPost,
      transcriptItemCount: items.length
    },
    simulated_post_state: {},
    comments_page: {},
    available_tools_now: ALL_TOOLS,
    messages: await renderSessionMessages(items, { uploadDir }),
    last_action_summary: "",
    run_constraints: {
      max_steps_per_journey: maxJourneyActions,
      can_use_multiple_tools: true,
      can_have_thought_only_turn: true,
      tool_use_must_reflect_real_user_behavior: true
    }
  };
}

function coerceRecordedAgentContext(value: unknown): RecordedAgentContext {
  const record = objectRecord(value);
  return {
    persona: record.persona ?? {},
    displayName: stringValue(record.displayName) ?? "",
    current_screen_snapshot: objectRecord(record.current_screen_snapshot),
    simulated_post_state: objectRecord(record.simulated_post_state),
    comments_page: objectRecord(record.comments_page),
    available_tools_now: Array.isArray(record.available_tools_now) ? record.available_tools_now as RecordedAgentContext["available_tools_now"] : [],
    messages: Array.isArray(record.messages) ? record.messages as RunParticipantContext["messages"] : [],
    last_action_summary: stringValue(record.last_action_summary) ?? "",
    run_constraints: objectRecord(record.run_constraints) as RecordedAgentContext["run_constraints"]
  };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

