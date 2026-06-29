import type {
  AudienceSeatStatus,
  CommentItem,
  JourneyExitOutcome,
  RunClockSnapshot,
  RunStatus
} from "./run.js";

// ── SSE 事件类型枚举 ──

export type LiveEventType =
  | "post_state.updated"
  | "comments.page_loaded"
  | "comment.created"
  | "comment.updated"
  | "action_log.created"
  | "summary.updated"
  | "insight.created"
  | "audience.status_updated"
  | "audience.action_happened"
  | "audience.generation.job.started"
  | "audience.generation.job.completed"
  | "audience.generation.job.failed"
  | "audience.generation.job.canceled"
  | "audience.plan.started"
  | "audience.plan.reasoning.delta"
  | "audience.plan.progress"
  | "audience.plan.frame"
  | "audience.plan.ready"
  | "audience.plan.updated"
  | "audience.plan.confirmed"
  | "audience.plan.failed"
  | "audience.profile.expansion.started"
  | "audience.profile.expansion.ready"
  | "audience.profile.expansion.directive_started"
  | "audience.profile.expansion.directive_ready"
  | "audience.profile.expansion.directive_failed"
  | "audience.profile.created"
  | "audience.identity.started"
  | "audience.identity.ready"
  | "audience.identity.failed"
  | "audience.updated"
  | "run.clock.updated"
  | "run.started"
  | "run.pausing"
  | "run.paused"
  | "run.resumed"
  | "run.completed"
  | "run_log.created"
  | "report.regenerated";

// ── SSE payload 基础 envelope ──

export type LiveEventPayload = {
  eventId: string;
  type: LiveEventType;
  runId: string;
  contentVersionId?: string;
  simulatedTime?: number;
  createdAt?: string;
};

/**
 * LiveEventPayload extended with an index signature for consumers that need
 * to access event-specific fields (e.g. `payload.commentId`, `payload.job`).
 * The base LiveEventPayload type is kept closed to prevent the escape hatch
 * from spreading into type signatures that should be explicit.
 */
export type LiveEventEnvelope = LiveEventPayload & Record<string, unknown>;

// ── 具体 payload 类型 ──

export type CommentUpdatePatch = Partial<Pick<CommentItem, "likeCount" | "replyCount">>;

export type CommentUpdatedPayload = LiveEventPayload & {
  type: "comment.updated";
  commentId: string;
  patch: CommentUpdatePatch;
};

export type AudienceStatusUpdatedPayload = {
  type: "audience.status_updated";
  runId: string;
  audienceRevision: number;
  participantId: string;
  simulatedTime: number;
  status: AudienceSeatStatus;
  currentAction?: string;
  exitOutcome?: JourneyExitOutcome;
  exitReason?: string;
};

export type AudienceActionHappenedPayload = {
  type: "audience.action_happened";
  runId: string;
  audienceRevision: number;
  participantId: string;
  simulatedTime: number;
  action: "open_post" | "read_post" | "like_post" | "favorite_post" | "share_post" | "write_comment" | "like_comment" | "exit_browsing";
  animationHint?: "heart" | "star" | "comment" | "risk" | "skip" | "none";
  exitOutcome?: JourneyExitOutcome;
  exitReason?: string;
  text?: string;
};

export type RunClockUpdateReason =
  | "started"
  | "resumed"
  | "paused"
  | "report_started"
  | "completed"
  | "reset"
  | "retry_started"
  | "error_frozen";

export type RunClockUpdatedPayload = {
  type: "run.clock.updated";
  runId: string;
  reason: RunClockUpdateReason;
  status: RunStatus;
  clock: RunClockSnapshot;
};
