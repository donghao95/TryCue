import { z } from "zod";

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

export const AudienceIdentityStatusSchema = z.enum([
  "profile_only",
  "identity_queued",
  "identity_generating",
  "identity_ready",
  "identity_failed"
]);
export type AudienceIdentityStatus = z.infer<typeof AudienceIdentityStatusSchema>;

export const AudienceGenerationJobStatusSchema = z.enum([
  "queued",
  "planning",
  "generating",
  "completed",
  "failed",
  "canceled"
]);
export type AudienceGenerationJobStatus = z.infer<typeof AudienceGenerationJobStatusSchema>;

export const AudienceGenerationJobScopeSchema = z.enum(["sampling_plan", "profile_expansion", "identities", "single_identity"]);
export type AudienceGenerationJobScope = z.infer<typeof AudienceGenerationJobScopeSchema>;

export const AudienceSamplingPlanStatusSchema = z.enum([
  "draft",
  "planning",
  "ready_for_review",
  "confirmed",
  "expanding_profiles",
  "generating_identities",
  "ready",
  "ready_with_failures",
  "failed",
  "canceled"
]);
export type AudienceSamplingPlanStatus = z.infer<typeof AudienceSamplingPlanStatusSchema>;

export const AudienceSamplingDirectiveExpansionStatusSchema = z.enum(["pending", "generating", "ready", "failed"]);
export type AudienceSamplingDirectiveExpansionStatus = z.infer<typeof AudienceSamplingDirectiveExpansionStatusSchema>;

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

export const ToolNameSchema = z.enum([
  "open_post",
  "read_post",
  "view_comments",
  "like_post",
  "favorite_post",
  "share_post",
  "write_comment",
  "like_comment",
  "exit_browsing"
]);
export type ToolName = z.infer<typeof ToolNameSchema>;

// ── read_post / exit_browsing / write_comment structured enums ──
export const ReadDepthSchema = z.enum(["skim", "partial", "full"]);
export type ReadDepth = z.infer<typeof ReadDepthSchema>;

export const ExitReasonCategorySchema = z.enum([
  "not_relevant",
  "not_interested",
  "low_trust",
  "too_ad_like",
  "content_too_long",
  "need_more_evidence",
  "finished_normally",
  "no_more_action"
]);
export type ExitReasonCategory = z.infer<typeof ExitReasonCategorySchema>;

export const ExitReadingDepthSchema = z.enum(["feed_only", "skimmed", "partial", "full"]);
export type ExitReadingDepth = z.infer<typeof ExitReadingDepthSchema>;

export const InterestTrustLevelSchema = z.enum(["low", "medium", "high"]);
export type InterestTrustLevel = z.infer<typeof InterestTrustLevelSchema>;

export const CommentIntentSchema = z.enum([
  "ask",
  "doubt",
  "share_experience",
  "agree",
  "joke",
  "pushback"
]);
export type CommentIntent = z.infer<typeof CommentIntentSchema>;

export const ToolCategorySchema = z.enum(["navigation", "interaction"]);
export type ToolCategory = z.infer<typeof ToolCategorySchema>;

export const CUSTOM_AUDIENCE_MIN = 1;
export const CUSTOM_AUDIENCE_MAX = 10000;
export const CUSTOM_AUDIENCE_TOKEN_WARNING_THRESHOLD = 100;

export const ScaleSchema = z.enum(["quick", "standard", "custom"]);
export type Scale = z.infer<typeof ScaleSchema>;

export const RecommendationSchema = z.enum([
  "recommend_publish",
  "modify_then_publish",
  "not_recommend_current_version",
  "recommend_retest"
]);
export type Recommendation = z.infer<typeof RecommendationSchema>;

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

export const CreateAudienceSamplingPlanRequestSchema = z.object({
  replaceActive: z.boolean().optional().default(false)
});
export type CreateAudienceSamplingPlanRequest = z.infer<typeof CreateAudienceSamplingPlanRequestSchema>;

export const UpdateAudienceSamplingPlanRequestSchema = z.object({
  planMarkdown: z.string().trim().max(8000).optional(),
  dimensions: z.array(z.string().trim().min(1).max(120)).min(1).max(30).optional()
});
export type UpdateAudienceSamplingPlanRequest = z.infer<typeof UpdateAudienceSamplingPlanRequestSchema>;

export const AudienceGroupRoleSchema = z.enum([
  "core_target",
  "peripheral_target",
  "contrast",
  "exploratory",
  "unknown"
]);
export type AudienceGroupRole = z.infer<typeof AudienceGroupRoleSchema>;

export const CreateAudienceSamplingDirectiveRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(1000),
  quantity: z.number().int().min(1).max(1000),
  diversityAxes: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  rationale: z.string().trim().min(1).max(1000),
  groupRole: AudienceGroupRoleSchema.optional(),
  samplingReason: z.string().trim().max(500).optional(),
  sortOrder: z.number().int().min(0).optional()
});
export type CreateAudienceSamplingDirectiveRequest = z.infer<typeof CreateAudienceSamplingDirectiveRequestSchema>;

export const UpdateAudienceSamplingDirectiveRequestSchema = CreateAudienceSamplingDirectiveRequestSchema.partial();
export type UpdateAudienceSamplingDirectiveRequest = z.infer<typeof UpdateAudienceSamplingDirectiveRequestSchema>;

export const AudienceSamplingPlanRevisionOperationSchema = z.discriminatedUnion("op", [
  z.object({
    operationId: z.string().trim().min(1),
    op: z.literal("add_directive"),
    directive: CreateAudienceSamplingDirectiveRequestSchema,
    reason: z.string().trim().min(1).max(1000)
  }),
  z.object({
    operationId: z.string().trim().min(1),
    op: z.literal("update_directive"),
    directiveId: z.string().trim().min(1),
    patch: UpdateAudienceSamplingDirectiveRequestSchema.refine((value) => Object.keys(value).length > 0, "至少需要一个修改字段"),
    before: z.record(z.string(), z.unknown()).optional(),
    reason: z.string().trim().min(1).max(1000)
  }),
  z.object({
    operationId: z.string().trim().min(1),
    op: z.literal("delete_directive"),
    directiveId: z.string().trim().min(1),
    reason: z.string().trim().min(1).max(1000)
  })
]);
export type AudienceSamplingPlanRevisionOperation = z.infer<typeof AudienceSamplingPlanRevisionOperationSchema>;

export const AudienceSamplingPlanRevisionProposalSchema = z.object({
  proposalId: z.string().trim().min(1).optional(),
  summary: z.string().trim().min(1).max(2000),
  operations: z.array(AudienceSamplingPlanRevisionOperationSchema).max(20).default([]),
  totalCountChange: z.object({
    before: z.number().int().min(0),
    after: z.number().int().min(0)
  }).nullable().optional(),
  warnings: z.array(z.string().trim().min(1).max(1000)).default([])
});
export type AudienceSamplingPlanRevisionProposal = z.infer<typeof AudienceSamplingPlanRevisionProposalSchema>;

export const AudienceSamplingPlanRevisionMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  visibleText: z.string().trim().min(1).max(4000),
  hiddenMentionContexts: z.array(z.object({
    directiveId: z.string().trim().min(1),
    label: z.string().trim().min(1).max(80),
    context: z.unknown()
  })).default([]),
  proposal: AudienceSamplingPlanRevisionProposalSchema.optional()
});
export type AudienceSamplingPlanRevisionMessage = z.infer<typeof AudienceSamplingPlanRevisionMessageSchema>;

export const CreateAudienceSamplingPlanRevisionSuggestionRequestSchema = z.object({
  messages: z.array(AudienceSamplingPlanRevisionMessageSchema).min(1).max(30)
});
export type CreateAudienceSamplingPlanRevisionSuggestionRequest = z.infer<typeof CreateAudienceSamplingPlanRevisionSuggestionRequestSchema>;

export const RetryAudienceIdentitiesRequestSchema = z.object({
  profileIds: z.array(z.string().trim().min(1)).default([])
});
export type RetryAudienceIdentitiesRequest = z.infer<typeof RetryAudienceIdentitiesRequestSchema>;

export const AudienceSamplingDirectiveSchema = z.object({
  id: z.string(),
  sortOrder: z.number().int().min(0),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(1000),
  quantity: z.number().int().min(0).max(1000),
  diversityAxes: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  rationale: z.string().trim().min(1).max(1000),
  groupRole: AudienceGroupRoleSchema.default("unknown"),
  samplingReason: z.string().trim().max(500).default(""),
  expansionStatus: AudienceSamplingDirectiveExpansionStatusSchema,
  expansionError: z.string().nullable()
});
export type AudienceSamplingDirective = z.infer<typeof AudienceSamplingDirectiveSchema>;

export const AudienceSamplingPlanValidationSchema = z.object({
  quantityTotal: z.number().int(),
  expectedTotal: z.number().int(),
  isQuantityValid: z.boolean(),
  issues: z.array(z.string())
});
export type AudienceSamplingPlanValidation = z.infer<typeof AudienceSamplingPlanValidationSchema>;

export const AudienceSamplingPlanViewSchema = z.object({
  planId: z.string(),
  runId: z.string(),
  totalCount: z.number().int().min(0),
  status: AudienceSamplingPlanStatusSchema,
  planMarkdown: z.string(),
  dimensions: z.array(z.string()),
  confirmedAt: z.string().nullable(),
  directives: z.array(AudienceSamplingDirectiveSchema),
  validation: AudienceSamplingPlanValidationSchema
});
export type AudienceSamplingPlanView = z.infer<typeof AudienceSamplingPlanViewSchema>;

export const AudiencePlanProgressStageSchema = z.enum([
  "model_request",
  "public_reasoning",
  "dimensions",
  "directives",
  "quantities",
  "plan_summary"
]);
export type AudiencePlanProgressStage = z.infer<typeof AudiencePlanProgressStageSchema>;

export const AudiencePlanProgressEventSchema = z.object({
  stage: AudiencePlanProgressStageSchema,
  label: z.string().trim().min(1),
  detail: z.string().trim().min(1).optional(),
  directiveCount: z.number().int().min(0).optional(),
  quantityTotal: z.number().int().min(0).optional(),
  targetCount: z.number().int().min(0)
});
export type AudiencePlanProgressEvent = z.infer<typeof AudiencePlanProgressEventSchema>;

// ---------------------------------------------------------------------------
// Audience Plan Frame Protocol (NDJSON stream-native preview)
// ---------------------------------------------------------------------------

export const AudiencePlanFramePlanMarkdownDeltaSchema = z.object({
  type: z.literal("plan_markdown_delta"),
  text: z.string()
});

export const AudiencePlanFrameDimensionUpsertSchema = z.object({
  type: z.literal("dimension_upsert"),
  key: z.string().trim().min(1),
  label: z.string().trim().min(1)
});

export const AudiencePlanFrameDirectiveStartedSchema = z.object({
  type: z.literal("directive_started"),
  key: z.string().trim().min(1),
  sortOrder: z.number().int().min(0)
});

export const AudiencePlanFrameDirectivePatchSchema = z.object({
  type: z.literal("directive_patch"),
  key: z.string().trim().min(1),
  patch: z.object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().min(1).max(1000).optional(),
    quantity: z.number().int().min(1).max(1000).optional(),
    diversityAxes: z.array(z.string().trim().min(1).max(120)).min(1).max(20).optional(),
    rationale: z.string().trim().min(1).max(1000).optional()
  })
});

export const AudiencePlanFrameDirectiveCompletedSchema = z.object({
  type: z.literal("directive_completed"),
  key: z.string().trim().min(1)
});

export const AudiencePlanFramePlanCompletedSchema = z.object({
  type: z.literal("plan_completed"),
  totalCount: z.number().int().min(1)
});

export const AudiencePlanFrameParserErrorSchema = z.object({
  type: z.literal("parser_error"),
  line: z.string(),
  message: z.string()
});

export const AudiencePlanFrameValidationIssueSchema = z.object({
  type: z.literal("validation_issue"),
  key: z.string().trim().min(1).optional(),
  message: z.string()
});

export const AudiencePlanFrameSchema = z.discriminatedUnion("type", [
  AudiencePlanFramePlanMarkdownDeltaSchema,
  AudiencePlanFrameDimensionUpsertSchema,
  AudiencePlanFrameDirectiveStartedSchema,
  AudiencePlanFrameDirectivePatchSchema,
  AudiencePlanFrameDirectiveCompletedSchema,
  AudiencePlanFramePlanCompletedSchema,
  AudiencePlanFrameParserErrorSchema,
  AudiencePlanFrameValidationIssueSchema
]);
export type AudiencePlanFrame = z.infer<typeof AudiencePlanFrameSchema>;

// ---------------------------------------------------------------------------
// Audience Demographics Schema
// ---------------------------------------------------------------------------

export const AudienceDemographicsSchema = z.object({
  gender: z.string().trim().min(1).max(40),
  ageRange: z.string().trim().min(1).max(40),
  cityTier: z.string().trim().min(1).max(40),
  lifeStage: z.string().trim().min(1).max(40),
  role: z.string().trim().min(1).max(40),
  spendingPower: z.string().trim().min(1).max(40)
});

// ---------------------------------------------------------------------------
// Audience Profile Expansion Frame Protocol (NDJSON stream-native)
// ---------------------------------------------------------------------------

export const AudienceProfileCompletedFrameSchema = z.object({
  type: z.literal("profile_completed"),
  sampleIndex: z.number().int().min(0),
  profile: z.object({
    samplingLabel: z.string().trim().min(2).max(20),
    demographics: AudienceDemographicsSchema
  })
});
export type AudienceProfileCompletedFrame = z.infer<typeof AudienceProfileCompletedFrameSchema>;

export const AudienceProfileExpansionFrameSchema = z.discriminatedUnion("type", [
  AudienceProfileCompletedFrameSchema,
  AudiencePlanFrameParserErrorSchema,
  AudiencePlanFrameValidationIssueSchema
]);
export type AudienceProfileExpansionFrame = z.infer<typeof AudienceProfileExpansionFrameSchema>;

export const AudiencePlanPreviewDirectiveStatusSchema = z.enum(["streaming", "complete", "invalid"]);
export type AudiencePlanPreviewDirectiveStatus = z.infer<typeof AudiencePlanPreviewDirectiveStatusSchema>;

export const AudiencePlanPreviewDirectiveSchema = z.object({
  key: z.string(),
  sortOrder: z.number().int().min(0),
  status: AudiencePlanPreviewDirectiveStatusSchema,
  name: z.string().optional(),
  description: z.string().optional(),
  quantity: z.number().int().min(0).optional(),
  diversityAxes: z.array(z.string()).optional(),
  rationale: z.string().optional()
});
export type AudiencePlanPreviewDirective = z.infer<typeof AudiencePlanPreviewDirectiveSchema>;

export const AudiencePlanPreviewDimensionSchema = z.object({
  key: z.string(),
  label: z.string()
});

export const AudiencePlanPreviewSchema = z.object({
  planMarkdown: z.string(),
  dimensions: z.array(AudiencePlanPreviewDimensionSchema),
  directives: z.array(AudiencePlanPreviewDirectiveSchema),
  quantityTotal: z.number().int().min(0),
  targetCount: z.number().int().min(0),
  completed: z.boolean(),
  validationIssues: z.array(z.string())
});
export type AudiencePlanPreview = z.infer<typeof AudiencePlanPreviewSchema>;

export type AudienceGenerationDirectiveProgress = {
  directiveId: string;
  description: string;
  targetCount: number;
  profileCreatedCount: number;
  identityReadyCount: number;
  identityFailedCount: number;
  generationStatus: AudienceSamplingDirectiveExpansionStatus;
  generationError: string | null;
};

export type AudienceDemographics = {
  gender: string;
  ageRange: string;
  cityTier: string;
  lifeStage: string;
  role: string;
  spendingPower: string;
};

export type AudienceProfileView = {
  id: string;
  profileId: string;
  samplingPlanId: string | null;
  samplingDirectiveId: string | null;
  sampleIndex: number;
  generationJobId?: string | null;
  sortOrder: number;
  samplingLabel: string;
  demographicsJson: AudienceDemographics;
  identityStatus: AudienceIdentityStatus;
  identityError?: string | null;
  identityGeneratedAt?: string | null;
  generatedUserId?: string | null;
  generatedAgentId?: string | null;
  generatedPlatformAccountId?: string | null;
  identity?: {
    user?: {
      id: string;
      userType: string;
      nickname: string;
      avatarUrl?: string | null;
    } | null;
    agent?: {
      id: string;
      userId: string;
      memorySummary?: string | null;
    } | null;
    platformAccount?: {
      id: string;
      userId: string;
      platform: string;
    } | null;
    personaJson?: Record<string, unknown> | null;
    retentionPolicy?: string;
    favorited?: boolean;
    saved?: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type AudienceGenerationProgressView = {
  runId: string;
  planId: string | null;
  status: AudienceSamplingPlanStatus | "not_started";
  total: number;
  profileCreatedCount: number;
  identityReadyCount: number;
  identityFailedCount: number;
  activeJob?: AudienceGenerationJobView | null;
  directives: AudienceGenerationDirectiveProgress[];
  profiles: AudienceProfileView[];
};

export type AudienceGenerationJobView = {
  id: string;
  runId: string;
  scope: AudienceGenerationJobScope;
  status: AudienceGenerationJobStatus;
  active: boolean;
  profileId?: string | null;
  samplingPlanId?: string | null;
  samplingDirectiveId?: string | null;
  targetCount: number;
  batchSize: number;
  errorMessage?: string | null;
  attemptCount: number;
  heartbeatAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  canceledAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export const MBTI_TYPES = [
  "INTJ", "INTP", "ENTJ", "ENTP",
  "INFJ", "INFP", "ENFJ", "ENFP",
  "ISTJ", "ISFJ", "ESTJ", "ESFJ",
  "ISTP", "ISFP", "ESTP", "ESFP"
] as const;

export const AudiencePersonaJsonSchema = z.object({
  profile: z.string().trim().min(1).max(2000),
  personality: z.string().trim().min(1).max(2000),
  mbtiType: z.enum(MBTI_TYPES),
  responseStyle: z.string().trim().min(1).max(2000)
});
export type AudiencePersonaJson = z.infer<typeof AudiencePersonaJsonSchema>;

export const UpdateAudienceIdentityRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  avatarUrl: z.string().trim().max(1000).nullable().optional(),
  personaJson: AudiencePersonaJsonSchema.optional(),
  favorited: z.boolean().optional()
});
export type UpdateAudienceIdentityRequest = z.infer<typeof UpdateAudienceIdentityRequestSchema>;

export const FavoriteAudienceIdentityRequestSchema = z.object({
  favorited: z.boolean()
});
export type FavoriteAudienceIdentityRequest = z.infer<typeof FavoriteAudienceIdentityRequestSchema>;

export const CreateAudienceProfileRequestSchema = z.object({
  directiveId: z.string().trim().min(1),
  samplingLabel: z.string().trim().min(2).max(20),
  demographics: AudienceDemographicsSchema
});
export type CreateAudienceProfileRequest = z.infer<typeof CreateAudienceProfileRequestSchema>;

const AudienceSeatRevisionIdentityPatchSchema = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  avatarUrl: z.string().trim().max(1000).nullable().optional(),
  personaJson: AudiencePersonaJsonSchema.optional()
}).refine((value) => Object.keys(value).length > 0, "至少需要一个修改字段");

export const AudienceSeatRevisionOperationSchema = z.discriminatedUnion("op", [
  z.object({
    operationId: z.string().trim().min(1),
    op: z.literal("update_identity"),
    profileId: z.string().trim().min(1),
    patch: AudienceSeatRevisionIdentityPatchSchema,
    before: z.record(z.string(), z.unknown()).optional(),
    reason: z.string().trim().min(1).max(1000)
  }),
  z.object({
    operationId: z.string().trim().min(1),
    op: z.literal("regenerate_identity"),
    profileId: z.string().trim().min(1),
    reason: z.string().trim().min(1).max(1000)
  }),
  z.object({
    operationId: z.string().trim().min(1),
    op: z.literal("delete_profile"),
    profileId: z.string().trim().min(1),
    reason: z.string().trim().min(1).max(1000)
  }),
  z.object({
    operationId: z.string().trim().min(1),
    op: z.literal("favorite_identity"),
    profileId: z.string().trim().min(1),
    favorited: z.boolean(),
    reason: z.string().trim().min(1).max(1000)
  }),
  z.object({
    operationId: z.string().trim().min(1),
    op: z.literal("retry_identity"),
    profileId: z.string().trim().min(1),
    reason: z.string().trim().min(1).max(1000)
  }),
  z.object({
    operationId: z.string().trim().min(1),
    op: z.literal("add_profile"),
    directiveId: z.string().trim().min(1),
    samplingLabel: z.string().trim().min(2).max(20),
    demographics: AudienceDemographicsSchema,
    reason: z.string().trim().min(1).max(1000)
  })
]);
export type AudienceSeatRevisionOperation = z.infer<typeof AudienceSeatRevisionOperationSchema>;

export const AudienceSeatRevisionProposalSchema = z.object({
  proposalId: z.string().trim().min(1).optional(),
  summary: z.string().trim().min(1).max(2000),
  operations: z.array(AudienceSeatRevisionOperationSchema).max(20).default([]),
  warnings: z.array(z.string().trim().min(1).max(1000)).default([])
});
export type AudienceSeatRevisionProposal = z.infer<typeof AudienceSeatRevisionProposalSchema>;

export const AudienceSeatRevisionMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  visibleText: z.string().trim().min(1).max(4000),
  hiddenMentionContexts: z.array(z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("directive"),
      directiveId: z.string().trim().min(1),
      label: z.string().trim().min(1).max(80),
      context: z.unknown()
    }),
    z.object({
      kind: z.literal("profile"),
      profileId: z.string().trim().min(1),
      label: z.string().trim().min(1).max(80),
      context: z.unknown()
    })
  ])).default([]),
  proposal: AudienceSeatRevisionProposalSchema.optional()
});
export type AudienceSeatRevisionMessage = z.infer<typeof AudienceSeatRevisionMessageSchema>;

export const CreateAudienceSeatRevisionSuggestionRequestSchema = z.object({
  messages: z.array(AudienceSeatRevisionMessageSchema).min(1).max(30)
});
export type CreateAudienceSeatRevisionSuggestionRequest = z.infer<typeof CreateAudienceSeatRevisionSuggestionRequestSchema>;

export const LlmRuntimeModeSchema = z.enum(["mock", "real"]);
export type LlmRuntimeMode = z.infer<typeof LlmRuntimeModeSchema>;

export const LlmCapacityModeSchema = z.enum(["auto", "manual"]);
export type LlmCapacityMode = z.infer<typeof LlmCapacityModeSchema>;

export const LlmCapacityPresetSchema = z.enum(["conservative", "standard", "high_quota", "custom"]);
export type LlmCapacityPreset = z.infer<typeof LlmCapacityPresetSchema>;

export type LlmCapacityPresetValues = {
  initialRpm: number;
  minRpm: number;
  maxRpm: number;
  initialConcurrency: number;
  minConcurrency: number;
  maxConcurrency: number;
};

export const LLM_CAPACITY_PRESET_VALUES: Record<Exclude<LlmCapacityPreset, "custom">, LlmCapacityPresetValues> = {
  conservative: {
    initialRpm: 4,
    minRpm: 1,
    maxRpm: 30,
    initialConcurrency: 2,
    minConcurrency: 1,
    maxConcurrency: 2
  },
  standard: {
    initialRpm: 8,
    minRpm: 2,
    maxRpm: 60,
    initialConcurrency: 4,
    minConcurrency: 1,
    maxConcurrency: 4
  },
  high_quota: {
    initialRpm: 30,
    minRpm: 5,
    maxRpm: 300,
    initialConcurrency: 8,
    minConcurrency: 1,
    maxConcurrency: 16
  }
};

export const LlmCapacitySharedSchema = z.object({
  initialRpm: z.number().int().positive(),
  minRpm: z.number().int().positive(),
  maxRpm: z.number().int().positive(),
  hardMaxRpm: z.number().int().positive(),
  initialConcurrency: z.number().int().positive(),
  minConcurrency: z.number().int().positive(),
  maxConcurrency: z.number().int().positive(),
  hardMaxConcurrency: z.number().int().positive()
});
export type LlmCapacityShared = z.infer<typeof LlmCapacitySharedSchema>;

export const LlmCapacityRetrySchema = z.object({
  maxRetries: z.number().int().min(0).max(10)
});
export type LlmCapacityRetry = z.infer<typeof LlmCapacityRetrySchema>;

export const LlmCapacityAutoSchema = z.object({
  cooldownMs: z.number().int().positive(),
  successWindow: z.number().int().positive(),
  rpmIncreaseStep: z.number().int().positive()
});
export type LlmCapacityAuto = z.infer<typeof LlmCapacityAutoSchema>;

export const LlmCapacitySettingsSchema = z.object({
  mode: LlmCapacityModeSchema,
  preset: LlmCapacityPresetSchema,
  shared: LlmCapacitySharedSchema,
  retry: LlmCapacityRetrySchema,
  auto: LlmCapacityAutoSchema
});
export type LlmCapacitySettings = z.infer<typeof LlmCapacitySettingsSchema>;

export const LlmSettingsRequestSchema = z.object({
  provider: z.literal("openai-compatible").default("openai-compatible"),
  runtimeMode: LlmRuntimeModeSchema,
  apiKey: z.string().trim().optional(),
  clearApiKey: z.boolean().optional().default(false),
  baseUrl: z.string().trim().optional(),
  models: z.object({
    fast: z.string().trim().optional(),
    pro: z.string().trim().optional()
  }),
  capacity: LlmCapacitySettingsSchema.optional()
}).strict();
export type LlmSettingsRequest = z.infer<typeof LlmSettingsRequestSchema>;

export const ListModelsRequestSchema = z.object({
  apiKey: z.string().trim().optional(),
  baseUrl: z.string().trim().optional()
});
export type ListModelsRequest = z.infer<typeof ListModelsRequestSchema>;

export type LlmSettingsView = {
  provider: "openai-compatible";
  runtimeMode: LlmRuntimeMode;
  isConfigured: boolean;
  isRealConfigComplete: boolean;
  hasApiKey: boolean;
  apiKeyMasked: string;
  baseUrl: string;
  models: { fast: string; pro: string };
  capacity: LlmCapacitySettings;
  configPath: string;
};

export type ModelListItem = {
  id: string;
  ownedBy?: string;
};

export type LlmCapacityStatus = {
  mode: LlmCapacityMode;
  effectiveRpm: number;
  effectiveConcurrency: number;
  configuredMaxRpm: number;
  configuredMaxConcurrency: number;
  inFlight: number;
  queueSize: number;
  cooldownUntil?: string;
  recentLimitCount: number;
  lastLimitAt?: string;
  lastLimitReason?: string;
};

export const LlmCapacityProbeModeSchema = z.enum(["normal", "high_quota", "custom"]);
export type LlmCapacityProbeMode = z.infer<typeof LlmCapacityProbeModeSchema>;

export const LlmCapacityProbeRequestSchema = z.object({
  mode: LlmCapacityProbeModeSchema,
  maxRpm: z.number().int().positive().optional(),
  maxConcurrency: z.number().int().positive().optional(),
  model: z.string().trim().optional(),
  apiKey: z.string().trim().optional(),
  baseUrl: z.string().trim().optional()
}).strict();
export type LlmCapacityProbeRequest = z.infer<typeof LlmCapacityProbeRequestSchema>;

export type LlmCapacityProbeResult = {
  recommendedRpm: number;
  recommendedConcurrency: number;
  testedMaxRpm: number;
  testedMaxConcurrency: number;
  avgLatencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  levels: LlmCapacityProbeLevelResult[];
  warnings: string[];
};

export type LlmCapacityProbeLevelResult = {
  concurrency: number;
  sentRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rpm: number;
  successRate: number;
  avgLatencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  elapsedMs: number;
  selected: boolean;
  stopReason?: string;
};

export type LlmCapacityProbeJobStatus = "running" | "completed" | "failed" | "cancelled";
export type LlmCapacityProbeJobPhase = "starting" | "testing" | "cooldown" | "done";

export type LlmCapacityProbeJobStartView = {
  jobId: string;
  status: LlmCapacityProbeJobStatus;
};

export type LlmCapacityProbeJobView = {
  id: string;
  status: LlmCapacityProbeJobStatus;
  phase: LlmCapacityProbeJobPhase;
  currentRpm: number;
  currentConcurrency: number;
  currentLevelSentRequests: number;
  currentLevelSuccessfulRequests: number;
  currentLevelFailedRequests: number;
  currentLevelInputTokens: number;
  currentLevelOutputTokens: number;
  currentLevelTotalTokens: number;
  currentLevelAvgLatencyMs: number;
  currentLevelElapsedMs: number;
  currentLevelDurationMs: number;
  cooldownRemainingMs: number;
  cooldownTotalMs: number;
  sentRequests: number;
  elapsedMs: number;
  maxElapsedMs: number;
  successfulRequests: number;
  failedRequests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  stableRpm: number;
  stableConcurrency: number;
  levels: LlmCapacityProbeLevelResult[];
  message: string;
  result?: LlmCapacityProbeResult;
  error?: string;
};

export const ApplyRecommendedRequestSchema = z.object({
  recommendedRpm: z.number().int().positive().optional(),
  recommendedConcurrency: z.number().int().positive().optional(),
  testedMaxRpm: z.number().int().positive().optional(),
  testedMaxConcurrency: z.number().int().positive().optional(),
  maxRpm: z.number().int().positive().optional(),
  maxConcurrency: z.number().int().positive().optional()
}).strict().refine((value) => Boolean(value.recommendedRpm ?? value.maxRpm) && Boolean(value.recommendedConcurrency ?? value.maxConcurrency), {
  message: "需要提供正整数 recommendedRpm 和 recommendedConcurrency"
});
export type ApplyRecommendedRequest = z.infer<typeof ApplyRecommendedRequestSchema>;

export const ViewCommentsArgsSchema = z.object({
  postId: z.string().trim().min(1),
  cursor: z.string().nullable().optional(),
  sort: z.enum(["latest", "hot"]).nullable().optional()
});

export const PostIdArgsSchema = z.object({
  postId: z.string().trim().min(1)
});

/** Max character length for user/audience comments */
export const MAX_COMMENT_LENGTH = 200;

export const ReadPostArgsSchema = z.object({
  postId: z.string().trim().min(1),
  depth: ReadDepthSchema,
  focus: z.array(z.string().trim().min(1).max(20)).max(3).optional()
});
export type ReadPostArgs = z.infer<typeof ReadPostArgsSchema>;

export const ExitBrowsingArgsSchema = z.object({
  reasonCategory: ExitReasonCategorySchema,
  readingDepth: ExitReadingDepthSchema,
  interestLevel: InterestTrustLevelSchema,
  trustLevel: InterestTrustLevelSchema
});
export type ExitBrowsingArgs = z.infer<typeof ExitBrowsingArgsSchema>;

export const WriteCommentArgsSchema = z.object({
  postId: z.string().trim().min(1),
  intent: CommentIntentSchema,
  content: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
  replyToCommentId: z.string().nullable().optional()
});
export type WriteCommentArgs = z.infer<typeof WriteCommentArgsSchema>;

export const LikeCommentArgsSchema = z.object({
  commentId: z.string().trim().min(1)
});

export const ToolCallInputSchema = z.discriminatedUnion("toolName", [
  z.object({ toolName: z.literal("open_post"), args: z.object({}).default({}) }),
  z.object({ toolName: z.literal("read_post"), args: ReadPostArgsSchema }),
  z.object({ toolName: z.literal("view_comments"), args: ViewCommentsArgsSchema }),
  z.object({ toolName: z.literal("like_post"), args: PostIdArgsSchema }),
  z.object({ toolName: z.literal("favorite_post"), args: PostIdArgsSchema }),
  z.object({ toolName: z.literal("share_post"), args: PostIdArgsSchema }),
  z.object({ toolName: z.literal("write_comment"), args: WriteCommentArgsSchema }),
  z.object({ toolName: z.literal("like_comment"), args: LikeCommentArgsSchema }),
  z.object({ toolName: z.literal("exit_browsing"), args: ExitBrowsingArgsSchema })
]);
export type ToolCallInput = z.infer<typeof ToolCallInputSchema>;

export type ApiSuccess<T> = {
  success: true;
  data: T;
};

export type ApiFailure = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

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

export type CommentUpdatePatch = Partial<Pick<CommentItem, "likeCount" | "replyCount">>;

export type CommentUpdatedPayload = LiveEventPayload & {
  type: "comment.updated";
  commentId: string;
  patch: CommentUpdatePatch;
};

export type InsightItem = {
  id: string;
  level: string;
  title: string;
  evidence: string;
  simulatedTime?: number;
};

export type ActionLogItem = {
  id: string;
  participantId?: string | null;
  simulatedTime: number;
  action?: string | null;
  text: string;
  logType?: string;
  audienceName?: string;
  segment?: string;
  createdAt?: string;
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
    simulatedTime: number;
    action: string;
    observableLog: string;
    innerReaction?: string;
    decisionReason?: string;
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

export function ok<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

export function fail(code: string, message: string, details?: unknown): ApiFailure {
  return { success: false, error: { code, message, details } };
}

export function categoryForTool(toolName: ToolName): ToolCategory {
  return toolName === "like_post" || toolName === "favorite_post" || toolName === "share_post" || toolName === "write_comment" || toolName === "like_comment"
    ? "interaction"
    : "navigation";
}

/** Whether a tool records a "reading but not interacting" behavior (read_post). */
export function isReadTool(toolName: ToolName): boolean {
  return toolName === "read_post";
}

// ── Shared constants ──

/** Default platform display name */
export const DEFAULT_PLATFORM_NAME = "小红书";

/**
 * Unified metric dictionary for audience-behavior metrics.
 * Single source of truth for the Chinese label, English metric name, and a
 * short user-facing explanation. Both backend report generation and frontend
 * rendering should pull from this dictionary to keep wording consistent.
 *
 * Keys are the canonical metric identifiers used in EvidenceFunnel and
 * funnel/exit/comment analyses. Each entry is identified by its `key` field
 * so callers can also look up by enum value.
 */
export interface MetricDictionaryEntry {
  /** Canonical metric identifier (matches EvidenceFunnel field name where applicable) */
  key: string;
  /** Chinese display label, e.g. "快速浏览" */
  label: string;
  /** English metric name shown as a secondary hint, e.g. "readSkim" */
  englishName: string;
  /** Short user-facing explanation of what this metric means */
  description: string;
  /** Semantic bucket: "reading" | "action" | "rate" | "exit" | "comment" */
  category: "reading" | "action" | "rate" | "exit" | "comment";
}

export const METRIC_DICTIONARY: readonly MetricDictionaryEntry[] = [
  // Reading-depth metrics (人数)
  { key: "readActors", label: "阅读人数", englishName: "readActors", description: "发生过阅读行为的观众人数（按人去重，包含快速浏览/部分阅读/完整阅读）。", category: "reading" },
  { key: "readSkimActors", label: "快速浏览", englishName: "readSkimActors", description: "只扫了几眼或短停留的观众人数（按人去重）。通常说明标题吸引了点击，但正文开头没有快速建立继续阅读理由。", category: "reading" },
  { key: "readPartialActors", label: "部分阅读", englishName: "readPartialActors", description: "读了一部分后离开的观众人数（按人去重）。通常说明主题有一定吸引力，但正文结构、信息密度或中段承接存在问题。", category: "reading" },
  { key: "readFullActors", label: "完整阅读", englishName: "readFullActors", description: "基本读完整篇内容的观众人数（按人去重）。通常说明主题、结构和信息价值较好。", category: "reading" },
  { key: "deepReadActors", label: "深度阅读", englishName: "deepReadActors", description: "部分阅读 + 完整阅读的观众人数（按人去重）。", category: "reading" },
  // Action metrics (人数)
  { key: "exposedActors", label: "曝光人数", englishName: "exposedActors", description: "进入试映的观众人数，是漏斗最上层数字。", category: "action" },
  { key: "openedActors", label: "点开人数", englishName: "openedActors", description: "进入内容详情页的观众人数，说明标题、封面或主题有初步吸引力。", category: "action" },
  { key: "viewedCommentsActors", label: "查看评论人数", englishName: "viewedCommentsActors", description: "点开评论区的观众人数，通常说明内容引发了进一步了解或参与动机。", category: "action" },
  { key: "likedActors", label: "点赞人数", englishName: "likedActors", description: "点赞的观众人数（状态型行为，每人只算一次）。", category: "action" },
  { key: "favoritedActors", label: "收藏人数", englishName: "favoritedActors", description: "收藏的观众人数（状态型行为，每人只算一次）。反映内容的工具/复查价值。", category: "action" },
  { key: "commentedActors", label: "评论人数", englishName: "commentedActors", description: "发表过评论的观众人数（按人去重，一人可写多条评论）。", category: "comment" },
  { key: "sharedActors", label: "分享人数", englishName: "sharedActors", description: "分享的观众人数（按人去重）。反映内容的社交货币价值。", category: "action" },
  { key: "exitedActors", label: "离开人数", englishName: "exitedActors", description: "结束浏览的观众人数。结合 readingDepth / reasonCategory 可判断是正常离开还是风险离开。", category: "exit" },
  { key: "positiveActionActors", label: "正向行为人数", englishName: "positiveActionActors", description: "至少做过点赞/收藏/评论/分享之一的观众人数（按人去重，不能把行为相加）。", category: "action" },
  // Event metrics (次数)
  { key: "openEvents", label: "打开次数", englishName: "openEvents", description: "open_post 工具调用次数（含重复打开）。", category: "action" },
  { key: "readEvents", label: "阅读次数", englishName: "readEvents", description: "read_post 工具调用次数（含同一人多次阅读）。", category: "action" },
  { key: "commentEvents", label: "评论条数", englishName: "commentEvents", description: "write_comment 工具调用次数，即产生的评论总条数。", category: "comment" },
  { key: "shareEvents", label: "分享次数", englishName: "shareEvents", description: "share_post 工具调用次数。", category: "action" },
  { key: "exitEvents", label: "离开次数", englishName: "exitEvents", description: "exit_browsing 工具调用次数。", category: "exit" },
  // Rate metrics (全部用人数计算)
  { key: "openRate", label: "点开率", englishName: "openRate", description: "点开人数 / 曝光人数。反映标题封面在信息流阶段的吸引力。", category: "rate" },
  { key: "readRateAfterOpen", label: "点开后阅读率", englishName: "readRateAfterOpen", description: "阅读正文人数 / 点开人数。反映正文开头是否能留住人。", category: "rate" },
  { key: "deepReadRateAfterOpen", label: "点开后深度阅读率", englishName: "deepReadRateAfterOpen", description: "深度阅读人数 / 点开人数。", category: "rate" },
  { key: "favoriteRateAfterOpen", label: "点开后收藏率", englishName: "favoriteRateAfterOpen", description: "收藏人数 / 点开人数。反映内容的工具 / 复查价值。", category: "rate" },
  { key: "commentRateAfterOpen", label: "点开后评论率", englishName: "commentRateAfterOpen", description: "评论人数 / 点开人数。反映内容引发的讨论 / 提问动机。", category: "rate" },
  { key: "shareRateAfterOpen", label: "点开后分享率", englishName: "shareRateAfterOpen", description: "分享人数 / 点开人数。反映内容的社交货币价值。", category: "rate" },
  { key: "positiveActionRate", label: "正向行为率", englishName: "positiveActionRate", description: "至少做过正向行为的人数 / 点开人数。综合反映内容激发互动的能力。", category: "rate" }
] as const;

/** Lookup helper: returns the dictionary entry for a metric key, or undefined. */
export function getMetricEntry(key: string): MetricDictionaryEntry | undefined {
  return METRIC_DICTIONARY.find((entry) => entry.key === key);
}

// ── Report Decision Dashboard Types ──

export const EvidenceQualitySchema = z.enum(["low", "medium", "high"]);
export type EvidenceQuality = z.infer<typeof EvidenceQualitySchema>;

export const EvidenceRefTypeSchema = z.enum([
  "metric",
  "thought",
  "comment",
  "tool_call",
  "journey",
  "segment",
  "blocker",
  "group"
]);
export type EvidenceRefType = z.infer<typeof EvidenceRefTypeSchema>;

export const EvidenceRefSchema = z.object({
  id: z.string(),
  type: EvidenceRefTypeSchema,
  participantId: z.string().optional(),
  label: z.string()
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const EvidenceItemSchema = z.object({
  id: z.string(),
  type: EvidenceRefTypeSchema,
  title: z.string(),
  content: z.string(),
  participantId: z.string().optional(),
  raw: z.unknown().optional()
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

// ── EvidencePack sub-structures ──

export const EvidencePackMetaSchema = z.object({
  runId: z.string(),
  contentVersionId: z.string(),
  audienceCount: z.number().int(),
  completedCount: z.number().int(),
  failedCount: z.number().int(),
  skippedCount: z.number().int(),
  generatedAt: z.string(),
  evidenceQuality: EvidenceQualitySchema,
  evidenceQualityReason: z.string()
});
export type EvidencePackMeta = z.infer<typeof EvidencePackMetaSchema>;

export const EvidenceContentSnapshotSchema = z.object({
  title: z.string(),
  bodyPreview: z.string(),
  platformName: z.string(),
  imageCount: z.number().int()
});
export type EvidenceContentSnapshot = z.infer<typeof EvidenceContentSnapshotSchema>;

export const EvidenceFunnelSchema = z.object({
  // ── 参与者人数（actor count，按 participant 去重）──
  exposedActors: z.number().int(),
  openedActors: z.number().int(),
  readActors: z.number().int(),
  deepReadActors: z.number().int(),
  readSkimActors: z.number().int(),
  readPartialActors: z.number().int(),
  readFullActors: z.number().int(),
  viewedCommentsActors: z.number().int(),
  likedActors: z.number().int(),
  favoritedActors: z.number().int(),
  commentedActors: z.number().int(),
  sharedActors: z.number().int(),
  exitedActors: z.number().int(),
  positiveActionActors: z.number().int(),
  // ── 事件/次数指标 ──
  openEvents: z.number().int(),
  readEvents: z.number().int(),
  commentEvents: z.number().int(),
  shareEvents: z.number().int(),
  exitEvents: z.number().int(),
  // ── 比率（全部用人数计算）──
  openRate: z.number().nullable(),
  readRateAfterOpen: z.number().nullable(),
  deepReadRateAfterOpen: z.number().nullable(),
  favoriteRateAfterOpen: z.number().nullable(),
  commentRateAfterOpen: z.number().nullable(),
  shareRateAfterOpen: z.number().nullable(),
  positiveActionRate: z.number().nullable()
});
export type EvidenceFunnel = z.infer<typeof EvidenceFunnelSchema>;

export const EvidenceExitAnalysisSchema = z.object({
  byReasonCategory: z.record(ExitReasonCategorySchema, z.number().int()),
  byReadingDepth: z.record(ExitReadingDepthSchema, z.number().int()),
  byInterestLevel: z.record(InterestTrustLevelSchema, z.number().int()),
  byTrustLevel: z.record(InterestTrustLevelSchema, z.number().int()),
  riskExitCount: z.number().int(),
  riskExitRate: z.number().nullable()
});
export type EvidenceExitAnalysis = z.infer<typeof EvidenceExitAnalysisSchema>;

export const EvidenceCommentSchema = z.object({
  evidenceId: z.string(),
  participantId: z.string(),
  displayName: z.string(),
  intent: CommentIntentSchema,
  content: z.string(),
  simulatedTime: z.number().optional()
});
export type EvidenceComment = z.infer<typeof EvidenceCommentSchema>;

export const EvidenceCommentAnalysisSchema = z.object({
  totalComments: z.number().int(),
  byIntent: z.record(CommentIntentSchema, z.number().int()),
  representativeComments: z.array(EvidenceCommentSchema)
});
export type EvidenceCommentAnalysis = z.infer<typeof EvidenceCommentAnalysisSchema>;

export const ThoughtPhaseSchema = z.enum(["feed", "post", "comments", "exit"]);
export type ThoughtPhase = z.infer<typeof ThoughtPhaseSchema>;

export const EvidenceThoughtSchema = z.object({
  evidenceId: z.string(),
  participantId: z.string(),
  displayName: z.string(),
  phase: ThoughtPhaseSchema,
  text: z.string(),
  beforeAction: z.string().optional(),
  simulatedTime: z.number().optional()
});
export type EvidenceThought = z.infer<typeof EvidenceThoughtSchema>;

export const ThoughtThemeSchema = z.object({
  theme: z.string(),
  count: z.number().int(),
  examples: z.array(EvidenceRefSchema)
});
export type ThoughtTheme = z.infer<typeof ThoughtThemeSchema>;

export const EvidenceThoughtAnalysisSchema = z.object({
  representativeThoughts: z.array(EvidenceThoughtSchema),
  themes: z.array(ThoughtThemeSchema)
});
export type EvidenceThoughtAnalysis = z.infer<typeof EvidenceThoughtAnalysisSchema>;

export const SegmentKeySchema = z.enum([
  "persuaded",
  "interested_but_not_convinced",
  "skipped",
  "skeptical"
]);
export type SegmentKey = z.infer<typeof SegmentKeySchema>;

export const SegmentEvidenceSchema = z.object({
  key: SegmentKeySchema,
  name: z.string(),
  participantIds: z.array(z.string()),
  size: z.number().int(),
  percentage: z.number().nullable(),
  summary: z.string(),
  commonTraits: z.array(z.string()),
  evidenceRefs: z.array(EvidenceRefSchema)
});
export type SegmentEvidence = z.infer<typeof SegmentEvidenceSchema>;

export const EvidenceSegmentsSchema = z.object({
  persuaded: SegmentEvidenceSchema,
  interestedButNotConvinced: SegmentEvidenceSchema,
  skipped: SegmentEvidenceSchema,
  skeptical: SegmentEvidenceSchema
});
export type EvidenceSegments = z.infer<typeof EvidenceSegmentsSchema>;

export const BlockerTypeSchema = z.enum([
  "feed_attraction",
  "opening_retention",
  "trust_evidence",
  "action_motivation",
  "comment_risk",
  "target_mismatch",
  "evidence_quality"
]);
export type BlockerType = z.infer<typeof BlockerTypeSchema>;

export const SeveritySchema = z.enum(["low", "medium", "high"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const EvidenceBlockerSchema = z.object({
  blockerType: BlockerTypeSchema,
  severity: SeveritySchema,
  affectedCount: z.number().int(),
  summary: z.string(),
  evidenceRefs: z.array(EvidenceRefSchema)
});
export type EvidenceBlocker = z.infer<typeof EvidenceBlockerSchema>;

// ── AudienceGroupAnalysis (replaces TargetAudienceFit) ──

/**
 * TargetAudienceFit classifies how well a sampling group maps to the content's
 * intended audience. Used by the report to weight group feedback: core_target
 * groups should drive revision direction, contrast groups only provide edge cases.
 *
 * - high:   core target audience — feedback should drive main revision direction
 * - medium: adjacent audience — feedback used to fill gaps and surface boundary issues
 * - low:    non-target audience — feedback only as misclick / misunderstanding reference
 */
export const TargetAudienceFitSchema = z.enum(["high", "medium", "low"]);
export type TargetAudienceFit = z.infer<typeof TargetAudienceFitSchema>;

/**
 * ModificationWeight indicates how strongly this group's feedback should influence
 * the revision plan. Distinct from targetAudienceFit because a high-fit group that
 * showed no engagement may still get low modification weight.
 *
 * - high:   feedback should be a primary input to revision plan
 * - medium: feedback used as secondary signal
 * - low:    feedback only as boundary / edge case reference
 */
export const ModificationWeightSchema = z.enum(["high", "medium", "low"]);
export type ModificationWeight = z.infer<typeof ModificationWeightSchema>;

export const AudienceGroupStatsSchema = z.object({
  directiveId: z.string(),
  directiveName: z.string(),
  role: AudienceGroupRoleSchema,
  confidence: z.enum(["low", "medium", "high"]),
  /** How well this group maps to the content's intended audience. */
  targetAudienceFit: TargetAudienceFitSchema.optional(),
  /** How strongly this group's feedback should influence the revision plan. */
  modificationWeight: ModificationWeightSchema.optional(),
  /** Free-text typical motivation observed in this group. */
  typicalMotivation: z.string().optional(),
  /** Free-text main barrier observed in this group. */
  mainBarrier: z.string().optional(),
  /** Suggested handling for this group. */
  handlingSuggestion: z.string().optional(),
  total: z.number().int(),
  opened: z.number().int(),
  readSkim: z.number().int(),
  readPartial: z.number().int(),
  readFull: z.number().int(),
  viewedComments: z.number().int(),
  liked: z.number().int(),
  favorited: z.number().int(),
  commented: z.number().int(),
  shared: z.number().int(),
  positiveActionActors: z.number().int().optional(),
  riskExitCount: z.number().int(),
  mainExitReasons: z.array(z.string()),
  mainCommentIntents: z.array(z.string()),
  representativeThoughts: z.array(EvidenceRefSchema),
  representativeComments: z.array(EvidenceRefSchema),
  representativeJourneys: z.array(EvidenceRefSchema),
  evidenceRefs: z.array(EvidenceRefSchema)
});
export type AudienceGroupStats = z.infer<typeof AudienceGroupStatsSchema>;

export const AudienceGroupAnalysisSchema = z.object({
  groups: z.array(AudienceGroupStatsSchema),
  inferredGroups: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
  crossGroupSummary: z.string(),
  coreTargetHit: z.boolean(),
  coreTargetHighInterestLowTrust: z.boolean(),
  peripheralExpansionOpportunity: z.boolean(),
  contrastSkipExpected: z.boolean(),
  contrastUnexpectedRisk: z.boolean(),
  evidenceRefs: z.array(EvidenceRefSchema)
});
export type AudienceGroupAnalysis = z.infer<typeof AudienceGroupAnalysisSchema>;

// ── JourneySample ──

export const JourneySampleSchema = z.object({
  evidenceId: z.string(),
  participantId: z.string(),
  displayName: z.string(),
  segmentKeys: z.array(SegmentKeySchema),
  summary: z.string(),
  steps: z.array(z.object({
    action: z.string(),
    thought: z.string().optional(),
    toolOutputSummary: z.string().optional(),
    simulatedTime: z.number().optional()
  })),
  evidenceRefs: z.array(EvidenceRefSchema)
});
export type JourneySample = z.infer<typeof JourneySampleSchema>;

// ── EvidencePack top-level ──

export const EvidencePackSchema = z.object({
  meta: EvidencePackMetaSchema,
  content: EvidenceContentSnapshotSchema,
  funnel: EvidenceFunnelSchema,
  exitAnalysis: EvidenceExitAnalysisSchema,
  commentAnalysis: EvidenceCommentAnalysisSchema,
  thoughtAnalysis: EvidenceThoughtAnalysisSchema,
  segments: EvidenceSegmentsSchema,
  blockers: z.array(EvidenceBlockerSchema),
  audienceGroups: AudienceGroupAnalysisSchema,
  journeySamples: z.array(JourneySampleSchema),
  evidenceIndex: z.record(z.string(), EvidenceItemSchema)
});
export type EvidencePack = z.infer<typeof EvidencePackSchema>;

// ── ReportOutput sub-structures ──

export const VerdictCardSchema = z.object({
  recommendation: RecommendationSchema,
  recommendationLabel: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  headline: z.string(),
  oneSentence: z.string(),
  topOpportunity: z.string(),
  topRisk: z.string(),
  priorityFix: z.string(),
  evidenceRefs: z.array(EvidenceRefSchema)
});
export type VerdictCard = z.infer<typeof VerdictCardSchema>;

export const FunnelCardSchema = z.object({
  audienceCount: z.number().int(),
  completedCount: z.number().int(),
  failedCount: z.number().int(),
  // ── 参与者人数（actor count，按 participant 去重）──
  exposedActors: z.number().int(),
  openedActors: z.number().int(),
  readActors: z.number().int(),
  deepReadActors: z.number().int(),
  readSkimActors: z.number().int(),
  readPartialActors: z.number().int(),
  readFullActors: z.number().int(),
  viewedCommentsActors: z.number().int(),
  likedActors: z.number().int(),
  favoritedActors: z.number().int(),
  commentedActors: z.number().int(),
  sharedActors: z.number().int(),
  exitedActors: z.number().int(),
  positiveActionActors: z.number().int(),
  // ── 事件/次数指标 ──
  openEvents: z.number().int(),
  readEvents: z.number().int(),
  commentEvents: z.number().int(),
  shareEvents: z.number().int(),
  exitEvents: z.number().int(),
  // ── 比率（全部用人数计算）──
  openRate: z.number().nullable(),
  readRateAfterOpen: z.number().nullable(),
  deepReadRateAfterOpen: z.number().nullable(),
  favoriteRateAfterOpen: z.number().nullable(),
  commentRateAfterOpen: z.number().nullable(),
  shareRateAfterOpen: z.number().nullable(),
  positiveActionRate: z.number().nullable(),
  notes: z.string()
});
export type FunnelCard = z.infer<typeof FunnelCardSchema>;

export const MainBlockerCardSchema = z.object({
  blockerType: BlockerTypeSchema,
  title: z.string(),
  severity: SeveritySchema,
  affectedCount: z.number().int(),
  summary: z.string(),
  diagnosis: z.string(),
  evidenceRefs: z.array(EvidenceRefSchema)
});
export type MainBlockerCard = z.infer<typeof MainBlockerCardSchema>;

export const SegmentCardSchema = z.object({
  key: SegmentKeySchema,
  name: z.string(),
  size: z.number().int(),
  percentage: z.number().nullable(),
  summary: z.string(),
  commonTraits: z.array(z.string()),
  representativeThoughts: z.array(EvidenceRefSchema),
  representativeComments: z.array(EvidenceRefSchema),
  suggestedAction: z.string(),
  evidenceRefs: z.array(EvidenceRefSchema)
});
export type SegmentCard = z.infer<typeof SegmentCardSchema>;

export const DiagnosticAreaSchema = z.enum([
  "feed_attraction",
  "reading_retention",
  "trust_evidence",
  "save_value",
  "comment_risk"
]);
export type DiagnosticArea = z.infer<typeof DiagnosticAreaSchema>;

export const DiagnosticStatusSchema = z.enum(["strong", "medium", "weak", "risk"]);
export type DiagnosticStatus = z.infer<typeof DiagnosticStatusSchema>;

export const DiagnosticCardSchema = z.object({
  area: DiagnosticAreaSchema,
  title: z.string(),
  status: DiagnosticStatusSchema,
  /** 判断：当前维度的结论（如"中等，有主题，但缺少强收益或强冲突"） */
  finding: z.string(),
  /** 原因：为什么会这样，引用证据解释机制（如"标题能让人点进来，但正文开头没有快速兑现标题承诺"）。Optional for backward compat. */
  reason: z.string().optional(),
  evidenceRefs: z.array(EvidenceRefSchema),
  suggestedFix: z.string()
});
export type DiagnosticCard = z.infer<typeof DiagnosticCardSchema>;

export const KeepAndChangeSchema = z.object({
  keep: z.array(z.object({
    item: z.string(),
    reason: z.string(),
    evidenceRefs: z.array(EvidenceRefSchema)
  })),
  change: z.array(z.object({
    item: z.string(),
    reason: z.string(),
    evidenceRefs: z.array(EvidenceRefSchema)
  }))
});
export type KeepAndChange = z.infer<typeof KeepAndChangeSchema>;

export const RevisionPrioritySchema = z.enum(["P0", "P1", "P2"]);
export type RevisionPriority = z.infer<typeof RevisionPrioritySchema>;

/**
 * ImpactLevel and CostLevel are used by the priority matrix chart (spec §12).
 * impactLevel = how much this issue affects the publish decision.
 * costLevel = how much effort the fix requires.
 * Both optional for backward compat with older reports; frontend derives from
 * priority when absent (P0→high, P1→medium, P2→low) and defaults cost to medium.
 */
export const ImpactLevelSchema = z.enum(["high", "medium", "low"]);
export type ImpactLevel = z.infer<typeof ImpactLevelSchema>;

export const CostLevelSchema = z.enum(["high", "medium", "low"]);
export type CostLevel = z.infer<typeof CostLevelSchema>;

export const RevisionActionSchema = z.object({
  priority: RevisionPrioritySchema,
  title: z.string(),
  action: z.string(),
  reason: z.string(),
  affectedSegment: z.union([SegmentKeySchema, z.literal("overall")]),
  expectedImpact: z.string(),
  retestQuestion: z.string(),
  evidenceRefs: z.array(EvidenceRefSchema),
  /** Spec §12.4: impact level for the priority matrix. Optional for backward compat. */
  impactLevel: ImpactLevelSchema.optional(),
  /** Spec §12.4: fix cost level for the priority matrix. Optional for backward compat. */
  costLevel: CostLevelSchema.optional()
});
export type RevisionAction = z.infer<typeof RevisionActionSchema>;

export const RetestQuestionSchema = z.object({
  question: z.string(),
  /** Hypothesis label in H1/H2/H3 form (e.g. "H1: 如果标题前置具体收益，点击后的继续阅读比例会提升"). Optional for backward compat. */
  hypothesis: z.string().optional(),
  /** Suggested test version label (e.g. "A 版：强化省钱避坑"). Optional. */
  testVersionLabel: z.string().optional(),
  relatedAction: z.string(),
  metricToWatch: z.string(),
  expectedDirection: z.string()
});
export type RetestQuestion = z.infer<typeof RetestQuestionSchema>;

// ── ReportOutput top-level ──

/**
 * KeyFinding is a fixed-structure insight that follows the
 * "结论 → 证据 → 影响 → 动作" pattern required by the report optimization spec.
 * The first screen surfaces up to 3 key findings so the user can immediately
 * see the most important takeaways beyond the verdict.
 */
export const KeyFindingSchema = z.object({
  /** 结论：one-line finding statement (e.g. "装修初期人群对主题有兴趣，但开头承接不足") */
  finding: z.string(),
  /** 证据：evidence supporting the finding, referencing EvidenceRef ids */
  evidence: z.string(),
  /** 影响：what happens if this is not addressed (e.g. "内容可能有点击，但停留和互动会弱") */
  impact: z.string(),
  /** 动作：concrete next action (e.g. "将正文前三行改成问题 + 代价 + 结论") */
  action: z.string(),
  evidenceRefs: z.array(EvidenceRefSchema).default([])
});
export type KeyFinding = z.infer<typeof KeyFindingSchema>;

/**
 * RewriteSuggestion is the highest-value module of the report: instead of telling
 * the user to "optimize the title", it provides copyable concrete rewrites.
 * Each sub-item carries a `reason` explaining why this rewrite is suggested.
 */
export const RewriteSuggestionItemSchema = z.object({
  text: z.string(),
  reason: z.string()
});
export type RewriteSuggestionItem = z.infer<typeof RewriteSuggestionItemSchema>;

export const RewriteSuggestionsSchema = z.object({
  /** 2-3 recommended titles with reasons */
  recommendedTitles: z.array(RewriteSuggestionItemSchema).default([]),
  /** Optional recommended cover text / overlay copy */
  recommendedCoverText: RewriteSuggestionItemSchema.optional(),
  /** Recommended opening (前 3 行) */
  recommendedOpening: RewriteSuggestionItemSchema.optional(),
  /** Optional recommended body structure outline */
  recommendedBodyStructure: RewriteSuggestionItemSchema.optional(),
  /** Recommended comment-prompt CTA at the end of the post */
  recommendedCommentPrompt: RewriteSuggestionItemSchema.optional(),
  /** Optional recommended hashtag / topic tags */
  recommendedTags: z.array(z.string()).default([])
});
export type RewriteSuggestions = z.infer<typeof RewriteSuggestionsSchema>;

export const ReportOutputSchema = z.object({
  verdict: VerdictCardSchema,
  funnel: FunnelCardSchema,
  mainBlocker: MainBlockerCardSchema,
  audienceGroupAnalysis: AudienceGroupAnalysisSchema,
  segments: z.array(SegmentCardSchema),
  diagnostics: z.array(DiagnosticCardSchema),
  keepAndChange: KeepAndChangeSchema,
  revisionPlan: z.array(RevisionActionSchema),
  retestPlan: z.array(RetestQuestionSchema),
  evidenceRefs: z.array(EvidenceRefSchema),
  /** Fixed-structure key findings (结论 → 证据 → 影响 → 动作). First screen surfaces up to 3. Optional for backward compat with older reports. */
  keyFindings: z.array(KeyFindingSchema).optional(),
  /** Copyable concrete rewrite suggestions (titles / opening / comment prompt / tags). Optional for backward compat. */
  rewriteSuggestions: RewriteSuggestionsSchema.optional(),
  summaryMarkdown: z.string().optional()
}).strict();
export type ReportOutput = z.infer<typeof ReportOutputSchema>;
