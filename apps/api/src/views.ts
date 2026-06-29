import type {
  ActionLog,
  RunParticipant,
  ContentVersion,
  Insight,
  AgentJourney,
  Report,
  SimulatedComment,
  SocialInteractionEvent,
  SimulatedPostState,
  TestRun
} from "@trycue/db";
import type {
  RunParticipantStatus,
  AudienceDetail,
  AudienceSeat,
  AudienceSeatStatus,
  ActionLogItem,
  CommentIntent,
  CommentItem,
  CommentUpdatePatch,
  EvidencePack,
  ExitReasonCategory,
  ExitReadingDepth,
  InterestTrustLevel,
  InsightItem,
  LiveSummary,
  PostStateView,
  Recommendation,
  ReportOutput,
  ReportView,
  RunOverview
} from "@trycue/shared";
import { ReportOutputSchema, EvidencePackSchema } from "@trycue/shared";
import { runClockSnapshot } from "./runtime/clock.js";

export function postStateView(state: SimulatedPostState, viewerState?: Pick<PostStateView, "likedByMe" | "favoritedByMe" | "sharedByMe">): PostStateView {
  return {
    exposureCount: state.exposureCount,
    openCount: state.openCount,
    likeCount: state.likeCount,
    favoriteCount: state.favoriteCount,
    commentCount: state.commentCount,
    shareCount: state.shareCount,
    exitCount: state.exitCount,
    ...viewerState
  };
}

export function commentView(comment: SimulatedComment, audience?: RunParticipant | null, options?: { likedByMe?: boolean }): CommentItem {
  const fallbackName = comment.source === "human_ui" ? "前端用户" : "AI 观众";
  const view = {
    id: comment.id,
    participantId: comment.participantId,
    audienceName: audience ? participantDisplayName(audience) : fallbackName,
    segment: audience ? participantSamplingLabel(audience) : "",
    commentText: comment.commentText,
    parentCommentId: comment.parentCommentId,
    rootCommentId: comment.rootCommentId,
    mentionedUserIds: stringArrayView(comment.mentionedUserIdsJson),
    mentionedCommentIds: stringArrayView(comment.mentionedCommentIdsJson),
    likeCount: comment.likeCount,
    replyCount: comment.replyCount,
    simulatedTime: comment.simulatedTime,
    createdAt: comment.createdAt.toISOString()
  };
  return options ? { ...view, likedByMe: options.likedByMe ?? false } : view;
}

export function commentUpdatePatch(comment: SimulatedComment): CommentUpdatePatch {
  return {
    likeCount: comment.likeCount,
    replyCount: comment.replyCount
  };
}

export function logView(log: ActionLog, audience?: RunParticipant | null): ActionLogItem {
  const payload = objectRecord(log.eventPayloadJson);
  return {
    id: log.id,
    participantId: log.participantId,
    turnId: log.journeyActionId,
    simulatedTime: log.simulatedTime,
    audienceName: audience ? participantDisplayName(audience) : "AI 观众",
    segment: audience ? participantSamplingLabel(audience) : "",
    text: log.logText,
    action: log.action,
    kind: log.eventKind,
    data: {
      toolName: typeof payload.toolName === "string" ? payload.toolName : undefined,
      input: objectRecord(payload.input),
      output: objectRecord(payload.output),
      content: typeof payload.content === "string" ? payload.content : undefined,
      reasoningContent: typeof payload.reasoningContent === "string" ? payload.reasoningContent : undefined,
      source: typeof payload.source === "string" ? payload.source : undefined,
      displayText: typeof payload.displayText === "string" ? payload.displayText : undefined
    }
  };
}

export function insightView(insight: Insight): InsightItem {
  return {
    id: insight.id,
    level: insight.level,
    title: insight.title,
    evidence: insight.evidence,
    simulatedTime: insight.simulatedTime
  };
}

export function reportView(report: Report): ReportView {
  // Defensive: validate the persisted JSON blobs against the shared schemas before
  // casting. If a report was written by an older build or a schema drift slipped in,
  // we fall back to a minimal but well-typed structure instead of crashing the API.
  const rawOutput = report.reportOutputJson as unknown;
  const rawPack = report.evidencePackJson as unknown;
  const outputParse = ReportOutputSchema.safeParse(rawOutput);
  const packParse = EvidencePackSchema.safeParse(rawPack);
  if (!outputParse.success || !packParse.success) {
    // Log-once style: callers should never see this in normal operation, but if a
    // persisted report is malformed we still return a typed object so the frontend
    // can render the disclosure + headline without crashing.
    const fallbackOutput: ReportOutput = outputParse.success ? outputParse.data : minimalReportOutput(report);
    const fallbackPack: EvidencePack = packParse.success ? packParse.data : minimalEvidencePack(report);
    return {
      reportId: report.id,
      runId: report.runId,
      recommendation: report.recommendation as Recommendation,
      reportOutput: fallbackOutput,
      evidencePack: fallbackPack,
      model: report.model,
      promptVersion: report.promptVersion,
      createdAt: report.createdAt.toISOString()
    };
  }
  return {
    reportId: report.id,
    runId: report.runId,
    recommendation: report.recommendation as Recommendation,
    reportOutput: outputParse.data,
    evidencePack: packParse.data,
    model: report.model,
    promptVersion: report.promptVersion,
    createdAt: report.createdAt.toISOString()
  };
}

function minimalReportOutput(report: Report): ReportOutput {
  const recommendation = (report.recommendation as Recommendation) ?? "recommend_retest";
  return {
    verdict: {
      recommendation,
      recommendationLabel: recommendationLabel(recommendation),
      confidence: "low",
      headline: "报告数据格式异常，已退回到最小可用结构。",
      oneSentence: "",
      topOpportunity: "",
      topRisk: "",
      priorityFix: "",
      evidenceRefs: []
    },
    funnel: {
      audienceCount: 0, completedCount: 0, failedCount: 0,
      exposedActors: 0, openedActors: 0, readActors: 0, deepReadActors: 0,
      readSkimActors: 0, readPartialActors: 0, readFullActors: 0,
      viewedCommentsActors: 0, likedActors: 0, favoritedActors: 0,
      commentedActors: 0, sharedActors: 0, exitedActors: 0, positiveActionActors: 0,
      openEvents: 0, readEvents: 0, commentEvents: 0, shareEvents: 0, exitEvents: 0,
      openRate: null, readRateAfterOpen: null, deepReadRateAfterOpen: null,
      favoriteRateAfterOpen: null, commentRateAfterOpen: null,
      shareRateAfterOpen: null, positiveActionRate: null,
      notes: "证据已损坏。"
    },
    mainBlocker: {
      blockerType: "evidence_quality",
      title: "证据质量不足",
      severity: "low",
      affectedCount: 0,
      summary: "报告数据格式异常。",
      diagnosis: "报告数据格式异常，建议重测。",
      evidenceRefs: []
    },
    audienceGroupAnalysis: {
      groups: [],
      inferredGroups: [],
      confidence: "low",
      crossGroupSummary: "",
      coreTargetHit: false,
      coreTargetHighInterestLowTrust: false,
      peripheralExpansionOpportunity: false,
      contrastSkipExpected: false,
      contrastUnexpectedRisk: false,
      evidenceRefs: []
    },
    segments: [],
    diagnostics: [],
    keepAndChange: { keep: [], change: [] },
    revisionPlan: [],
    retestPlan: [],
    evidenceRefs: []
  };
}

function minimalEvidencePack(_report: Report): EvidencePack {
  return {
    meta: {
      runId: _report.runId,
      contentVersionId: _report.contentVersionId,
      audienceCount: 0,
      completedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      generatedAt: _report.createdAt.toISOString(),
      evidenceQuality: "low",
      evidenceQualityReason: "报告数据格式异常，已退回最小可用结构。"
    },
    content: { title: "", bodyPreview: "", platformName: "小红书", imageCount: 0 },
    funnel: {
      exposedActors: 0, openedActors: 0, readActors: 0, deepReadActors: 0,
      readSkimActors: 0, readPartialActors: 0, readFullActors: 0,
      viewedCommentsActors: 0, likedActors: 0, favoritedActors: 0,
      commentedActors: 0, sharedActors: 0, exitedActors: 0, positiveActionActors: 0,
      openEvents: 0, readEvents: 0, commentEvents: 0, shareEvents: 0, exitEvents: 0,
      openRate: null, readRateAfterOpen: null, deepReadRateAfterOpen: null,
      positiveActionRate: null, favoriteRateAfterOpen: null,
      commentRateAfterOpen: null, shareRateAfterOpen: null
    },
    exitAnalysis: {
      byReasonCategory: {
        not_relevant: 0, not_interested: 0, low_trust: 0, too_ad_like: 0,
        content_too_long: 0, need_more_evidence: 0, finished_normally: 0, no_more_action: 0
      },
      byReadingDepth: { feed_only: 0, skimmed: 0, partial: 0, full: 0 },
      byInterestLevel: { low: 0, medium: 0, high: 0 },
      byTrustLevel: { low: 0, medium: 0, high: 0 },
      riskExitCount: 0,
      riskExitRate: null
    },
    commentAnalysis: {
      totalComments: 0,
      byIntent: { ask: 0, doubt: 0, share_experience: 0, agree: 0, joke: 0, pushback: 0 },
      representativeComments: []
    },
    thoughtAnalysis: { representativeThoughts: [], themes: [] },
    segments: {
      persuaded: { key: "persuaded", name: "被打动的人", participantIds: [], size: 0, percentage: null, summary: "", commonTraits: [], evidenceRefs: [] },
      interestedButNotConvinced: { key: "interested_but_not_convinced", name: "高兴趣低信任的人", participantIds: [], size: 0, percentage: null, summary: "", commonTraits: [], evidenceRefs: [] },
      skipped: { key: "skipped", name: "直接流失的人", participantIds: [], size: 0, percentage: null, summary: "", commonTraits: [], evidenceRefs: [] },
      skeptical: { key: "skeptical", name: "质疑/反驳的人", participantIds: [], size: 0, percentage: null, summary: "", commonTraits: [], evidenceRefs: [] }
    },
    blockers: [],
    audienceGroups: {
      groups: [],
      inferredGroups: [],
      confidence: "low",
      crossGroupSummary: "",
      coreTargetHit: false,
      coreTargetHighInterestLowTrust: false,
      peripheralExpansionOpportunity: false,
      contrastSkipExpected: false,
      contrastUnexpectedRisk: false,
      evidenceRefs: []
    },
    journeySamples: [],
    evidenceIndex: {}
  };
}

function recommendationLabel(recommendation: Recommendation): string {
  const map: Record<Recommendation, string> = {
    recommend_publish: "建议发布",
    modify_then_publish: "修改后发布",
    not_recommend_current_version: "不建议当前版本发布",
    recommend_retest: "建议重测"
  };
  return map[recommendation];
}

export async function buildSummaryView(params: {
  run: TestRun;
  postState?: SimulatedPostState | null;
  journeys: AgentJourney[];
  comments: SimulatedComment[];
}): Promise<LiveSummary> {
  const opened = params.postState?.openCount ?? 0;
  const text = params.comments.map((comment) => comment.commentText).join("\n");
  const skippedCount = params.journeys.filter((journey) => journey.exitOutcome === "skipped").length;
  const browsedAndLeftCount = params.journeys.filter((journey) => journey.exitOutcome === "browsed_and_left").length;
  const riskExitCount = params.journeys.filter((journey) => journey.exitOutcome === "risk_exit").length;
  const maxStepsCount = params.journeys.filter((journey) => journey.exitOutcome === "max_steps").length;
  return {
    audienceTotal: params.journeys.length || params.run.audienceCount,
    reachedCount: params.postState?.exposureCount ?? 0,
    openedCount: opened,
    finishedCount: params.journeys.filter((journey) => journey.status !== "active").length,
    skippedCount,
    browsedAndLeftCount,
    riskExitCount,
    maxStepsCount,
    likedCount: params.postState?.likeCount ?? 0,
    favoritedCount: params.postState?.favoriteCount ?? 0,
    commentedCount: params.postState?.commentCount ?? 0,
    trustConcernCount: countMatches(text, ["依据", "真实吗", "真的", "具体", "来源"]),
    adConcernCount: countMatches(text, ["广", "广告", "软广"]),
    questionCount: countMatches(text, ["吗", "？", "?", "求", "蹲"])
  };
}

function countMatches(value: string, words: string[]): number {
  return words.reduce((count, word) => count + (value.includes(word) ? 1 : 0), 0);
}

function stringArrayView(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function personaSectionText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function participantProfileSnapshot(audience: RunParticipant) {
  return objectRecord(audience.profileSnapshotJson);
}

function participantDisplayName(audience: RunParticipant) {
  return audience.displayNameSnapshot;
}

function participantSamplingLabel(audience: RunParticipant) {
  const snapshot = participantProfileSnapshot(audience);
  return typeof snapshot.samplingLabel === "string" ? snapshot.samplingLabel : "";
}

function participantAvatarUrl(audience: RunParticipant) {
  return typeof audience.avatarUrlSnapshot === "string" && audience.avatarUrlSnapshot.trim()
    ? audience.avatarUrlSnapshot
    : null;
}

export function deriveSeatStatus(
  journey: AgentJourney | undefined,
  interactionTypes: string[],
  hasDoubt: boolean
): AudienceSeatStatus {
  if (!journey) return "not_started";
  if (journey.status === "failed") return "failed";
  if (journey.exitOutcome === "skipped") return "skipped";
  if (journey.exitOutcome === "risk_exit") return "risk_exit";
  if (journey.exitOutcome === "browsed_and_left" || journey.exitOutcome === "max_steps") return "finished";
  const lastInteraction = interactionTypes.at(-1);
  if (lastInteraction === "exit_browsing") return interactionTypes.includes("open_post") ? "finished" : "skipped";
  if (journey.status === "finished") return "finished";
  if (lastInteraction === "write_comment") return "commented";
  if (lastInteraction === "favorite_post") return "favorited";
  if (lastInteraction === "like_post") return "liked";
  if (lastInteraction === "view_comments") return "viewing_comments";
  if (hasDoubt && interactionTypes.includes("open_post")) return "hesitating";
  // read_post 是"看了正文但未互动"的中间状态，seat 仍显示为 watching
  if (lastInteraction === "read_post" || lastInteraction === "open_post") return "watching";
  return "entered";
}

export function audienceSeatView(params: {
  audience: RunParticipant;
  journey?: AgentJourney;
  interactionTypes: string[];
  hasDoubt: boolean;
  lastLog?: { participantId: string; logText: string; simulatedTime: number };
}): AudienceSeat {
  const persona = objectRecord(params.audience.agentSnapshotJson);
  const status = deriveSeatStatus(params.journey, params.interactionTypes, params.hasDoubt);
  const profileSummary = personaSectionText(persona.profile);
  return {
    participantId: params.audience.id,
    actorUserId: params.audience.userId,
    agentId: params.audience.agentId,
    platformAccountId: params.audience.platformAccountId,
    name: participantDisplayName(params.audience),
    avatarUrl: participantAvatarUrl(params.audience),
    segment: participantSamplingLabel(params.audience),
    personaSummary: profileSummary,
    status,
    exitOutcome: params.journey?.exitOutcome ?? undefined,
    exitReason: params.journey?.exitReason ?? undefined,
    hasOpened: params.interactionTypes.includes("open_post"),
    hasLiked: params.interactionTypes.includes("like_post"),
    hasFavorited: params.interactionTypes.includes("favorite_post"),
    hasShared: params.interactionTypes.includes("share_post"),
    hasCommented: params.interactionTypes.includes("write_comment"),
    hasSkipped: params.journey?.exitOutcome === "skipped" || (!params.journey?.exitOutcome && params.interactionTypes.includes("exit_browsing") && !params.interactionTypes.includes("open_post")),
    hasDoubt: params.hasDoubt,
    lastObservableLog: params.lastLog?.logText,
    lastUpdatedSimulatedTime: params.lastLog?.simulatedTime
  };
}

export function buildAudienceSeatsView(params: {
  audiences: RunParticipant[];
  journeys: AgentJourney[];
  interactions: SocialInteractionEvent[];
  riskLogs: ActionLog[];
  lastLogs: Array<{ participantId: string; logText: string; simulatedTime: number }>;
}): AudienceSeat[] {
  const journeyByAudience = new Map(params.journeys.map((j) => [j.participantId, j]));
  const typesByAudience = new Map<string, string[]>();
  for (const interaction of params.interactions) {
    if (!interaction.participantId) continue;
    const list = typesByAudience.get(interaction.participantId) ?? [];
    list.push(interaction.interactionType);
    typesByAudience.set(interaction.participantId, list);
  }
  const doubtSet = new Set(params.riskLogs.flatMap((log) => log.participantId ? [log.participantId] : []));
  const lastLogByAudience = new Map(params.lastLogs.map((log) => [log.participantId, log]));
  return params.audiences.map((audience) =>
    audienceSeatView({
      audience,
      journey: journeyByAudience.get(audience.id),
      interactionTypes: typesByAudience.get(audience.id) ?? [],
      hasDoubt: doubtSet.has(audience.id),
      lastLog: lastLogByAudience.get(audience.id)
    })
  );
}

export function audienceDetailView(params: {
  audience: RunParticipant;
  journey?: AgentJourney;
  timeline: ActionLog[];
  interactions: SocialInteractionEvent[];
  comments: SimulatedComment[];
  toolCalls?: Array<{ toolName: string; input: unknown; output: unknown }>;
}): AudienceDetail {
  const persona = objectRecord(params.audience.agentSnapshotJson);
  const exitStructured = extractExitStructuredFields(params.toolCalls ?? []);
  const commentIntentByCommentId = buildCommentIntentMap(params.toolCalls ?? []);
  return {
    participantId: params.audience.id,
    actorUserId: params.audience.userId,
    agentId: params.audience.agentId,
    platformAccountId: params.audience.platformAccountId,
    avatarUrl: participantAvatarUrl(params.audience),
    persona: {
      name: participantDisplayName(params.audience),
      segment: participantSamplingLabel(params.audience),
      profile: personaSectionText(persona.profile),
      personality: personaSectionText(persona.personality),
      mbtiType: personaSectionText(persona.mbtiType),
      responseStyle: personaSectionText(persona.responseStyle)
    },
    journey: {
      status: params.journey?.status ?? "not_started",
      currentStep: params.journey?.currentStepIndex ?? 0,
      finalSummary: params.journey?.finalSummary ?? undefined,
      exitOutcome: params.journey?.exitOutcome ?? undefined,
      exitReason: params.journey?.exitReason ?? undefined,
      exitReasonCategory: exitStructured.reasonCategory,
      exitReadingDepth: exitStructured.readingDepth,
      exitInterestLevel: exitStructured.interestLevel,
      exitTrustLevel: exitStructured.trustLevel
    },
    timeline: params.timeline.map((log) => {
      const payload = objectRecord(log.eventPayloadJson);
      return {
        id: log.id,
        turnId: log.journeyActionId,
        simulatedTime: log.simulatedTime,
        action: log.action ?? "thought",
        kind: log.eventKind,
        data: {
          toolName: typeof payload.toolName === "string" ? payload.toolName : undefined,
          input: objectRecord(payload.input),
          output: objectRecord(payload.output),
          content: typeof payload.content === "string" ? payload.content : undefined,
          reasoningContent: typeof payload.reasoningContent === "string" ? payload.reasoningContent : undefined,
          source: typeof payload.source === "string" ? payload.source : undefined,
          displayText: typeof payload.displayText === "string" ? payload.displayText : undefined
        },
        observableLog: log.logText,
        innerReaction: log.thoughtText ?? log.logText
      };
    }),
    interactions: params.interactions.map((interaction) => ({
      type: interaction.interactionType,
      simulatedTime: interaction.simulatedTime
    })),
    comments: params.comments.map((comment) => ({
      commentText: comment.commentText,
      simulatedTime: comment.simulatedTime,
      commentType: inferCommentType(comment.commentText),
      sentiment: inferCommentSentiment(comment.commentText),
      riskTag: inferCommentRiskTag(comment.commentText),
      intent: commentIntentByCommentId.get(comment.id)
    }))
  };
}

type ExitStructuredFields = {
  reasonCategory?: ExitReasonCategory;
  readingDepth?: ExitReadingDepth;
  interestLevel?: InterestTrustLevel;
  trustLevel?: InterestTrustLevel;
};

function extractExitStructuredFields(toolCalls: Array<{ toolName: string; input: unknown; output: unknown }>): ExitStructuredFields {
  for (const call of [...toolCalls].reverse()) {
    if (call.toolName !== "exit_browsing") continue;
    const output = objectRecord(call.output);
    const reasonCategory = typeof output.reasonCategory === "string" ? (output.reasonCategory as ExitReasonCategory) : undefined;
    const readingDepth = typeof output.readingDepth === "string" ? (output.readingDepth as ExitReadingDepth) : undefined;
    const interestLevel = typeof output.interestLevel === "string" ? (output.interestLevel as InterestTrustLevel) : undefined;
    const trustLevel = typeof output.trustLevel === "string" ? (output.trustLevel as InterestTrustLevel) : undefined;
    return { reasonCategory, readingDepth, interestLevel, trustLevel };
  }
  return {};
}

function buildCommentIntentMap(toolCalls: Array<{ toolName: string; input: unknown; output: unknown }>): Map<string, CommentIntent> {
  const map = new Map<string, CommentIntent>();
  for (const call of toolCalls) {
    if (call.toolName !== "write_comment") continue;
    const output = objectRecord(call.output);
    const commentId = typeof output.commentId === "string" ? output.commentId : undefined;
    const intent = typeof output.intent === "string" ? (output.intent as CommentIntent) : undefined;
    if (commentId && intent) map.set(commentId, intent);
  }
  return map;
}

function inferCommentType(text: string) {
  if (text.includes("?") || text.includes("？") || text.includes("吗") || text.includes("求") || text.includes("蹲")) return "question";
  if (text.includes("广") || text.includes("广告")) return "concern";
  return "feedback";
}

function inferCommentSentiment(text: string) {
  if (text.includes("广") || text.includes("怕") || text.includes("担心")) return "cautious";
  if (text.includes("有用") || text.includes("码住") || text.includes("收藏")) return "positive";
  return "neutral";
}

function inferCommentRiskTag(text: string) {
  if (text.includes("广") || text.includes("广告")) return "ad_concern";
  if (text.includes("具体") || text.includes("来源") || text.includes("型号")) return "trust_evidence";
  return undefined;
}

export function runOverviewView(params: {
  run: TestRun;
  contentVersion: ContentVersion | null;
  journeys: AgentJourney[];
  postState: SimulatedPostState | null;
  audienceProgress?: { total: number; generated: number; ready: number };
  latestLiveEventSequence?: string | null;
}): RunOverview {
  const clock = runClockSnapshot(params.run);
  const currentSimulatedTime = Math.floor(clock.clockElapsedMs / 1000);
  return {
    runId: params.run.id,
    status: params.run.status,
    mode: params.run.mode,
    contentVersion: params.contentVersion
      ? {
          id: params.contentVersion.id,
          title: params.contentVersion.title,
          coverImageUrl: params.contentVersion.coverImageUrl,
          imageUrls: contentImageUrls(params.contentVersion.imageUrlsJson, params.contentVersion.coverImageUrl),
          bodyText: params.contentVersion.bodyText,
          bodyPreview: params.contentVersion.bodyText.slice(0, 120)
        }
      : null,
    progress: {
      audienceTotal: params.run.audienceCount,
      journeyFinishedCount: params.journeys.filter((journey) => journey.status === "finished").length,
      journeyFailedCount: params.journeys.filter((journey) => journey.status === "failed").length,
      currentSimulatedTime
    },
    audienceProgress: params.audienceProgress,
    clock,
    audienceRevision: params.run.audienceRevision,
    latestLiveEventSequence: params.latestLiveEventSequence ?? null,
    createdAt: params.run.createdAt.toISOString(),
    startedAt: params.run.startedAt?.toISOString() ?? null,
    completedAt: params.run.completedAt?.toISOString() ?? null,
    terminalReason: params.run.terminalReason ?? null
  };
}

function contentImageUrls(imageUrlsJson: unknown, coverImageUrl: string | null) {
  const stored = Array.isArray(imageUrlsJson) ? imageUrlsJson : [];
  const urls = [...stored, coverImageUrl]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(urls)];
}
