import type { Prisma } from "@trycue/db";

export type LifecycleGroup = "content_setup" | "audience_preparation" | "runtime_facts" | "reusable_identity_asset";

export const runDataLifecyclePolicies: Record<string, {
  group: LifecycleGroup;
  owner: "run" | "content_version" | "audience_profile" | "identity" | "asset";
  resetRuntime: "preserve" | "delete";
  deleteRun: "cascade" | "delete" | "reference_check";
}> = {
  TestRun: { group: "content_setup", owner: "run", resetRuntime: "preserve", deleteRun: "delete" },
  ContentVersion: { group: "content_setup", owner: "run", resetRuntime: "preserve", deleteRun: "cascade" },
  ContentVersionImage: { group: "content_setup", owner: "content_version", resetRuntime: "preserve", deleteRun: "cascade" },
  Asset: { group: "reusable_identity_asset", owner: "asset", resetRuntime: "preserve", deleteRun: "reference_check" },
  User: { group: "reusable_identity_asset", owner: "identity", resetRuntime: "preserve", deleteRun: "reference_check" },
  Agent: { group: "reusable_identity_asset", owner: "identity", resetRuntime: "preserve", deleteRun: "reference_check" },
  PlatformAccount: { group: "reusable_identity_asset", owner: "identity", resetRuntime: "preserve", deleteRun: "reference_check" },
  AudienceSamplingPlan: { group: "audience_preparation", owner: "run", resetRuntime: "preserve", deleteRun: "cascade" },
  AudienceSamplingDirective: { group: "audience_preparation", owner: "run", resetRuntime: "preserve", deleteRun: "cascade" },
  AudienceProfile: { group: "audience_preparation", owner: "run", resetRuntime: "preserve", deleteRun: "cascade" },
  AudienceGenerationJob: { group: "audience_preparation", owner: "run", resetRuntime: "preserve", deleteRun: "cascade" },
  RunParticipant: { group: "runtime_facts", owner: "run", resetRuntime: "delete", deleteRun: "cascade" },
  AgentJourney: { group: "runtime_facts", owner: "run", resetRuntime: "delete", deleteRun: "cascade" },
  AgentTranscriptItem: { group: "runtime_facts", owner: "run", resetRuntime: "delete", deleteRun: "cascade" },
  AgentTurn: { group: "runtime_facts", owner: "run", resetRuntime: "delete", deleteRun: "cascade" },
  AgentTurnContext: { group: "runtime_facts", owner: "run", resetRuntime: "delete", deleteRun: "cascade" },
  AgentToolCall: { group: "runtime_facts", owner: "run", resetRuntime: "delete", deleteRun: "cascade" },
  LiveEvent: { group: "runtime_facts", owner: "run", resetRuntime: "delete", deleteRun: "cascade" },
  SimulatedPostState: { group: "runtime_facts", owner: "content_version", resetRuntime: "delete", deleteRun: "cascade" },
  SocialInteractionEvent: { group: "runtime_facts", owner: "content_version", resetRuntime: "delete", deleteRun: "cascade" },
  SocialReaction: { group: "runtime_facts", owner: "content_version", resetRuntime: "delete", deleteRun: "cascade" },
  LoadedCommentPage: { group: "runtime_facts", owner: "content_version", resetRuntime: "delete", deleteRun: "cascade" },
  SimulatedComment: { group: "runtime_facts", owner: "content_version", resetRuntime: "delete", deleteRun: "cascade" },
  ActionLog: { group: "runtime_facts", owner: "run", resetRuntime: "delete", deleteRun: "cascade" },
  RunLog: { group: "runtime_facts", owner: "run", resetRuntime: "delete", deleteRun: "cascade" },
  LlmCallTrace: { group: "runtime_facts", owner: "run", resetRuntime: "delete", deleteRun: "cascade" },
  RunLlmUsageSummary: { group: "runtime_facts", owner: "run", resetRuntime: "delete", deleteRun: "cascade" },
  Insight: { group: "runtime_facts", owner: "content_version", resetRuntime: "delete", deleteRun: "cascade" },
  Report: { group: "runtime_facts", owner: "run", resetRuntime: "delete", deleteRun: "cascade" }
};

export interface ParticipantCleanupCounts {
  actionLogs: number;
  simulatedComments: number;
  loadedCommentPages: number;
  socialInteractionEvents: number;
  socialReactions: number;
  agentTranscriptItems: number;
  agentToolCalls: number;
  agentTurnContexts: number;
  agentTurns: number;
  agentJourneys: number;
}

/** Delete participant-scoped runtime facts in FK-safe order. Preserves RunParticipant row and identity/profile rows. */
export async function cleanupParticipantRuntimeFacts(
  tx: Prisma.TransactionClient,
  runId: string,
  participantId: string
): Promise<ParticipantCleanupCounts> {
  // Narrow content-scoped deletes to the participant's journey contentVersion(s)
  const participantJourneys = await tx.agentJourney.findMany({ where: { runId, participantId }, select: { contentVersionId: true } });
  const cvIds = [...new Set(participantJourneys.map((j) => j.contentVersionId))];
  const cvFilter = cvIds.length === 1 ? { contentVersionId: cvIds[0] } : cvIds.length > 1 ? { contentVersionId: { in: cvIds } } : {};

  // Leaf tables scoped by participantId (some have runId, some don't)
  const actionLogs = await tx.actionLog.deleteMany({ where: { runId, participantId } });
  const simulatedComments = await tx.simulatedComment.deleteMany({ where: { participantId, ...cvFilter } });
  const loadedCommentPages = await tx.loadedCommentPage.deleteMany({ where: { participantId, ...cvFilter } });
  const socialInteractionEvents = await tx.socialInteractionEvent.deleteMany({ where: { participantId, ...cvFilter } });
  const socialReactions = await tx.socialReaction.deleteMany({ where: { participantId, ...cvFilter } });

  // Transcript items reference toolCalls and agentTurns via SetNull - delete first
  // AgentTranscriptItem doesn't have participantId directly; filter via journey's participantId
  const agentTranscriptItems = await tx.agentTranscriptItem.deleteMany({ where: { runId, journey: { participantId } } });
  const agentToolCalls = await tx.agentToolCall.deleteMany({ where: { runId, participantId } });
  const agentTurnContexts = await tx.agentTurnContext.deleteMany({ where: { agentTurn: { runId, participantId } } });
  const agentTurns = await tx.agentTurn.deleteMany({ where: { runId, participantId } });
  const agentJourneys = await tx.agentJourney.deleteMany({ where: { runId, participantId } });

  return {
    actionLogs: actionLogs.count,
    simulatedComments: simulatedComments.count,
    loadedCommentPages: loadedCommentPages.count,
    socialInteractionEvents: socialInteractionEvents.count,
    socialReactions: socialReactions.count,
    agentTranscriptItems: agentTranscriptItems.count,
    agentToolCalls: agentToolCalls.count,
    agentTurnContexts: agentTurnContexts.count,
    agentTurns: agentTurns.count,
    agentJourneys: agentJourneys.count
  };
}

export interface RuntimeCleanupCounts {
  reports: number;
  insights: number;
  runLogs: number;
  llmCallTraces: number;
  runLlmUsageSummaries: number;
  actionLogs: number;
  simulatedComments: number;
  loadedCommentPages: number;
  socialInteractionEvents: number;
  socialReactions: number;
  simulatedPostStates: number;
  liveEvents: number;
  agentToolCalls: number;
  agentTurnContexts: number;
  agentTurns: number;
  agentTranscriptItems: number;
  agentJourneys: number;
  runParticipants: number;
}

/** Delete all runtime facts for a run and its single contentVersion, in FK-safe order. */
export async function cleanupRuntimeFacts(tx: Prisma.TransactionClient, runId: string): Promise<RuntimeCleanupCounts> {
  const contentVersion = await tx.contentVersion.findUnique({ where: { runId } });
  const cvId = contentVersion?.id;

  // Leaf tables under contentVersion with Restrict FKs from journey/toolCall/participant
  const socialInteractionEvents = cvId ? await tx.socialInteractionEvent.deleteMany({ where: { contentVersionId: cvId } }) : { count: 0 };
  const socialReactions = cvId ? await tx.socialReaction.deleteMany({ where: { contentVersionId: cvId } }) : { count: 0 };
  const loadedCommentPages = cvId ? await tx.loadedCommentPage.deleteMany({ where: { contentVersionId: cvId } }) : { count: 0 };
  const simulatedComments = cvId ? await tx.simulatedComment.deleteMany({ where: { contentVersionId: cvId } }) : { count: 0 };

  // Transcript items reference toolCalls and agentTurns via SetNull - delete first
  const agentTranscriptItems = await tx.agentTranscriptItem.deleteMany({ where: { runId } });
  // ActionLog has Cascade FKs from AgentJourney and AgentTurn - delete before those parents
  const actionLogs = await tx.actionLog.deleteMany({ where: { runId } });
  const agentToolCalls = await tx.agentToolCall.deleteMany({ where: { runId } });
  const agentTurnContexts = await tx.agentTurnContext.deleteMany({ where: { agentTurn: { runId } } });
  const agentTurns = await tx.agentTurn.deleteMany({ where: { runId } });
  const agentJourneys = await tx.agentJourney.deleteMany({ where: { runId } });

  // ContentVersion-level runtime state
  const simulatedPostStates = cvId ? await tx.simulatedPostState.deleteMany({ where: { contentVersionId: cvId } }) : { count: 0 };
  const insights = cvId ? await tx.insight.deleteMany({ where: { contentVersionId: cvId } }) : { count: 0 };

  // TestRun-level runtime facts
  const reports = await tx.report.deleteMany({ where: { runId } });
  const runLogs = await tx.runLog.deleteMany({ where: { runId } });
  const llmCallTraces = await tx.llmCallTrace.deleteMany({ where: { runId } });
  const runLlmUsageSummaries = await tx.runLlmUsageSummary.deleteMany({ where: { runId } });
  const liveEvents = await tx.liveEvent.deleteMany({ where: { runId } });

  // Participants last - Restrict FKs from User/Agent/PlatformAccount
  const runParticipants = await tx.runParticipant.deleteMany({ where: { runId } });

  return {
    reports: reports.count,
    insights: insights.count,
    runLogs: runLogs.count,
    llmCallTraces: llmCallTraces.count,
    runLlmUsageSummaries: runLlmUsageSummaries.count,
    actionLogs: actionLogs.count,
    simulatedComments: simulatedComments.count,
    loadedCommentPages: loadedCommentPages.count,
    socialInteractionEvents: socialInteractionEvents.count,
    socialReactions: socialReactions.count,
    simulatedPostStates: simulatedPostStates.count,
    liveEvents: liveEvents.count,
    agentToolCalls: agentToolCalls.count,
    agentTurnContexts: agentTurnContexts.count,
    agentTurns: agentTurns.count,
    agentTranscriptItems: agentTranscriptItems.count,
    agentJourneys: agentJourneys.count,
    runParticipants: runParticipants.count
  };
}
