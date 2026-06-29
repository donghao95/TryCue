import type {
  ActionLogItem,
  CommentItem,
  RuntimeLogItem,
  RunClockSnapshot,
  RunStatus
} from "@trycue/shared/run";
import type {
  AudienceGenerationDirectiveProgress,
  AudienceGenerationJobView,
  AudiencePlanPreview,
  AudienceGenerationProgressView,
  AudiencePersonaJson,
  AudienceProfileView,
  AudienceSamplingDirective,
  AudienceSamplingPlanView
} from "@trycue/shared/audience";

export type UiStatus = RunStatus | "starting" | "restoring" | "restore_failed" | "report_unavailable";

export type AppRoute =
  | { kind: "workbench"; runId?: string }
  | { kind: "report"; runId: string }
  | { kind: "settings" }
  | { kind: "history" }
  | { kind: "not_found" };

export type LocalRunClockSnapshot = RunClockSnapshot & {
  receivedAtMs: number;
};

export type CommentsState = {
  runId: string | null;
  items: CommentItem[];
  cursor: string | null;
  hasMore: boolean;
  sort: "latest" | "hot";
  loading: boolean;
};

export type RuntimeLogsState = {
  runId: string | null;
  items: RuntimeLogItem[];
  cursor: string | null;
  hasMore: boolean;
  loading: boolean;
};

export type AudienceLiveLogsState = {
  runId: string | null;
  byParticipant: Record<string, ActionLogItem[]>;
};

export type AudienceDraft = AudienceProfileView & {
  identity?: (AudienceProfileView["identity"] & {
    personaJson?: AudiencePersonaJson | Record<string, unknown> | null;
  }) | null;
};

export type AudienceGenerationJob = AudienceGenerationJobView;

export type AudienceDirectiveCard = AudienceSamplingDirective & {
  profileCreatedCount: number;
  identityReadyCount: number;
  identityFailedCount: number;
  generationStatus: AudienceGenerationDirectiveProgress["generationStatus"] | null;
  generationError: string | null;
  profiles: AudienceDraft[];
};

export type AudienceSamplingState = {
  runId: string | null;
  plan: AudienceSamplingPlanView | null;
  progress: AudienceGenerationProgressView | null;
};

export type AudienceEditState = {
  id: string;
  mode: "identity";
  identityStatus: AudienceDraft["identityStatus"];
  displayName: string;
  samplingLabel: string;
  demographicsJson: AudienceProfileView["demographicsJson"];
  profileText: string;
  personalityText: string;
  mbtiTypeText: string;
  responseStyleText: string;
  avatarUrl: string;
  identity: Record<string, unknown>;
};

export type BehaviorToast = {
  id: string;
  text: string;
  hint: "heart" | "star" | "comment" | "risk" | "skip" | "none";
};

export type AppToast = {
  id: number;
  tone: "error" | "success";
  text: string;
};

export type ConfirmDialogState = {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void;
};

export type CountDeltaBurst = {
  delta: number;
  nonce: number;
};
