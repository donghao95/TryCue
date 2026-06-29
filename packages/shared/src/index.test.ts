import { describe, expect, it } from "vitest";
import type {
  AudienceDetail,
  AudienceSeat,
  AudienceSeatStatus,
  AudienceStatusUpdatedPayload,
  AudienceActionHappenedPayload,
  AudiencePlanPreview,
  CommentUpdatedPayload
} from "./index.js";
import {
  AudienceGenerationJobScopeSchema,
  AudiencePlanFrameSchema,
  AudienceProfileExpansionFrameSchema,
  AudiencePlanPreviewDirectiveSchema,
  AudiencePlanPreviewDirectiveStatusSchema,
  AudiencePlanPreviewSchema,
  AudiencePlanProgressEventSchema,
  AudienceSamplingPlanRevisionOperationSchema,
  AudienceSamplingPlanRevisionProposalSchema,
  AudienceSamplingPlanViewSchema,
  AudienceSeatRevisionOperationSchema,
  AudienceSeatRevisionProposalSchema,
  CreateAudienceSamplingDirectiveRequestSchema,
  CreateAudienceSamplingPlanRequestSchema,
  CreateAudienceSamplingPlanRevisionSuggestionRequestSchema,
  CreateAudienceSeatRevisionSuggestionRequestSchema,
  CreateRunRequestSchema,
  LlmSettingsRequestSchema,
  RetryRunRequestSchema,
  // Report decision dashboard schemas (added in Stage 2 shared extension)
  ReportOutputSchema,
  KeyFindingSchema,
  RewriteSuggestionsSchema,
  RewriteSuggestionItemSchema,
  TargetAudienceFitSchema,
  ModificationWeightSchema,
  DiagnosticCardSchema,
  RetestQuestionSchema,
  EvidenceFunnelSchema,
  AudienceGroupStatsSchema,
  AudienceGroupAnalysisSchema,
  METRIC_DICTIONARY,
  getMetricEntry
} from "./index.js";

describe("shared contracts", () => {
  it("validates create run payloads", () => {
    expect(
      CreateRunRequestSchema.safeParse({
        title: "宝宝用品避坑",
        coverImageUrl: "/uploads/demo.png",
        imageUrls: ["/uploads/demo.png", "/uploads/detail.png"],
        bodyText: "这是一段超过二十个字的正文，用于创建一次 AI 试映任务。",
        scale: "quick"
      }).success
    ).toBe(true);

    expect(
      CreateRunRequestSchema.safeParse({
        title: "宝宝用品避坑",
        coverImageUrl: "/uploads/demo.png",
        bodyText: "这是一段超过二十个字的正文，用于创建一次 AI 试映任务。",
        scale: "custom",
        audienceCount: 10000
      }).success
    ).toBe(true);

    expect(
      CreateRunRequestSchema.safeParse({
        title: "",
        coverImageUrl: "",
        bodyText: "too short",
        scale: "quick"
      }).success
    ).toBe(false);

    expect(
      CreateRunRequestSchema.safeParse({
        title: "宝宝用品避坑",
        coverImageUrl: "/uploads/demo.png",
        imageUrls: Array.from({ length: 10 }, (_, index) => `/uploads/${index}.png`),
        bodyText: "这是一段超过二十个字的正文，用于创建一次 AI 试映任务。",
        scale: "quick"
      }).success
    ).toBe(false);

    expect(
      CreateRunRequestSchema.safeParse({
        title: "宝宝用品避坑",
        coverImageUrl: "/uploads/demo.png",
        bodyText: "这是一段超过二十个字的正文，用于创建一次 AI 试映任务。",
        scale: "custom"
      }).success
    ).toBe(false);

    expect(
      CreateRunRequestSchema.safeParse({
        title: "宝宝用品避坑",
        coverImageUrl: "/uploads/demo.png",
        bodyText: "这是一段超过二十个字的正文，用于创建一次 AI 试映任务。",
        scale: "standard",
        audienceCount: 40
      }).success
    ).toBe(false);

    expect(
      CreateRunRequestSchema.safeParse({
        title: "宝宝用品避坑",
        coverImageUrl: "/uploads/demo.png",
        bodyText: "这是一段超过二十个字的正文，用于创建一次 AI 试映任务。",
        scale: "custom",
        audienceCount: 10001
      }).success
    ).toBe(false);

    expect(
      CreateRunRequestSchema.safeParse({
        title: "宝宝用品避坑",
        coverImageUrl: "//example.com/tracker.png",
        bodyText: "这是一段超过二十个字的正文，用于创建一次 AI 试映任务。",
        scale: "quick"
      }).success
    ).toBe(false);

    expect(
      CreateRunRequestSchema.safeParse({
        title: "宝宝用品避坑",
        coverImageUrl: "javascript:alert(1)",
        bodyText: "这是一段超过二十个字的正文，用于创建一次 AI 试映任务。",
        scale: "quick"
      }).success
    ).toBe(false);
  });

  it("validates audience plan progress events", () => {
    expect(AudiencePlanProgressEventSchema.safeParse({
      stage: "quantities",
      label: "人数分配",
      directiveCount: 4,
      quantityTotal: 12,
      targetCount: 12
    }).success).toBe(true);

    expect(AudiencePlanProgressEventSchema.safeParse({
      stage: "allocation",
      label: "旧阶段",
      targetCount: 12
    }).success).toBe(false);
  });

  it("validates retry run request with participantId and strategy", () => {
    expect(RetryRunRequestSchema.parse({ participantId: "p1" })).toEqual({ participantId: "p1", strategy: "continue_retry" });
    expect(RetryRunRequestSchema.parse({ participantId: "p1", strategy: "continue_retry" })).toEqual({ participantId: "p1", strategy: "continue_retry" });
    expect(RetryRunRequestSchema.parse({ participantId: "p1", strategy: "clean_retry" })).toEqual({ participantId: "p1", strategy: "clean_retry" });
    expect(RetryRunRequestSchema.safeParse({ participantId: "" }).success).toBe(false);
    expect(RetryRunRequestSchema.safeParse({ participantId: "p1", strategy: "invalid" }).success).toBe(false);
    expect(RetryRunRequestSchema.safeParse({}).success).toBe(false);
  });

  it("validates audience sampling plan contracts", () => {
    expect(CreateAudienceSamplingPlanRequestSchema.parse({})).toEqual({ replaceActive: false });
    expect(AudienceGenerationJobScopeSchema.safeParse("profile_expansion").success).toBe(true);
    expect(CreateAudienceSamplingDirectiveRequestSchema.safeParse({
      name: "核心用户",
      description: "认真做购买前功课的新手爸妈",
      quantity: 3,
      diversityAxes: ["预算压力"],
      rationale: "观察收藏、追问和评论行为"
    }).success).toBe(true);
    expect(CreateAudienceSamplingDirectiveRequestSchema.safeParse({
      name: "核心用户",
      description: "认真做购买前功课的新手爸妈",
      quantity: 0,
      diversityAxes: ["预算压力"],
      rationale: "观察收藏、追问和评论行为"
    }).success).toBe(false);
    expect(AudienceSamplingPlanViewSchema.safeParse({
      planId: "plan-1",
      runId: "run-1",
      totalCount: 3,
      status: "ready_for_review",
      planMarkdown: "采样计划",
      dimensions: ["需求强度"],
      confirmedAt: null,
      directives: [{
        id: "directive-1",
        sortOrder: 0,
        name: "核心用户",
        description: "认真做购买前功课的新手爸妈",
        quantity: 3,
        diversityAxes: ["预算压力"],
        rationale: "观察收藏、追问和评论行为",
        expansionStatus: "pending",
        expansionError: null
      }],
      validation: {
        quantityTotal: 3,
        expectedTotal: 3,
        isQuantityValid: true,
        issues: []
      }
    }).success).toBe(true);
  });

  it("validates audience sampling plan revision contracts", () => {
    const proposal = AudienceSamplingPlanRevisionProposalSchema.parse({
      summary: "建议补充预算敏感用户，并从核心用户中拆出 1 人。",
      operations: [{
        operationId: "op-1",
        op: "add_directive",
        directive: {
          name: "预算敏感用户",
          description: "强需求但会反复比较价格和替代方案的新手爸妈",
          quantity: 1,
          diversityAxes: ["预算压力", "替代品比较"],
          rationale: "观察价格敏感用户是否会收藏、追问或质疑必要性"
        },
        reason: "当前分组没有单独覆盖预算压力。"
      }, {
        operationId: "op-2",
        op: "update_directive",
        directiveId: "directive-1",
        patch: { quantity: 2 },
        before: { quantity: 3 },
        reason: "拆出预算敏感用户后下调原分组人数。"
      }],
      totalCountChange: { before: 3, after: 3 },
      warnings: []
    });
    expect(proposal.operations).toHaveLength(2);

    expect(CreateAudienceSamplingPlanRevisionSuggestionRequestSchema.safeParse({
      messages: [{
        role: "user",
        visibleText: "把 @核心用户 里预算敏感的人拆出来",
        hiddenMentionContexts: [{
          directiveId: "directive-1",
          label: "核心用户",
          context: { id: "directive-1", name: "核心用户", quantity: 3 }
        }]
      }]
    }).success).toBe(true);

    expect(AudienceSamplingPlanRevisionOperationSchema.safeParse({
      operationId: "bad-empty-patch",
      op: "update_directive",
      directiveId: "directive-1",
      patch: {},
      reason: "空 patch 不应通过。"
    }).success).toBe(false);
  });

  it("validates audience seat revision contracts", () => {
    const proposal = AudienceSeatRevisionProposalSchema.parse({
      summary: "建议把指定观众调整成更理性的证据型表达。",
      operations: [{
        operationId: "op-1",
        op: "update_identity",
        profileId: "profile-1",
        patch: {
          displayName: "理性比价妈妈",
          personaJson: {
            profile: "30 岁新手妈妈，近期在准备宝宝洗护和出行用品，预算有限但需求明确。",
            personality: "先看评论和具体型号，再比较价格与替代方案。",
            mbtiType: "INTJ",
            responseStyle: "表达直接克制，会用具体问题指出证据缺口。倾向收藏后继续查证。"
          }
        },
        before: { displayName: "核心用户 1" },
        reason: "让同组观众更有决策差异。"
      }, {
        operationId: "op-2",
        op: "add_profile",
        directiveId: "directive-1",
        samplingLabel: "新增预算敏感妈妈",
        demographics: {
          gender: "女",
          ageRange: "28-35岁",
          cityTier: "二线城市",
          lifeStage: "产后3个月",
          role: "新手妈妈",
          spendingPower: "预算敏感"
        },
        reason: "用户希望增加一个具体观众视角。"
      }],
      warnings: []
    });
    expect(proposal.operations).toHaveLength(2);

    expect(CreateAudienceSeatRevisionSuggestionRequestSchema.safeParse({
      messages: [{
        role: "user",
        visibleText: "把 @核心用户 里的 @核心用户1 调得更理性",
        hiddenMentionContexts: [{
          kind: "directive",
          directiveId: "directive-1",
          label: "核心用户",
          context: { id: "directive-1", name: "核心用户", ready: 3 }
        }, {
          kind: "profile",
          profileId: "profile-1",
          label: "核心用户1",
          context: { id: "profile-1", identityStatus: "identity_ready" }
        }]
      }]
    }).success).toBe(true);

    expect(AudienceSeatRevisionOperationSchema.safeParse({
      operationId: "bad-empty-patch",
      op: "update_identity",
      profileId: "profile-1",
      patch: {},
      reason: "空 patch 不应通过。"
    }).success).toBe(false);
  });

  it("validates LLM settings without exposing execution-pool controls", () => {
    expect(
      LlmSettingsRequestSchema.safeParse({
        provider: "openai-compatible",
        runtimeMode: "mock",
        models: { fast: "", pro: "" }
      }).success
    ).toBe(true);

    expect(
      LlmSettingsRequestSchema.safeParse({
        provider: "openai-compatible",
        runtimeMode: "mock",
        models: { fast: "", pro: "" },
        execution: { maxConcurrentAiTasks: 0, taskTimeoutSeconds: 120, maxRetry: 2 }
      }).success
    ).toBe(false);
  });

  it("AudienceSeat type compiles with all required fields", () => {
    const seat: AudienceSeat = {
      participantId: "test-id",
      actorUserId: "user-id",
      agentId: "agent-id",
      platformAccountId: "platform-account-id",
      name: "测试用户",
      segment: "核心用户",
      personaSummary: "新手妈妈",
      status: "watching",
      hasOpened: true,
      hasLiked: false,
      hasFavorited: false,
      hasShared: false,
      hasCommented: false,
      hasSkipped: false,
      hasDoubt: false
    };
    expect(seat.participantId).toBe("test-id");
    expect(seat.status).toBe("watching");
  });

  it("AudienceDetail type compiles with all required fields", () => {
    const detail: AudienceDetail = {
      participantId: "test-id",
      actorUserId: "user-id",
      agentId: "agent-id",
      platformAccountId: "platform-account-id",
      avatarUrl: "/uploads/avatar.png",
      persona: {
        name: "测试用户",
        segment: "核心用户",
        profile: "长期背景",
        personality: "确认细节",
        mbtiType: "ISTJ",
        responseStyle: "直接"
      },
      journey: {
        status: "active",
        currentStep: 2
      },
      timeline: [{ turnId: "turn-1", simulatedTime: 10, action: "open_post", kind: "tool_call", observableLog: "打开了帖子", innerReaction: "想确认细节" }],
      interactions: [{ type: "open_post", simulatedTime: 10 }],
      comments: [{ commentText: "好文", simulatedTime: 30, commentType: "feedback", sentiment: "positive" }]
    };
    expect(detail.timeline).toHaveLength(1);
    expect(detail.comments[0]!.commentText).toBe("好文");
  });

  it("AudienceSeatStatus includes all expected values", () => {
    const statuses: AudienceSeatStatus[] = [
      "not_started", "entered", "watching", "hesitating",
      "viewing_comments", "liked", "favorited", "commented",
      "skipped", "risk_exit", "finished", "failed"
    ];
    expect(statuses).toHaveLength(12);
    expect(statuses[0]).toBe("not_started");
  });

  it("AudienceStatusUpdatedPayload type compiles", () => {
    const payload: AudienceStatusUpdatedPayload = {
      type: "audience.status_updated",
      runId: "r1",
      audienceRevision: 1,
      participantId: "a1",
      simulatedTime: 10,
      status: "liked"
    };
    expect(payload.type).toBe("audience.status_updated");
  });

  it("AudienceActionHappenedPayload type compiles", () => {
    const payload: AudienceActionHappenedPayload = {
      type: "audience.action_happened",
      runId: "r1",
      audienceRevision: 1,
      participantId: "a1",
      simulatedTime: 10,
      action: "exit_browsing",
      animationHint: "skip",
      exitOutcome: "skipped",
      exitReason: "封面第一眼不吸引"
    };
    expect(payload.animationHint).toBe("skip");
    expect(payload.exitOutcome).toBe("skipped");
  });

  it("CommentUpdatedPayload carries only a comment patch", () => {
    const payload: CommentUpdatedPayload = {
      eventId: "evt-1",
      type: "comment.updated",
      runId: "run-1",
      commentId: "comment-1",
      patch: { likeCount: 2, replyCount: 1 }
    };
    expect(payload.patch.likeCount).toBe(2);
  });

  it("validates AudiencePlanFrame types", () => {
    expect(AudiencePlanFrameSchema.safeParse({ type: "plan_markdown_delta", text: "hello" }).success).toBe(true);
    expect(AudiencePlanFrameSchema.safeParse({ type: "dimension_upsert", key: "trust", label: "信任阈值" }).success).toBe(true);
    expect(AudiencePlanFrameSchema.safeParse({ type: "directive_started", key: "d1", sortOrder: 0 }).success).toBe(true);
    expect(AudiencePlanFrameSchema.safeParse({ type: "directive_patch", key: "d1", patch: { name: "核心用户", quantity: 5 } }).success).toBe(true);
    expect(AudiencePlanFrameSchema.safeParse({ type: "directive_completed", key: "d1" }).success).toBe(true);
    expect(AudiencePlanFrameSchema.safeParse({ type: "plan_completed", totalCount: 12 }).success).toBe(true);
    expect(AudiencePlanFrameSchema.safeParse({ type: "parser_error", line: "bad", message: "err" }).success).toBe(true);
    expect(AudiencePlanFrameSchema.safeParse({ type: "validation_issue", key: "d1", message: "missing field" }).success).toBe(true);

    // Invalid frame type
    expect(AudiencePlanFrameSchema.safeParse({ type: "unknown_frame" }).success).toBe(false);
    // Missing required field
    expect(AudiencePlanFrameSchema.safeParse({ type: "plan_completed" }).success).toBe(false);
    // directive_patch with empty patch
    expect(AudiencePlanFrameSchema.safeParse({ type: "directive_patch", key: "d1", patch: {} }).success).toBe(true);
  });

  it("validates AudiencePlanPreviewDirective status", () => {
    expect(AudiencePlanPreviewDirectiveStatusSchema.safeParse("streaming").success).toBe(true);
    expect(AudiencePlanPreviewDirectiveStatusSchema.safeParse("complete").success).toBe(true);
    expect(AudiencePlanPreviewDirectiveStatusSchema.safeParse("invalid").success).toBe(true);
    expect(AudiencePlanPreviewDirectiveStatusSchema.safeParse("unknown").success).toBe(false);
  });

  it("validates AudiencePlanPreviewSchema", () => {
    const preview: AudiencePlanPreview = {
      planMarkdown: "测试计划说明",
      dimensions: [{ key: "trust", label: "信任阈值" }],
      directives: [{
        key: "d1",
        sortOrder: 0,
        status: "streaming",
        name: "核心用户",
        quantity: 5
      }],
      quantityTotal: 5,
      targetCount: 12,
      completed: false,
      validationIssues: []
    };
    expect(AudiencePlanPreviewSchema.safeParse(preview).success).toBe(true);

    // Empty preview is valid
    expect(AudiencePlanPreviewSchema.safeParse({
      planMarkdown: "",
      dimensions: [],
      directives: [],
      quantityTotal: 0,
      targetCount: 12,
      completed: false,
      validationIssues: []
    }).success).toBe(true);
  });

  it("validates AudienceProfileExpansionFrame types", () => {
    expect(AudienceProfileExpansionFrameSchema.safeParse({
      type: "profile_completed",
      sampleIndex: 0,
      profile: {
        samplingLabel: "预算敏感准妈妈",
        demographics: {
          gender: "女性",
          ageRange: "28-35岁",
          cityTier: "二线城市",
          lifeStage: "孕晚期",
          role: "准妈妈",
          spendingPower: "预算敏感"
        }
      }
    }).success).toBe(true);

    expect(AudienceProfileExpansionFrameSchema.safeParse({
      type: "profile_completed",
      sampleIndex: 0,
      profile: {
        samplingLabel: "预算敏感准妈妈",
        demographics: { gender: "女性" }
      }
    }).success).toBe(false);

    expect(AudienceProfileExpansionFrameSchema.safeParse({
      type: "parser_error",
      line: "bad",
      message: "JSON 解析失败"
    }).success).toBe(true);
  });
});

// ── Report decision dashboard schemas (Stage 2 shared extension) ──

/**
 * Minimal valid ReportOutput shape WITHOUT the new optional fields
 * (keyFindings / rewriteSuggestions / summaryMarkdown).
 * Used to assert backward compatibility: reports persisted before the
 * Stage 2 extension must still parse successfully.
 */
function buildOldShapeReportOutput() {
  return {
    verdict: {
      recommendation: "recommend_publish",
      recommendationLabel: "建议发布",
      confidence: "high",
      headline: "标题测试",
      oneSentence: "一句话总结",
      topOpportunity: "机会",
      topRisk: "风险",
      priorityFix: "优先修复",
      evidenceRefs: []
    },
    funnel: {
      audienceCount: 12,
      completedCount: 12,
      failedCount: 0,
      exposedActors: 12,
      openedActors: 10,
      readActors: 10,
      deepReadActors: 8,
      readSkimActors: 2,
      readPartialActors: 3,
      readFullActors: 5,
      viewedCommentsActors: 4,
      likedActors: 6,
      favoritedActors: 3,
      commentedActors: 2,
      sharedActors: 1,
      exitedActors: 10,
      positiveActionActors: 8,
      openEvents: 10,
      readEvents: 12,
      commentEvents: 3,
      shareEvents: 1,
      exitEvents: 10,
      openRate: 0.83,
      readRateAfterOpen: 0.8,
      deepReadRateAfterOpen: 0.8,
      favoriteRateAfterOpen: 0.3,
      commentRateAfterOpen: 0.2,
      shareRateAfterOpen: 0.1,
      positiveActionRate: 0.8,
      notes: "测试备注"
    },
    mainBlocker: {
      blockerType: "opening_retention",
      title: "测试阻塞",
      severity: "medium",
      affectedCount: 3,
      summary: "测试摘要",
      diagnosis: "测试诊断",
      evidenceRefs: []
    },
    audienceGroupAnalysis: {
      // 注意：group 条目使用"旧 shape"——省略阶段 2 新增的 5 个 optional 字段
      // (targetAudienceFit / modificationWeight / typicalMotivation / mainBarrier / handlingSuggestion)，
      // 用于验证旧 ReportOutput 数据回归保护能下沉到 group 条目层级。
      groups: [
        {
          directiveId: "directive-1",
          directiveName: "核心用户",
          role: "core_target",
          confidence: "high",
          total: 4,
          opened: 4,
          readSkim: 1,
          readPartial: 1,
          readFull: 2,
          viewedComments: 2,
          liked: 3,
          favorited: 2,
          commented: 1,
          shared: 1,
          riskExitCount: 0,
          mainExitReasons: ["finished_normally"],
          mainCommentIntents: ["agree"],
          representativeThoughts: [],
          representativeComments: [],
          representativeJourneys: [],
          evidenceRefs: []
        }
      ],
      inferredGroups: [],
      confidence: "high",
      crossGroupSummary: "测试跨组总结",
      coreTargetHit: true,
      coreTargetHighInterestLowTrust: false,
      peripheralExpansionOpportunity: false,
      contrastSkipExpected: true,
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

describe("report decision dashboard schemas", () => {
  it("parses a legacy ReportOutput shape without the new optional fields (backward compat)", () => {
    const result = ReportOutputSchema.safeParse(buildOldShapeReportOutput());
    expect(result.success).toBe(true);
  });

  it("parses a ReportOutput with the new keyFindings / rewriteSuggestions fields", () => {
    const data = {
      ...buildOldShapeReportOutput(),
      keyFindings: [
        {
          finding: "装修初期人群对主题有兴趣，但开头承接不足",
          evidence: "10 人点开，仅 5 人完整阅读，3 人在前 3 秒离开",
          impact: "内容可能有点击，但停留和互动会弱",
          action: "将正文前三行改成问题 + 代价 + 结论",
          evidenceRefs: [{ id: "ref-1", type: "metric", label: "openRate 83%" }]
        }
      ],
      rewriteSuggestions: {
        recommendedTitles: [
          { text: "新手装修避坑清单：10 个最容易踩的坑", reason: "前置具体收益和数量，更有点击动机" }
        ],
        recommendedOpening: {
          text: "装修第一年最容易花冤枉钱。下面这 10 个坑，每个都至少让一位朋友多花了 5000 元。",
          reason: "问题 + 代价 + 引出清单"
        },
        recommendedTags: ["装修避坑", "新手装修"]
      },
      summaryMarkdown: "## 决策摘要\n建议发布后调整开头承接。"
    };
    const result = ReportOutputSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("parse should succeed");
    }
    // 精确断言解析后的值，避免宽松断言
    expect(result.data.keyFindings).toHaveLength(1);
    expect(result.data.keyFindings?.[0]?.finding).toContain("装修初期");
    expect(result.data.keyFindings?.[0]?.evidenceRefs).toEqual([
      { id: "ref-1", type: "metric", label: "openRate 83%" }
    ]);
    expect(result.data.rewriteSuggestions?.recommendedTitles).toHaveLength(1);
    expect(result.data.rewriteSuggestions?.recommendedTitles[0]?.text).toContain("装修避坑清单");
    expect(result.data.rewriteSuggestions?.recommendedTags).toEqual(["装修避坑", "新手装修"]);
    expect(result.data.summaryMarkdown).toContain("决策摘要");
  });

  it("rejects ReportOutput with an unknown top-level field (strict mode)", () => {
    const data = { ...buildOldShapeReportOutput(), unknownField: "should be rejected" };
    const result = ReportOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("KeyFindingSchema defaults evidenceRefs to an empty array when omitted", () => {
    const parsed = KeyFindingSchema.parse({
      finding: "测试结论",
      evidence: "测试证据",
      impact: "测试影响",
      action: "测试动作"
    });
    expect(parsed.evidenceRefs).toEqual([]);
  });

  it("RewriteSuggestionsSchema defaults array fields to empty arrays when omitted", () => {
    const parsed = RewriteSuggestionsSchema.parse({});
    expect(parsed.recommendedTitles).toEqual([]);
    expect(parsed.recommendedTags).toEqual([]);
    // 所有 optional 单数字段在省略时必须为 undefined
    expect(parsed.recommendedCoverText).toBeUndefined();
    expect(parsed.recommendedOpening).toBeUndefined();
    expect(parsed.recommendedBodyStructure).toBeUndefined();
    expect(parsed.recommendedCommentPrompt).toBeUndefined();
  });

  it("RewriteSuggestionItemSchema requires both text and reason", () => {
    expect(RewriteSuggestionItemSchema.safeParse({ text: "标题", reason: "原因" }).success).toBe(true);
    expect(RewriteSuggestionItemSchema.safeParse({ text: "标题" }).success).toBe(false);
    expect(RewriteSuggestionItemSchema.safeParse({ reason: "原因" }).success).toBe(false);
  });

  it("TargetAudienceFitSchema and ModificationWeightSchema accept high/medium/low", () => {
    for (const v of ["high", "medium", "low"] as const) {
      expect(TargetAudienceFitSchema.safeParse(v).success).toBe(true);
      expect(ModificationWeightSchema.safeParse(v).success).toBe(true);
    }
    expect(TargetAudienceFitSchema.safeParse("unknown").success).toBe(false);
    expect(ModificationWeightSchema.safeParse("unknown").success).toBe(false);
  });

  it("DiagnosticCardSchema accepts optional reason field (判断→证据→原因→动作)", () => {
    const baseDiagnostic = {
      area: "feed_attraction",
      title: "标题吸引力",
      status: "medium",
      finding: "中等，有主题，但缺少强收益或强冲突",
      evidenceRefs: [],
      suggestedFix: "前置具体收益点"
    };
    // Without reason → valid (backward compat)
    expect(DiagnosticCardSchema.safeParse(baseDiagnostic).success).toBe(true);

    // With reason → valid
    expect(DiagnosticCardSchema.safeParse({
      ...baseDiagnostic,
      reason: "标题能让人点进来，但正文开头没有快速兑现标题承诺"
    }).success).toBe(true);
  });

  it("RetestQuestionSchema accepts optional hypothesis and testVersionLabel fields", () => {
    const baseRetest = {
      question: "如果标题前置具体收益，点击后的继续阅读比例会提升吗？",
      relatedAction: "改写标题",
      metricToWatch: "readRateAfterOpen",
      expectedDirection: "上升"
    };
    // Without hypothesis/testVersionLabel → valid (backward compat)
    expect(RetestQuestionSchema.safeParse(baseRetest).success).toBe(true);

    // With hypothesis and testVersionLabel → valid
    expect(RetestQuestionSchema.safeParse({
      ...baseRetest,
      hypothesis: "H1: 如果标题前置具体收益，点击后的继续阅读比例会提升",
      testVersionLabel: "A 版：强化省钱避坑"
    }).success).toBe(true);
  });

  it("METRIC_DICTIONARY has no duplicate keys", () => {
    const keys = METRIC_DICTIONARY.map((entry) => entry.key);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });

  it("METRIC_DICTIONARY covers every EvidenceFunnel field (lookup must not return undefined)", () => {
    // Every numeric/rate field name in EvidenceFunnel must have a dictionary
    // entry so the frontend can render a Chinese label + explanation.
    const funnelKeys = Object.keys(EvidenceFunnelSchema.shape);
    const missing = funnelKeys.filter((key) => getMetricEntry(key) === undefined);
    expect(missing).toEqual([]);
  });

  it("METRIC_DICTIONARY entries have non-empty label / englishName / description and a valid category", () => {
    const validCategories = new Set(["reading", "action", "rate", "exit", "comment"]);
    for (const entry of METRIC_DICTIONARY) {
      expect(entry.key.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.englishName.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(validCategories.has(entry.category)).toBe(true);
    }
  });

  it("getMetricEntry returns undefined for unknown keys", () => {
    expect(getMetricEntry("readSkimActors")).toBeDefined();
    expect(getMetricEntry("nonExistentMetric")).toBeUndefined();
  });

  // ── MF-1 修复：AudienceGroupStatsSchema 5 个阶段 2 新增 optional 字段专项测试 ──

  /**
   * 旧 shape AudienceGroupStats 条目：5 个新 optional 字段（targetAudienceFit /
   * modificationWeight / typicalMotivation / mainBarrier / handlingSuggestion）全部省略。
   * 必须解析成功，且解析后这些字段为 undefined。
   */
  function buildOldShapeAudienceGroupStats() {
    return {
      directiveId: "directive-1",
      directiveName: "核心用户",
      role: "core_target",
      confidence: "high",
      total: 4,
      opened: 4,
      readSkim: 1,
      readPartial: 1,
      readFull: 2,
      viewedComments: 2,
      liked: 3,
      favorited: 2,
      commented: 1,
      shared: 1,
      riskExitCount: 0,
      mainExitReasons: ["finished_normally"],
      mainCommentIntents: ["agree"],
      representativeThoughts: [],
      representativeComments: [],
      representativeJourneys: [],
      evidenceRefs: []
    };
  }

  it("AudienceGroupStatsSchema parses a legacy group entry without the 5 new optional fields", () => {
    const result = AudienceGroupStatsSchema.safeParse(buildOldShapeAudienceGroupStats());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.targetAudienceFit).toBeUndefined();
    expect(result.data.modificationWeight).toBeUndefined();
    expect(result.data.typicalMotivation).toBeUndefined();
    expect(result.data.mainBarrier).toBeUndefined();
    expect(result.data.handlingSuggestion).toBeUndefined();
  });

  it("AudienceGroupStatsSchema parses a new shape group entry with all 5 new optional fields populated", () => {
    const data = {
      ...buildOldShapeAudienceGroupStats(),
      targetAudienceFit: "high",
      modificationWeight: "high",
      typicalMotivation: "怕踩坑、怕花冤枉钱、需要明确清单",
      mainBarrier: "开头没有马上说明能帮我解决什么问题",
      handlingSuggestion: "作为核心目标人群重点优化"
    };
    const result = AudienceGroupStatsSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.targetAudienceFit).toBe("high");
    expect(result.data.modificationWeight).toBe("high");
    expect(result.data.typicalMotivation).toContain("怕踩坑");
    expect(result.data.mainBarrier).toContain("开头");
    expect(result.data.handlingSuggestion).toContain("核心目标人群");
  });

  it("AudienceGroupStatsSchema rejects an invalid targetAudienceFit / modificationWeight value", () => {
    // 非法枚举值必须被拒绝
    expect(AudienceGroupStatsSchema.safeParse({
      ...buildOldShapeAudienceGroupStats(),
      targetAudienceFit: "unknown"
    }).success).toBe(false);
    expect(AudienceGroupStatsSchema.safeParse({
      ...buildOldShapeAudienceGroupStats(),
      modificationWeight: "critical"
    }).success).toBe(false);
  });

  it("AudienceGroupStatsSchema rejects a group entry missing required fields (e.g. role / total)", () => {
    const { role: _omitRole, ...withoutRole } = buildOldShapeAudienceGroupStats();
    expect(AudienceGroupStatsSchema.safeParse(withoutRole).success).toBe(false);

    const { total: _omitTotal, ...withoutTotal } = buildOldShapeAudienceGroupStats();
    expect(AudienceGroupStatsSchema.safeParse(withoutTotal).success).toBe(false);
  });

  // ── REC-5 修复：AudienceGroupAnalysisSchema 整体直接测试 ──

  it("AudienceGroupAnalysisSchema rejects when a required boolean is missing or confidence is invalid", () => {
    const baseValid = {
      groups: [],
      inferredGroups: [],
      confidence: "high",
      crossGroupSummary: "测试跨组总结",
      coreTargetHit: true,
      coreTargetHighInterestLowTrust: false,
      peripheralExpansionOpportunity: false,
      contrastSkipExpected: true,
      contrastUnexpectedRisk: false,
      evidenceRefs: []
    };
    expect(AudienceGroupAnalysisSchema.safeParse(baseValid).success).toBe(true);

    // 缺少 coreTargetHit → fail
    const { coreTargetHit: _omit, ...withoutCoreTargetHit } = baseValid;
    expect(AudienceGroupAnalysisSchema.safeParse(withoutCoreTargetHit).success).toBe(false);

    // 缺少 contrastSkipExpected → fail
    const { contrastSkipExpected: _omit2, ...withoutContrastSkipExpected } = baseValid;
    expect(AudienceGroupAnalysisSchema.safeParse(withoutContrastSkipExpected).success).toBe(false);

    // 非法 confidence → fail
    expect(AudienceGroupAnalysisSchema.safeParse({
      ...baseValid,
      confidence: "critical"
    }).success).toBe(false);
  });
});
