import { z } from "zod";

// ── 观众生成与采样生命周期枚举 ──

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

export const AudienceGroupRoleSchema = z.enum([
  "core_target",
  "peripheral_target",
  "contrast",
  "exploratory",
  "unknown"
]);
export type AudienceGroupRole = z.infer<typeof AudienceGroupRoleSchema>;

// ── 采样计划 API 请求 ──

export const CreateAudienceSamplingPlanRequestSchema = z.object({
  replaceActive: z.boolean().optional().default(false)
});
export type CreateAudienceSamplingPlanRequest = z.infer<typeof CreateAudienceSamplingPlanRequestSchema>;

export const UpdateAudienceSamplingPlanRequestSchema = z.object({
  planMarkdown: z.string().trim().max(8000).optional(),
  dimensions: z.array(z.string().trim().min(1).max(120)).min(1).max(30).optional()
});
export type UpdateAudienceSamplingPlanRequest = z.infer<typeof UpdateAudienceSamplingPlanRequestSchema>;

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

// ── 采样计划视图 ──

export const AudienceSamplingDirectiveSchema = z.object({
  id: z.string(),
  sortOrder: z.number().int().min(0),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(1000),
  // docs/04 明确 directive.quantity 全部为正整数，与 CreateRequestSchema 的 min(1) 一致。
  quantity: z.number().int().min(1).max(1000),
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
  validation: AudienceSamplingPlanValidationSchema,
  // plan 失败时的具体错误信息（来自后端 reconcile 孤儿检测或 sampling plan job 失败）。
  // 前端在 plan.status === "failed" 时优先用它覆盖 generic 兜底文案。
  errorMessage: z.string().nullable().optional()
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

// ── Persona 与 Identity ──

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

// ── Seat Revision（观众席增删改协议） ──

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
