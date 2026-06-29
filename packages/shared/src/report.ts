import { z } from "zod";
import { AudienceGroupRoleSchema } from "./audience.js";
import {
  CommentIntentSchema,
  ExitReasonCategorySchema,
  ExitReadingDepthSchema,
  InterestTrustLevelSchema
} from "./tool.js";

// ── 推荐结论 ──

export const RecommendationSchema = z.enum([
  "recommend_publish",
  "modify_then_publish",
  "not_recommend_current_version",
  "recommend_retest"
]);
export type Recommendation = z.infer<typeof RecommendationSchema>;

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
