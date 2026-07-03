import type { AgentTurn, AgentJourney, RunParticipant, SimulatedPostState, JourneyExitOutcome, Prisma } from "@trycue/db";
import type { ToolName } from "@trycue/shared/tool";
import type { LiveEventEnvelope } from "@trycue/shared/live-events";
import { recordLiveEvent } from "../liveEvents.js";
import { logView, postStateView, deriveSeatStatus } from "../views.js";

export async function commitToolLog(
  tx: Prisma.TransactionClient,
  action: AgentTurn,
  audience: RunParticipant,
  toolCallId: string,
  toolName: ToolName,
  logText: string,
  simulatedTime: number,
  toolInput: Record<string, unknown> = {},
  toolOutput: Record<string, unknown> = {}
) {
  const log = await tx.actionLog.create({
    data: {
      runId: action.runId,
      contentVersionId: action.contentVersionId,
      participantId: action.participantId,
      actorUserId: action.actorUserId,
      platformAccountId: action.platformAccountId,
      journeyId: action.journeyId,
      journeyActionId: action.id,
      toolCallId,
      simulatedTime,
      logText,
      action: toolName,
      topicTagsJson: [],
      riskTagsJson: inferRiskTags(logText),
      eventKind: "tool_call",
      eventPayloadJson: { toolName, input: toolInput, output: toolOutput } as Prisma.InputJsonValue
    }
  });

  return recordLiveEvent(tx, {
    runId: action.runId,
    eventType: "action_log.created",
    payload: {
      contentVersionId: action.contentVersionId,
      simulatedTime,
      log: logView(log, audience)
    }
  });
}

export async function commitAudienceEvents(
  tx: Prisma.TransactionClient,
  action: AgentTurn,
  journey: AgentJourney,
  audience: RunParticipant,
  toolName: ToolName,
  simulatedTime: number,
  postState?: SimulatedPostState
): Promise<Array<{ sequence: string; eventType: string; payload: LiveEventEnvelope }>> {
  const events: Array<{ sequence: string; eventType: string; payload: LiveEventEnvelope }> = [];

  if (postState) {
    events.push(await recordLiveEvent(tx, {
      runId: action.runId,
      eventType: "post_state.updated",
      payload: {
        contentVersionId: action.contentVersionId,
        simulatedTime,
        postState: postStateView(postState)
      }
    }));
  }

  const run = await tx.testRun.findUniqueOrThrow({ where: { id: action.runId }, select: { audienceRevision: true } });
  const interactionTypes = (
    await tx.socialInteractionEvent.findMany({
      where: { contentVersionId: action.contentVersionId, participantId: action.participantId },
      select: { interactionType: true },
      orderBy: [{ simulatedTime: "asc" }, { createdAt: "asc" }]
    })
  ).map((i: { interactionType: string }) => i.interactionType);

  const audienceLogs = await tx.actionLog.findMany({
    where: {
      runId: action.runId,
      contentVersionId: action.contentVersionId,
      participantId: action.participantId
    },
    select: { riskTagsJson: true }
  });
  const hasDoubt = audienceLogs.some((log) => hasDoubtRisk(log.riskTagsJson));

  const status = deriveSeatStatus(journey, interactionTypes, hasDoubt);
  const animationMap: Record<string, "heart" | "star" | "comment" | "risk" | "skip" | "none"> = {
    open_post: "none",
    read_post: "none",
    like_post: "heart",
    favorite_post: "star",
    share_post: "none",
    write_comment: "comment",
    like_comment: "heart",
    exit_browsing: animationHintForExit(journey.exitOutcome)
  };

  events.push(
    await recordLiveEvent(tx, {
      runId: action.runId,
      eventType: "audience.status_updated",
      payload: {
        contentVersionId: action.contentVersionId,
        audienceRevision: run.audienceRevision,
        simulatedTime,
        participantId: action.participantId,
        status,
        currentAction: toolName,
        exitOutcome: journey.exitOutcome,
        exitReason: journey.exitReason
      }
    })
  );

  if (toolName === "view_comments") return events;

  events.push(
    await recordLiveEvent(tx, {
      runId: action.runId,
      eventType: "audience.action_happened",
      payload: {
        contentVersionId: action.contentVersionId,
        audienceRevision: run.audienceRevision,
        simulatedTime,
        participantId: action.participantId,
        action: toolName,
        animationHint: animationMap[toolName] ?? "none",
        exitOutcome: journey.exitOutcome,
        exitReason: journey.exitReason,
        text: audienceActionText(participantDisplayName(audience), toolName, journey.exitOutcome ?? undefined)
      }
    })
  );

  return events;
}

export function inferRiskTags(text: string): string[] {
  const tags: string[] = [];
  if (text.includes("广告")) tags.push("ad_concern");
  if (text.includes("具体") || text.includes("来源") || text.includes("依据")) tags.push("trust_evidence");
  return tags;
}

export function participantDisplayName(audience: RunParticipant): string {
  return audience.displayNameSnapshot;
}

function hasDoubtRisk(tags: unknown) {
  return Array.isArray(tags) && tags.some((tag) => tag === "ad_concern" || tag === "trust_evidence");
}

function animationHintForExit(outcome?: JourneyExitOutcome | null): "risk" | "skip" | "none" {
  if (outcome === "skipped") return "skip";
  if (outcome === "risk_exit") return "risk";
  return "none";
}

function audienceActionText(name: string, toolName: ToolName, exitOutcome?: JourneyExitOutcome) {
  if (toolName === "open_post") return `${name} 点开了内容`;
  if (toolName === "read_post") return `${name} 阅读了正文`;
  if (toolName === "like_post") return `${name} 点赞了这篇内容`;
  if (toolName === "favorite_post") return `${name} 收藏了这篇内容`;
  if (toolName === "share_post") return `${name} 分享了这篇内容`;
  if (toolName === "write_comment") return `${name} 发表了评论`;
  if (toolName === "like_comment") return `${name} 点赞了一条评论`;
  if (toolName === "exit_browsing" && exitOutcome === "skipped") return `${name} 跳过了内容`;
  if (toolName === "exit_browsing" && exitOutcome === "risk_exit") return `${name} 离开了内容`;
  if (toolName === "exit_browsing") return `${name} 结束了浏览`;
  return `${name} 更新了状态`;
}
