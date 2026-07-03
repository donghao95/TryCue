import { resolveWorkspacePath } from "../config.js";
import { prisma, type Prisma } from "@trycue/db";
import { log } from "../logger.js";
import { PROMPT_VERSION_REPORT } from "../agents/promptVersions.js";
import { recordLiveEvent, pushLiveEvent } from "../liveEvents.js";
import { generateReportWithLLM } from "../agents/reportAgent.js";
import type { AiTaskRunner } from "../agents/taskRunner.js";
import { freezeRunClockData, recordRunClockUpdatedEvent } from "./clock.js";
import { ApiError } from "../errors.js";
import { requireSingleContentVersion } from "./contentVersions.js";
import { prepareModelImageUrls } from "./modelImages.js";
import { createRunLogWithEvent } from "./runLogs.js";
import {
  buildEvidencePack,
  recommendFromEvidence,
  selectMainBlocker,
  type EvidencePackInput
} from "./evidencePack.js";
import { ReportOutputSchema } from "@trycue/shared/report";
import type {
  EvidencePack,
  EvidenceBlocker,
  Recommendation,
  ReportOutput
} from "@trycue/shared/report";
import {
  buildFallbackVerdict,
  buildFallbackFunnel,
  buildFallbackMainBlocker,
  buildFallbackSegments,
  buildFallbackDiagnostics,
  buildFallbackKeepAndChange,
  buildFallbackRevisionPlan,
  buildFallbackRetestPlan,
  buildFallbackKeyFindings,
  buildFallbackRewriteSuggestions,
  buildFallbackSummaryMarkdown,
  collectTopLevelRefs
} from "./reportBuilders.js";

type ReportGenerator = typeof generateReportWithLLM;

export async function generateReportAndCompleteRun(
  runId: string,
  model = "mock-report-generator",
  useReal = false,
  apiKey?: string,
  baseUrl?: string,
  options?: { allowPaused?: boolean; aiTaskRunner?: AiTaskRunner; uploadDir?: string; reportGenerator?: ReportGenerator; preFrozenClock?: { clockElapsedMs: number; clockAnchorAt: null }; regenerate?: boolean }
) {
  const originalRun = await prisma.testRun.findUniqueOrThrow({ where: { id: runId } });
  const regenerate = options?.regenerate === true;
  // regenerate allows re-running report generation on an already-completed run.
  // It bypasses the normal status gate but still requires the run to be in a terminal
  // state (completed or paused) so we never regenerate mid-flight.
  const canGenerate = regenerate
    ? originalRun.status === "completed" || (options?.allowPaused === true && originalRun.status === "paused")
    : originalRun.status === "running" ||
      originalRun.status === "report_generating" ||
      (options?.allowPaused === true && originalRun.status === "paused");
  if (!canGenerate) return;
  const wasEndedEarly = originalRun.status === "paused" && options?.allowPaused === true;
  const terminalReason = originalRun.terminalReason ?? (wasEndedEarly ? "user_ended" : "all_journeys_finished");
  // When regenerate is true on a completed run, skip the status transition —
  // the run is already terminal and we don't want to flip it back to report_generating.
  if (!regenerate && originalRun.status !== "report_generating") {
    const clockEvent = await prisma.$transaction(async (tx) => {
      const run = await tx.testRun.findUniqueOrThrow({ where: { id: runId } });
      const frozenClock = options?.preFrozenClock ?? freezeRunClockData(run);
      const updated = await tx.testRun.update({
        where: { id: runId },
        data: { status: "report_generating", ...frozenClock, terminalReason }
      });
      return recordRunClockUpdatedEvent(tx, {
        runId,
        reason: "report_started",
        status: "report_generating",
        run: updated
      });
    });
    pushLiveEvent(runId, clockEvent);
  }
  const run = await prisma.testRun.findUniqueOrThrow({ where: { id: runId } });
  const content = await requireSingleContentVersion(prisma, runId);
  const postState = await prisma.simulatedPostState.findUniqueOrThrow({
    where: { contentVersionId: content.id }
  });
  const journeys = await prisma.agentJourney.findMany({ where: { runId } });
  const comments = await prisma.simulatedComment.findMany({ where: { contentVersionId: content.id }, orderBy: { simulatedTime: "asc" } });
  const logs = await prisma.actionLog.findMany({
    where: { runId, contentVersionId: content.id },
    orderBy: { simulatedTime: "asc" },
    take: 1000,
    select: { id: true, logText: true, action: true, thoughtText: true, participantId: true, journeyActionId: true, toolCallId: true, simulatedTime: true }
  });
  const turns = await prisma.agentTurn.findMany({
    where: { runId, contentVersionId: content.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, thoughtText: true }
  });
  const toolCalls = await prisma.agentToolCall.findMany({
    where: { runId, contentVersionId: content.id },
    orderBy: [{ simulatedTime: "asc" }, { callIndex: "asc" }],
    take: 1000,
    select: {
      id: true,
      agentTurnId: true,
      journeyId: true,
      participantId: true,
      callIndex: true,
      toolName: true,
      status: true,
      input: true,
      output: true,
      simulatedTime: true
    }
  });
  const participants = await prisma.runParticipant.findMany({
    where: { runId },
    select: { id: true, displayNameSnapshot: true, profileSnapshotJson: true, samplingDirectiveId: true }
  });
  const directives = await prisma.audienceSamplingDirective.findMany({
    where: { plan: { runId } },
    select: { id: true, name: true, description: true, groupRole: true, samplingReason: true }
  });

  const completedCount = journeys.filter((j) => j.status === "finished").length;
  const failedCount = journeys.filter((j) => j.status === "failed").length;
  const skippedCount = journeys.filter((j) => j.exitOutcome === "skipped").length;

  const evidencePackInput: EvidencePackInput = {
    runId,
    contentVersionId: content.id,
    content: {
      title: content.title,
      bodyText: content.bodyText,
      imageUrlsJson: content.imageUrlsJson,
      coverImageUrl: content.coverImageUrl
    },
    postState: {
      exposureCount: postState.exposureCount,
      openCount: postState.openCount,
      likeCount: postState.likeCount,
      favoriteCount: postState.favoriteCount,
      commentCount: postState.commentCount,
      shareCount: postState.shareCount,
      exitCount: postState.exitCount
    },
    journeys: journeys.map((j) => ({
      id: j.id,
      status: j.status,
      exitOutcome: j.exitOutcome,
      exitReason: j.exitReason,
      participantId: j.participantId,
      thoughtSummary: j.thoughtSummary,
      finalSummary: j.finalSummary
    })),
    participants: participants.map((p) => ({
      id: p.id,
      displayNameSnapshot: p.displayNameSnapshot,
      profileSnapshotJson: p.profileSnapshotJson,
      samplingDirectiveId: p.samplingDirectiveId
    })),
    directives: directives.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      groupRole: d.groupRole,
      samplingReason: d.samplingReason
    })),
    comments: comments.map((c) => ({
      id: c.id,
      commentText: c.commentText,
      participantId: c.participantId,
      simulatedTime: c.simulatedTime
    })),
    logs,
    toolCalls,
    turns,
    audienceCount: run.audienceCount,
    completedCount,
    failedCount,
    skippedCount,
    wasEndedEarly
  };

  const evidencePack = buildEvidencePack(evidencePackInput);
  const recommendationCandidate = recommendFromEvidence(evidencePack);
  const mainBlocker = selectMainBlocker(evidencePack.blockers);

  let reportData: {
    recommendation: Recommendation;
    reportOutput: ReportOutput;
    evidencePack: EvidencePack;
    promptVersion: string;
  };

  if (useReal && apiKey) {
    try {
      const imageUrls = await prepareModelImageUrls(
        contentImageUrls(content.imageUrlsJson, content.coverImageUrl),
        options?.uploadDir ?? resolveWorkspacePath("apps/api/uploads")
      );
      const reportGenerator = options?.reportGenerator ?? generateReportWithLLM;
      const reportTask = (selectedModel: string) => reportGenerator({
        runId,
        model: selectedModel,
        apiKey,
        baseUrl,
        imageUrls,
        contentHeader: {
          title: content.title,
          bodyPreview: evidencePack.content.bodyPreview,
          imageCount: evidencePack.content.imageCount
        },
        evidencePack,
        recommendationCandidate,
        mainBlocker
      });
      const llmResult = options?.aiTaskRunner
        ? await options.aiTaskRunner.run({
          type: "report",
          runId,
          contentVersionId: content.id,
          call: ({ model }) => reportTask(model)
        })
        : await reportTask(model);
      reportData = {
        recommendation: llmResult.recommendation,
        reportOutput: llmResult.reportOutput,
        evidencePack,
        promptVersion: llmResult.promptVersion
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // On regenerate failure, do NOT mutate the run status — the run is already
      // terminal (completed/paused) and the old report must remain intact.
      if (!regenerate) {
        await pauseRunForReportFailure(runId, message);
      }
      throw new ApiError("REPORT_GENERATION_FAILED", `真实报告生成失败：${message}`, 502);
    }
  } else {
    const reportOutput = buildFallbackReportOutput(evidencePack, recommendationCandidate, mainBlocker, wasEndedEarly);
    // Validate the fallback output against the shared schema — guarantees the mock path
    // produces the same shape as the real LLM path and catches regressions in the builder.
    const validation = ReportOutputSchema.safeParse(reportOutput);
    if (!validation.success) {
      throw new Error(`Mock 报告 schema 校验失败: ${validation.error.issues.map((i) => `${i.path.join(".")}:${i.message}`).join("; ")}`);
    }
    reportData = {
      recommendation: validation.data.verdict.recommendation,
      reportOutput: validation.data,
      evidencePack,
      promptVersion: PROMPT_VERSION_REPORT
    };
  }

  // Wrap the transaction so DB-level failures (e.g. SQLite write lock contention)
  // also trigger pauseRunForReportFailure on the non-regenerate path — otherwise
  // the run would be stuck in report_generating forever.
  const result = await prisma.$transaction(async (tx) => {
    const frozenClock = options?.preFrozenClock ?? freezeRunClockData(await tx.testRun.findUniqueOrThrow({ where: { id: runId } }));
    const completedSimulatedTime = Math.floor(frozenClock.clockElapsedMs / 1000);
    // CAS (non-regenerate only): claim the report_generating → completed
    // transition BEFORE any other writes. A concurrent loser that enters the
    // transaction after the winner commits would otherwise overwrite report
    // facts (upsert) before hitting the CAS guard. Placing the CAS first
    // ensures count === 0 returns immediately, skipping report.upsert,
    // simulatedPostState.update, and event writes. Mirrors the CAS pattern in
    // pauseRunForReportFailure and scheduler's running → report_generating.
    if (!regenerate) {
      const { count } = await tx.testRun.updateMany({
        where: { id: runId, status: "report_generating" },
        data: {
          status: "completed",
          completedAt: new Date(),
          ...frozenClock,
          terminalReason
        }
      });
      if (count === 0) {
        return { clockEvent: null, completedEvent: null };
      }
    }
    const report = await tx.report.upsert({
      where: { runId },
      update: {
        recommendation: reportData.recommendation,
        contentVersionId: content.id,
        reportOutputJson: reportData.reportOutput as Prisma.InputJsonValue,
        evidencePackJson: reportData.evidencePack as Prisma.InputJsonValue,
        model,
        promptVersion: reportData.promptVersion
      },
      create: {
        runId,
        contentVersionId: content.id,
        recommendation: reportData.recommendation,
        reportOutputJson: reportData.reportOutput as Prisma.InputJsonValue,
        evidencePackJson: reportData.evidencePack as Prisma.InputJsonValue,
        model,
        promptVersion: reportData.promptVersion
      }
    });
    if (regenerate) {
      // Regeneration path: run is already terminal. Only persist the new report and
      // a report.regenerated event so the frontend can update its view. Do not touch
      // run status, clock, or emit run.completed again.
      const regeneratedEvent = await recordLiveEvent(tx, {
        runId,
        eventType: "report.regenerated",
        payload: {
          contentVersionId: content.id,
          reportId: report.id,
          model,
          promptVersion: reportData.promptVersion
        }
      });
      return { regeneratedEvent };
    }
    await tx.simulatedPostState.update({
      where: { contentVersionId: content.id },
      data: { currentPhase: "completed" }
    });
    const updatedRun = await tx.testRun.findUniqueOrThrow({ where: { id: runId } });
    const clockEvent = await recordRunClockUpdatedEvent(tx, {
      runId,
      reason: "completed",
      status: "completed",
      run: updatedRun
    });
    const completedEvent = await recordLiveEvent(tx, {
      runId,
      eventType: "run.completed",
      payload: {
        contentVersionId: content.id,
        simulatedTime: completedSimulatedTime,
        reportId: report.id
      }
    });
    return { clockEvent, completedEvent };
  }).catch(async (txError) => {
    if (!regenerate) {
      const msg = txError instanceof Error ? txError.message : String(txError);
      await pauseRunForReportFailure(runId, msg).catch((err) => {
        log.error({ err, runId }, "[Report] failed to pause run after transaction error");
      });
    }
    throw txError;
  });
  if (result) {
    if ("regeneratedEvent" in result && result.regeneratedEvent) {
      pushLiveEvent(runId, result.regeneratedEvent);
    } else if ("clockEvent" in result && result.clockEvent) {
      pushLiveEvent(runId, result.clockEvent);
      if (result.completedEvent) pushLiveEvent(runId, result.completedEvent);
    }
  }
}

// Process-level guard to prevent reentrant recovery calls (e.g. if the server
// start hook fires twice). V1 is single-process, so this is sufficient.
let recoveringReports = false;

export async function recoverReportGenerationRuns(
  model = "mock-report-generator",
  useReal = false,
  apiKey?: string,
  baseUrl?: string,
  options?: { aiTaskRunner?: AiTaskRunner; uploadDir?: string }
) {
  if (recoveringReports) return;
  recoveringReports = true;
  try {
    const staleRuns = await prisma.testRun.findMany({
      where: {
        status: "report_generating",
        reports: { none: {} }
      },
      orderBy: { updatedAt: "asc" },
      select: { id: true }
    });
    if (staleRuns.length > 0) {
      log.info({ count: staleRuns.length, runIds: staleRuns.map((r) => r.id) }, "[Report] recovering stale report_generating runs");
    }
    for (const run of staleRuns) {
      void generateReportAndCompleteRun(run.id, model, useReal, apiKey, baseUrl, {
        aiTaskRunner: options?.aiTaskRunner,
        uploadDir: options?.uploadDir
      }).catch((err) => {
        log.error({ err, runId: run.id }, "[Report] failed to recover report generation");
      });
    }
  } finally {
    recoveringReports = false;
  }
}

async function pauseRunForReportFailure(runId: string, message: string) {
  const event = await prisma.$transaction(async (tx) => {
    const run = await tx.testRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.status !== "running" && run.status !== "report_generating") return null;
    const configJson = (run.configJson as Record<string, unknown>) ?? {};
    const frozenClock = freezeRunClockData(run);
    // CAS: only the first caller to match an active status may transition to "paused"
    const { count } = await tx.testRun.updateMany({
      where: { id: runId, status: run.status },
      data: {
        status: "paused",
        errorMessage: message,
        ...frozenClock,
        configJson: { ...configJson, controlState: "paused" }
      }
    });
    if (count === 0) return null;
    const logEvent = await createRunLogWithEvent(tx, {
      runId,
      logType: "exception",
      message: `真实报告生成失败：${message}`,
      simulatedTime: Math.floor(frozenClock.clockElapsedMs / 1000)
    });
    const clockEvent = await recordRunClockUpdatedEvent(tx, {
      runId,
      reason: "error_frozen",
      status: "paused",
      run: { clockElapsedMs: frozenClock.clockElapsedMs, clockAnchorAt: null, clockScale: run.clockScale }
    });
    const pausedEvent = await recordLiveEvent(tx, {
      runId,
      eventType: "run.paused",
      payload: {
        reason: "system_error",
        error: { code: "REPORT_GENERATION_FAILED", message },
        simulatedTime: Math.floor(frozenClock.clockElapsedMs / 1000)
      }
    });
    return { logEvent, clockEvent, pausedEvent };
  });
  if (event) {
    pushLiveEvent(runId, event.logEvent);
    pushLiveEvent(runId, event.clockEvent);
    pushLiveEvent(runId, event.pausedEvent);
  }
}

function contentImageUrls(imageUrlsJson: unknown, coverImageUrl: string | null) {
  const stored = Array.isArray(imageUrlsJson) ? imageUrlsJson : [];
  const urls = [...stored, coverImageUrl]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(urls)];
}

// ── Mock / fallback ReportOutput builder ──
// Generates a complete, structurally-valid ReportOutput deterministically from the
// EvidencePack. Used in mock mode and as a safety net. The output is intentionally
// plain but must contain every field the frontend needs to render without crashing.
// All sub-builders live in reportBuilders.ts so the real-LLM path (reportAgent.ts)
// can reuse them as fallbacks when the LLM output is invalid.

export function buildFallbackReportOutput(
  pack: EvidencePack,
  recommendation: Recommendation,
  mainBlocker: EvidenceBlocker | null,
  wasEndedEarly: boolean
): ReportOutput {
  const verdict = buildFallbackVerdict(pack, recommendation, mainBlocker, wasEndedEarly);
  const funnel = buildFallbackFunnel(pack);
  const mainBlockerCard = buildFallbackMainBlocker(pack, mainBlocker);
  const segments = buildFallbackSegments(pack);
  const diagnostics = buildFallbackDiagnostics(pack);
  const keepAndChange = buildFallbackKeepAndChange(pack);
  const revisionPlan = buildFallbackRevisionPlan(pack, mainBlocker);
  const retestPlan = buildFallbackRetestPlan(pack, mainBlocker);
  const keyFindings = buildFallbackKeyFindings(pack, recommendation, mainBlocker);
  const rewriteSuggestions = buildFallbackRewriteSuggestions(pack, recommendation, mainBlocker);
  // Stage 4: keyFindings 必须在 collectTopLevelRefs 之前构建，并传入汇总，保证 mock/real 路径 evidenceRefs 一致。
  const evidenceRefs = collectTopLevelRefs({ verdict, mainBlocker: mainBlockerCard, segments, diagnostics, keepAndChange, revisionPlan, keyFindings });
  return {
    verdict,
    funnel,
    mainBlocker: mainBlockerCard,
    audienceGroupAnalysis: pack.audienceGroups,
    segments,
    diagnostics,
    keepAndChange,
    revisionPlan,
    retestPlan,
    evidenceRefs,
    keyFindings,
    rewriteSuggestions,
    summaryMarkdown: buildFallbackSummaryMarkdown(pack, recommendation, mainBlocker)
  };
}

