import type {
  AudienceGenerationProgressView,
  AudiencePlanFrame,
  AudiencePlanPreview,
  AudiencePlanProgressEvent,
  AudienceProfileExpansionFrame,
  AudienceSamplingPlanRevisionMessage,
  AudienceSamplingPlanRevisionProposal,
  AudienceSeatRevisionMessage,
  AudienceSeatRevisionProposal
} from "@trycue/shared/audience";
import type { ToolName } from "@trycue/shared/tool";
import type { ModelMessage } from "ai";

export type AudiencePersona = {
  profile: string;
  personality: string;
  mbtiType: string;
  responseStyle: string;
};

export type GeneratedAudience = {
  profileId?: string;
  persona: AudiencePersona;
  displayName: string;
};

export type AudienceProfilePlan = {
  profileId?: string;
  samplingLabel: string;
  demographics: Record<string, unknown>;
};

export type AudienceSamplingDirectiveDraft = {
  name: string;
  description: string;
  quantity: number;
  diversityAxes: string[];
  rationale: string;
};

export type AudienceSamplingPlanDraft = {
  reasoningTrace?: Array<{
    stage: string;
    text: string;
  }>;
  totalCount: number;
  planMarkdown: string;
  dimensions: string[];
  directives: AudienceSamplingDirectiveDraft[];
};

export type AudienceSamplingDirectiveView = AudienceSamplingDirectiveDraft & {
  id: string;
  sortOrder: number;
  expansionStatus?: string;
  expansionError?: string | null;
};

export type AudienceSamplingPlanViewForProvider = {
  planId: string;
  runId: string;
  totalCount: number;
  status: string;
  planMarkdown: string;
  dimensions: string[];
  directives: AudienceSamplingDirectiveView[];
};

export type ParsedToolCall = {
  toolName: ToolName;
  args: Record<string, unknown>;
  sdkCallId?: string;
  callIndex?: number;
  idempotencyKey?: string;
  rawToolCall?: Record<string, unknown>;
};
export type AgentToolCall = ParsedToolCall;


export type AudienceMessageContent =
  | string
  | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;

export type AudienceSessionMessage =
  | {
    role: "user";
    content: AudienceMessageContent;
  }
  | {
    role: "assistant";
    content: string | null;
    reasoningContent?: string;
    toolCalls?: ParsedToolCall[];
  }
  | {
    role: "tool";
    toolName: string;
    sdkCallId?: string;
    content: unknown;
  };

export type RunParticipantContext = {
  runId: string;
  participantId: string;
  actionId: string;
  stepIndex: number;
  journeyId: string;
  hasOpenedPost: boolean;
  displayName: string;
  persona: AudiencePersona;
  messages: ModelMessage[];
  availableTools: ToolName[];
  maxSteps?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  stepTimeoutMs?: number;
  uploadDir?: string;
};

export type RunParticipantResult = {
  thoughtText: string;
  reasoningText?: string;
  toolCalls: ParsedToolCall[];
  managedRuntime?: boolean;
  rawOutput: Record<string, unknown>;
  model: string;
  promptVersion: string;
  requestJson?: Record<string, unknown>;
  rawResponseJson?: Record<string, unknown>;
  parsedToolCallsJson?: unknown;
};

export type LlmTraceContext = {
  runId?: string;
  jobId?: string;
  profileId?: string;
  participantId?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

export interface AgentProvider {
  generateAudienceSamplingPlan(input: {
    title: string;
    coverImageUrl: string;
    imageUrls: string[];
    bodyText: string;
    count: number;
    onReasoningDelta?: (delta: string, meta?: { tokens?: number; tokenEstimate?: number }) => void | Promise<void>;
    onProgress?: (event: AudiencePlanProgressEvent) => void | Promise<void>;
    onFrame?: (frame: AudiencePlanFrame, preview: AudiencePlanPreview) => void | Promise<void>;
    trace?: LlmTraceContext;
  }): Promise<AudienceSamplingPlanDraft>;
  generateAudienceSamplingPlanRevision(input: {
    title: string;
    coverImageUrl: string;
    imageUrls: string[];
    bodyText: string;
    plan: AudienceSamplingPlanViewForProvider;
    messages: AudienceSamplingPlanRevisionMessage[];
    trace?: LlmTraceContext;
  }): Promise<AudienceSamplingPlanRevisionProposal>;
  generateAudienceSeatRevision(input: {
    title: string;
    coverImageUrl: string;
    imageUrls: string[];
    bodyText: string;
    plan: AudienceSamplingPlanViewForProvider | null;
    progress: AudienceGenerationProgressView;
    messages: AudienceSeatRevisionMessage[];
    trace?: LlmTraceContext;
  }): Promise<AudienceSeatRevisionProposal>;
  expandAudienceProfiles(input: {
    title: string;
    coverImageUrl: string;
    imageUrls: string[];
    bodyText: string;
    plan: AudienceSamplingPlanViewForProvider;
    directive: AudienceSamplingDirectiveView;
    chunkStart: number;
    chunkCount: number;
    onFrame: (frame: AudienceProfileExpansionFrame) => void | Promise<void>;
    trace?: LlmTraceContext;
  }): Promise<void>;
  generateAudiencePersona(input: {
    profile: {
      profileId: string;
      demographics: Record<string, unknown>;
    };
    platformName?: string;
    trace?: LlmTraceContext;
  }): Promise<GeneratedAudience>;
  runAudienceTurn(context: RunParticipantContext): Promise<RunParticipantResult>;
}
