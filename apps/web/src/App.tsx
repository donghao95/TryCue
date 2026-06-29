import { useEffect, useMemo, useRef, useState } from "react";
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, UIEvent } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Eye, Heart, History, Home, ImageUp, Loader2, MessageCircle, PencilLine, Play, RefreshCw, Save, Send, Settings, Star, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CUSTOM_AUDIENCE_MAX, CUSTOM_AUDIENCE_MIN, CUSTOM_AUDIENCE_TOKEN_WARNING_THRESHOLD } from "@trycue/shared/run";
import type {
  ActionLogItem,
  AudienceDetail,
  AudienceSeat,
  AudienceSeatsSummary,
  CommentItem,
  InsightItem,
  LiveSummary,
  PostStateView,
  ReportView,
  RuntimeLogItem,
  RunOverview,
  RunStatus,
  Scale
} from "@trycue/shared/run";
import type {
  AudienceActionHappenedPayload,
  AudienceStatusUpdatedPayload,
  CommentUpdatePatch,
  LiveEventEnvelope,
  LiveEventType,
  RunClockUpdatedPayload
} from "@trycue/shared/live-events";
import type {
  AudiencePlanPreview,
  AudienceSamplingPlanRevisionMessage,
  AudienceSamplingPlanRevisionOperation,
  AudienceSamplingPlanRevisionProposal,
  AudienceSeatRevisionMessage,
  AudienceSeatRevisionOperation,
  AudienceSeatRevisionProposal,
  CreateAudienceProfileRequest,
  CreateAudienceSamplingDirectiveRequest,
  UpdateAudienceIdentityRequest,
  UpdateAudienceSamplingDirectiveRequest
} from "@trycue/shared/audience";
import { AssistantDialog } from "./components/AssistantDialog.js";
import type {
  AssistantDialogMessage,
  AssistantMention,
  AssistantMentionCandidate,
  AssistantOperation,
  AssistantOperationState,
  AssistantStage
} from "./components/AssistantDialog.js";
import { AudienceDetailDrawerContent } from "./components/AudienceDetailDrawerContent.js";
import { AudienceEditDrawer } from "./components/AudienceEditDrawer.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { ReportPanel } from "./components/ReportPanel.js";
import { RuntimeLogStrip } from "./components/RuntimeLogStrip.js";
import { SimulatedPostSurface, PlanningContentPreview } from "./components/SimulatedPostSurface.js";
import { SortableImageTile } from "./components/SortableImageTile.js";
import { AppHeader } from "./components/AppHeader.js";
import { AnimatedCommentList, AudienceAvatar, PostAction, SeatCell, VenueHud } from "./components/VenueWidgets.js";
import { useNavigationGuard } from "./hooks/useNavigationGuard.js";
import { useLiveEvents, type ConnectionStatus } from "./hooks/useLiveEvents.js";
import { useCreateDraft, isMeaningfulCreateDraft } from "./hooks/useCreateDraft.js";
import i18n from "./i18n.js";
import {
  COMMENT_PAGE_SIZE,
  DEMO_BODY,
  DEMO_IMAGE_URLS,
  DEMO_TITLE,
  emptyPostState,
  emptySummary,
  MAX_POST_IMAGES,
  MAX_UPLOAD_IMAGE_BYTES,
  MAX_UPLOAD_IMAGE_EDGE,
  RUNTIME_LOG_PAGE_SIZE,
  SEAT_FILTERS,
  SEEN_EVENT_IDS_MAX
} from "./constants.js";
import { parseApiResponse, request } from "./lib/api.js";
import { hasRuntimeSnapshot, mergeById, mergePostState, mergeRuntimeLogsById, mergeSeatSummary, patchCommentById, sortAudienceDrafts, sortPostComments } from "./lib/collections.js";
import { actionText } from "./lib/events.js";
import { audienceProfileLabel, classifyDrawerTimelineItem, formatCompact, formatTime, personaSectionText, sortRuntimeLogs, statusLabel, type DrawerTimelineKind } from "./lib/format.js";
import { formatBytes, normalizeImageUrls, prepareImageForUpload } from "./lib/images.js";
import { parseRoute, pathForRoute } from "./lib/routes.js";
import { HistoryRoute } from "./routes/HistoryRoute.js";
import { SettingsRoute } from "./routes/SettingsRoute.js";
import type {
  AppRoute,
  AppToast,
  AudienceDirectiveCard,
  AudienceDraft,
  AudienceEditState,
  AudienceGenerationJob,
  AudienceLiveLogsState,
  AudienceSamplingState,
  BehaviorToast,
  CommentsState,
  ConfirmDialogState,
  CountDeltaBurst,
  LocalRunClockSnapshot,
  RuntimeLogsState,
  UiStatus
} from "./types.js";

type DirectiveDraftState = {
  name: string;
  description: string;
  quantity: string;
  diversityAxes: string[];
  axisInput: string;
  rationale: string;
};

function directiveDraftFromCard(directive: AudienceDirectiveCard): DirectiveDraftState {
  return {
    name: directive.name,
    description: directive.description,
    quantity: String(directive.quantity),
    diversityAxes: directive.diversityAxes,
    axisInput: "",
    rationale: directive.rationale
  };
}

function emptyDirectiveDraft(): DirectiveDraftState {
  return {
    name: "",
    description: "",
    quantity: "1",
    diversityAxes: [],
    axisInput: "",
    rationale: ""
  };
}

function splitDiversityAxes(value: string) {
  return value
    .split(/[\n,，、/；;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDiversityAxes(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function isAudiencePreparationUiStatus(status: UiStatus) {
  return ["planning_audience", "generating_audience", "audience_ready"].includes(status);
}

function directiveDisplayName(directive: Pick<AudienceDirectiveCard, "name">) {
  return directive.name?.trim() || i18n.t("audienceGen.directive.namePlaceholder");
}

function directiveReviewVisualState(directive: AudienceDirectiveCard) {
  const status = directive.generationStatus ?? directive.expansionStatus;
  const isComplete = directive.quantity > 0 && directive.identityReadyCount >= directive.quantity;
  const hasActiveProfiles = directive.profiles.some(
    (profile) => profile.identityStatus === "identity_queued" || profile.identityStatus === "identity_generating"
  );
  if (status === "failed" && directive.identityReadyCount <= 0) {
    return {
      cardClassName: "isFailed",
      label: i18n.t("audienceStatus.failed"),
      pillClassName: "isFailed",
      statusClassName: "isFailed"
    };
  }
  if (isComplete) {
    return {
      cardClassName: "isComplete",
      label: i18n.t("audienceStatus.ready"),
      pillClassName: "isComplete",
      statusClassName: "isComplete"
    };
  }
  if (directive.identityReadyCount > 0) {
    return {
      cardClassName: "isPartial",
      label: i18n.t("audienceStatus.partial"),
      pillClassName: "isPartial",
      statusClassName: "isPartial"
    };
  }
  if (status === "generating" || hasActiveProfiles) {
    return {
      cardClassName: "isGenerating",
      label: i18n.t("audienceStatus.generating"),
      pillClassName: "isGenerating",
      statusClassName: "isGenerating"
    };
  }
  return {
    cardClassName: "isPending",
    label: i18n.t("audienceStatus.pending"),
    pillClassName: "",
    statusClassName: ""
  };
}

function draftQuantityValue(value: string) {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : 0;
}

function emptyAudiencePlanPreview(targetCount: number): AudiencePlanPreview {
  return {
    planMarkdown: "",
    dimensions: [],
    directives: [],
    quantityTotal: 0,
    targetCount,
    completed: false,
    validationIssues: []
  };
}

type AudiencePlanPreviewDirective = AudiencePlanPreview["directives"][number];

function previewSkeletonDirectiveCount(targetCount: number) {
  if (targetCount <= 12) return 4;
  if (targetCount <= 30) return 5;
  return 6;
}

type AudiencePreparationUiPhase =
  | "idle"
  | "plan_requesting"
  | "plan_reasoning"
  | "plan_streaming"
  | "plan_ready"
  | "plan_failed"
  | "audience_generating"
  | "audience_ready";

type AudiencePreparationUiState = {
  runId: string | null;
  phase: AudiencePreparationUiPhase;
  planJobId: string | null;
  reasoningTokens: number;
  reasoningEstimated: boolean;
};

function emptyAudiencePreparationUiState(runId: string | null = null): AudiencePreparationUiState {
  return {
    runId,
    phase: "idle",
    planJobId: null,
    reasoningTokens: 0,
    reasoningEstimated: true
  };
}

function DiversityAxesEditor({
  axes,
  inputValue,
  onAxesChange,
  onInputChange
}: {
  axes: string[];
  inputValue: string;
  onAxesChange: (axes: string[]) => void;
  onInputChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  function addAxes(value = inputValue) {
    const additions = splitDiversityAxes(value);
    if (!additions.length) return;
    onAxesChange(normalizeDiversityAxes([...axes, ...additions]));
    onInputChange("");
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addAxes();
  }

  return (
    <div className="axisEditor">
      <div className="axisChipList" aria-label={t("audienceGen.directive.diversityAria")}>
        {axes.length ? axes.map((axis) => (
          <button key={axis} type="button" onClick={() => onAxesChange(axes.filter((item) => item !== axis))} aria-label={t("audienceGen.directive.diversityRemove", { axis })}>
            {axis}
            <X size={12} />
          </button>
        )) : <span className="emptyFieldPill">{t("audienceGen.directive.diversityEmpty")}</span>}
      </div>
      <div className="axisInputRow">
        <input aria-label={t("audienceGen.directive.diversityNew")} value={inputValue} onChange={(event) => onInputChange(event.target.value)} onKeyDown={handleKeyDown} placeholder={t("audienceGen.directive.diversityAddPlaceholder")} />
        <button className="ghostButton" type="button" onClick={() => addAxes()}>{t("audienceGen.directive.diversityAdd")}</button>
      </div>
    </div>
  );
}
function audienceAgentBackground(audience: AudienceDraft) {
  const persona = audience.identity?.personaJson ?? {};
  const profile = personaSectionText(persona.profile);
  return profile || i18n.t("audienceFact.profileEmpty");
}

function audienceDemographicsSummary(audience: AudienceDraft) {
  const demographics = audience.demographicsJson;
  const summary = [
    demographics.gender,
    demographics.ageRange,
    demographics.cityTier,
    demographics.lifeStage,
    demographics.role,
    demographics.spendingPower
  ]
    .map((item) => item.trim())
    .filter((item) => item && item !== i18n.t("audienceFact.unlimited"))
    .slice(0, 5)
    .join(" · ");
  return summary || i18n.t("audienceFact.sampleEmpty");
}

function compactAudienceFacts(parts: Array<string | undefined>) {
  return parts
    .map((item) => item?.trim() ?? "")
    .filter((item) => item && item !== i18n.t("audienceFact.unlimited"))
    .join(" · ");
}

function labeledFact(label: string, value?: string) {
  const text = value?.trim();
  if (!text || text === i18n.t("audienceFact.unlimited")) return "";
  return `${label}${i18n.t("common.labelSeparator")}${text}`;
}

function audienceSlotPrimaryFacts(audience: AudienceDraft) {
  const demographics = audience.demographicsJson;
  return compactAudienceFacts([
    demographics.role,
    demographics.lifeStage,
    demographics.gender
  ]);
}

function audienceSlotSecondaryFacts(audience: AudienceDraft) {
  const demographics = audience.demographicsJson;
  return compactAudienceFacts([
    demographics.ageRange,
    demographics.cityTier,
    labeledFact(i18n.t("audienceFact.consumption"), demographics.spendingPower)
  ]);
}

function audiencePersonaMeta(audience: AudienceDraft) {
  const persona = audience.identity?.personaJson ?? {};
  const demographics = audience.demographicsJson;
  return compactAudienceFacts([
    audience.samplingLabel,
    personaSectionText(persona.mbtiType),
    demographics.role,
    demographics.lifeStage
  ]);
}

function audienceProfileBrief(audience: AudienceDraft) {
  return audienceDemographicsSummary(audience);
}

function audienceIdentityDisplayName(audience: AudienceDraft) {
  return audience.identity?.user?.nickname?.trim() || audience.samplingLabel.trim() || i18n.t("audience.unnamed");
}

function audienceIdentityStatusLabel(status: AudienceDraft["identityStatus"]) {
  if (status === "identity_ready") return i18n.t("status.identity.ready");
  if (status === "identity_failed") return i18n.t("status.identity.failed");
  if (status === "identity_generating") return i18n.t("status.identity.generating");
  if (status === "identity_queued") return i18n.t("status.identity.queued");
  return i18n.t("status.identity.pending");
}

function assistantMessageId(stage: AssistantStage, role: "user" | "assistant") {
  return `${stage}_${role}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function initialOperationStates(proposal: AudienceSamplingPlanRevisionProposal | AudienceSeatRevisionProposal) {
  return Object.fromEntries(proposal.operations.map((operation) => [
    operation.operationId,
    { status: "idle" as const }
  ]));
}

function planMessagesForRequest(messages: AssistantDialogMessage[]): AudienceSamplingPlanRevisionMessage[] {
  return messages.map((message) => ({
    role: message.role,
    visibleText: message.visibleText,
    hiddenMentionContexts: message.mentions
      .filter((mention) => mention.kind === "directive")
      .map((mention) => ({
        directiveId: mention.refId,
        label: mention.label,
        context: mention.context
      })),
    ...(message.proposal ? { proposal: message.proposal as AudienceSamplingPlanRevisionProposal } : {})
  }));
}

function PlanMarkdown({ children }: { children: string }) {
  const { t } = useTranslation();
  return (
    <div className="planMarkdownContent">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ node: _node, ...props }) {
            return <a {...props} rel="noreferrer" target="_blank" />;
          },
          img() {
            return <span className="planMarkdownImagePlaceholder">{t("venue.post.imageHidden")}</span>;
          },
          table({ node: _node, ...props }) {
            return (
              <div className="planMarkdownTableScroll">
                <table {...props} />
              </div>
            );
          }
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function seatMessagesForRequest(messages: AssistantDialogMessage[]): AudienceSeatRevisionMessage[] {
  return messages.map((message) => ({
    role: message.role,
    visibleText: message.visibleText,
    hiddenMentionContexts: message.mentions.map((mention) => mention.kind === "directive"
      ? {
          kind: "directive" as const,
          directiveId: mention.refId,
          label: mention.label,
          context: mention.context
        }
      : {
          kind: "profile" as const,
          profileId: mention.refId,
          label: mention.label,
          context: mention.context
        }),
    ...(message.proposal ? { proposal: message.proposal as AudienceSeatRevisionProposal } : {})
  }));
}

function directiveMentionContext(directive: AudienceDirectiveCard) {
  return {
    directive: {
      id: directive.id,
      sortOrder: directive.sortOrder,
      name: directive.name,
      description: directive.description,
      quantity: directive.quantity,
      diversityAxes: directive.diversityAxes,
      rationale: directive.rationale,
      expansionStatus: directive.expansionStatus,
      expansionError: directive.expansionError
    },
    counts: {
      target: directive.quantity,
      profileCreated: directive.profileCreatedCount,
      identityReady: directive.identityReadyCount,
      identityFailed: directive.identityFailedCount,
      missing: Math.max(0, directive.quantity - directive.identityReadyCount)
    },
    profiles: directive.profiles.map(profileMentionContext)
  };
}

function profileMentionContext(audience: AudienceDraft) {
  return {
    profileId: audience.id,
    samplingLabel: audience.samplingLabel,
    identityStatus: audience.identityStatus,
    displayName: audience.identity?.user?.nickname || audience.samplingLabel,
    sampleIndex: audience.sampleIndex,
    identityError: audience.identityError ?? null,
    user: audience.identity?.user ?? null,
    agent: audience.identity?.agent ?? null,
    platformAccount: audience.identity?.platformAccount ?? null,
    personaJson: audience.identity?.personaJson ?? null,
    favorited: audience.identity?.favorited ?? audience.identity?.saved ?? false
  };
}

/**
 * Compile-time exhaustiveness check for LiveEventType. If a new event type is
 * added to the shared package, TypeScript will error on the `default` branch,
 * prompting the developer to add a handler in `handleLiveEvent` or explicitly
 * acknowledge it as a no-op here.
 */
function assertLiveEventTypeExhaustive(type: LiveEventType): void {
  switch (type) {
    // --- Types handled in handleLiveEvent ---
    case "post_state.updated":
    case "comments.page_loaded":
    case "comment.created":
    case "comment.updated":
    case "action_log.created":
    case "summary.updated":
    case "insight.created":
    case "audience.status_updated":
    case "audience.action_happened":
    case "audience.generation.job.started":
    case "audience.generation.job.completed":
    case "audience.generation.job.failed":
    case "audience.generation.job.canceled":
    case "audience.plan.started":
    case "audience.plan.progress":
    case "audience.plan.frame":
    case "audience.plan.ready":
    case "audience.plan.updated":
    case "audience.plan.confirmed":
    case "audience.plan.failed":
    case "audience.profile.expansion.started":
    case "audience.profile.expansion.ready":
    case "audience.profile.created":
    case "audience.identity.started":
    case "audience.identity.ready":
    case "audience.identity.failed":
    case "audience.updated":
    case "run.clock.updated":
    case "run.started":
    case "run.pausing":
    case "run.paused":
    case "run.resumed":
    case "run.completed":
    case "run_log.created":
    case "report.regenerated":
    // --- Known but intentionally not handled in the UI ---
    case "audience.plan.reasoning.delta":
    case "audience.profile.expansion.directive_started":
    case "audience.profile.expansion.directive_ready":
    case "audience.profile.expansion.directive_failed":
      return;
    default:
      const _exhaustive: never = type;
      throw new Error(`Unhandled live event type: ${_exhaustive}`);
  }
}

export function App() {
  const { t } = useTranslation();
  const [route, setRoute] = useState<AppRoute>(() => parseRoute());
  const navigationGuard = useNavigationGuard();
  const currentPathRef = useRef(window.location.pathname);
  const isNavigatingRef = useRef(false);
  // Derived from run, sampling plan, and job state; do not treat as raw test_runs.status.
  const [uiStatus, setUiStatus] = useState<UiStatus>(route.kind === "workbench" ? (route.runId ? "restoring" : "draft") : route.kind === "report" ? "completed" : "draft");
  const {
    title, setTitle,
    bodyText, setBodyText,
    scale, setScale,
    customAudienceCount, setCustomAudienceCount,
    imageUrls, setImageUrls,
    currentCreateDraft,
    clearDraft: clearCreateDraft,
    reloadFromStorage: reloadCreateDraftFromStorage,
    overrideFromContentVersion,
    setActive: setCreateDraftActive
  } = useCreateDraft({ route, uiStatus });
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [runId, setRunId] = useState(route.kind === "workbench" || route.kind === "report" ? (route.runId ?? "") : "");
  const [, setConnectionStatus] = useState<ConnectionStatus>("idle");
  const [postState, setPostState] = useState<PostStateView>(emptyPostState);
  const [summary, setSummary] = useState<LiveSummary>(emptySummary);
  const [commentsState, setCommentsState] = useState<CommentsState>({
    runId: route.kind === "workbench" || route.kind === "report" ? (route.runId ?? null) : null,
    items: [],
    cursor: null,
    hasMore: false,
    sort: "latest",
    loading: false
  });
  const [, setInsights] = useState<InsightItem[]>([]);
  const [report, setReport] = useState<ReportView | null>(null);
  const [isRegeneratingReport, setIsRegeneratingReport] = useState(false);
  const [error, setError] = useState("");
  const [restoredRunId, setRestoredRunId] = useState<string | null>(null);
  const [liveLogsByAudience, setLiveLogsByAudience] = useState<AudienceLiveLogsState>({
    runId: route.kind === "workbench" || route.kind === "report" ? (route.runId ?? null) : null,
    byParticipant: {}
  });
  const [runtimeLogsState, setRuntimeLogsState] = useState<RuntimeLogsState>({
    runId: route.kind === "workbench" || route.kind === "report" ? (route.runId ?? null) : null,
    items: [],
    cursor: null,
    hasMore: false,
    loading: false
  });
  const [runClock, setRunClock] = useState<LocalRunClockSnapshot | null>(null);
  const [runtimeSnapshotReady, setRuntimeSnapshotReady] = useState(!runId);
  const [hasRuntimeData, setHasRuntimeData] = useState(false);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [rightPanelView, setRightPanelView] = useState<"audience" | "logs">("audience");
  const [commentDraft, setCommentDraft] = useState("");
  const [audienceDrafts, setAudienceDrafts] = useState<AudienceDraft[]>([]);
  const [audienceSampling, setAudienceSampling] = useState<AudienceSamplingState>({
    runId: route.kind === "workbench" || route.kind === "report" ? (route.runId ?? null) : null,
    plan: null,
    progress: null
  });
  const [audiencePlanPreview, setAudiencePlanPreview] = useState<AudiencePlanPreview | null>(null);
  const [audiencePlanFailureMessage, setAudiencePlanFailureMessage] = useState("");
  const [audiencePreparationUi, setAudiencePreparationUi] = useState<AudiencePreparationUiState>(() =>
    emptyAudiencePreparationUiState(route.kind === "workbench" || route.kind === "report" ? (route.runId ?? null) : null)
  );
  const audiencePreparationUiRef = useRef(audiencePreparationUi);
  const [activeGenerationJob, setActiveGenerationJob] = useState<AudienceGenerationJob | null>(null);
  const [audienceEdit, setAudienceEdit] = useState<AudienceEditState | null>(null);
  const [editingDirectiveId, setEditingDirectiveId] = useState<string | null>(null);
  const [directiveDrafts, setDirectiveDrafts] = useState<Record<string, DirectiveDraftState>>({});
  const [directiveMutationKey, setDirectiveMutationKey] = useState<string | null>(null);
  const [assistantDialogStage, setAssistantDialogStage] = useState<AssistantStage | null>(null);
  const [planAssistantMessages, setPlanAssistantMessages] = useState<AssistantDialogMessage[]>([]);
  const [seatAssistantMessages, setSeatAssistantMessages] = useState<AssistantDialogMessage[]>([]);
  const [assistantSendingStage, setAssistantSendingStage] = useState<AssistantStage | null>(null);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [consoleFilter, setConsoleFilter] = useState("all");
  const [audienceSeats, setAudienceSeats] = useState<AudienceSeat[]>([]);
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);
  const [audienceDetail, setAudienceDetail] = useState<AudienceDetail | null>(null);
  const [appToast, setAppToast] = useState<AppToast | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [behaviorToasts, setBehaviorToasts] = useState<BehaviorToast[]>([]);
  const [enteringCommentIds, setEnteringCommentIds] = useState<string[]>([]);
  const [commentBurst, setCommentBurst] = useState<CountDeltaBurst | null>(null);
  const [postActionPulses, setPostActionPulses] = useState<Record<string, number>>({});
  const [pulsingCommentLikeIds, setPulsingCommentLikeIds] = useState<string[]>([]);
  const [seatFilter, setSeatFilter] = useState("all");
  const [audienceTooltipPlacements, setAudienceTooltipPlacements] = useState<Record<string, "above" | "below">>({});
  const seenEventIds = useRef(new Set<string>());
  const appToastCounter = useRef(0);
  const toastCounter = useRef(0);
  const commentBurstCounter = useRef(0);
  const commentBurstPending = useRef(0);
  const postActionPulseCounter = useRef(0);
  const animatedCommentIds = useRef(new Set<string>());
  const commentEntryClearTimer = useRef<number | null>(null);
  const commentBurstMergeTimer = useRef<number | null>(null);
  const commentBurstClearTimer = useRef<number | null>(null);
  const postActionPulseTimers = useRef(new Map<string, number>());
  const commentLikePulseTimers = useRef(new Map<string, number>());
  const activeRunIdRef = useRef(runId);
  const directiveCardRefs = useRef(new Map<string, HTMLElement>());
  const restoreRequestSeq = useRef(0);
  const commentRequestSeq = useRef(0);
  const runtimeLogRequestSeq = useRef(0);
  const latestLiveEventSequenceRef = useRef<string | null>(null);
  const audienceRevisionRef = useRef<number | null>(null);
  const uiStatusRef = useRef(uiStatus);
  // Keep uiStatusRef in sync during render (not in a useEffect) so that
  // effects reading uiStatusRef.current always see the latest value without
  // depending on uiStatus in their dependency arrays.
  uiStatusRef.current = uiStatus;

  const coverImageUrl = imageUrls[0] ?? "";
  const activeImageUrl = imageUrls[selectedImageIndex] ?? coverImageUrl;
  const selectedAudienceCount = scale === "quick" ? 12 : scale === "standard" ? 30 : customAudienceCount;
  const canSubmit = title.trim().length >= 2 && bodyText.trim().length >= 20 && Boolean(coverImageUrl);
  const routeRunId = route.kind === "workbench" || route.kind === "report" ? (route.runId ?? "") : "";
  const visibleRunId = routeRunId || runId;
  const isWorkbenchRunRestoring = route.kind === "workbench" && Boolean(route.runId) && restoredRunId !== route.runId;
  const comments = commentsState.runId === runId ? commentsState.items : [];
  const commentSort = commentsState.runId === runId ? commentsState.sort : "latest";
  const commentSortRef = useRef(commentSort);
  useEffect(() => { commentSortRef.current = commentSort; }, [commentSort]);
  const commentCursor = commentsState.runId === runId ? commentsState.cursor : null;
  const hasMoreCommentPages = commentsState.runId === runId ? commentsState.hasMore : false;
  const isLoadingComments = commentsState.runId === runId && commentsState.loading;
  const runtimeLogs = runtimeLogsState.runId === runId ? runtimeLogsState.items : [];
  const runtimeLogCursor = runtimeLogsState.runId === runId ? runtimeLogsState.cursor : null;
  const hasMoreRuntimeLogs = runtimeLogsState.runId === runId && runtimeLogsState.hasMore;
  const isLoadingRuntimeLogs = runtimeLogsState.runId === runId && runtimeLogsState.loading;
  const currentLiveLogsByAudience = liveLogsByAudience.runId === runId ? liveLogsByAudience.byParticipant : {};
  const imageSortSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function emptyCommentsStateFor(targetRunId: string, sort: "latest" | "hot" = "latest"): CommentsState {
    return { runId: targetRunId, items: [], cursor: null, hasMore: false, sort, loading: false };
  }

  function setCommentSort(nextSort: "latest" | "hot") {
    if (!runId) return;
    setCommentsState((current) => {
      const base = current.runId === runId ? current : emptyCommentsStateFor(runId, nextSort);
      return { ...base, sort: nextSort };
    });
  }

  function markNewCommentEntries(ids: string[]) {
    const uniqueIds = [...new Set(ids.filter((id) => id && !animatedCommentIds.current.has(id)))];
    if (!uniqueIds.length) return;
    uniqueIds.forEach((id) => animatedCommentIds.current.add(id));
    setEnteringCommentIds((current) => [...new Set([...current, ...uniqueIds])].slice(-6));
    commentBurstPending.current += uniqueIds.length;
    if (commentEntryClearTimer.current) window.clearTimeout(commentEntryClearTimer.current);
    if (commentBurstMergeTimer.current) window.clearTimeout(commentBurstMergeTimer.current);
    if (commentBurstClearTimer.current) window.clearTimeout(commentBurstClearTimer.current);
    commentEntryClearTimer.current = window.setTimeout(() => setEnteringCommentIds([]), 1100);
    commentBurstMergeTimer.current = window.setTimeout(() => {
      const delta = commentBurstPending.current;
      commentBurstPending.current = 0;
      if (delta <= 0) return;
      commentBurstCounter.current += 1;
      setCommentBurst({ delta: Math.min(99, delta), nonce: commentBurstCounter.current });
      commentBurstClearTimer.current = window.setTimeout(() => setCommentBurst(null), 1400);
    }, 220);
  }

  function postActionPulseKey(action: AudienceActionHappenedPayload["action"]) {
    if (action === "like_post") return "like";
    if (action === "favorite_post") return "favorite";
    if (action === "share_post") return "share";
    if (action === "write_comment" || action === "like_comment") return "comment";
    return null;
  }

  function pulsePostAction(action: AudienceActionHappenedPayload["action"]) {
    const key = postActionPulseKey(action);
    if (!key) return;
    postActionPulseCounter.current += 1;
    setPostActionPulses((current) => ({ ...current, [key]: postActionPulseCounter.current }));
    const existingTimer = postActionPulseTimers.current.get(key);
    if (existingTimer) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      postActionPulseTimers.current.delete(key);
      setPostActionPulses((current) => {
        const { [key]: _removed, ...rest } = current;
        return rest;
      });
    }, 760);
    postActionPulseTimers.current.set(key, timer);
  }

  function pulseCommentLike(commentId: string) {
    if (!commentId) return;
    setPulsingCommentLikeIds((current) => [...new Set([...current, commentId])].slice(-12));
    const existingTimer = commentLikePulseTimers.current.get(commentId);
    if (existingTimer) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      commentLikePulseTimers.current.delete(commentId);
      setPulsingCommentLikeIds((current) => current.filter((id) => id !== commentId));
    }, 760);
    commentLikePulseTimers.current.set(commentId, timer);
  }

  function commitAudiencePreparationUi(next: AudiencePreparationUiState | ((current: AudiencePreparationUiState) => AudiencePreparationUiState)) {
    const resolved = typeof next === "function" ? next(audiencePreparationUiRef.current) : next;
    audiencePreparationUiRef.current = resolved;
    setAudiencePreparationUi(resolved);
  }

  function resetAudiencePreparationUi(targetRunId: string | null) {
    commitAudiencePreparationUi(emptyAudiencePreparationUiState(targetRunId));
  }

  /** Reset all runtime UI state to empty defaults. Call this before setting a new phase. */
  function clearRuntimeUIState(targetRunId: string | null) {
    setReport(null);
    setPostState(emptyPostState);
    setSummary(emptySummary);
    setRunClock(null);
    setError("");
    setActiveGenerationJob(null);
    setAudiencePlanPreview(null);
    setAudiencePlanFailureMessage("");
    setRuntimeLogsState({ runId: targetRunId, items: [], cursor: null, hasMore: false, loading: false });
    setCommentsState({ runId: targetRunId, items: [], cursor: null, hasMore: false, sort: "latest", loading: false });
    setLiveLogsByAudience({ runId: targetRunId, byParticipant: {} });
    setAudienceSeats([]);
    setSelectedParticipantId(null);
    setAudienceDetail(null);
    setBehaviorToasts([]);
    setPostActionPulses({});
    setPulsingCommentLikeIds([]);
    setHasRuntimeData(false);
    setRuntimeSnapshotReady(!targetRunId);
    latestLiveEventSequenceRef.current = null;
    audienceRevisionRef.current = null;
    seenEventIds.current.clear();
    postActionPulseTimers.current.forEach((timer) => window.clearTimeout(timer));
    postActionPulseTimers.current.clear();
    commentLikePulseTimers.current.forEach((timer) => window.clearTimeout(timer));
    commentLikePulseTimers.current.clear();
  }

  function beginPlanGenerationUi(targetRunId: string, targetCount: number) {
    commitAudiencePreparationUi({
      runId: targetRunId,
      phase: "plan_requesting",
      planJobId: null,
      reasoningTokens: 0,
      reasoningEstimated: true
    });
    setUiStatus("planning_audience");
    setAudienceSampling({ runId: targetRunId, plan: null, progress: null });
    setAudienceDrafts([]);
    setAudiencePlanPreview(emptyAudiencePlanPreview(targetCount));
    setAudiencePlanFailureMessage("");
    setEditingDirectiveId(null);
    setDirectiveDrafts({});
  }

  function bindPlanGenerationJob(targetRunId: string, job: AudienceGenerationJob | null) {
    if (job?.scope === "sampling_plan") {
      commitAudiencePreparationUi((current) => ({
        runId: targetRunId,
        phase: current.phase === "plan_streaming" ? "plan_streaming" : "plan_reasoning",
        planJobId: job.id,
        reasoningTokens: current.runId === targetRunId ? current.reasoningTokens : 0,
        reasoningEstimated: current.runId === targetRunId ? current.reasoningEstimated : true
      }));
      if (!audiencePlanPreview) setAudiencePlanPreview(emptyAudiencePlanPreview(job.targetCount));
      return;
    }
    if (job) {
      commitAudiencePreparationUi({
        runId: targetRunId,
        phase: "audience_generating",
        planJobId: null,
        reasoningTokens: 0,
        reasoningEstimated: true
      });
    }
  }

  function isCurrentPlanGenerationJob(eventJobId: string | null) {
    const state = audiencePreparationUiRef.current;
    return Boolean(eventJobId && state.planJobId === eventJobId && state.phase !== "idle");
  }

  useEffect(() => {
    const handlePopState = async () => {
      if (navigationGuard.isDirty()) {
        const ok = await navigationGuard.confirmLeave();
        if (!ok) {
          // 用户取消，pushState 回原路径（用 ref，不是 location.pathname）
          window.history.pushState(null, "", currentPathRef.current);
          return;
        }
      }
      currentPathRef.current = window.location.pathname;
      setRoute(parseRoute());
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [navigationGuard]);

  useEffect(() => {
    return () => {
      if (commentEntryClearTimer.current) window.clearTimeout(commentEntryClearTimer.current);
      if (commentBurstMergeTimer.current) window.clearTimeout(commentBurstMergeTimer.current);
      if (commentBurstClearTimer.current) window.clearTimeout(commentBurstClearTimer.current);
      postActionPulseTimers.current.forEach((timer) => window.clearTimeout(timer));
      commentLikePulseTimers.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    setSelectedImageIndex((current) => {
      if (imageUrls.length === 0) return 0;
      return Math.min(current, imageUrls.length - 1);
    });
  }, [imageUrls.length]);

  useEffect(() => {
    if (!runClock?.clockAnchorAt) return;
    const timer = window.setInterval(() => setClockTick(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [runClock?.clockAnchorAt]);

  useEffect(() => {
    if (route.kind === "settings" || route.kind === "history" || route.kind === "not_found") {
      activeRunIdRef.current = "";
      restoreRequestSeq.current += 1;
      setRestoredRunId(null);
      clearRuntimeUIState(null);
      resetAudiencePreparationUi(null);
      setUiStatus("draft");
      return;
    }
    if (!route.runId) {
      setCreateDraftActive(true);
      activeRunIdRef.current = "";
      restoreRequestSeq.current += 1;
      setRestoredRunId(null);
      setRunId("");
      reloadCreateDraftFromStorage();
      setSelectedImageIndex(0);
      clearRuntimeUIState(null);
      setAudienceSeats([]);
      setAudienceDrafts([]);
      setAudienceSampling({ runId: null, plan: null, progress: null });
      resetAudiencePreparationUi(null);
      setUiStatus("draft");
      return;
    }
    setCreateDraftActive(false);
    if (route.kind === "workbench" && route.runId === runId && restoredRunId === route.runId) return;
    seenEventIds.current.clear();
    latestLiveEventSequenceRef.current = null;
    audienceRevisionRef.current = null;
    if (route.runId !== runId) {
      commentRequestSeq.current += 1;
      runtimeLogRequestSeq.current += 1;
    }
    setRuntimeSnapshotReady(false);
    activeRunIdRef.current = route.runId;
    const restoreSeq = ++restoreRequestSeq.current;
    setRestoredRunId(null);
    setRunId(route.runId);
    if (route.kind === "report") {
      setUiStatus("report_generating");
      void refreshSnapshots(route.runId, { strict: false });
      void loadReport(route.runId);
      return;
    }
    setReport(null);
    setUiStatus("restoring");
    void restoreRun(route.runId, restoreSeq);
  }, [route]);

  useLiveEvents({
    runId,
    routeKind: route.kind,
    restoredRunId,
    uiStatusRef,
    latestLiveEventSequenceRef,
    onEvent: handleLiveEvent,
    onConnectionStatusChange: setConnectionStatus,
    onMalformed: () => showAppError(t("audienceGen.toast.sseError"))
  });

  useEffect(() => {
    activeRunIdRef.current = runId;
  }, [runId]);

  useEffect(() => {
    setAssistantDialogStage(null);
    setPlanAssistantMessages([]);
    setSeatAssistantMessages([]);
    setAssistantSendingStage(null);
  }, [runId]);

  useEffect(() => {
    if (behaviorToasts.length === 0) return;
    const timer = setTimeout(() => setBehaviorToasts((items) => items.slice(1)), 2200);
    return () => clearTimeout(timer);
  }, [behaviorToasts]);

  useEffect(() => {
    if (!appToast) return;
    const timer = window.setTimeout(() => setAppToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [appToast]);

  useEffect(() => {
    if (!isImageViewerOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsImageViewerOpen(false);
      if (event.key === "ArrowLeft") shiftSelectedImage(-1);
      if (event.key === "ArrowRight") shiftSelectedImage(1);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isImageViewerOpen, imageUrls.length]);

  const samplingPlan = audienceSampling.runId === visibleRunId ? audienceSampling.plan : null;
  const audienceProgress = audienceSampling.runId === visibleRunId ? audienceSampling.progress : null;
  const plannedAudienceCount = audienceProgress?.total ?? samplingPlan?.totalCount ?? 0;
  const identityReadyCount = audienceProgress?.identityReadyCount ?? 0;
  const missingIdentityCount = Math.max(0, plannedAudienceCount - identityReadyCount);
  const totalAudience = Math.max(summary.audienceTotal, audienceSeats.length, audienceDrafts.length, plannedAudienceCount);
  const isAudienceStage = isAudiencePreparationUiStatus(uiStatus);

  // 注册全局导航守卫：根据当前 route 判断 dirty 条件
  const navigationGuardResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const navigationGuardConfirmedRef = useRef(false);
  useEffect(() => {
    const isDirty = () => {
      if (route.kind === "workbench" && route.runId && isAudienceStage) {
        // 观众生成页：编辑态
        return Boolean(editingDirectiveId);
      }
      return false;
    };
    const confirm = () => new Promise<boolean>((resolve) => {
      navigationGuardResolveRef.current = resolve;
      navigationGuardConfirmedRef.current = false;
      setConfirmDialog({
        title: t("guard.leaveTitle"),
        body: t("guard.leaveBody"),
        confirmLabel: t("guard.leaveConfirm"),
        cancelLabel: t("guard.leaveCancel"),
        tone: "danger",
        onConfirm: () => {
          navigationGuardConfirmedRef.current = true;
          resolve(true);
        }
      });
    });
    const unregister = navigationGuard.register({ isDirty, confirm });
    return unregister;
  }, [route, editingDirectiveId, isAudienceStage, navigationGuard]);

  const isAudienceGenerationActive = Boolean(activeGenerationJob?.active && ["queued", "planning", "generating"].includes(activeGenerationJob.status));
  const isPlanGenerationActive = isAudienceGenerationActive && activeGenerationJob?.scope === "sampling_plan";
  const hasFailedAudiencePlanPreview = uiStatus === "planning_audience" && !samplingPlan && Boolean(audiencePlanFailureMessage);
  const isSamplingPlanPending = uiStatus === "planning_audience" && !samplingPlan && !hasFailedAudiencePlanPreview;
  const currentAudiencePreparationUi = audiencePreparationUi.runId === visibleRunId ? audiencePreparationUi : emptyAudiencePreparationUiState(visibleRunId || null);
  const isPlanReasoningActive = currentAudiencePreparationUi.phase === "plan_requesting" || currentAudiencePreparationUi.phase === "plan_reasoning";
  const planReasoningTokenLabel = currentAudiencePreparationUi.reasoningTokens > 0
    ? t("audienceGen.reasoning.thinkingTokens", { prefix: currentAudiencePreparationUi.reasoningEstimated ? "~" : "", count: currentAudiencePreparationUi.reasoningTokens })
    : t("audienceGen.reasoning.thinking");
  const planGenerationActionLabel = isPlanReasoningActive ? planReasoningTokenLabel : isPlanGenerationActive ? t("audienceGen.reasoning.planning") : t("audienceGen.reasoning.replan");
  const readyAudienceCount = audienceDrafts.filter((audience) => audience.identityStatus === "identity_ready").length;
  const eventDerivedSimulatedTime = Math.max(
    ...audienceSeats.map((seat) => seat.lastUpdatedSimulatedTime ?? 0),
    ...comments.map((comment) => comment.simulatedTime ?? 0),
    postState.openCount * 4,
    0
  );
  const currentSimulatedTime = runClock
    ? Math.floor((runClock.clockElapsedMs + (runClock.clockAnchorAt ? Math.max(0, clockTick - runClock.receivedAtMs) * runClock.clockScale : 0)) / 1000)
    : eventDerivedSimulatedTime;
  const postComments = useMemo(
    () => sortPostComments(comments, commentSort),
    [commentSort, comments]
  );
  const hasMoreComments = hasMoreCommentPages;

  const activeCount = useMemo(
    () => audienceSeats.filter((seat) => !["not_started", "finished", "failed", "skipped", "risk_exit"].includes(seat.status)).length,
    [audienceSeats]
  );

  function isAudienceLockedByJob(audience: AudienceDraft) {
    if (isPlanGenerationActive) return true;
    if (audience.identityStatus === "identity_queued" || audience.identityStatus === "identity_generating") return true;
    return false;
  }

  const audienceDirectiveCards = useMemo<AudienceDirectiveCard[]>(() => {
    if (!samplingPlan) return [];
    const progressByDirective = new Map((audienceProgress?.directives ?? []).map((directive) => [directive.directiveId, directive]));
    const profilesByDirective = new Map<string, AudienceDraft[]>();
    for (const audience of audienceDrafts) {
      const key = audience.samplingDirectiveId ?? "";
      profilesByDirective.set(key, [...(profilesByDirective.get(key) ?? []), audience]);
    }
    return samplingPlan.directives.map((directive) => {
      const progress = progressByDirective.get(directive.id);
      return {
        ...directive,
        profileCreatedCount: progress?.profileCreatedCount ?? 0,
        identityReadyCount: progress?.identityReadyCount ?? 0,
        identityFailedCount: progress?.identityFailedCount ?? 0,
        generationStatus: progress?.generationStatus ?? null,
        generationError: progress?.generationError ?? null,
        profiles: (profilesByDirective.get(directive.id) ?? []).sort(sortAudienceDrafts)
      };
    });
  }, [audienceDrafts, audienceProgress, samplingPlan]);
  const canEditSamplingPlan = Boolean(samplingPlan && !samplingPlan.confirmedAt && !isAudienceGenerationActive);
  const savedPlanQuantityTotal = audienceDirectiveCards.reduce((total, directive) => total + directive.quantity, 0);
  const savedPlanIdentityReadyTotal = audienceDirectiveCards.reduce((total, directive) => total + directive.identityReadyCount, 0);
  const draftPlanQuantityTotal = useMemo(() => {
    return audienceDirectiveCards.reduce((total, directive) => {
      const draft = editingDirectiveId === directive.id ? directiveDrafts[directive.id] : null;
      return total + (draft ? draftQuantityValue(draft.quantity) : directive.quantity);
    }, 0);
  }, [audienceDirectiveCards, directiveDrafts, editingDirectiveId]);
  const hasUnsavedDirectiveDraft = Boolean(editingDirectiveId);
  const planQuantityTotal = hasUnsavedDirectiveDraft ? draftPlanQuantityTotal : savedPlanQuantityTotal;
  const planExpectedTotal = samplingPlan?.validation.expectedTotal ?? samplingPlan?.totalCount ?? 0;
  const planIdentityReadyTotal = audienceProgress?.identityReadyCount ?? savedPlanIdentityReadyTotal;
  const planQuantityDelta = planQuantityTotal - planExpectedTotal;
  const planQuantityDeltaNote = planQuantityDelta === 0 ? "" : planQuantityDelta > 0 ? t("audienceGen.quantityDelta.more", { count: planQuantityDelta }) : t("audienceGen.quantityDelta.less", { count: Math.abs(planQuantityDelta) });
  const planReviewStatusNotes = [
    hasUnsavedDirectiveDraft ? (planQuantityDeltaNote ? t("audienceGen.quantityDelta.unsavedWithDelta", { delta: planQuantityDeltaNote }) : t("audienceGen.quantityDelta.unsaved")) : planQuantityDeltaNote
  ].filter(Boolean);
  const isPlanReviewMode = Boolean(samplingPlan && !samplingPlan.confirmedAt);
  const showConfirmPlanAction = Boolean(samplingPlan && !samplingPlan.confirmedAt);
  const showIdentityRecoveryAction = Boolean((samplingPlan?.confirmedAt || uiStatus === "audience_ready") && (audienceProgress?.identityFailedCount ?? 0) > 0);
  const showStartAction = ["generating_audience", "audience_ready"].includes(uiStatus) && Boolean(samplingPlan?.confirmedAt || uiStatus === "audience_ready");
  const showClearAudienceAction = Boolean(samplingPlan?.confirmedAt && ["generating_audience", "audience_ready"].includes(uiStatus));
  const showPlanAssistantAction = Boolean(canEditSamplingPlan && samplingPlan?.status === "ready_for_review");
  const showSeatAssistantAction = Boolean(["generating_audience", "audience_ready"].includes(uiStatus) && samplingPlan?.confirmedAt && !audienceSeats.length);
  const planMentionCandidates = useMemo<AssistantMentionCandidate[]>(() => audienceDirectiveCards.map((directive) => {
    const label = directiveDisplayName(directive);
    return {
      id: `directive:${directive.id}`,
      refId: directive.id,
      kind: "directive",
      label,
      detail: `${directive.quantity} ${t("audienceGen.directive.people")} · ${directive.description}`,
      searchText: `${label} ${directive.description} ${directive.diversityAxes.join(" ")} ${directive.rationale}`,
      context: directiveMentionContext(directive)
    };
  }), [audienceDirectiveCards]);
  const seatMentionCandidates = useMemo<AssistantMentionCandidate[]>(() => {
    const directiveCandidates = audienceDirectiveCards.map((directive) => {
      const label = directiveDisplayName(directive);
      return {
        id: `directive:${directive.id}`,
        refId: directive.id,
        kind: "directive" as const,
        label,
        detail: `${directive.identityReadyCount}/${directive.quantity} ${t("status.identity.ready")} · ${directive.description}`,
        searchText: `${label} ${directive.description} ${directive.diversityAxes.join(" ")} ${directive.rationale}`,
        context: directiveMentionContext(directive)
      };
    });
    const profileCandidates = audienceDirectiveCards.flatMap((directive) => directive.profiles.map((audience) => {
      const label = audienceProfileLabel(audience);
      return {
        id: `profile:${audience.id}`,
        refId: audience.id,
        kind: "profile" as const,
        label,
        detail: `${directiveDisplayName(directive)} · ${audienceIdentityStatusLabel(audience.identityStatus)}`,
        searchText: `${label} ${audience.samplingLabel} ${audienceAgentBackground(audience)}`,
        context: profileMentionContext(audience)
      };
    }));
    return [...directiveCandidates, ...profileCandidates];
  }, [audienceDirectiveCards]);
  const planAssistantTargetLabels = useMemo(() => Object.fromEntries(
    audienceDirectiveCards.map((directive) => [directive.id, directiveDisplayName(directive)])
  ), [audienceDirectiveCards]);
  const seatAssistantTargetLabels = useMemo(() => Object.fromEntries([
    ...audienceDirectiveCards.map((directive) => [directive.id, directiveDisplayName(directive)]),
    ...audienceDirectiveCards.flatMap((directive) => directive.profiles.map((audience) => [audience.id, audienceProfileLabel(audience)]))
  ]), [audienceDirectiveCards]);

  useEffect(() => {
    if (!runId || !isAudienceStage || !isAudienceGenerationActive || route.kind === "report") return;
    const timer = window.setInterval(() => void loadAudienceState(runId), 1000);
    return () => window.clearInterval(timer);
  }, [runId, isAudienceStage, isAudienceGenerationActive, route.kind]);

  useEffect(() => {
    setDirectiveDrafts(Object.fromEntries(audienceDirectiveCards.map((directive) => [directive.id, directiveDraftFromCard(directive)])));
  }, [audienceDirectiveCards]);

  useEffect(() => {
    if (editingDirectiveId && !audienceDirectiveCards.some((directive) => directive.id === editingDirectiveId)) {
      setEditingDirectiveId(null);
    }
  }, [audienceDirectiveCards, editingDirectiveId]);

  function setDirectiveCardRef(directiveId: string, node: HTMLElement | null) {
    if (node) {
      directiveCardRefs.current.set(directiveId, node);
      return;
    }
    directiveCardRefs.current.delete(directiveId);
  }

  function scrollToDirective(directiveId: string) {
    directiveCardRefs.current.get(directiveId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openDirectiveEditor(directive: AudienceDirectiveCard) {
    updateDirectiveDraft(directive.id, directiveDraftFromCard(directive));
    setEditingDirectiveId(directive.id);
  }

  const filterCounts = useMemo(() => {
    return {
      all: audienceSeats.length,
      active: audienceSeats.filter((seat) => !["not_started", "finished", "failed", "skipped", "risk_exit"].includes(seat.status)).length,
      opened: audienceSeats.filter((seat) => seat.hasOpened).length,
      commented: audienceSeats.filter((seat) => seat.hasCommented).length,
      favorited: audienceSeats.filter((seat) => seat.hasFavorited).length,
      skipped: audienceSeats.filter((seat) => seat.hasSkipped).length,
      doubt: audienceSeats.filter((seat) => seat.hasDoubt).length,
      finished: audienceSeats.filter((seat) => seat.status === "finished").length,
      failed: audienceSeats.filter((seat) => seat.status === "failed").length
    };
  }, [audienceSeats]);

  const filteredSeats = useMemo(() => {
    if (seatFilter === "active") return audienceSeats.filter((seat) => !["not_started", "finished", "failed", "skipped", "risk_exit"].includes(seat.status));
    if (seatFilter === "opened") return audienceSeats.filter((seat) => seat.hasOpened);
    if (seatFilter === "commented") return audienceSeats.filter((seat) => seat.hasCommented);
    if (seatFilter === "favorited") return audienceSeats.filter((seat) => seat.hasFavorited);
    if (seatFilter === "skipped") return audienceSeats.filter((seat) => seat.hasSkipped);
    if (seatFilter === "doubt") return audienceSeats.filter((seat) => seat.hasDoubt);
    if (seatFilter === "finished") return audienceSeats.filter((seat) => seat.status === "finished");
    if (seatFilter === "failed") return audienceSeats.filter((seat) => seat.status === "failed");
    return audienceSeats;
  }, [audienceSeats, seatFilter]);

  async function uploadImages(files: FileList | File[]) {
    setError("");
    const remainingSlots = MAX_POST_IMAGES - imageUrls.length;
    if (remainingSlots <= 0) {
      setError(t("audienceGen.toast.maxImages", { max: MAX_POST_IMAGES }));
      return;
    }
    const selectedFiles = Array.from(files).slice(0, remainingSlots);
    if (!selectedFiles.length) return;
    setIsUploadingImages(true);
    try {
      const uploadedUrls: string[] = [];
      for (const file of selectedFiles) {
        const preparedFile = await prepareImageForUpload(file);
        const form = new FormData();
        form.set("file", preparedFile);
        const response = await fetch("/api/upload", { method: "POST", body: form });
        const body = await parseApiResponse<{ url: string }>(response);
        if (!body.success) throw new Error(body.error.message);
        uploadedUrls.push(body.data.url);
      }
      setImageUrls((current) => [...current, ...uploadedUrls].slice(0, MAX_POST_IMAGES));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t("audienceGen.toast.imageFailed"));
    } finally {
      setIsUploadingImages(false);
    }
  }

  function removeImage(indexToRemove: number) {
    setImageUrls((current) => current.filter((_, index) => index !== indexToRemove));
  }

  function moveImage(activeUrl: string, overUrl: string) {
    if (activeUrl === overUrl) return;
    let newIndex: number | null = null;
    setImageUrls((current) => {
      const fromIndex = current.indexOf(activeUrl);
      const toIndex = current.indexOf(overUrl);
      if (fromIndex < 0 || toIndex < 0) return current;
      if (selectedImageIndex === fromIndex) {
        newIndex = toIndex;
      } else if (selectedImageIndex !== null) {
        if (fromIndex < toIndex && selectedImageIndex > fromIndex && selectedImageIndex <= toIndex) {
          newIndex = selectedImageIndex - 1;
        } else if (fromIndex > toIndex && selectedImageIndex >= toIndex && selectedImageIndex < fromIndex) {
          newIndex = selectedImageIndex + 1;
        }
      }
      return arrayMove(current, fromIndex, toIndex);
    });
    if (newIndex !== null) {
      setSelectedImageIndex(newIndex);
    }
  }

  function handleImageDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    moveImage(String(active.id), String(over.id));
  }

  function applyDemoContent() {
    setTitle(DEMO_TITLE);
    setBodyText(DEMO_BODY);
    setImageUrls([...DEMO_IMAGE_URLS]);
    setSelectedImageIndex(0);
  }

  function useDemoContent() {
    if (isMeaningfulCreateDraft(currentCreateDraft)) {
      setConfirmDialog({
        title: t("home.demoOverwrite.title"),
        body: t("home.demoOverwrite.body"),
        confirmLabel: t("home.demoOverwrite.confirm"),
        cancelLabel: t("home.demoOverwrite.cancel"),
        tone: "danger",
        onConfirm: applyDemoContent
      });
      return;
    }
    applyDemoContent();
  }

  function updateCustomAudienceCount(value: string) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      setCustomAudienceCount(CUSTOM_AUDIENCE_MIN);
      return;
    }
    setCustomAudienceCount(Math.min(CUSTOM_AUDIENCE_MAX, Math.max(CUSTOM_AUDIENCE_MIN, parsed)));
  }

  function openImageViewer(index: number) {
    setSelectedImageIndex(index);
    setIsImageViewerOpen(true);
  }

  function shiftSelectedImage(direction: -1 | 1) {
    setSelectedImageIndex((current) => {
      if (!imageUrls.length) return 0;
      return (current + direction + imageUrls.length) % imageUrls.length;
    });
  }

  const imageViewer = isImageViewerOpen && activeImageUrl ? (
    <div className="imageViewer" role="dialog" aria-modal="true" aria-label={t("imageViewer.viewImage")} onClick={() => setIsImageViewerOpen(false)}>
      <button className="imageViewerClose" type="button" aria-label={t("imageViewer.closeViewer")} onClick={() => setIsImageViewerOpen(false)}>
        <X size={22} />
      </button>
      <button
        className="imageViewerNav previous"
        type="button"
        aria-label={t("venue.post.prevImage")}
        disabled={imageUrls.length <= 1}
        onClick={(event) => {
          event.stopPropagation();
          shiftSelectedImage(-1);
        }}
      >
        <ChevronLeft size={30} />
      </button>
      <img src={activeImageUrl} alt={t("imageViewer.imageN", { index: selectedImageIndex + 1 })} onClick={(event) => event.stopPropagation()} />
      <button
        className="imageViewerNav next"
        type="button"
        aria-label={t("venue.post.nextImage")}
        disabled={imageUrls.length <= 1}
        onClick={(event) => {
          event.stopPropagation();
          shiftSelectedImage(1);
        }}
      >
        <ChevronRight size={30} />
      </button>
      <span className="imageViewerCount">{selectedImageIndex + 1} / {imageUrls.length}</span>
    </div>
  ) : null;

  const appToastOverlay = appToast ? (
    <div className={`appToast appToast-${appToast.tone}`} role="status" aria-live="polite" key={appToast.id}>
      {appToast.tone === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      <span>{appToast.text}</span>
      <button type="button" aria-label={t("imageViewer.closeHint")} onClick={() => setAppToast(null)}>
        <X size={14} />
      </button>
    </div>
  ) : null;

  const confirmDialogOverlay = confirmDialog ? (
    <ConfirmDialog
      title={confirmDialog.title}
      body={confirmDialog.body}
      confirmLabel={confirmDialog.confirmLabel}
      tone={confirmDialog.tone}
      onConfirm={confirmDialog.onConfirm}
      onClose={() => {
        if (navigationGuardResolveRef.current && !navigationGuardConfirmedRef.current) {
          navigationGuardResolveRef.current(false);
          navigationGuardResolveRef.current = null;
        }
        setConfirmDialog(null);
      }}
    />
  ) : null;

  async function createAndPlanAudience() {
    if (!canSubmit) return;
    setError("");
    setUiStatus("starting");
    setAudienceDrafts([]);
    setAudienceSampling({ runId: null, plan: null, progress: null });
    commentRequestSeq.current += 1;
    runtimeLogRequestSeq.current += 1;
    const createPayload = {
      title,
      coverImageUrl,
      imageUrls,
      bodyText,
      scale,
      ...(scale === "custom" ? { audienceCount: customAudienceCount } : {})
    };
    const createResponse = await request<{ runId: string }>("/api/runs", {
      method: "POST",
      body: JSON.stringify(createPayload)
    });
    if (!createResponse.success) {
      setError(createResponse.error.message);
      setUiStatus("draft");
      return;
    }
    const createdRunId = createResponse.data.runId;
    setRunId(createdRunId);
    setRestoredRunId(createdRunId);
    clearCreateDraft();
    await navigateTo({ kind: "workbench", runId: createdRunId }, { replace: true, skipGuard: true });
    if (await startAudiencePlanGeneration(createdRunId, { targetCount: selectedAudienceCount })) {
      void loadAudienceState(createdRunId);
    }
  }

  async function restoreRun(id: string, restoreSeq = restoreRequestSeq.current) {
    const response = await request<RunOverview>(`/api/runs/${id}`);
    if (restoreSeq !== restoreRequestSeq.current || id !== activeRunIdRef.current) return;
    if (!response.success) {
      clearRuntimeUIState(null);
      setError(response.error.message);
      setUiStatus("restore_failed");
      setRestoredRunId(null);
      return;
    }
    const nextStatus = response.data.status;
    clearRuntimeUIState(id);
    latestLiveEventSequenceRef.current = nextStatus === "completed" ? null : (response.data.latestLiveEventSequence ?? null);
    audienceRevisionRef.current = response.data.audienceRevision;
    const shouldLoadAudienceState = ["planning_audience", "generating_audience", "audience_ready"].includes(nextStatus);
    setUiStatus(nextStatus);
    if (hasRuntimeSnapshot(nextStatus)) setHasRuntimeData(true);
    if (response.data.clock) setRunClock({ ...response.data.clock, receivedAtMs: Date.now() });
    if (response.data.contentVersion) {
      overrideFromContentVersion({
        title: response.data.contentVersion.title,
        imageUrls: normalizeImageUrls(response.data.contentVersion.imageUrls, response.data.contentVersion.coverImageUrl),
        bodyText: response.data.contentVersion.bodyText ?? response.data.contentVersion.bodyPreview ?? ""
      });
    }
    if (shouldLoadAudienceState) await loadAudienceState(id, restoreSeq);
    if (restoreSeq !== restoreRequestSeq.current || id !== activeRunIdRef.current) return;
    void loadRuntimeLogs(id);
    if (hasRuntimeSnapshot(nextStatus)) {
      void refreshSnapshots(id, { strict: true });
    } else {
      setRuntimeSnapshotReady(true);
    }
    void resetComments(id);
    setRestoredRunId(id);
  }

  async function refreshSnapshots(id = runId, options?: { strict?: boolean }) {
    if (!id) return;
    const [post, insightData, seatData] = await Promise.all([
      request<{ postState: PostStateView }>(`/api/runs/${id}/post-state`),
      request<{ insights: InsightItem[] }>(`/api/runs/${id}/insights`),
      request<{ audienceRevision: number; seats: AudienceSeat[]; summary?: AudienceSeatsSummary }>(`/api/runs/${id}/audience-seats`)
    ]);
    if (options?.strict) {
      const failures = [post, insightData, seatData].filter((item) => !item.success);
      if (failures.length) {
        showAppError(t("audienceGen.toast.refreshFailed", { errors: failures.map((item) => item.success ? "" : item.error.message).filter(Boolean).join(i18n.t("common.reportSeparator")) }));
        return;
      }
    }
    if (post.success) setPostState((current) => mergePostState(current, post.data.postState));
    if (insightData.success) setInsights(insightData.data.insights);
    if (seatData.success) {
      audienceRevisionRef.current = seatData.data.audienceRevision;
      setAudienceSeats(seatData.data.seats);
      if (seatData.data.summary) setSummary((current) => mergeSeatSummary(current, seatData.data.summary!));
    }
    setRuntimeSnapshotReady(true);
  }

  async function resetComments(id = runId) {
    await loadMoreComments(id, null, true, commentSort);
  }

  function mergeCommentsForRun(id: string, incoming: CommentItem[]) {
    setCommentsState((current) => {
      const base = current.runId === id ? current : emptyCommentsStateFor(id, commentSort);
      return { ...base, items: sortPostComments(mergeById(base.items, incoming), base.sort) };
    });
  }

  function updateCommentsForRun(id: string, updater: (items: CommentItem[]) => CommentItem[]) {
    setCommentsState((current) => {
      const base = current.runId === id ? current : emptyCommentsStateFor(id, commentSort);
      return { ...base, items: updater(base.items) };
    });
  }

  async function loadMoreComments(id = runId, cursor = commentCursor, replace = false, sort = commentSort) {
    if (!id || (commentsState.runId === id && commentsState.loading && !replace)) return;
    const requestSeq = replace ? ++commentRequestSeq.current : commentRequestSeq.current;
    setCommentsState((current) => ({
      runId: id,
      items: current.runId === id ? current.items : [],
      cursor: current.runId === id ? current.cursor : null,
      hasMore: current.runId === id ? current.hasMore : false,
      sort,
      loading: true
    }));
    const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const response = await request<{ comments: CommentItem[]; hasMore?: boolean; nextCursor?: string | null }>(`/api/runs/${id}/comments?limit=${COMMENT_PAGE_SIZE}&sort=${sort}${cursorQuery}`);
    if (requestSeq !== commentRequestSeq.current) return;
    setCommentsState((current) => {
      if (current.runId !== id) return current;
      if (!response.success) return { ...current, loading: false };
      return {
        runId: id,
        items: replace ? sortPostComments(response.data.comments, sort) : mergeById(current.items, response.data.comments),
        cursor: response.data.nextCursor ?? null,
        hasMore: Boolean(response.data.hasMore),
        sort,
        loading: false
      };
    });
  }

  function changeCommentSort(nextSort: "latest" | "hot") {
    if (nextSort === commentSort) return;
    setCommentSort(nextSort);
    void loadMoreComments(runId, null, true, nextSort);
  }

  function handleMockContentScroll(event: UIEvent<HTMLDivElement>) {
    if (!hasMoreComments) return;
    const element = event.currentTarget;
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceToBottom < 120) void loadMoreComments();
  }

  async function startAudiencePlanGeneration(targetRunId: string, options: { targetCount: number; reloadOnFailure?: boolean }) {
    setError("");
    setActiveGenerationJob(null);
    beginPlanGenerationUi(targetRunId, options.targetCount);
    const response = await request<{ job?: AudienceGenerationJob }>(`/api/runs/${targetRunId}/audience-sampling-plan`, {
      method: "POST",
      body: JSON.stringify({ replaceActive: true })
    });
    if (!response.success) {
      commitAudiencePreparationUi((current) => ({
        ...current,
        runId: targetRunId,
        phase: "plan_failed",
        planJobId: null
      }));
      showAppError(response.error.message);
      if (options.reloadOnFailure) void loadAudienceState(targetRunId);
      return false;
    }
    const nextJob = response.data.job ?? null;
    setActiveGenerationJob(nextJob);
    bindPlanGenerationJob(targetRunId, nextJob);
    return true;
  }

  async function loadAudiences(id = runId) {
    if (!id) return;
    await request<{ participants: unknown[] }>(`/api/runs/${id}/participants`);
  }

  async function loadAudienceState(id = runId, restoreSeq?: number) {
    if (!id) return;
    const [planResponse, progressResponse] = await Promise.all([
      request<{ runId: string; plan: AudienceSamplingState["plan"] }>(`/api/runs/${id}/audience-sampling-plan`),
      request<NonNullable<AudienceSamplingState["progress"]>>(`/api/runs/${id}/audience-generation`)
    ]);
    const planOk = planResponse.success && planResponse.data.runId === id;
    const progressOk = progressResponse.success && progressResponse.data.runId === id;
    if (restoreSeq !== undefined && restoreSeq !== restoreRequestSeq.current) return;
    if (id !== activeRunIdRef.current) return;
    setAudienceSampling((current) => ({
      runId: id,
      plan: planOk ? planResponse.data.plan : current.runId === id ? current.plan : null,
      progress: progressOk ? progressResponse.data : current.runId === id ? current.progress : null
    }));
    if (planOk && planResponse.data.plan) {
      setAudiencePlanFailureMessage("");
      commitAudiencePreparationUi((current) => ({
        runId: id,
        phase: planResponse.data.plan?.confirmedAt ? current.phase : "plan_ready",
        planJobId: null,
        reasoningTokens: 0,
        reasoningEstimated: true
      }));
    }
    if (progressOk) {
      const nextActiveJob = progressResponse.data.activeJob ?? null;
      setActiveGenerationJob(nextActiveJob);
      if (nextActiveJob?.scope === "sampling_plan") {
        bindPlanGenerationJob(id, nextActiveJob);
      } else if (nextActiveJob) {
        commitAudiencePreparationUi({
          runId: id,
          phase: "audience_generating",
          planJobId: null,
          reasoningTokens: 0,
          reasoningEstimated: true
        });
      } else if (progressResponse.data.status === "ready" || progressResponse.data.status === "ready_with_failures") {
        commitAudiencePreparationUi({
          runId: id,
          phase: progressResponse.data.identityReadyCount > 0 ? "audience_ready" : "audience_generating",
          planJobId: null,
          reasoningTokens: 0,
          reasoningEstimated: true
        });
      } else if (progressResponse.data.status === "not_started" && planOk && !planResponse.data.plan) {
        commitAudiencePreparationUi({
          runId: id,
          phase: "plan_failed",
          planJobId: null,
          reasoningTokens: 0,
          reasoningEstimated: true
        });
      }
      setAudienceDrafts(progressResponse.data.profiles.sort(sortAudienceDrafts));
      if (isAudiencePreparationUiStatus(uiStatusRef.current) || uiStatusRef.current === "restoring") {
        if (progressResponse.data.status === "ready" || progressResponse.data.status === "ready_with_failures") {
          setUiStatus(progressResponse.data.identityReadyCount > 0 ? "audience_ready" : "generating_audience");
        } else if (progressResponse.data.status !== "not_started") {
          setUiStatus(progressResponse.data.status === "ready_for_review" ? "planning_audience" : "generating_audience");
        } else if (planOk && !planResponse.data.plan && !nextActiveJob) {
          setUiStatus("planning_audience");
          setAudiencePlanFailureMessage(t("audienceGen.toast.planFailed"));
        }
      }
    }
  }

  async function loadRuntimeLogs(id = runId, cursor: string | null = null, append = false) {
    if (!id) return;
    if (append && !cursor) return;
    const requestSeq = ++runtimeLogRequestSeq.current;
    setRuntimeLogsState((current) => ({
      runId: id,
      items: current.runId === id ? current.items : [],
      cursor: current.runId === id ? current.cursor : null,
      hasMore: current.runId === id ? current.hasMore : false,
      loading: true
    }));
    const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const response = await request<{ logs: RuntimeLogItem[]; hasMore?: boolean; nextCursor?: string | null }>(`/api/runs/${id}/run-logs?limit=${RUNTIME_LOG_PAGE_SIZE}&order=desc${cursorQuery}`);
    if (requestSeq !== runtimeLogRequestSeq.current) return;
    setRuntimeLogsState((current) => {
      if (current.runId !== id) return current;
      if (!response.success) return { ...current, loading: false };
      const nextItems = sortRuntimeLogs(mergeRuntimeLogsById(current.items, response.data.logs));
      const shouldAdvanceCursor = append || !cursor;
      return {
        runId: id,
        items: nextItems,
        cursor: shouldAdvanceCursor ? response.data.nextCursor ?? null : current.cursor,
        hasMore: shouldAdvanceCursor ? Boolean(response.data.hasMore) : current.hasMore,
        loading: false
      };
    });
  }

  function loadMoreRuntimeLogs() {
    if (!hasMoreRuntimeLogs || isLoadingRuntimeLogs) return;
    void loadRuntimeLogs(runId, runtimeLogCursor, true);
  }

  function handleRuntimeLogScroll(event: UIEvent<HTMLDivElement>) {
    if (!hasMoreRuntimeLogs || isLoadingRuntimeLogs) return;
    const element = event.currentTarget;
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceToBottom < 120) loadMoreRuntimeLogs();
  }

  async function loadReport(id = runId) {
    if (!id) return;
    const response = await request<ReportView>(`/api/runs/${id}/report`);
    if (!response.success) {
      setError(response.error.message);
      setReport(null);
      setUiStatus("report_unavailable");
      return;
    }
    setReport(response.data);
    setUiStatus("completed");
  }

  async function regenerateReport() {
    if (!runId) return;
    if (isRegeneratingReport) return;
    setIsRegeneratingReport(true);
    try {
      const response = await request<ReportView>(`/api/runs/${runId}/report?regenerate=true`, {
        method: "POST",
        body: "{}"
      });
      if (!response.success) {
        showAppError(response.error.message);
        return;
      }
      setReport(response.data);
    } catch (err) {
      showAppError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRegeneratingReport(false);
    }
  }

  async function openAudienceDetail(participantId: string) {
    setSelectedParticipantId(participantId);
    const response = await request<AudienceDetail>(`/api/runs/${runId}/participants/${participantId}`);
    if (response.success) setAudienceDetail(response.data);
  }

  function openAudienceEdit(audience: AudienceDraft) {
    const persona = audience.identity?.personaJson ?? {};
    setAudienceEdit({
      id: audience.id,
      mode: "identity",
      identityStatus: audience.identityStatus,
      displayName: audience.identity?.user?.nickname || audience.samplingLabel,
      samplingLabel: audience.samplingLabel,
      demographicsJson: audience.demographicsJson,
      profileText: personaSectionText(persona.profile),
      personalityText: personaSectionText(persona.personality),
      mbtiTypeText: personaSectionText(persona.mbtiType),
      responseStyleText: personaSectionText(persona.responseStyle),
      avatarUrl: audience.identity?.user?.avatarUrl || "",
      identity: persona
    });
  }

  function updateAudienceTooltipPlacement(audienceId: string, row: HTMLElement) {
    const tooltip = row.querySelector<HTMLElement>(".audienceIdentityTooltip");
    if (!tooltip) return;
    const rowRect = row.getBoundingClientRect();
    const gap = 8;
    const tooltipHeight = tooltip.scrollHeight || tooltip.getBoundingClientRect().height || 96;
    const belowSpace = window.innerHeight - rowRect.bottom - gap;
    const aboveSpace = rowRect.top - gap;
    const nextPlacement = belowSpace < tooltipHeight && aboveSpace > belowSpace ? "above" : "below";
    setAudienceTooltipPlacements((current) => {
      if (current[audienceId] === nextPlacement) return current;
      return { ...current, [audienceId]: nextPlacement };
    });
  }

  function handleAudienceTooltipFocus(audienceId: string, event: ReactFocusEvent<HTMLElement>) {
    updateAudienceTooltipPlacement(audienceId, event.currentTarget);
  }

  async function retryFailedIdentities() {
    if (!runId || isGeneratingAll || (audienceProgress?.identityFailedCount ?? 0) === 0) return;
    setError("");
    setIsGeneratingAll(true);
    const response = await request<{ job?: AudienceGenerationJob; progress?: AudienceSamplingState["progress"] }>(`/api/runs/${runId}/audience-generation/retry-identities`, {
      method: "POST",
      body: JSON.stringify({ profileIds: [] })
    });
    setIsGeneratingAll(false);
    if (!response.success) {
      showAppError(response.error.message);
      return;
    }
    setActiveGenerationJob(response.data.job ?? response.data.progress?.activeJob ?? null);
    setUiStatus("generating_audience");
    if (response.data.progress?.runId === runId) {
      setAudienceSampling((current) => ({ ...current, runId, progress: response.data.progress ?? current.progress }));
      setAudienceDrafts((response.data.progress.profiles ?? []).sort(sortAudienceDrafts));
    }
  }

  function requestReplanAudience() {
    const hasExistingAudiencePlan = Boolean(samplingPlan) || audienceDrafts.length > 0;
    if (hasExistingAudiencePlan) {
      setConfirmDialog({
        title: t("audienceGen.confirm.replanTitle"),
        body: t("audienceGen.confirm.replanBody"),
        confirmLabel: t("audienceGen.confirm.replanConfirm"),
        tone: "danger",
        onConfirm: () => void replanAudience()
      });
      return;
    }
    void replanAudience();
  }

  async function replanAudience() {
    if (!runId) return;
    await startAudiencePlanGeneration(runId, {
      targetCount: plannedAudienceCount || selectedAudienceCount,
      reloadOnFailure: true
    });
  }

  function requestClearGeneratedAudience() {
    setConfirmDialog({
      title: t("audienceGen.confirm.clearTitle"),
      body: t("audienceGen.confirm.clearBody"),
      confirmLabel: t("audienceGen.confirm.clearConfirm"),
      tone: "danger",
      onConfirm: () => void clearGeneratedAudience()
    });
  }

  async function clearGeneratedAudience() {
    if (!runId || isAudienceGenerationActive) return;
    const response = await request<{ plan: AudienceSamplingState["plan"]; progress: AudienceSamplingState["progress"] }>(`/api/runs/${runId}/audience-sampling-plan/clear-audience`, {
      method: "POST",
      body: JSON.stringify({})
    });
    if (!response.success) {
      showAppError(response.error.message);
      return;
    }
    setUiStatus("planning_audience");
    setActiveGenerationJob(null);
    commitAudiencePreparationUi({
      runId,
      phase: "plan_ready",
      planJobId: null,
      reasoningTokens: 0,
      reasoningEstimated: true
    });
    setAudiencePlanPreview(null);
    setAudiencePlanFailureMessage("");
    setAudienceSampling({ runId, plan: response.data.plan, progress: response.data.progress ?? null });
    setAudienceDrafts([]);
    setAudienceSeats([]);
    setSummary(emptySummary);
    setEditingDirectiveId(null);
    setDirectiveDrafts({});
    showAppToast(t("audienceGen.toast.cleared"), "success");
  }

  async function confirmAudienceSamplingPlan() {
    if (!runId || !samplingPlan || isAudienceGenerationActive) return;
    const response = await request<{ job?: AudienceGenerationJob; progress?: AudienceSamplingState["progress"] }>(`/api/runs/${runId}/audience-sampling-plan/confirm`, {
      method: "POST",
      body: JSON.stringify({})
    });
    if (!response.success) {
      showAppError(response.error.message);
      return;
    }
    setUiStatus("generating_audience");
    setActiveGenerationJob(response.data.job ?? response.data.progress?.activeJob ?? null);
    commitAudiencePreparationUi({
      runId,
      phase: "audience_generating",
      planJobId: null,
      reasoningTokens: 0,
      reasoningEstimated: true
    });
    if (response.data.progress?.runId === runId) {
      setAudienceSampling((current) => ({ ...current, runId, progress: response.data.progress ?? current.progress }));
    }
    void loadAudienceState();
  }

  async function retryDirectiveExpansion(directiveId: string) {
    if (!runId || isAudienceGenerationActive) return;
    const response = await request<{ job?: AudienceGenerationJob; progress?: AudienceSamplingState["progress"] }>(`/api/runs/${runId}/audience-sampling-plan/directives/${directiveId}/retry-expansion`, {
      method: "POST",
      body: JSON.stringify({})
    });
    if (!response.success) {
      showAppError(response.error.message);
      return;
    }
    setUiStatus("generating_audience");
    setActiveGenerationJob(response.data.job ?? response.data.progress?.activeJob ?? null);
    void loadAudienceState();
  }

  function applyAudienceSamplingPlan(plan: AudienceSamplingState["plan"]) {
    if (plan && plan.runId !== runId) return;
    setAudienceSampling((current) => {
      if (!plan || !current.progress || current.runId !== runId) return { runId, plan, progress: null };
      const quantitiesByDirective = new Map(plan.directives.map((directive) => [directive.id, directive.quantity]));
      return {
        ...current,
        runId,
        plan,
        progress: {
          ...current.progress,
          total: plan.totalCount,
          directives: current.progress.directives.map((directive) => ({
            ...directive,
            targetCount: quantitiesByDirective.get(directive.directiveId) ?? directive.targetCount
          }))
        }
      };
    });
  }

  function directivePayloadFromDraft(draft: DirectiveDraftState) {
    const quantity = Number(draft.quantity);
    const diversityAxes = normalizeDiversityAxes([...draft.diversityAxes, ...splitDiversityAxes(draft.axisInput)]);
    if (!Number.isInteger(quantity) || quantity < 1) {
      showAppError(t("audienceGen.toast.invalidQuantity"));
      return null;
    }
    if (!draft.name.trim()) {
      showAppError(t("audienceGen.toast.emptyName"));
      return null;
    }
    if (!draft.description.trim()) {
      showAppError(t("audienceGen.toast.emptyDesc"));
      return null;
    }
    if (!diversityAxes.length) {
      showAppError(t("audienceGen.toast.emptyDiversity"));
      return null;
    }
    if (!draft.rationale.trim()) {
      showAppError(t("audienceGen.toast.emptyRationale"));
      return null;
    }
    return {
      name: draft.name.trim(),
      description: draft.description.trim(),
      quantity,
      diversityAxes,
      rationale: draft.rationale.trim()
    };
  }

  function updateDirectiveDraft(directiveId: string, patch: Partial<DirectiveDraftState>) {
    setDirectiveDrafts((current) => ({ ...current, [directiveId]: { ...(current[directiveId] ?? emptyDirectiveDraft()), ...patch } }));
  }

  async function saveAudienceDirective(directive: AudienceDirectiveCard) {
    if (!runId || !canEditSamplingPlan) return;
    const draft = directiveDrafts[directive.id] ?? directiveDraftFromCard(directive);
    const payload = directivePayloadFromDraft(draft);
    if (!payload) return;
    setDirectiveMutationKey(`save:${directive.id}`);
    const response = await request<{ plan: AudienceSamplingState["plan"] }>(`/api/runs/${runId}/audience-sampling-plan/directives/${directive.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    setDirectiveMutationKey(null);
    if (!response.success) {
      showAppError(response.error.message);
      return;
    }
    applyAudienceSamplingPlan(response.data.plan);
    setEditingDirectiveId(null);
    showAppToast(t("audienceGen.toast.saved"), "success");
  }

  function requestDeleteAudienceDirective(directive: AudienceDirectiveCard) {
    setConfirmDialog({
      title: t("audienceGen.confirm.deleteDirectiveTitle"),
      body: t("audienceGen.confirm.deleteDirectiveBody", { description: directive.description }),
      confirmLabel: t("audienceGen.confirm.deleteDirectiveConfirm"),
      tone: "danger",
      onConfirm: () => void deleteAudienceDirective(directive.id)
    });
  }

  async function deleteAudienceDirective(directiveId: string) {
    if (!runId || !canEditSamplingPlan) return;
    setDirectiveMutationKey(`delete:${directiveId}`);
    const response = await request<{ plan: AudienceSamplingState["plan"] }>(`/api/runs/${runId}/audience-sampling-plan/directives/${directiveId}`, {
      method: "DELETE"
    });
    setDirectiveMutationKey(null);
    if (!response.success) {
      showAppError(response.error.message);
      return;
    }
    applyAudienceSamplingPlan(response.data.plan);
    setEditingDirectiveId(null);
    showAppToast(t("audienceGen.toast.deleted"), "success");
  }

  function setAssistantMessagesForStage(stage: AssistantStage, updater: (messages: AssistantDialogMessage[]) => AssistantDialogMessage[]) {
    if (stage === "plan") {
      setPlanAssistantMessages(updater);
      return;
    }
    setSeatAssistantMessages(updater);
  }

  function assistantMessagesForStage(stage: AssistantStage) {
    return stage === "plan" ? planAssistantMessages : seatAssistantMessages;
  }

  function setAssistantOperationState(stage: AssistantStage, messageId: string, operationId: string, state: AssistantOperationState) {
    setAssistantMessagesForStage(stage, (messages) => messages.map((message) => message.id === messageId
      ? {
          ...message,
          operationStates: {
            ...(message.operationStates ?? {}),
            [operationId]: state
          }
        }
      : message));
  }

  async function sendAssistantMessage(stage: AssistantStage, text: string, mentions: AssistantMention[]) {
    if (!runId || assistantSendingStage) return;
    const userMessage: AssistantDialogMessage = {
      id: assistantMessageId(stage, "user"),
      role: "user",
      visibleText: text,
      mentions
    };
    const nextMessages = [...assistantMessagesForStage(stage), userMessage];
    setAssistantMessagesForStage(stage, () => nextMessages);
    setAssistantSendingStage(stage);
    const endpoint = stage === "plan"
      ? `/api/runs/${runId}/audience-sampling-plan/revision-suggestions`
      : `/api/runs/${runId}/audience-profiles/revision-suggestions`;
    const body = stage === "plan"
      ? { messages: planMessagesForRequest(nextMessages) }
      : { messages: seatMessagesForRequest(nextMessages) };
    const response = await request<{ runId: string; proposal: AudienceSamplingPlanRevisionProposal | AudienceSeatRevisionProposal }>(endpoint, {
      method: "POST",
      body: JSON.stringify(body)
    });
    setAssistantSendingStage(null);
    if (!response.success) {
      showAppError(response.error.message);
      return;
    }
    const proposal = response.data.proposal;
    const assistantMessage: AssistantDialogMessage = {
      id: assistantMessageId(stage, "assistant"),
      role: "assistant",
      visibleText: proposal.summary,
      mentions: [],
      proposal,
      operationStates: initialOperationStates(proposal)
    };
    setAssistantMessagesForStage(stage, (messages) => [...messages, assistantMessage]);
  }

  async function applyAssistantOperation(stage: AssistantStage, messageId: string, operationId: string) {
    const message = assistantMessagesForStage(stage).find((item) => item.id === messageId);
    const operation = (message?.proposal?.operations as AssistantOperation[] | undefined)?.find((item) => item.operationId === operationId);
    if (!message || !operation) return false;
    const currentStatus = message.operationStates?.[operationId]?.status ?? "idle";
    if (currentStatus === "running" || currentStatus === "success" || currentStatus === "not_applicable") return currentStatus === "success";
    setAssistantOperationState(stage, messageId, operationId, { status: "running", message: t("audienceGen.toast.updating") });
    try {
      const resultMessage = stage === "plan"
        ? await applyPlanRevisionOperation(operation as AudienceSamplingPlanRevisionOperation)
        : await applySeatRevisionOperation(operation as AudienceSeatRevisionOperation);
      setAssistantOperationState(stage, messageId, operationId, { status: "success", message: resultMessage });
      return true;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : t("audienceGen.toast.applyFailed");
      setAssistantOperationState(stage, messageId, operationId, { status: "failed", message: messageText });
      showAppError(messageText);
      return false;
    }
  }

  async function applyAllAssistantOperations(stage: AssistantStage, messageId: string) {
    const message = assistantMessagesForStage(stage).find((item) => item.id === messageId);
    const operations = (message?.proposal?.operations as AssistantOperation[] | undefined) ?? [];
    for (const operation of operations) {
      const status = message?.operationStates?.[operation.operationId]?.status ?? "idle";
      if (status === "success" || status === "not_applicable") continue;
      const ok = await applyAssistantOperation(stage, messageId, operation.operationId);
      if (!ok) break;
    }
  }

  async function applyPlanRevisionOperation(operation: AudienceSamplingPlanRevisionOperation) {
    if (!runId || !canEditSamplingPlan) throw new Error(t("audienceGen.toast.cannotOptimizePlan"));
    if (operation.op === "add_directive") {
      const payload: CreateAudienceSamplingDirectiveRequest = operation.directive;
      setDirectiveMutationKey(`assistant:${operation.operationId}`);
      const response = await request<{ plan: AudienceSamplingState["plan"] }>(`/api/runs/${runId}/audience-sampling-plan/directives`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setDirectiveMutationKey(null);
      if (!response.success) throw new Error(response.error.message);
      applyAudienceSamplingPlan(response.data.plan);
      setEditingDirectiveId(null);
      showAppToast(t("audienceGen.toast.appliedAdd"), "success");
      return t("audienceGen.toast.appliedAddResult");
    }
    if (operation.op === "update_directive") {
      const payload: UpdateAudienceSamplingDirectiveRequest = operation.patch;
      setDirectiveMutationKey(`assistant:${operation.operationId}`);
      const response = await request<{ plan: AudienceSamplingState["plan"] }>(`/api/runs/${runId}/audience-sampling-plan/directives/${operation.directiveId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      setDirectiveMutationKey(null);
      if (!response.success) throw new Error(response.error.message);
      applyAudienceSamplingPlan(response.data.plan);
      setEditingDirectiveId(null);
      showAppToast(t("audienceGen.toast.appliedUpdate"), "success");
      return t("audienceGen.toast.appliedUpdateResult");
    }
    setDirectiveMutationKey(`assistant:${operation.operationId}`);
    const response = await request<{ plan: AudienceSamplingState["plan"] }>(`/api/runs/${runId}/audience-sampling-plan/directives/${operation.directiveId}`, {
      method: "DELETE"
    });
    setDirectiveMutationKey(null);
    if (!response.success) throw new Error(response.error.message);
    applyAudienceSamplingPlan(response.data.plan);
    setEditingDirectiveId(null);
    showAppToast(t("audienceGen.toast.appliedDelete"), "success");
    return t("audienceGen.toast.appliedDeleteResult");
  }

  async function applySeatRevisionOperation(operation: AudienceSeatRevisionOperation) {
    if (!runId || !showSeatAssistantAction) throw new Error(t("audienceGen.toast.cannotPolishSeat"));
    if (operation.op === "add_profile") {
      const payload: CreateAudienceProfileRequest = {
        directiveId: operation.directiveId,
        samplingLabel: operation.samplingLabel,
        demographics: operation.demographics ?? defaultAudienceDemographics()
      };
      const response = await request<{ plan?: AudienceSamplingState["plan"]; job?: AudienceGenerationJob; progress?: AudienceSamplingState["progress"] }>(`/api/runs/${runId}/audience-profiles`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      if (!response.success) throw new Error(response.error.message);
      setUiStatus("generating_audience");
      setActiveGenerationJob(response.data.job ?? response.data.progress?.activeJob ?? null);
      if (response.data.progress?.runId === runId) {
        setAudienceSampling((current) => ({
          ...current,
          runId,
          plan: response.data.plan?.runId === runId ? response.data.plan : current.runId === runId ? current.plan : null,
          progress: response.data.progress ?? current.progress
        }));
        setAudienceDrafts((response.data.progress.profiles ?? []).sort(sortAudienceDrafts));
      } else {
        await loadAudienceState();
      }
      showAppToast(t("audienceGen.toast.appliedAddProfile"), "success");
      return t("audienceGen.toast.appliedAddProfileResult");
    }
    if (operation.op === "update_identity") {
      const payload: UpdateAudienceIdentityRequest = operation.patch;
      const response = await request<AudienceDraft>(`/api/runs/${runId}/audience-profiles/${operation.profileId}/identity`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      if (!response.success) throw new Error(response.error.message);
      await loadAudienceState();
      void loadAudiences();
      void loadRuntimeLogs();
      showAppToast(t("audienceGen.toast.appliedUpdateProfile"), "success");
      return t("audienceGen.toast.appliedUpdateProfileResult");
    }
    if (operation.op === "regenerate_identity") {
      const response = await request<{ job?: AudienceGenerationJob; progress?: AudienceSamplingState["progress"] }>(`/api/runs/${runId}/audience-profiles/${operation.profileId}/identity/regenerate`, {
        method: "POST",
        body: JSON.stringify({})
      });
      if (!response.success) throw new Error(response.error.message);
      setUiStatus("generating_audience");
      setActiveGenerationJob(response.data.job ?? response.data.progress?.activeJob ?? null);
      if (response.data.progress?.runId === runId) {
        setAudienceSampling((current) => ({ ...current, runId, progress: response.data.progress ?? current.progress }));
        setAudienceDrafts((response.data.progress.profiles ?? []).sort(sortAudienceDrafts));
      } else {
        await loadAudienceState();
      }
      showAppToast(t("audienceGen.toast.appliedRegenerate"), "success");
      return t("audienceGen.toast.appliedRegenerateResult");
    }
    if (operation.op === "delete_profile") {
      const response = await request<{ profileId: string; status: string }>(`/api/runs/${runId}/audience-profiles/${operation.profileId}`, { method: "DELETE" });
      if (!response.success) throw new Error(response.error.message);
      await loadAudienceState();
      void loadAudiences();
      void loadRuntimeLogs();
      showAppToast(t("audienceGen.toast.appliedDeleteProfile"), "success");
      return t("audienceGen.toast.appliedDeleteProfileResult");
    }
    if (operation.op === "favorite_identity") {
      const response = await request<AudienceDraft>(`/api/runs/${runId}/audience-profiles/${operation.profileId}/identity/favorite`, {
        method: "POST",
        body: JSON.stringify({ favorited: operation.favorited })
      });
      if (!response.success) throw new Error(response.error.message);
      await loadAudienceState();
      void loadAudiences();
      showAppToast(operation.favorited ? t("audienceGen.toast.appliedFavorite") : t("audienceGen.toast.appliedUnfavorite"), "success");
      return operation.favorited ? t("audienceGen.toast.appliedFavoriteResult") : t("audienceGen.toast.appliedUnfavoriteResult");
    }
    const response = await request<{ job?: AudienceGenerationJob; jobs?: AudienceGenerationJob[]; progress?: AudienceSamplingState["progress"] }>(`/api/runs/${runId}/audience-generation/retry-identities`, {
      method: "POST",
      body: JSON.stringify({ profileIds: [operation.profileId] })
    });
    if (!response.success) throw new Error(response.error.message);
    setUiStatus("generating_audience");
    setActiveGenerationJob(response.data.job ?? response.data.progress?.activeJob ?? null);
    if (response.data.progress?.runId === runId) {
      setAudienceSampling((current) => ({ ...current, runId, progress: response.data.progress ?? current.progress }));
      setAudienceDrafts((response.data.progress.profiles ?? []).sort(sortAudienceDrafts));
    } else {
      await loadAudienceState();
    }
    showAppToast(t("audienceGen.toast.appliedRetry"), "success");
    return t("audienceGen.toast.appliedRetryResult");
  }

  async function saveAudienceEdit() {
    if (!runId || !audienceEdit) return;
    const identity = {
      ...audienceEdit.identity,
      profile: audienceEdit.profileText.trim(),
      personality: audienceEdit.personalityText.trim(),
      mbtiType: audienceEdit.mbtiTypeText.trim(),
      responseStyle: audienceEdit.responseStyleText.trim()
    };
    const response = await request<AudienceDraft>(`/api/runs/${runId}/audience-profiles/${audienceEdit.id}/identity`, {
        method: "PATCH",
        body: JSON.stringify({
          displayName: audienceEdit.displayName,
          avatarUrl: audienceEdit.avatarUrl.trim() || null,
          personaJson: identity
        })
      });
    if (!response.success) {
      showAppError(response.error.message);
      return;
    }
    setAudienceEdit(null);
    void loadAudienceState();
    void loadAudiences();
    void loadRuntimeLogs();
  }

  async function regenerateAudienceIdentity(profileId: string) {
    if (!runId || isAudienceGenerationActive) return;
    const response = await request<{ job?: AudienceGenerationJob; progress?: AudienceSamplingState["progress"] }>(`/api/runs/${runId}/audience-profiles/${profileId}/identity/regenerate`, {
      method: "POST",
      body: JSON.stringify({})
    });
    if (!response.success) {
      showAppError(response.error.message);
      return;
    }
    setUiStatus("generating_audience");
    setActiveGenerationJob(response.data.job ?? response.data.progress?.activeJob ?? null);
    if (response.data.progress?.runId === runId) {
      setAudienceSampling((current) => ({ ...current, runId, progress: response.data.progress ?? current.progress }));
      setAudienceDrafts((response.data.progress.profiles ?? []).sort(sortAudienceDrafts));
    }
  }

  function requestRegenerateAudienceIdentity(audience: AudienceDraft) {
    if (isAudienceGenerationActive || isAudienceLockedByJob(audience)) return;
    const label = audienceIdentityDisplayName(audience);
    const isReady = audience.identityStatus === "identity_ready";
    setConfirmDialog({
      title: isReady ? t("audienceGen.confirm.regenerateTitle") : t("audienceGen.confirm.regenerateTitlePending"),
      body: isReady
        ? t("audienceGen.confirm.regenerateBodyReady", { label })
        : t("audienceGen.confirm.regenerateBodyPending", { label: audience.samplingLabel }),
      confirmLabel: isReady ? t("audienceGen.confirm.regenerateConfirmReady") : t("audienceGen.confirm.regenerateConfirmPending"),
      tone: isReady ? "danger" : "primary",
      onConfirm: () => void regenerateAudienceIdentity(audience.id)
    });
  }

  async function deleteAudience(profileId: string) {
    if (!runId) return;
    const response = await request<{ status: string }>(`/api/runs/${runId}/audience-profiles/${profileId}`, { method: "DELETE" });
    if (!response.success) {
      showAppError(response.error.message);
      return;
    }
    void loadAudienceState();
    void loadAudiences();
    void loadRuntimeLogs();
  }

  function requestDeleteAudience(audience: AudienceDraft) {
    if (isAudienceLockedByJob(audience)) return;
    const label = audience.identityStatus === "identity_ready" ? audienceIdentityDisplayName(audience) : audience.samplingLabel;
    setConfirmDialog({
      title: t("audienceGen.confirm.deleteAudienceTitle"),
      body: t("audienceGen.confirm.deleteAudienceBody", { label }),
      confirmLabel: t("audienceGen.confirm.deleteAudienceConfirm"),
      tone: "danger",
      onConfirm: () => void deleteAudience(audience.id)
    });
  }

  async function toggleAudienceIdentityFavorite(audience: AudienceDraft) {
    if (!runId) return;
    const response = await request<AudienceDraft>(`/api/runs/${runId}/audience-profiles/${audience.id}/identity/favorite`, {
      method: "POST",
      body: JSON.stringify({ favorited: !(audience.identity?.favorited ?? audience.identity?.saved ?? false) })
    });
    if (!response.success) {
      showAppError(response.error.message);
      return;
    }
    void loadAudienceState();
    void loadAudiences();
  }

  async function updatePostReaction(kind: "like" | "favorite") {
    if (!runId) return;
    const endpoint = kind === "like" ? "like" : "favorite";
    const active = kind === "like" ? !postState.likedByMe : !postState.favoritedByMe;
    const response = await request<{ postState: PostStateView }>(`/api/runs/${runId}/post/${endpoint}`, {
      method: "POST",
      body: JSON.stringify({ active })
    });
    if (!response.success) {
      showAppError(response.error.message);
      return;
    }
    setPostState((current) => mergePostState(current, response.data.postState));
  }

  async function shareCurrentPost() {
    if (!runId) return;
    const response = await request<{ postState: PostStateView }>(`/api/runs/${runId}/post/share`, {
      method: "POST",
      body: JSON.stringify({})
    });
    if (!response.success) {
      showAppError(response.error.message);
      return;
    }
    setPostState((current) => mergePostState(current, response.data.postState));
  }

  async function publishUserComment() {
    if (!runId) return;
    if (uiStatus === "completed") return;
    const content = commentDraft.trim();
    if (!content) return;
    const response = await request<{ comment: CommentItem; postState: PostStateView }>(`/api/runs/${runId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content })
    });
    if (!response.success) {
      showAppError(response.error.message);
      return;
    }
    setCommentDraft("");
    setPostState((current) => mergePostState(current, response.data.postState));
    markNewCommentEntries([response.data.comment.id]);
    mergeCommentsForRun(runId, [response.data.comment]);
  }

  async function likeUserComment(comment: CommentItem) {
    if (!runId) return;
    const response = await request<{ comment: CommentItem }>(`/api/runs/${runId}/comments/${comment.id}/like`, {
      method: "POST",
      body: JSON.stringify({ active: !comment.likedByMe })
    });
    if (!response.success) {
      showAppError(response.error.message);
      return;
    }
    mergeCommentsForRun(runId, [response.data.comment]);
  }

  async function startRun(partialAudienceConfirmed = false) {
    if (!runId) return;
    if (missingIdentityCount > 0 && !partialAudienceConfirmed) {
      setConfirmDialog({
        title: t("venue.startWithReadyTitle"),
        body: t("venue.startWithReadyBody", { ready: readyAudienceCount, missing: missingIdentityCount }),
        confirmLabel: t("venue.startWithReadyConfirm"),
        tone: "primary",
        onConfirm: () => void startRun(true)
      });
      return;
    }
    const response = await request<{ status: RunStatus }>(`/api/runs/${runId}/start`, {
      method: "POST",
      body: JSON.stringify({ force: false, allowPartialAudience: partialAudienceConfirmed })
    });
    if (!response.success) {
      showAppError(response.error.message);
      return;
    }
    setUiStatus(response.data.status);
    setHasRuntimeData(true);
    void restoreRun(runId);
    void loadRuntimeLogs();
  }

  async function controlRun(action: "pause" | "resume") {
    if (!runId) return;
    const response = await request<{ status: RunStatus }>(`/api/runs/${runId}/${action}`, { method: "POST" });
    if (!response.success) {
      showAppError(response.error.message);
      return;
    }
    setUiStatus(response.data.status);
    void refreshSnapshots(runId, { strict: hasRuntimeSnapshot(response.data.status) });
    void loadRuntimeLogs();
  }

  async function resetRuntime() {
    if (!runId) return;
    const response = await request<{ status: RunStatus }>(`/api/runs/${runId}/reset-runtime`, { method: "POST" });
    if (!response.success) {
      showAppError(response.error.message);
      return;
    }
    clearRuntimeUIState(runId);
    commentRequestSeq.current += 1;
    runtimeLogRequestSeq.current += 1;
    setUiStatus(response.data.status);
    void loadAudienceState(runId);
    void loadRuntimeLogs(runId);
    void resetComments(runId);
    showAppToast(t("venue.resetRun"), "success");
  }

  function requestResetRuntime() {
    setConfirmDialog({
      title: t("venue.resetRunTitle"),
      body: t("venue.resetRunBody"),
      confirmLabel: t("venue.resetRunConfirm"),
      tone: "danger",
      onConfirm: () => void resetRuntime()
    });
  }

  function closeAudienceDetail() {
    setSelectedParticipantId(null);
    setAudienceDetail(null);
  }

  function addBehaviorToast(text: string, hint: BehaviorToast["hint"]) {
    if (hint === "none") return;
    toastCounter.current += 1;
    setBehaviorToasts((items) => [...items.slice(-1), { id: `toast_${Date.now()}_${toastCounter.current}`, text, hint }]);
  }

  async function openReport() {
    if (!runId) return;
    if (uiStatus === "paused") {
      const response = await request<ReportView>(`/api/runs/${runId}/report`, { method: "POST", body: "{}" });
      if (!response.success) {
        showAppError(response.error.message);
        return;
      }
      setReport(response.data);
      setUiStatus("completed");
      void refreshSnapshots(runId, { strict: true });
      void loadRuntimeLogs();
      void resetComments();
      return;
    }
    if (uiStatus !== "completed") return;
    const response = await request<ReportView>(`/api/runs/${runId}/report`, { method: "POST", body: "{}" });
    if (!response.success) {
      showAppError(response.error.message);
      return;
    }
    setReport(response.data);
    void navigateTo({ kind: "report", runId });
  }

  function openSettings() {
    void navigateTo({ kind: "settings" });
  }

  function showAppToast(text: string, tone: AppToast["tone"] = "error") {
    appToastCounter.current += 1;
    setAppToast({ id: appToastCounter.current, tone, text });
  }

  function showAppError(text: string) {
    setError("");
    showAppToast(text, "error");
  }

  function openHistory() {
    void navigateTo({ kind: "history" });
  }

  function openHome() {
    void navigateTo({ kind: "workbench" });
  }

  async function navigateTo(nextRoute: AppRoute, options: boolean | { replace?: boolean; skipGuard?: boolean } = false) {
    const replace = typeof options === "boolean" ? options : Boolean(options.replace);
    const skipGuard = typeof options === "boolean" ? false : Boolean(options.skipGuard);
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    try {
      if (!skipGuard && navigationGuard.isDirty()) {
        const ok = await navigationGuard.confirmLeave();
        if (!ok) return;
      }
      const path = pathForRoute(nextRoute);
      activeRunIdRef.current = nextRoute.kind === "workbench" || nextRoute.kind === "report" ? (nextRoute.runId ?? "") : "";
      if (replace) {
        window.history.replaceState(null, "", path);
      } else {
        window.history.pushState(null, "", path);
      }
      currentPathRef.current = path;
      setRoute(nextRoute);
    } finally {
      isNavigatingRef.current = false;
    }
  }

  function mergeAudienceEvent(event: LiveEventEnvelope) {
    if (!event.profile || typeof event.profile !== "object") return;
    const audience = event.profile as AudienceDraft;
    setAudienceDrafts((drafts) => {
      const index = drafts.findIndex((item) => item.id === audience.id);
      if (index < 0) return [...drafts, audience].sort(sortAudienceDrafts);
      return drafts.map((item) => item.id === audience.id ? audience : item);
    });
  }

  function commentUpdatePatchFromEvent(event: LiveEventEnvelope): { commentId: string; patch: CommentUpdatePatch } | null {
    if (typeof event.commentId !== "string") return null;
    const rawPatch = event.patch;
    if (!rawPatch || typeof rawPatch !== "object" || Array.isArray(rawPatch)) return null;
    const values = rawPatch as Record<string, unknown>;
    const patch: CommentUpdatePatch = {};
    if (typeof values.likeCount === "number") patch.likeCount = values.likeCount;
    if (typeof values.replyCount === "number") patch.replyCount = values.replyCount;
    return Object.keys(patch).length ? { commentId: event.commentId, patch } : null;
  }

  function handleLiveEvent(event: LiveEventEnvelope, eventRunId = runId) {
    if (eventRunId !== activeRunIdRef.current) return;
    if (!event.eventId || seenEventIds.current.has(event.eventId)) return;
    seenEventIds.current.add(event.eventId);
    // Cap the Set to prevent unbounded memory growth during long runs.
    // Set preserves insertion order, so delete the oldest entry when over the cap.
    if (seenEventIds.current.size > SEEN_EVENT_IDS_MAX) {
      const oldest = seenEventIds.current.values().next().value;
      if (oldest !== undefined) seenEventIds.current.delete(oldest);
    }
    // Track the latest durable event sequence so SSE reconnections (triggered
    // by uiStatus changes) use an up-to-date `?after=` parameter. Only durable
    // events have numeric sequence IDs; ephemeral events (e.g. reasoning deltas
    // with "reasoning-..." IDs) are not replayed on reconnection.
    if (/^\d+$/.test(event.eventId)) {
      const prevSeq = latestLiveEventSequenceRef.current;
      if (!prevSeq || BigInt(event.eventId) > BigInt(prevSeq)) {
        latestLiveEventSequenceRef.current = event.eventId;
      }
    }
    const eventAudienceRevision = typeof event.audienceRevision === "number" ? event.audienceRevision : null;
    if (event.type.startsWith("audience.") && eventAudienceRevision !== null && audienceRevisionRef.current !== null && eventAudienceRevision !== audienceRevisionRef.current) {
      if (eventAudienceRevision > audienceRevisionRef.current) {
        audienceRevisionRef.current = eventAudienceRevision;
        void loadAudienceState(eventRunId);
        if (hasRuntimeSnapshot(uiStatusRef.current)) void refreshSnapshots(eventRunId, { strict: false });
      }
      return;
    }

    if (typeof event.job === "object" && event.job) {
      setActiveGenerationJob(event.job as AudienceGenerationJob);
    }
    if (event.type === "audience.generation.job.started") {
      setUiStatus((event.scope ?? (event.job as AudienceGenerationJob | undefined)?.scope) === "sampling_plan" ? "planning_audience" : "generating_audience");
    }
    if (event.type === "audience.plan.started") {
      const eventJobId = typeof event.jobId === "string" ? event.jobId : null;
      if (!eventJobId) return;
      const planUi = audiencePreparationUiRef.current;
      if (planUi.planJobId && planUi.planJobId !== eventJobId) return;
      if (!planUi.planJobId && planUi.phase !== "plan_requesting") return;
      setUiStatus("planning_audience");
      setAudiencePlanPreview(emptyAudiencePlanPreview(typeof event.targetCount === "number" ? event.targetCount : plannedAudienceCount));
      setAudiencePlanFailureMessage("");
      commitAudiencePreparationUi({
        runId: eventRunId,
        phase: "plan_reasoning",
        planJobId: eventJobId,
        reasoningTokens: 0,
        reasoningEstimated: true
      });
    }
    if (event.type === "audience.plan.progress") {
      const eventJobId = typeof event.jobId === "string" ? event.jobId : null;
      if (!isCurrentPlanGenerationJob(eventJobId)) return;
      const progress = event.progress as { stage?: string; reasoningTokens?: number; reasoningEstimated?: boolean } | undefined;
      if (progress?.stage === "public_reasoning" && typeof progress.reasoningTokens === "number") {
        commitAudiencePreparationUi((current) => ({
          ...current,
          reasoningTokens: progress.reasoningTokens!,
          reasoningEstimated: progress.reasoningEstimated ?? true
        }));
      } else if (progress?.stage && progress.stage !== "model_request" && progress.stage !== "public_reasoning") {
        commitAudiencePreparationUi((current) => ({ ...current, phase: "plan_streaming" }));
      }
    }
    if (event.type === "audience.plan.frame") {
      const eventJobId = typeof event.jobId === "string" ? event.jobId : null;
      if (!isCurrentPlanGenerationJob(eventJobId)) return;
      commitAudiencePreparationUi((current) => ({ ...current, phase: "plan_streaming" }));
      const preview = event.preview as AudiencePlanPreview | undefined;
      if (preview) {
        setAudiencePlanPreview(preview);
        setAudiencePlanFailureMessage("");
      }
    }
    if (event.type === "audience.generation.job.completed") {
      const eventJobId = typeof event.jobId === "string" ? event.jobId : null;
      const eventScope = event.scope ?? (event.job as AudienceGenerationJob | undefined)?.scope;
      if (eventScope === "sampling_plan" && !isCurrentPlanGenerationJob(eventJobId)) return;
      setActiveGenerationJob(null);
      setIsGeneratingAll(false);
      if (eventScope === "sampling_plan") {
        commitAudiencePreparationUi((current) => ({ ...current, phase: "plan_streaming" }));
      }
      void loadAudienceState(eventRunId);
    }
    if (event.type === "audience.generation.job.failed" || event.type === "audience.plan.failed") {
      const eventJobId = typeof event.jobId === "string" ? event.jobId : null;
      const eventScope = event.type === "audience.plan.failed"
        ? "sampling_plan"
        : event.scope ?? (event.job as AudienceGenerationJob | undefined)?.scope;
      if (eventScope === "sampling_plan" && !isCurrentPlanGenerationJob(eventJobId)) return;
      setActiveGenerationJob(null);
      setIsGeneratingAll(false);
      if (typeof event.message === "string") {
        if (eventScope === "sampling_plan") setAudiencePlanFailureMessage(event.message);
        showAppError(event.message);
      }
      if (eventScope === "sampling_plan") {
        commitAudiencePreparationUi((current) => ({ ...current, phase: "plan_failed" }));
      }
    }
    if (event.type === "audience.generation.job.canceled") {
      const eventJobId = typeof event.jobId === "string" ? event.jobId : null;
      const eventScope = event.scope ?? (event.job as AudienceGenerationJob | undefined)?.scope;
      if (eventScope === "sampling_plan" && !isCurrentPlanGenerationJob(eventJobId)) return;
      setActiveGenerationJob(null);
      setIsGeneratingAll(false);
      if (eventScope === "sampling_plan") {
        commitAudiencePreparationUi((current) => ({ ...current, phase: "plan_failed" }));
      }
    }

    if (event.type === "post_state.updated") setPostState((current) => mergePostState(current, event.postState as PostStateView));
    if (event.type === "comment.created") {
      const comment = event.comment as CommentItem;
      markNewCommentEntries([comment.id]);
      updateCommentsForRun(eventRunId, (items) => {
        return sortPostComments(mergeById(items, [comment]), commentSortRef.current);
      });
      if (comment.participantId) {
        setAudienceSeats((seats) =>
          seats.map((seat) =>
            seat.participantId === comment.participantId
              ? { ...seat, hasCommented: true, status: "commented", lastUpdatedSimulatedTime: event.simulatedTime }
              : seat
          )
        );
      }
    }
    if (event.type === "comment.updated") {
      const update = commentUpdatePatchFromEvent(event);
      if (update) {
        updateCommentsForRun(eventRunId, (items) => sortPostComments(patchCommentById(items, update.commentId, update.patch), commentSortRef.current));
        if (typeof update.patch.likeCount === "number") pulseCommentLike(update.commentId);
      }
    }
    if (event.type === "comments.page_loaded") {
      const page = event.page as { comments?: CommentItem[] };
      if (page.comments?.length) mergeCommentsForRun(eventRunId, page.comments);
    }
    if (event.type === "summary.updated") setSummary(event.summary as LiveSummary);
    if (event.type === "insight.created") {
      const insight = event.insight as InsightItem;
      setInsights((items) => items.some((item) => item.id === insight.id) ? items : [...items, insight]);
    }
    if (event.type === "action_log.created") {
      const log = event.log as ActionLogItem | undefined;
      if (log?.participantId) {
        setLiveLogsByAudience((current) => {
          const existing = current.runId === eventRunId ? current.byParticipant[log.participantId as string] ?? [] : [];
          if (existing.some((item) => item.id === log.id)) return current;
          return {
            runId: eventRunId,
            byParticipant: {
              ...(current.runId === eventRunId ? current.byParticipant : {}),
              [log.participantId as string]: [...existing, log]
            }
          };
        });
      }
      if (log) {
        setRuntimeLogsState((current) => {
          const base = current.runId === eventRunId ? current : { runId: eventRunId, items: [], cursor: null, hasMore: false, loading: false };
          return { ...base, items: sortRuntimeLogs(mergeRuntimeLogsById(base.items, [{ ...log, logType: "action" }])) };
        });
      }
    }
    if (event.type === "audience.status_updated") {
      const payload = event as unknown as AudienceStatusUpdatedPayload;
      setAudienceSeats((seats) =>
        seats.map((seat) =>
          seat.participantId === payload.participantId
            ? {
                ...seat,
                status: payload.status,
                currentAction: payload.currentAction,
                exitOutcome: payload.exitOutcome,
                exitReason: payload.exitReason,
                hasSkipped: seat.hasSkipped || payload.status === "skipped",
                hasDoubt: seat.hasDoubt || payload.status === "risk_exit",
                lastUpdatedSimulatedTime: payload.simulatedTime
              }
            : seat
        )
      );
    }
    if (event.type === "audience.action_happened") {
      const payload = event as unknown as AudienceActionHappenedPayload;
      const hint = payload.animationHint ?? "none";
      setAudienceSeats((seats) =>
        seats.map((seat) =>
          seat.participantId === payload.participantId
            ? {
                ...seat,
                hasOpened: seat.hasOpened || payload.action === "open_post",
                hasLiked: seat.hasLiked || payload.action === "like_post",
                hasFavorited: seat.hasFavorited || payload.action === "favorite_post",
                hasShared: seat.hasShared || payload.action === "share_post",
                hasCommented: seat.hasCommented || payload.action === "write_comment",
                hasSkipped: seat.hasSkipped || hint === "skip"
              }
            : seat
        )
      );
      pulsePostAction(payload.action);
      addBehaviorToast(payload.text ?? actionText(payload.action), hint);
    }
    if (event.type === "run_log.created") {
      const log = {
        id: String(event.logId ?? event.eventId),
        logType: String(event.logType ?? "control"),
        message: String(event.message ?? ""),
        participantId: typeof event.participantId === "string" ? event.participantId : undefined,
        simulatedTime: typeof event.simulatedTime === "number" ? event.simulatedTime : undefined,
        createdAt: typeof event.createdAt === "string" ? event.createdAt : undefined
      };
      setRuntimeLogsState((current) => {
        const base = current.runId === eventRunId ? current : { runId: eventRunId, items: [], cursor: null, hasMore: false, loading: false };
        return { ...base, items: sortRuntimeLogs(mergeRuntimeLogsById(base.items, [log])) };
      });
    }
    if (event.type === "audience.plan.ready") {
      const eventJobId = typeof event.jobId === "string" ? event.jobId : null;
      if (!isCurrentPlanGenerationJob(eventJobId)) return;
      setAudiencePlanPreview(null);
      setAudiencePlanFailureMessage("");
      commitAudiencePreparationUi({
        runId: eventRunId,
        phase: "plan_ready",
        planJobId: null,
        reasoningTokens: 0,
        reasoningEstimated: true
      });
      setUiStatus("planning_audience");
      void loadAudienceState(eventRunId);
    }
    if (event.type === "audience.plan.updated") {
      setUiStatus("planning_audience");
      void loadAudienceState(eventRunId);
    }
    if (event.type === "audience.plan.confirmed" || event.type === "audience.profile.expansion.started" || event.type === "audience.profile.expansion.ready") {
      setUiStatus("generating_audience");
      commitAudiencePreparationUi({
        runId: eventRunId,
        phase: "audience_generating",
        planJobId: null,
        reasoningTokens: 0,
        reasoningEstimated: true
      });
      void loadAudienceState(eventRunId);
    }
    if (event.type === "audience.profile.created") {
      commitAudiencePreparationUi({
        runId: eventRunId,
        phase: "audience_generating",
        planJobId: null,
        reasoningTokens: 0,
        reasoningEstimated: true
      });
      void loadAudienceState(eventRunId);
    }
    if (event.type === "audience.identity.started" || event.type === "audience.identity.ready" || event.type === "audience.identity.failed" || event.type === "audience.updated") {
      commitAudiencePreparationUi({
        runId: eventRunId,
        phase: "audience_generating",
        planJobId: null,
        reasoningTokens: 0,
        reasoningEstimated: true
      });
      mergeAudienceEvent(event);
      void loadAudienceState(eventRunId);
    }
    if (event.type === "run.clock.updated") {
      const payload = event as unknown as RunClockUpdatedPayload;
      setUiStatus(payload.status);
      setRunClock({ ...payload.clock, receivedAtMs: Date.now() });
      setHasRuntimeData(payload.status !== "audience_ready" || payload.clock.clockElapsedMs > 0);
      setRuntimeSnapshotReady(true);
    }
    if (event.type === "run.started") {
      setUiStatus("running");
      setHasRuntimeData(true);
      void refreshSnapshots(runId, { strict: true });
      void loadRuntimeLogs();
    }
    if (event.type === "run.pausing") setUiStatus("pausing");
    if (event.type === "run.paused") {
      setUiStatus("paused");
      void refreshSnapshots(runId, { strict: true });
      void loadRuntimeLogs();
    }
    if (event.type === "run.resumed") {
      setUiStatus("running");
      void refreshSnapshots(runId, { strict: true });
      void loadRuntimeLogs();
    }
    if (event.type === "run.completed") {
      setUiStatus("completed");
      void refreshSnapshots(runId, { strict: true });
    }

    // Compile-time exhaustiveness check — see assertLiveEventTypeExhaustive.
    assertLiveEventTypeExhaustive(event.type);
  }

  if (route.kind === "not_found") {
    return (
      <main className="restoreShell">
        <section className="restorePanel" aria-labelledby="notFoundTitle">
          <header className="restoreHeader">
            <span>{t("error.notFoundTitle")}</span>
          </header>
          <div className="restoreGrid">
            <div className="restoreCopy">
              <span className="restoreMark"><AlertTriangle size={24} /></span>
              <h1 id="notFoundTitle">{t("error.notFoundTitle")}</h1>
              <p>{t("error.notFoundBody")}</p>
              {typeof window !== "undefined" ? <code>{window.location.pathname}</code> : null}
            </div>
            <div className="restoreActions">
              <button className="primary" type="button" onClick={openHome}>
                {t("common.backHome")}
              </button>
              <button className="ghostButton iconTextButton" type="button" onClick={openHistory}>
                <History size={16} />
                {t("error.notFoundHistory")}
              </button>
              <button className="ghostButton iconTextButton" type="button" onClick={openHome}>
                <Send size={16} />
                {t("error.notFoundNew")}
              </button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (route.kind === "settings") {
    return <SettingsRoute onHome={openHome} registerNavigationGuard={navigationGuard.register} />;
  }

  if (route.kind === "history") {
    return (
      <HistoryRoute
        onHome={openHome}
        onOpenRun={(id) => void navigateTo({ kind: "workbench", runId: id })}
        onOpenReport={(id) => void navigateTo({ kind: "report", runId: id })}
      />
    );
  }

  if (route.kind === "report") {
    return (
      <main className="reportRoute">
        <AppHeader
          variant="narrow"
          title={t("venue.reportTitle")}
          right={(
            <>
              <button className="ghostButton iconTextButton" type="button" onClick={openHome}>
                <Home size={16} />
                {t("venue.reportBackHome")}
              </button>
              <button className="ghostButton iconTextButton" type="button" onClick={() => void navigateTo({ kind: "workbench", runId: route.runId })}>
                <Eye size={16} />
                {t("venue.reportReviewData")}
              </button>
            </>
          )}
        />
        {error ? <p className="error">{error}</p> : null}
        {report ? (
          <ReportPanel
            report={report}
            onRegenerate={regenerateReport}
            isRegenerating={isRegeneratingReport}
          />
        ) : uiStatus === "report_unavailable" ? (
          <div className="drawerLoading">{t("venue.reportNotAvailable")}</div>
        ) : (
          <div className="drawerLoading"><Loader2 className="spin" size={20} />{t("venue.reportLoading")}</div>
        )}
      </main>
    );
  }

  if (isWorkbenchRunRestoring || uiStatus === "restoring" || uiStatus === "restore_failed") {
    const isRestoreFailed = uiStatus === "restore_failed";
    return (
      <main className="restoreShell">
        <section className="restorePanel" aria-labelledby="restoreTitle">
          <header className="restoreHeader">
            <span>Run restore</span>
          </header>
          <div className="restoreGrid">
            <div className="restoreCopy">
              <span className="restoreMark">{isRestoreFailed ? <AlertTriangle size={24} /> : <Loader2 className="spin" size={24} />}</span>
              <h1 id="restoreTitle">{isRestoreFailed ? t("error.restoreFailedTitle") : t("error.restoringTitle")}</h1>
              <p>{isRestoreFailed ? error || t("error.restoreFailedBody") : t("error.restoringBody")}</p>
              {visibleRunId ? <code>{visibleRunId}</code> : null}
            </div>
            {isRestoreFailed ? <div className="restoreActions">
              <button className="primary" type="button" onClick={openHome}>
                {t("common.backHome")}
              </button>
              <button className="ghostButton iconTextButton" type="button" onClick={openHistory}>
                <History size={16} />
                {t("error.notFoundHistory")}
              </button>
              <button className="ghostButton iconTextButton" type="button" onClick={openHome}>
                <Send size={16} />
                {t("error.notFoundNew")}
              </button>
            </div> : null}
          </div>
        </section>
      </main>
    );
  }

  if (uiStatus === "draft" || uiStatus === "starting") {
    return (
      <main className="createShell">
        <div className="softOrb leftOrb" />
        <AppHeader
          variant="narrow"
          title={t("home.title")}
          right={(
            <>
              <p className="simulationNote">{t("simulation.note")}</p>
              <button className="ghostButton iconTextButton" type="button" onClick={openHistory}>
                <History size={16} />
                {t("home.history")}
              </button>
              <button className="ghostButton iconTextButton" type="button" onClick={openSettings}>
                <Settings size={16} />
                {t("home.settings")}
              </button>
            </>
          )}
        />
        <section className="createBoard">
          <div className="createEditor">
            <label>
              {t("home.field.title")}
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <div className="editorField">
              {t("home.field.cover")}
              <div className={`uploader ${imageUrls.length ? "hasImages" : ""}`}>
                {imageUrls.length ? (
                  <DndContext sensors={imageSortSensors} collisionDetection={closestCenter} onDragEnd={handleImageDragEnd}>
                    <SortableContext items={imageUrls} strategy={rectSortingStrategy}>
                      <div className="uploadPreviewGrid">
                        {imageUrls.map((url, index) => (
                          <SortableImageTile
                            index={index}
                            key={url}
                            url={url}
                            onOpen={() => openImageViewer(index)}
                            onRemove={() => removeImage(index)}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                ) : (
                  <div className="uploaderHint">
                    <ImageUp size={28} />
                    <span>{t("home.image.upload")}</span>
                  </div>
                )}
                <input
                  id="postImagesInput"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(event) => {
                    if (event.target.files?.length) void uploadImages(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
                <label className="uploadAddButton" htmlFor="postImagesInput">
                  {isUploadingImages ? <Loader2 className="spin" size={16} /> : <ImageUp size={16} />}
                  {imageUrls.length ? t("home.image.addMore", { current: imageUrls.length, max: MAX_POST_IMAGES }) : t("home.image.selectCount", { current: 0, max: MAX_POST_IMAGES })}
                </label>
              </div>
              <p className="imageLimitHint">{t("home.image.limitHint", { bytes: formatBytes(MAX_UPLOAD_IMAGE_BYTES), edge: MAX_UPLOAD_IMAGE_EDGE })}</p>
            </div>
            <label>
              {t("home.field.body")}
              <textarea value={bodyText} onChange={(event) => setBodyText(event.target.value)} />
            </label>
          </div>
          <aside className="createAside">
            <div className="briefPanel">
              <h2>{t("home.publishTitle")}</h2>
              <p>{t("home.publishBody")}</p>
            </div>
            <button className="ghostButton demoContentButton" type="button" onClick={useDemoContent}>
              {t("home.useDemo")}
            </button>
            <div className="scaleGroup">
              <button className={scale === "quick" ? "selected" : ""} type="button" onClick={() => setScale("quick")}>
                <strong>{t("home.preset.quick")}</strong>
                <span>{t("home.preset.quickDesc")}</span>
              </button>
              <button className={scale === "standard" ? "selected" : ""} type="button" onClick={() => setScale("standard")}>
                <strong>{t("home.preset.standard")}</strong>
                <span>{t("home.preset.standardDesc")}</span>
              </button>
              <button className={`customScaleOption ${scale === "custom" ? "selected" : ""}`} type="button" onClick={() => setScale("custom")}>
                <strong>{t("home.preset.custom")}</strong>
                <span>{t("home.preset.customDesc", { count: customAudienceCount })}</span>
              </button>
            </div>
            {scale === "custom" ? (
              <div className="customAudiencePanel">
                <label>
                  <span>{t("home.audienceCount")}</span>
                  <input
                    aria-label={t("home.audienceCountAria")}
                    type="number"
                    min={CUSTOM_AUDIENCE_MIN}
                    max={CUSTOM_AUDIENCE_MAX}
                    value={customAudienceCount}
                    onChange={(event) => updateCustomAudienceCount(event.target.value)}
                  />
                </label>
                <p className={customAudienceCount > CUSTOM_AUDIENCE_TOKEN_WARNING_THRESHOLD ? "tokenCostWarning" : ""}>
                  {customAudienceCount > CUSTOM_AUDIENCE_TOKEN_WARNING_THRESHOLD
                    ? t("home.audienceCountHigh")
                    : t("home.audienceCountRange", { min: CUSTOM_AUDIENCE_MIN, max: CUSTOM_AUDIENCE_MAX })}
                </p>
              </div>
            ) : null}
            {error && <p className="error">{error}</p>}
            <button className="primary" disabled={!canSubmit || uiStatus === "starting" || isUploadingImages} onClick={() => void createAndPlanAudience()}>
              {uiStatus === "starting" || isUploadingImages ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
              {isUploadingImages ? t("home.image.processing") : t("home.generate")}
            </button>
          </aside>
        </section>
        {appToastOverlay}
        {confirmDialogOverlay}
        {imageViewer}
      </main>
    );
  }

  if (isAudienceStage) {
    return (
      <main className="audienceGenerationShell">
        <header className="generationHud">
          <div className="generationHudMain">
            <div className="generationTitleRow">
              <h1>{hasFailedAudiencePlanPreview ? t("audienceGen.title.planFailed") : isSamplingPlanPending ? t("audienceGen.title.planning") : isAudienceGenerationActive ? t("audienceGen.title.generating") : uiStatus === "audience_ready" ? t("audienceGen.title.confirm") : t("audienceGen.title.review")}</h1>
              <span className={`generationPhase phase-${uiStatus}`}>
                {hasFailedAudiencePlanPreview ? t("audienceGen.status.failed") : isAudienceGenerationActive ? t("audienceGen.status.generating") : uiStatus === "audience_ready" ? t("audienceGen.status.ready") : t("audienceGen.status.pending")}
              </span>
            </div>
          </div>
          <div className="generationControlPanel">
            <div className="generationActions">
              <button className="ghostButton iconTextButton homeAction" type="button" onClick={openHome}>
                <Home size={16} />
                {t("common.backHome")}
              </button>
              {showClearAudienceAction ? (
                <button className="ghostButton iconTextButton replanAction" onClick={requestClearGeneratedAudience} disabled={isAudienceGenerationActive}>
                  <Trash2 size={16} />
                  {t("audienceGen.action.clearAudience")}
                </button>
              ) : (
                <button className="ghostButton iconTextButton replanAction" onClick={requestReplanAudience} disabled={isAudienceGenerationActive}>
                  {isPlanGenerationActive ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
                  {planGenerationActionLabel}
                </button>
              )}
              {showPlanAssistantAction ? (
                <button className="ghostButton iconTextButton assistantAction" type="button" onClick={() => {
                  setEditingDirectiveId(null);
                  setAssistantDialogStage("plan");
                }} disabled={assistantSendingStage === "plan"}>
                  {assistantSendingStage === "plan" ? <Loader2 className="spin" size={16} /> : <MessageCircle size={16} />}
                  {t("audienceGen.action.askAI")}
                </button>
              ) : null}
              {showIdentityRecoveryAction ? (
                <button className="ghostButton iconTextButton detailAction" onClick={() => void retryFailedIdentities()} disabled={isGeneratingAll || isAudienceGenerationActive}>
                  {isGeneratingAll ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
                  {t("audienceGen.action.retryFailed")}
                </button>
              ) : null}
              {showSeatAssistantAction ? (
                <button className="ghostButton iconTextButton assistantAction" onClick={() => setAssistantDialogStage("seat")} disabled={assistantSendingStage === "seat"}>
                  {assistantSendingStage === "seat" ? <Loader2 className="spin" size={16} /> : <MessageCircle size={16} />}
                  {t("audienceGen.action.askAI")}
                </button>
              ) : null}
              {showConfirmPlanAction ? (
                <button className="primary iconTextButton detailAction" onClick={() => void confirmAudienceSamplingPlan()} disabled={!samplingPlan || samplingPlan.status !== "ready_for_review" || !samplingPlan.validation.isQuantityValid || hasUnsavedDirectiveDraft || isAudienceGenerationActive}>
                  <CheckCircle2 size={16} />
                  {t("audienceGen.action.confirmAndGenerate")}
                </button>
              ) : null}
              {uiStatus === "audience_ready" && hasRuntimeData ? (
                <button className="ghostButton iconTextButton resetRuntimeAction" onClick={requestResetRuntime} disabled={isAudienceGenerationActive}>
                  <RefreshCw size={16} />
                  {t("audienceGen.action.resetRun")}
                </button>
              ) : null}
              {showStartAction ? (
                <button className="primary iconTextButton startAction" onClick={() => void startRun()} disabled={readyAudienceCount === 0 || isAudienceGenerationActive}>
                  <Play size={16} />
                  {t("audienceGen.action.startRun")}
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <section className="generationBoard">
          <PlanningContentPreview
            activeImageUrl={activeImageUrl}
            bodyText={bodyText}
            imageUrls={imageUrls}
            onOpenImage={openImageViewer}
            onSelectImage={setSelectedImageIndex}
            onShiftImage={shiftSelectedImage}
            selectedImageIndex={selectedImageIndex}
            title={title}
          />

          <aside className="generationRuntimeDock" aria-label={t("audienceGen.runtimeDock")}>
            <section className="generationAudiencePanel">
              <div className="audienceStudioSummary">
                <div className="audienceSummaryHeading">
                  <div>
                    <strong>{hasFailedAudiencePlanPreview ? t("audienceGen.runtimeTitle.planFailed") : isSamplingPlanPending ? t("audienceGen.runtimeTitle.planning") : samplingPlan?.confirmedAt ? t("audienceGen.runtimeTitle.progress") : t("audienceGen.runtimeTitle.review")}</strong>
                    {samplingPlan ? (
                      <span className="planReviewInlineStatus">
                        {t("audienceGen.generated")} {planIdentityReadyTotal} / {planQuantityTotal}
                        {planReviewStatusNotes.length ? ` · ${planReviewStatusNotes.join(" · ")}` : ""}
                      </span>
                    ) : audiencePlanPreview ? (
                      <span className="planReviewInlineStatus">
                        {t("audienceGen.planned")} {audiencePlanPreview.quantityTotal} / {audiencePlanPreview.targetCount}
                      </span>
                    ) : null}
                  </div>
                </div>
                {samplingPlan ? (
                  <div className={samplingPlan.validation.isQuantityValid ? "planReviewSummary isValid" : "planReviewSummary isInvalid"}>
                    {samplingPlan.dimensions.length ? (
                      <div className="planDimensionBlock" aria-label={t("audienceGen.dimension")}>
                        <span>{t("audienceGen.dimension")}</span>
                        <div className="dimensionChipList">
                          {samplingPlan.dimensions.map((dimension) => <span key={dimension}>{dimension}</span>)}
                        </div>
                      </div>
                    ) : null}
                    {samplingPlan.planMarkdown ? (
                      <section className="planExplanationBlock">
                        <span>{t("audienceGen.planNote")}</span>
                        <PlanMarkdown>{samplingPlan.planMarkdown}</PlanMarkdown>
                      </section>
                    ) : null}
                  </div>
                ) : audiencePlanPreview ? (
                  <div className="planReviewSummary isValid">
                    {audiencePlanPreview.dimensions.length ? (
                      <div className="planDimensionBlock" aria-label={t("audienceGen.dimension")}>
                        <span>{t("audienceGen.dimension")}</span>
                        <div className="dimensionChipList">
                          {audiencePlanPreview.dimensions.map((dimension) => <span key={dimension.key}>{dimension.label}</span>)}
                        </div>
                      </div>
                    ) : (
                      <div className="planDimensionBlock" aria-label={t("audienceGen.dimension")}>
                        <span>{t("audienceGen.dimension")}</span>
                        <div className="dimensionChipList" aria-label={t("audienceGen.dimensionGenerating")}>
                          <span className="skeletonChip" />
                          <span className="skeletonChip isShort" />
                          <span className="skeletonChip" />
                        </div>
                      </div>
                    )}
                    {audiencePlanPreview.planMarkdown ? (
                      <section className="planExplanationBlock">
                        <span>{t("audienceGen.planNote")}</span>
                        <PlanMarkdown>{audiencePlanPreview.planMarkdown}</PlanMarkdown>
                      </section>
                    ) : (
                      <section className="planExplanationBlock">
                        <span>{t("audienceGen.planNote")}</span>
                        <div className="skeletonBlock" aria-label={t("audienceGen.planNoteGenerating")}>
                          <span />
                          <span />
                          <span />
                        </div>
                      </section>
                    )}
                  </div>
                ) : null}
              </div>
              {audienceDirectiveCards.length > 0 || canEditSamplingPlan || audiencePlanPreview ? (
                <div className="planReviewNavRow">
                  <div className="coverageStrip">
                    {audienceDirectiveCards.length > 0 ? (
                      audienceDirectiveCards.map((directive, directiveIndex) => (
                        <button
                          aria-label={t("audienceGen.directive.coverageJumpAria", { index: directiveIndex + 1, name: directiveDisplayName(directive) })}
                          className={[
                            directive.identityReadyCount >= directive.quantity ? "isComplete" : directive.identityReadyCount > 0 ? "isPartial" : "isEmpty",
                            (directive.generationStatus ?? directive.expansionStatus) === "failed" ? "isFailed" : ""
                          ].filter(Boolean).join(" ")}
                          key={directive.id}
                          onClick={() => scrollToDirective(directive.id)}
                          type="button"
                        >
                          <span className="coverageName">{directiveDisplayName(directive)}</span>
                          <span className="coverageCount">
                            <strong>{directive.identityReadyCount}</strong>
                            <em>/{directive.quantity}</em>
                          </span>
                        </button>
                      ))
                    ) : audiencePlanPreview ? (
                      (audiencePlanPreview.directives.length
                        ? audiencePlanPreview.directives
                        : Array.from({ length: previewSkeletonDirectiveCount(audiencePlanPreview.targetCount) }, (_, index) => ({
                          key: `coverage-skeleton-${index}`,
                          sortOrder: index,
                          status: "streaming" as const
                        } satisfies AudiencePlanPreviewDirective))
                      ).map((previewDirective: AudiencePlanPreviewDirective) => (
                        <button
                          aria-label={previewDirective.name ? t("audienceGen.directive.previewName", { name: previewDirective.name }) : t("audienceGen.directive.previewGenerating")}
                          className={[
                            "isStreaming",
                            previewDirective.status === "complete" ? "isComplete" : "",
                            previewDirective.status === "invalid" ? "isFailed" : ""
                          ].filter(Boolean).join(" ")}
                          disabled
                          key={previewDirective.key}
                          type="button"
                        >
                          {previewDirective.name ? (
                            <span className="coverageName">{previewDirective.name}</span>
                          ) : (
                            <span className="coverageName skeletonLine coverageSkeletonName" aria-label={t("audienceGen.directive.nameGenerating")} />
                          )}
                          <span className="coverageCount">
                            {typeof previewDirective.quantity === "number" ? (
                              <>
                                <strong>{previewDirective.quantity}</strong>
                                <em>{t("audienceGen.directive.people")}</em>
                              </>
                            ) : (
                              <span className="coverageSkeletonCount" aria-label={t("audienceGen.directive.countGenerating")} />
                            )}
                          </span>
                        </button>
                      ))
                    ) : null}
                  </div>
                </div>
              ) : null}
              {samplingPlan?.validation.issues.length ? <p className="formError">{samplingPlan.validation.issues.join("；")}</p> : null}
              {hasFailedAudiencePlanPreview && !audiencePlanPreview ? (
                <p className="formError">{audiencePlanFailureMessage || t("audienceGen.toast.planError")}</p>
              ) : null}

              <div className="directiveList">
                {audienceDirectiveCards.length === 0 && audiencePlanPreview ? (
                  <>
                    {(audiencePlanPreview.directives.length
                      ? audiencePlanPreview.directives
                      : Array.from({ length: previewSkeletonDirectiveCount(audiencePlanPreview.targetCount) }, (_, index) => ({
                        key: `preview-skeleton-${index}`,
                        sortOrder: index,
                        status: "streaming" as const
                      }))
                    ).map((previewDirective: AudiencePlanPreviewDirective, previewIndex) => {
                      const isSkeletonDirective = !previewDirective.name && !previewDirective.description && typeof previewDirective.quantity !== "number";
                      const cardClassName = previewDirective.status === "complete"
                        ? "isComplete"
                        : previewDirective.status === "invalid" ? "isFailed" : "isStreaming";
                      const statusClassName = previewDirective.status === "complete"
                        ? "isComplete"
                        : previewDirective.status === "invalid" ? "isFailed" : "isGenerating";
                      const statusLabel = previewDirective.status === "complete"
                        ? t("audienceGen.review.complete")
                        : previewDirective.status === "invalid" ? t("audienceGen.review.incomplete") : t("audienceGen.review.generating");
                      return (
                        <article className={`directiveCard directiveReviewCard ${cardClassName}`} key={previewDirective.key}>
                          <div className="directiveOverview directiveReviewOverview directivePreviewOverview">
                            <div className="directiveReviewHeader">
                              <div className="directiveReviewMain">
                                <div className="directiveTitleLine">
                                  <span className="directiveSequence">{t("audienceGen.directive.groupN", { index: previewIndex + 1 })}</span>
                                  {previewDirective.name ? (
                                    <strong>{previewDirective.name}</strong>
                                  ) : (
                                    <strong className={`skeletonText skeletonLine ${isSkeletonDirective ? "isWide" : ""}`} aria-label={t("audienceGen.directive.nameGenerating")} />
                                  )}
                                  <span className={`directiveStatusTag ${statusClassName}`}>{statusLabel}</span>
                                </div>
                                {previewDirective.description ? (
                                  <p className="directiveReviewSummary">{previewDirective.description}</p>
                                ) : (
                                  <p className="directiveReviewSummary skeletonParagraph" aria-label={t("audienceGen.directive.descGenerating")}>
                                    <span />
                                    <span />
                                  </p>
                                )}
                                <div className="directiveReviewGrid">
                                  <div className="directiveReviewField directiveReviewAxes">
                                    <span>{t("audienceGen.directive.diversityAxes")}</span>
                                    <div>
                                      {previewDirective.diversityAxes?.length ? (
                                        previewDirective.diversityAxes.map((axis) => <em key={axis}>{axis}</em>)
                                      ) : (
                                        <>
                                          <span className="skeletonPill" />
                                          <span className="skeletonPill isShort" />
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  {previewDirective.rationale ? (
                                    <p className="directiveReviewReason"><span>{t("audienceGen.directive.reason")}</span>{previewDirective.rationale}</p>
                                  ) : (
                                    <p className="directiveReviewReason skeletonReason" aria-label={t("audienceGen.directive.reasonGenerating")}>
                                      <span>{t("audienceGen.directive.reason")}</span>
                                      <em />
                                      <em />
                                    </p>
                                  )}
                                </div>
                              </div>
                              <aside className="directiveReviewAside">
                                {typeof previewDirective.quantity === "number" ? (
                                  <span className={`directiveQuantityPill ${previewDirective.status === "complete" ? "isComplete" : "isGenerating"}`} aria-label={t("audienceGen.directive.target", { count: previewDirective.quantity })}>
                                    <strong>{previewDirective.quantity}</strong>
                                    {t("audienceGen.directive.people")}
                                  </span>
                                ) : (
                                  <span className="directiveQuantityPill isGenerating skeletonQuantityPill" aria-label={t("audienceGen.directive.countAssigning")}>
                                    <strong />
                                    {t("audienceGen.directive.people")}
                                  </span>
                                )}
                              </aside>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </>
                ) : null}
                {audienceDirectiveCards.map((directive, directiveIndex) => {
                  const draft = directiveDrafts[directive.id] ?? directiveDraftFromCard(directive);
                  const isSavingDirective = directiveMutationKey === `save:${directive.id}`;
                  const isDeletingDirective = directiveMutationKey === `delete:${directive.id}`;
                  const isEditingDirective = canEditSamplingPlan && editingDirectiveId === directive.id;
                  const reviewState = directiveReviewVisualState(directive);
                  return (
                  <article className={`directiveCard ${isEditingDirective ? "directiveEditCard" : `directiveReviewCard ${reviewState.cardClassName}`}`} key={directive.id} ref={(node) => setDirectiveCardRef(directive.id, node)}>
                    {isEditingDirective ? (
                      <form className="directiveEditForm" onSubmit={(event) => {
                          event.preventDefault();
                          void saveAudienceDirective(directive);
                        }}>
                          <div className="directiveEditHeader">
                            <div className="directiveEditTitle">
                              <span className="directiveSequence">{t("audienceGen.directive.groupN", { index: directiveIndex + 1 })}</span>
                            </div>
                          </div>
                          <div className="directiveNameQuantityRow">
                            <label className="directiveField">
                              <span>{t("audienceGen.directive.name")}</span>
                              <input required value={draft.name} onChange={(event) => updateDirectiveDraft(directive.id, { name: event.target.value })} />
                            </label>
                            <label className="directiveField directiveQuantityField">
                              <span>{t("audienceGen.directive.quantity")}</span>
                              <input required type="number" min={1} max={1000} value={draft.quantity} onChange={(event) => updateDirectiveDraft(directive.id, { quantity: event.target.value })} />
                            </label>
                          </div>
                          <label className="directiveField directiveFieldWide">
                            <span>{t("audienceGen.directive.description")}</span>
                            <textarea required rows={2} value={draft.description} onChange={(event) => updateDirectiveDraft(directive.id, { description: event.target.value })} />
                          </label>
                          <div className="directiveField">
                            <span>{t("audienceGen.directive.diversityAxes")}</span>
                            <DiversityAxesEditor
                              axes={draft.diversityAxes}
                              inputValue={draft.axisInput}
                              onAxesChange={(diversityAxes) => updateDirectiveDraft(directive.id, { diversityAxes })}
                              onInputChange={(axisInput) => updateDirectiveDraft(directive.id, { axisInput })}
                            />
                          </div>
                          <label className="directiveField">
                            <span>{t("audienceGen.directive.rationale")}</span>
                            <textarea required rows={3} value={draft.rationale} onChange={(event) => updateDirectiveDraft(directive.id, { rationale: event.target.value })} />
                          </label>
                          <div className="directiveEditActions">
                            <button className="ghostButton iconTextButton" type="button" onClick={() => {
                              updateDirectiveDraft(directive.id, directiveDraftFromCard(directive));
                              setEditingDirectiveId(null);
                            }} disabled={isSavingDirective || isDeletingDirective}>
                              <X size={14} />
                              {t("common.cancel")}
                            </button>
                            <button className="dangerButton iconTextButton" type="button" onClick={() => requestDeleteAudienceDirective(directive)} disabled={isSavingDirective || isDeletingDirective}>
                              {isDeletingDirective ? <Loader2 className="spin" size={14} /> : <Trash2 size={14} />}
                              {t("common.delete")}
                            </button>
                            <button className="primary iconTextButton" type="submit" disabled={isSavingDirective || isDeletingDirective}>
                              {isSavingDirective ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                              {t("common.save")}
                            </button>
                          </div>
                        </form>
                    ) : (
                      <div className="directiveOverview directiveReviewOverview">
                        <div className="directiveReviewHeader">
                          <div className="directiveReviewMain">
                            <div className="directiveTitleLine">
                              <span className="directiveSequence">{t("audienceGen.directive.groupN", { index: directiveIndex + 1 })}</span>
                              <strong className={directive.name.trim() ? "" : "missingFieldText"}>{directiveDisplayName(directive)}</strong>
                              <span className={`directiveStatusTag ${reviewState.statusClassName}`}>{reviewState.label}</span>
                            </div>
                            <p className="directiveReviewSummary">{directive.description}</p>
                            <div className="directiveReviewGrid">
                              <div className="directiveReviewField directiveReviewAxes">
                                <span>{t("audienceGen.directive.diversityAxes")}</span>
                                <div>
                                  {directive.diversityAxes.length ? directive.diversityAxes.map((axis) => <em key={axis}>{axis}</em>) : <span className="emptyFieldPill">{t("audienceGen.directive.diversityEmpty")}</span>}
                                </div>
                              </div>
                              <p className="directiveReviewReason"><span>{t("audienceGen.directive.reason")}</span>{directive.rationale}</p>
                            </div>
                          </div>
                          <aside className="directiveReviewAside">
                            <span className={`directiveQuantityPill ${reviewState.pillClassName}`} aria-label={t("audienceGen.directive.identityReadyAria", { ready: directive.identityReadyCount, total: directive.quantity })}>
                              <strong>{directive.identityReadyCount}</strong>
                              / {directive.quantity} {t("audienceGen.directive.people")}
                            </span>
                            {canEditSamplingPlan ? (
                              <div className="directiveReviewActions">
                                <button className="textButton" type="button" onClick={() => openDirectiveEditor(directive)}>{t("common.edit")}</button>
                                <button className="dangerTextButton" type="button" onClick={() => requestDeleteAudienceDirective(directive)} disabled={isDeletingDirective}>
                                  {isDeletingDirective ? t("common.deleting") : t("common.delete")}
                                </button>
                              </div>
                            ) : (directive.generationStatus ?? directive.expansionStatus) === "failed" ? (
                              <button className="textButton" type="button" onClick={() => void retryDirectiveExpansion(directive.id)} disabled={isAudienceGenerationActive}>{t("common.retry")}</button>
                            ) : null}
                          </aside>
                        </div>
                        {(directive.generationError ?? directive.expansionError) ? <p className="formError">{directive.generationError ?? directive.expansionError}</p> : null}
                      </div>
                    )}
                    {samplingPlan?.confirmedAt ? (
                      <div className="directiveSlots">
                        {directive.profiles.length ? (
                          <div className="slotPreviewList" aria-label={t("audienceGen.directive.detailAria", { name: directiveDisplayName(directive) })}>
                            {directive.profiles.map((audience) => {
                              const summaryText = audience.identityStatus === "identity_ready" ? audienceAgentBackground(audience) : audienceProfileBrief(audience);
                              const cardTitle = audience.identityStatus === "identity_ready" ? audienceIdentityDisplayName(audience) : audienceProfileLabel(audience);
                              const personaMeta = audience.identityStatus === "identity_ready" ? audiencePersonaMeta(audience) : "";
                              const slotPrimaryFacts = audienceSlotPrimaryFacts(audience);
                              const slotSecondaryFacts = audienceSlotSecondaryFacts(audience);
                              const tooltipPlacement = audienceTooltipPlacements[audience.id] ?? "below";
                              return (
                                audience.identityStatus === "identity_ready" ? (
                                  <article
                                    className={`audienceIdentityRow identity-ready tooltip-${tooltipPlacement}`}
                                    key={audience.id}
                                    onFocusCapture={(event) => handleAudienceTooltipFocus(audience.id, event)}
                                    onMouseEnter={(event) => updateAudienceTooltipPlacement(audience.id, event.currentTarget)}
                                  >
                                    <button className="audienceIdentityMain" type="button" onClick={() => openAudienceEdit(audience)} disabled={isAudienceLockedByJob(audience)}>
                                      <AudienceAvatar name={cardTitle} seed={audience.id} src={audience.identity?.user?.avatarUrl || undefined} small />
                                      <span className="audienceIdentityContent">
                                        <span className="audienceIdentityTopline">
                                          <strong>{cardTitle}</strong>
                                          <span className="audienceIdentityStatus">{audienceIdentityStatusLabel(audience.identityStatus)}</span>
                                        </span>
                                        {personaMeta ? <span className="audienceIdentityMeta">{personaMeta}</span> : null}
                                        <span className="audienceIdentitySummary">
                                          {summaryText}
                                        </span>
                                        <span className="audienceIdentityTooltip">{summaryText}</span>
                                      </span>
                                    </button>
                                    <div className="audienceIdentityActions">
                                      <button className={(audience.identity?.favorited ?? audience.identity?.saved) ? "isActive" : ""} type="button" aria-label={(audience.identity?.favorited ?? audience.identity?.saved) ? t("audienceGen.detail.toggleUnfavorite") : t("audienceGen.detail.toggleFavorite")} title={(audience.identity?.favorited ?? audience.identity?.saved) ? t("audienceGen.detail.toggleUnfavorite") : t("audienceGen.detail.toggleFavorite")} onClick={() => void toggleAudienceIdentityFavorite(audience)} disabled={isAudienceLockedByJob(audience)}>
                                        <Star size={15} fill={(audience.identity?.favorited ?? audience.identity?.saved) ? "currentColor" : "none"} />
                                      </button>
                                      <button type="button" aria-label={t("audienceGen.detail.regenerate")} title={t("audienceGen.detail.regenerate")} onClick={() => requestRegenerateAudienceIdentity(audience)} disabled={isAudienceLockedByJob(audience) || isAudienceGenerationActive}>
                                        <RefreshCw size={14} />
                                      </button>
                                      <button className="dangerIconButton" type="button" aria-label={t("audienceGen.detail.deleteAria", { name: cardTitle })} title={t("audienceGen.detail.delete")} onClick={() => requestDeleteAudience(audience)} disabled={isAudienceLockedByJob(audience)}>
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </article>
                                ) : (
                                  <article className={`audienceIdentityRow identity-pending slot-${audience.identityStatus}`} key={audience.id}>
                                    <button className="audienceIdentityMain" type="button" onClick={() => openAudienceEdit(audience)}>
                                      <span className="audiencePendingAvatar">{audience.sampleIndex + 1}</span>
                                      <span className="audienceIdentityContent">
                                        <span className="audienceIdentityTopline">
                                          <strong>{audienceProfileLabel(audience)}</strong>
                                          <span className="audienceIdentityStatus">{audienceIdentityStatusLabel(audience.identityStatus)}</span>
                                        </span>
                                        {slotPrimaryFacts ? <span className="audienceIdentityMeta">{slotPrimaryFacts}</span> : null}
                                        <span className="audienceIdentitySummary isPending">
                                          {slotSecondaryFacts || summaryText}
                                        </span>
                                      </span>
                                    </button>
                                    <div className="audienceIdentityActions">
                                      {audience.identityStatus === "profile_only" || audience.identityStatus === "identity_failed" ? (
                                        <button type="button" aria-label={`${audience.identityStatus === "identity_failed" ? t("audienceGen.detail.retry") : t("audienceGen.detail.generate")} ${audienceProfileLabel(audience)}`} title={audience.identityStatus === "identity_failed" ? t("audienceGen.detail.retryIdentity") : t("audienceGen.detail.generateIdentity")} onClick={() => requestRegenerateAudienceIdentity(audience)} disabled={isAudienceGenerationActive || isAudienceLockedByJob(audience)}>
                                          <RefreshCw size={14} />
                                        </button>
                                      ) : null}
                                      <button className="dangerIconButton" type="button" aria-label={t("audienceGen.detail.deleteAria", { name: audienceProfileLabel(audience) })} title={t("audienceGen.detail.delete")} onClick={() => requestDeleteAudience(audience)} disabled={isAudienceLockedByJob(audience)}>
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </article>
                                )
                              );
                            })}
                          </div>
                        ) : (
                          (() => {
                            const detailStatus = directive.generationStatus ?? directive.expansionStatus;
                            if (detailStatus === "generating") {
                              return (
                                <div className="directiveEmptyDetail directiveEmptyDetail-generating">
                                  <Loader2 size={14} className="directiveEmptySpinner" />
                                  <span>{t("audienceGen.expansion.generating")}</span>
                                </div>
                              );
                            }
                            if (detailStatus === "failed") {
                              return (
                                <div className="directiveEmptyDetail directiveEmptyDetail-failed">
                                  <span>{t("audienceGen.expansion.failed")}{directive.expansionError ? `：${directive.expansionError}` : ""}</span>
                                  <button className="textButton" type="button" onClick={() => void retryDirectiveExpansion(directive.id)} disabled={isAudienceGenerationActive}>{t("common.retry")}</button>
                                </div>
                              );
                            }
                            return (
                              <div className="directiveEmptyDetail directiveEmptyDetail-pending">
                                <Loader2 size={14} className="directiveEmptySpinner" />
                                <span>{t("audienceGen.expansion.queued")}</span>
                              </div>
                            );
                          })()
                        )}
                      </div>
                    ) : null}
                  </article>
                  );
                })}
              </div>
            </section>
          </aside>
        </section>

        {audienceEdit ? (
          <AudienceEditDrawer
            edit={audienceEdit}
            onChange={setAudienceEdit}
            onClose={() => setAudienceEdit(null)}
            onSave={() => void saveAudienceEdit()}
            onGenerate={() => {
              const audience = audienceDrafts.find((item) => item.id === audienceEdit.id);
              if (audience) requestRegenerateAudienceIdentity(audience);
            }}
            onDelete={() => {
              const audience = audienceDrafts.find((item) => item.id === audienceEdit.id);
              if (audience) requestDeleteAudience(audience);
            }}
          />
        ) : null}
        {assistantDialogStage ? (
          <AssistantDialog
            isOpen
            stage={assistantDialogStage}
            title={assistantDialogStage === "plan" ? t("audienceGen.assistant.planTitle") : t("audienceGen.assistant.seatTitle")}
            subtitle={assistantDialogStage === "plan" ? t("audienceGen.assistant.planSubtitle") : t("audienceGen.assistant.seatSubtitle")}
            messages={assistantDialogStage === "plan" ? planAssistantMessages : seatAssistantMessages}
            mentionCandidates={assistantDialogStage === "plan" ? planMentionCandidates : seatMentionCandidates}
            targetLabels={assistantDialogStage === "plan" ? planAssistantTargetLabels : seatAssistantTargetLabels}
            placeholder={assistantDialogStage === "plan" ? t("audienceGen.assistant.planPlaceholder") : t("audienceGen.assistant.seatPlaceholder")}
            isSending={assistantSendingStage === assistantDialogStage}
            onClose={() => setAssistantDialogStage(null)}
            onSend={(text, mentions) => void sendAssistantMessage(assistantDialogStage, text, mentions)}
            onApplyOperation={(messageId, operationId) => void applyAssistantOperation(assistantDialogStage, messageId, operationId)}
            onApplyAll={(messageId) => void applyAllAssistantOperations(assistantDialogStage, messageId)}
          />
        ) : null}
        {appToastOverlay}
        {confirmDialogOverlay}
        {imageViewer}
      </main>
    );
  }

  return (
    <main className="venueShell">
      <div className="softOrb stageOrb" />
      <VenueHud
        status={uiStatus}
        totalAudience={totalAudience}
        finishedCount={summary.finishedCount}
        failedCount={audienceSeats.filter((seat) => seat.status === "failed").length}
        currentSimulatedTime={currentSimulatedTime}
        hasRuntimeData={hasRuntimeData}
        onPause={() => void controlRun("pause")}
        onResume={() => void controlRun("resume")}
        onReport={openReport}
        onResetRuntime={requestResetRuntime}
        onHome={openHome}
      />

      <section className="venueStage">
        <div className="toastRail">
          {behaviorToasts.map((toast) => (
            <div className={`behaviorToast ${toast.hint}`} key={toast.id}>
              <AudienceAvatar name={toast.text.slice(0, 2)} seed={toast.id} small />
              <span>{toast.text}</span>
              {toast.hint === "star" && <Star size={18} />}
              {toast.hint === "risk" && <AlertTriangle size={18} />}
            </div>
          ))}
        </div>

        <SimulatedPostSurface
          activeImageUrl={activeImageUrl}
          actionBar={(
            <div className="postActionBar">
              <PostAction active={Boolean(postState.likedByMe)} icon={<Heart size={20} fill={postState.likedByMe ? "currentColor" : "none"} />} label={formatCompact(postState.likeCount)} onClick={() => void updatePostReaction("like")} pulseNonce={postActionPulses.like} title={postState.likedByMe ? t("venue.action.unlike") : t("venue.action.like")} />
              <PostAction active={Boolean(postState.favoritedByMe)} icon={<Star size={20} fill={postState.favoritedByMe ? "currentColor" : "none"} />} label={formatCompact(postState.favoriteCount)} onClick={() => void updatePostReaction("favorite")} pulseNonce={postActionPulses.favorite} title={postState.favoritedByMe ? t("venue.action.unfavorite") : t("venue.action.favorite")} />
              <PostAction icon={<MessageCircle size={20} />} label={String(Math.max(postState.commentCount, comments.length))} pulseNonce={postActionPulses.comment} />
            </div>
          )}
          afterContent={(
            <section className="commentsPanel">
              <div className="commentsHeader">
                <span>
                  {t("venue.comment.allCount", { count: Math.max(postState.commentCount, comments.length) })}
                  {commentBurst && commentBurst.delta > 1 ? (
                    <em className="commentBurstPill" key={commentBurst.nonce}>{t("venue.comment.burst", { delta: commentBurst.delta })}</em>
                  ) : null}
                </span>
                <div>
                  <button className={commentSort === "hot" ? "active" : ""} type="button" onClick={() => changeCommentSort("hot")}>{t("venue.comment.hot")}</button>
                  <button className={commentSort === "latest" ? "active" : ""} type="button" onClick={() => changeCommentSort("latest")}>{t("venue.comment.latest")}</button>
                </div>
              </div>
              <AnimatedCommentList
                comments={postComments}
                enteringCommentIds={enteringCommentIds}
                hasMoreComments={hasMoreComments}
                isLoadingComments={isLoadingComments}
                onLikeComment={(comment) => void likeUserComment(comment)}
                onLoadMore={() => void loadMoreComments()}
                pulsingLikeCommentIds={pulsingCommentLikeIds}
                totalComments={comments.length}
              />
            </section>
          )}
          bodyText={bodyText}
          footer={(
            <div className="commentComposerBar" data-disabled={uiStatus === "completed" ? "" : undefined}>
              <div className="commentComposer">
                <input
                  aria-label={t("venue.comment.ariaLabel")}
                  value={commentDraft}
                  onChange={(event) => setCommentDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void publishUserComment();
                  }}
                  placeholder={uiStatus === "completed" ? t("venue.comment.placeholderClosed") : t("venue.comment.placeholder")}
                  disabled={uiStatus === "completed"}
                />
                <button type="button" onClick={() => void publishUserComment()} disabled={uiStatus === "completed"}>{t("common.publish")}</button>
              </div>
            </div>
          )}
          imageUrls={imageUrls}
          onContentScroll={handleMockContentScroll}
          onOpenImage={openImageViewer}
          onSelectImage={setSelectedImageIndex}
          onShiftImage={shiftSelectedImage}
          onShare={() => void shareCurrentPost()}
          selectedImageIndex={selectedImageIndex}
          title={title}
        />

        <aside className="runtimeDock" aria-label={t("venue.audienceSeat")} data-view={rightPanelView}>
          <div className="rightPanelTabs" role="tablist">
            <button
              className={rightPanelView === "audience" ? "active" : ""}
              role="tab"
              id="tab-audience"
              aria-selected={rightPanelView === "audience"}
              aria-controls="panel-audience"
              type="button"
              onClick={() => setRightPanelView("audience")}
            >
              {t("venue.audienceSeat")}
            </button>
            <button
              className={rightPanelView === "logs" ? "active" : ""}
              role="tab"
              id="tab-logs"
              aria-selected={rightPanelView === "logs"}
              aria-controls="panel-logs"
              type="button"
              onClick={() => setRightPanelView("logs")}
            >
              {t("venue.runtimeLog")}
            </button>
          </div>

          <section className="audiencePanel" aria-label={t("venue.audiencePanel")} role="tabpanel" id="panel-audience" aria-labelledby="tab-audience">
            <header className="audienceHeader">
              <div>
                <h2>{t("venue.audiencePanel")}</h2>
                <p>{t("venue.currentActive")} <strong>{activeCount}</strong> / {totalAudience}</p>
              </div>
            </header>

            <div className="seatFilters">
              {SEAT_FILTERS.map((filter) => (
                <button className={seatFilter === filter.key ? "active" : ""} key={filter.key} onClick={() => setSeatFilter(filter.key)}>
                  {t(`seatFilter.${filter.label}`)}
                  <span>{filterCounts[filter.key as keyof typeof filterCounts] ?? 0}</span>
                </button>
              ))}
            </div>

            <div className="seatLegend" aria-label={t("venue.legendAria")}>
              <span><i className="dot green" />{t("venue.legend.active")}</span>
              <span><i className="dot hollow" />{t("venue.legend.pending")}</span>
              <span><i className="dot gray" />{t("venue.legend.left")}</span>
              <span><i className="dot red" />{t("venue.legend.failed")}</span>
              <span><i className="legendIcon doubt">!</i>{t("venue.legend.doubt")}</span>
              <span><i className="legendIcon comment">●</i>{t("venue.legend.comment")}</span>
              <span><i className="legendIcon favorite">★</i>{t("venue.legend.favorite")}</span>
              <span><i className="legendIcon share">↗</i>{t("venue.legend.share")}</span>
              <span><i className="legendIcon like">♥</i>{t("venue.legend.like")}</span>
            </div>

            <div className="seatGrid">
              {filteredSeats.map((seat) => (
                <SeatCell key={seat.participantId} seat={seat} onClick={() => void openAudienceDetail(seat.participantId)} />
              ))}
              {filteredSeats.length === 0 && audienceSeats.length > 0 ? <p className="seatEmpty">{t("venue.noMatch")}</p> : null}
            </div>
          </section>

          <RuntimeLogStrip
            expanded={rightPanelView === "logs"}
            filter={consoleFilter}
            hasMore={hasMoreRuntimeLogs}
            isComplete={uiStatus === "completed"}
            loading={isLoadingRuntimeLogs}
            logs={runtimeLogs}
            tabMode
            panelId="panel-logs"
            tabId="tab-logs"
            onFilterChange={setConsoleFilter}
            onLoadMore={loadMoreRuntimeLogs}
            onScroll={handleRuntimeLogScroll}
          />
        </aside>
      </section>

      {selectedParticipantId ? (
        <div className="drawerOverlay audienceDetailOverlay" onClick={closeAudienceDetail}>
          <div className="audienceDrawer" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2>{t("venue.drawerTitle")}</h2>
              <button onClick={closeAudienceDetail} aria-label={t("venue.closeDetail")}><X size={20} /></button>
            </header>
            {audienceDetail ? (
              <AudienceDetailDrawerContent
                audienceDetail={audienceDetail}
                currentLiveLogs={(selectedParticipantId ? currentLiveLogsByAudience[selectedParticipantId] : []) ?? []}
              />
            ) : (
              <div className="drawerLoading"><Loader2 className="spin" size={20} />{t("venue.drawerLoading")}</div>
            )}
          </div>
        </div>
      ) : null}

      {appToastOverlay}
      {confirmDialogOverlay}
      {imageViewer}
    </main>
  );
}

function defaultAudienceDemographics(): CreateAudienceProfileRequest["demographics"] {
  return {
    gender: i18n.t("audienceFact.unlimited"),
    ageRange: i18n.t("audienceFact.unlimited"),
    cityTier: i18n.t("audienceFact.unlimited"),
    lifeStage: i18n.t("audienceFact.unlimited"),
    role: i18n.t("audienceFact.unlimited"),
    spendingPower: i18n.t("audienceFact.unlimited")
  };
}
