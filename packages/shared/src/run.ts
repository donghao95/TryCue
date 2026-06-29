import { z } from "zod";
import type {
  CommentIntent,
  ExitReasonCategory,
  ExitReadingDepth,
  InterestTrustLevel
} from "./tool.js";
import type { EvidencePack, Recommendation, ReportOutput } from "./report.js";

// ── Run 生命周期状态枚举 ──

export const RunStatusSchema = z.enum([
  "draft",
  "planning_audience",
  "generating_audience",
  "audience_ready",
  "running",
  "pausing",
  "paused",
  "report_generating",
  "completed"
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunParticipantStatusSchema = z.enum([
  "ready",
  "queued",
  "thinking",
  "tool_running",
  "waiting_next",
  "finished",
  "skipped",
  "failed"
]);
export type RunParticipantStatus = z.infer<typeof RunParticipantStatusSchema>;

export const JourneyStatusSchema = z.enum(["active", "finished", "failed"]);
export type JourneyStatus = z.infer<typeof JourneyStatusSchema>;

export const AgentTurnStatusSchema = z.enum([
  "created",
  "context_recorded",
  "model_calling",
  "model_returned",
  "tools_executing",
  "completed",
  "failed",
  "recovered"
]);
export type AgentTurnStatus = z.infer<typeof AgentTurnStatusSchema>;

export const AgentToolCallStatusSchema = z.enum([
  "pending",
  "committed",
  "ignored",
  "failed"
]);
export type AgentToolCallStatus = z.infer<typeof AgentToolCallStatusSchema>;

// ── Run 创建/启动 API 请求 ──

export const CUSTOM_AUDIENCE_MIN = 1;
export const CUSTOM_AUDIENCE_MAX = 10000;
export const CUSTOM_AUDIENCE_TOKEN_WARNING_THRESHOLD = 100;

export const ScaleSchema = z.enum(["quick", "standard", "custom"]);
export type Scale = z.infer<typeof ScaleSchema>;

const PostImageUrlSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^(https?:\/\/|\/(?!\/)).+/i, "must be an http(s) URL or a same-origin absolute path starting with /");

export const CreateRunRequestSchema = z.object({
  title: z.string().trim().min(2).max(80),
  coverImageUrl: PostImageUrlSchema,
  imageUrls: z.array(PostImageUrlSchema).min(1).max(9).optional(),
  bodyText: z.string().trim().min(20).max(8000),
  scale: ScaleSchema,
  audienceCount: z.number().int().min(CUSTOM_AUDIENCE_MIN).max(CUSTOM_AUDIENCE_MAX).optional()
}).superRefine((value, ctx) => {
  if (value.scale === "custom" && value.audienceCount === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["audienceCount"],
      message: "自定义试映需要填写观众数"
    });
  }
  if (value.scale !== "custom" && value.audienceCount !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["audienceCount"],
      message: "只有自定义试映可以传 audienceCount"
    });
  }
});
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

export const StartRunRequestSchema = z.object({
  force: z.boolean().optional().default(false),
  allowPartialAudience: z.boolean().optional().default(false)
});
export type StartRunRequest = z.infer<typeof StartRunRequestSchema>;

export const RetryStrategySchema = z.enum(["continue_retry", "clean_retry"]);
export type RetryStrategy = z.infer<typeof RetryStrategySchema>;

export const RetryRunRequestSchema = z.object({
  participantId: z.string().trim().min(1),
  strategy: RetryStrategySchema.optional().default("continue_retry")
});
export type RetryRunRequest = z.infer<typeof RetryRunRequestSchema>;

// ── Run 工作台视图 ──

export type RunClockSnapshot = {
  serverNow: string;
  clockElapsedMs: number;
  clockAnchorAt?: string | null;
  clockScale: number;
};

export type RunOverview = {
  runId: string;
  status: RunStatus;
  mode: string;
  contentVersion: {
    id: string;
    title: string;
    coverImageUrl?: string | null;
    imageUrls?: string[] | null;
    bodyText?: string;
    bodyPreview?: string;
  } | null;
  progress: {
    audienceTotal: number;
    journeyFinishedCount: number;
    journeyFailedCount: number;
    currentSimulatedTime: number;
  };
  audienceProgress?: {
    total: number;
    generated: number;
    ready: number;
  };
  clock?: RunClockSnapshot;
  audienceRevision: number;
  latestLiveEventSequence: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  terminalReason?: string | null;
};

export type RunHistoryItem = {
  runId: string;
  status: RunStatus;
  title: string;
  coverImageUrl?: string | null;
  imageUrls?: string[];
  bodyPreview: string;
  audienceTotal: number;
  participantCount: number;
  identityReadyCount: number;
  journeyCount: number;
  hasReport: boolean;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type ReportView = {
  reportId: string;
  runId: string;
  recommendation: Recommendation;
  reportOutput: ReportOutput;
  evidencePack: EvidencePack;
  model: string;
  promptVersion: string;
  createdAt: string;
};

// ── Action log / insight / runtime log 视图 ──

export type CommentItem = {
  id: string;
  participantId?: string | null;
  audienceName: string;
  segment: string;
  commentText: string;
  parentCommentId?: string | null;
  rootCommentId?: string | null;
  mentionedUserIds?: string[];
  mentionedCommentIds?: string[];
  likeCount?: number;
  likedByMe?: boolean;
  replyCount?: number;
  simulatedTime?: number;
  createdAt?: string;
};

export type InsightItem = {
  id: string;
  level: string;
  title: string;
  evidence: string;
  simulatedTime?: number;
};

export type ActionLogStructuredData = {
  toolName?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  content?: string;
  reasoningContent?: string;
  source?: string;
  displayText?: string;
};

export type ActionLogItem = {
  id: string;
  participantId?: string | null;
  turnId?: string;
  simulatedTime: number;
  action?: string | null;
  text: string;
  logType?: string;
  audienceName?: string;
  segment?: string;
  createdAt?: string;
  kind?: string;
  data?: ActionLogStructuredData;
};

export type RuntimeLogItem = {
  id: string;
  logType: string;
  message?: string;
  text?: string;
  action?: string | null;
  audienceName?: string;
  participantId?: string | null;
  metadata?: unknown;
  createdAt?: string;
  simulatedTime?: number;
};

export type AudienceSeatsSummary = {
  total: number;
  activeCount: number;
  commentedCount: number;
  favoritedCount: number;
  skippedCount: number;
  doubtCount: number;
  riskExitCount: number;
  finishedCount: number;
};

// ── 现场工作台视图 ──

export type PostStateView = {
  exposureCount: number;
  openCount: number;
  likeCount: number;
  favoriteCount: number;
  commentCount: number;
  shareCount: number;
  exitCount: number;
  likedByMe?: boolean;
  favoritedByMe?: boolean;
  sharedByMe?: boolean;
};

export type LiveSummary = {
  audienceTotal: number;
  reachedCount: number;
  openedCount: number;
  finishedCount: number;
  skippedCount: number;
  browsedAndLeftCount: number;
  riskExitCount: number;
  maxStepsCount: number;
  likedCount: number;
  favoritedCount: number;
  commentedCount: number;
  trustConcernCount: number;
  adConcernCount: number;
  questionCount: number;
};

// ── 观众席视图 ──

export type AudienceSeatStatus =
  | "not_started"
  | "entered"
  | "watching"
  | "hesitating"
  | "viewing_comments"
  | "liked"
  | "favorited"
  | "commented"
  | "skipped"
  | "risk_exit"
  | "finished"
  | "failed";

export type JourneyExitOutcome = "skipped" | "browsed_and_left" | "risk_exit" | "max_steps";

export type AudienceSeat = {
  participantId: string;
  actorUserId: string;
  agentId?: string | null;
  platformAccountId: string;
  name: string;
  avatarUrl?: string | null;
  segment: string;
  personaSummary: string;
  status: AudienceSeatStatus;
  currentAction?: string;
  exitOutcome?: JourneyExitOutcome;
  exitReason?: string;
  hasOpened: boolean;
  hasLiked: boolean;
  hasFavorited: boolean;
  hasShared: boolean;
  hasCommented: boolean;
  hasSkipped: boolean;
  hasDoubt: boolean;
  lastObservableLog?: string;
  lastUpdatedSimulatedTime?: number;
};

export type AudienceDetail = {
  participantId: string;
  actorUserId: string;
  agentId?: string | null;
  platformAccountId: string;
  avatarUrl?: string | null;
  persona: {
    name: string;
    segment: string;
    profile: string;
    personality: string;
    mbtiType: string;
    responseStyle: string;
  };
  journey: {
    status: string;
    currentStep: number;
    finalSummary?: string;
    exitOutcome?: JourneyExitOutcome;
    exitReason?: string;
    exitReasonCategory?: ExitReasonCategory;
    exitReadingDepth?: ExitReadingDepth;
    exitInterestLevel?: InterestTrustLevel;
    exitTrustLevel?: InterestTrustLevel;
  };
  timeline: Array<{
    id?: string;
    turnId?: string;
    simulatedTime: number;
    action: string;
    kind: string;
    data?: ActionLogStructuredData;
    observableLog: string;
    innerReaction?: string;
  }>;
  interactions: Array<{
    type: string;
    simulatedTime: number;
  }>;
  comments: Array<{
    commentText: string;
    simulatedTime: number;
    commentType: string;
    sentiment: string;
    riskTag?: string;
    intent?: CommentIntent;
  }>;
};
