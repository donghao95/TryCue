import { describe, expect, it } from "vitest";
import { ReportOutputSchema, EvidencePackSchema, type ReportOutput } from "@trycue/shared/report";
import { buildEvidencePack, recommendFromEvidence, selectMainBlocker, type EvidencePackInput } from "./evidencePack.js";
import { buildFallbackReportOutput } from "./report.js";
import { assertNoBannedScoreFields, assertNoRealPlatformClaims, assertNoInventedEvidenceRefs } from "../agents/reportAgent.js";

// -- fixtures --

function makeBaseInput(overrides: Partial<EvidencePackInput> = {}): EvidencePackInput {
  return {
    runId: "run-1",
    contentVersionId: "cv-1",
    content: { title: "test", bodyText: "body", imageUrlsJson: [], coverImageUrl: null },
    postState: { exposureCount: 10, openCount: 6, likeCount: 3, favoriteCount: 2, commentCount: 1, shareCount: 1, exitCount: 4 },
    journeys: [],
    participants: [
      { id: "p1", displayNameSnapshot: "A", profileSnapshotJson: {}, samplingDirectiveId: null },
      { id: "p2", displayNameSnapshot: "B", profileSnapshotJson: {}, samplingDirectiveId: null },
      { id: "p3", displayNameSnapshot: "C", profileSnapshotJson: {}, samplingDirectiveId: null }
    ],
    directives: [],
    comments: [],
    logs: [],
    toolCalls: [
      { id: "tc1", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 0, toolName: "open_post", status: "committed", input: {}, output: {}, simulatedTime: null },
      { id: "tc2", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 1, toolName: "like_post", status: "committed", input: { postId: "post-1" }, output: {}, simulatedTime: null },
      { id: "tc3", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 2, toolName: "exit_browsing", status: "committed", input: {}, output: { reasonCategory: "finished_normally", readingDepth: "full", interestLevel: "high", trustLevel: "high" }, simulatedTime: null },
      { id: "tc4", agentTurnId: null, journeyId: null, participantId: "p2", callIndex: 0, toolName: "open_post", status: "committed", input: {}, output: {}, simulatedTime: null },
      { id: "tc5", agentTurnId: null, journeyId: null, participantId: "p2", callIndex: 1, toolName: "favorite_post", status: "committed", input: { postId: "post-1" }, output: {}, simulatedTime: null },
      { id: "tc6", agentTurnId: null, journeyId: null, participantId: "p2", callIndex: 2, toolName: "share_post", status: "committed", input: { postId: "post-1" }, output: {}, simulatedTime: null },
      { id: "tc7", agentTurnId: null, journeyId: null, participantId: "p2", callIndex: 3, toolName: "exit_browsing", status: "committed", input: {}, output: { reasonCategory: "not_interested", readingDepth: "skimmed", interestLevel: "low", trustLevel: "medium" }, simulatedTime: null },
      { id: "tc8", agentTurnId: null, journeyId: null, participantId: "p3", callIndex: 0, toolName: "open_post", status: "committed", input: {}, output: {}, simulatedTime: null },
      { id: "tc9", agentTurnId: null, journeyId: null, participantId: "p3", callIndex: 1, toolName: "write_comment", status: "committed", input: { postId: "post-1", intent: "agree", content: "好文" }, output: { commentId: "c1", intent: "agree" }, simulatedTime: null },
      { id: "tc10", agentTurnId: null, journeyId: null, participantId: "p3", callIndex: 2, toolName: "exit_browsing", status: "committed", input: {}, output: { reasonCategory: "finished_normally", readingDepth: "full", interestLevel: "high", trustLevel: "high" }, simulatedTime: null }
    ],
    turns: [],
    audienceCount: 3,
    completedCount: 2,
    failedCount: 0,
    skippedCount: 1,
    wasEndedEarly: false,
    ...overrides
  };
}

// -- ReportOutputSchema strict mode --

describe("ReportOutputSchema strict mode", () => {
  it("rejects unknown top-level fields", () => {
    const pack = buildEvidencePack(makeBaseInput());
    const recommendation = recommendFromEvidence(pack);
    const mainBlocker = selectMainBlocker(pack.blockers);
    const output = buildFallbackReportOutput(pack, recommendation, mainBlocker, false);
    const withExtra = { ...output, extraField: "should be rejected" } as Record<string, unknown>;
    const result = ReportOutputSchema.safeParse(withExtra);
    expect(result.success).toBe(false);
  });

  it("accepts a valid fallback report output", () => {
    const pack = buildEvidencePack(makeBaseInput());
    const recommendation = recommendFromEvidence(pack);
    const mainBlocker = selectMainBlocker(pack.blockers);
    const output = buildFallbackReportOutput(pack, recommendation, mainBlocker, false);
    const result = ReportOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });
});

// -- EvidencePackSchema validation --

describe("EvidencePackSchema validation", () => {
  it("accepts a valid evidence pack from buildEvidencePack", () => {
    const pack = buildEvidencePack(makeBaseInput());
    const result = EvidencePackSchema.safeParse(pack);
    expect(result.success).toBe(true);
  });

  it("accepts a low-quality evidence pack", () => {
    const pack = buildEvidencePack(makeBaseInput({ audienceCount: 2, completedCount: 2 }));
    const result = EvidencePackSchema.safeParse(pack);
    expect(result.success).toBe(true);
  });

  it("accepts a high-quality evidence pack", () => {
    const pack = buildEvidencePack(makeBaseInput({ audienceCount: 10, completedCount: 9, failedCount: 0 }));
    const result = EvidencePackSchema.safeParse(pack);
    expect(result.success).toBe(true);
  });
});

// -- buildFallbackReportOutput schema compliance --

describe("buildFallbackReportOutput schema compliance", () => {
  it("produces schema-valid output for medium quality pack", () => {
    const pack = buildEvidencePack(makeBaseInput({ audienceCount: 10, completedCount: 8, failedCount: 1 }));
    const recommendation = recommendFromEvidence(pack);
    const mainBlocker = selectMainBlocker(pack.blockers);
    const output = buildFallbackReportOutput(pack, recommendation, mainBlocker, false);
    const result = ReportOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it("produces schema-valid output for low quality pack", () => {
    const pack = buildEvidencePack(makeBaseInput({ audienceCount: 2, completedCount: 2 }));
    const recommendation = recommendFromEvidence(pack);
    const mainBlocker = selectMainBlocker(pack.blockers);
    const output = buildFallbackReportOutput(pack, recommendation, mainBlocker, false);
    const result = ReportOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it("produces schema-valid output when wasEndedEarly is true", () => {
    const pack = buildEvidencePack(makeBaseInput({ audienceCount: 10, completedCount: 6, failedCount: 1, wasEndedEarly: true }));
    const recommendation = recommendFromEvidence(pack);
    const mainBlocker = selectMainBlocker(pack.blockers);
    const output = buildFallbackReportOutput(pack, recommendation, mainBlocker, true);
    const result = ReportOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it("produces schema-valid output when there are no blockers", () => {
    const pack = buildEvidencePack(makeBaseInput({ audienceCount: 10, completedCount: 8, failedCount: 1 }));
    const recommendation = recommendFromEvidence(pack);
    const output = buildFallbackReportOutput(pack, recommendation, null, false);
    const result = ReportOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it("sets recommendation in verdict to match recommendFromEvidence output", () => {
    const pack = buildEvidencePack(makeBaseInput({ audienceCount: 10, completedCount: 8, failedCount: 1 }));
    const recommendation = recommendFromEvidence(pack);
    const mainBlocker = selectMainBlocker(pack.blockers);
    const output = buildFallbackReportOutput(pack, recommendation, mainBlocker, false);
    expect(output.verdict.recommendation).toBe(recommendation);
  });

  it("includes all 5 diagnostic areas", () => {
    const pack = buildEvidencePack(makeBaseInput({ audienceCount: 10, completedCount: 8, failedCount: 1 }));
    const recommendation = recommendFromEvidence(pack);
    const mainBlocker = selectMainBlocker(pack.blockers);
    const output = buildFallbackReportOutput(pack, recommendation, mainBlocker, false);
    const areas = output.diagnostics.map((d) => d.area);
    expect(areas).toContain("feed_attraction");
    expect(areas).toContain("reading_retention");
    expect(areas).toContain("trust_evidence");
    expect(areas).toContain("save_value");
    expect(areas).toContain("comment_risk");
  });

  it("includes all 4 segment keys", () => {
    const pack = buildEvidencePack(makeBaseInput({ audienceCount: 10, completedCount: 8, failedCount: 1 }));
    const recommendation = recommendFromEvidence(pack);
    const mainBlocker = selectMainBlocker(pack.blockers);
    const output = buildFallbackReportOutput(pack, recommendation, mainBlocker, false);
    const keys = output.segments.map((s) => s.key);
    expect(keys).toContain("persuaded");
    expect(keys).toContain("interested_but_not_convinced");
    expect(keys).toContain("skipped");
    expect(keys).toContain("skeptical");
  });
});

// -- assertNoBannedScoreFields (post-validation guard) --

describe("assertNoBannedScoreFields", () => {
  it("passes for clean output without banned patterns", () => {
    const clean = { verdict: { headline: "建议修改后发布", oneSentence: "10/10 完成。" } };
    expect(() => assertNoBannedScoreFields(clean)).not.toThrow();
  });

  it("passes for simulation-appropriate numeric ratios", () => {
    const clean = { verdict: { headline: "在本次 AI 观众试映中，6/10 位完成，点开率 60%。" } };
    expect(() => assertNoBannedScoreFields(clean)).not.toThrow();
  });

  it("throws when score field is present", () => {
    const parsed = { verdict: { headline: "test", score: 87 } };
    expect(() => assertNoBannedScoreFields(parsed)).toThrow(/被禁止的精确分数字段/);
  });

  it("throws when grade field is present", () => {
    const parsed = { verdict: { headline: "test", grade: "B+" } };
    expect(() => assertNoBannedScoreFields(parsed)).toThrow(/被禁止的精确分数字段/);
  });

  it("throws when rating field is present", () => {
    const parsed = { verdict: { headline: "test", rating: 4.5 } };
    expect(() => assertNoBannedScoreFields(parsed)).toThrow(/被禁止的精确分数字段/);
  });

  it("throws when potential has a numeric value", () => {
    const parsed = { verdict: { potential: 80 } };
    expect(() => assertNoBannedScoreFields(parsed)).toThrow(/被禁止的精确分数字段/);
  });

  it("throws when credibility has a numeric value", () => {
    const parsed = { verdict: { credibility: 72 } };
    expect(() => assertNoBannedScoreFields(parsed)).toThrow(/被禁止的精确分数字段/);
  });

  it("throws for numeric score embedded in string fields", () => {
    const parsed = { verdict: { headline: "这篇内容评 87 分，建议发布" } };
    expect(() => assertNoBannedScoreFields(parsed)).toThrow(/被禁止的精确分数字段/);
  });

  it("throws for B+ embedded in string fields", () => {
    const parsed = { verdict: { headline: "综合评级 B+" } };
    expect(() => assertNoBannedScoreFields(parsed)).toThrow(/被禁止的精确分数字段/);
  });

  it("throws for credibility phrase embedded in string fields", () => {
    const parsed = { verdict: { headline: "可信度 72" } };
    expect(() => assertNoBannedScoreFields(parsed)).toThrow(/被禁止的精确分数字段/);
  });

  it("throws for potential phrase embedded in string fields", () => {
    const parsed = { verdict: { headline: "发布潜力 8" } };
    expect(() => assertNoBannedScoreFields(parsed)).toThrow(/被禁止的精确分数字段/);
  });

  it("throws for conversion index phrase embedded in string fields", () => {
    const parsed = { verdict: { headline: "转化指数 5" } };
    expect(() => assertNoBannedScoreFields(parsed)).toThrow(/被禁止的精确分数字段/);
  });
});

// -- assertNoRealPlatformClaims (post-validation guard) --

describe("assertNoRealPlatformClaims", () => {
  function makeCleanReport(): ReportOutput {
    const pack = buildEvidencePack(makeBaseInput());
    const recommendation = recommendFromEvidence(pack);
    const mainBlocker = selectMainBlocker(pack.blockers);
    return buildFallbackReportOutput(pack, recommendation, mainBlocker, false);
  }

  it("passes for clean fallback report", () => {
    const report = makeCleanReport();
    expect(() => assertNoRealPlatformClaims(report)).not.toThrow();
  });

  it("passes for allowed simulation-appropriate phrasings", () => {
    const allowed = ["在本次 AI 观众试映中", "模拟观众表现显示", "当前试映证据表明"];
    for (const phrase of allowed) {
      const report = makeCleanReport();
      report.verdict.headline = `${phrase}，6/10 位模拟观众完成试映。`;
      expect(() => assertNoRealPlatformClaims(report), `phrase: ${phrase}`).not.toThrow();
    }
  });

  it("throws when forbidden phrase appears in verdict headline", () => {
    const report = makeCleanReport();
    report.verdict.headline = "发布后会获得高点赞，建议发布。";
    expect(() => assertNoRealPlatformClaims(report)).toThrow(/真实平台表现预测/);
  });

  it("throws when forbidden phrase appears in verdict oneSentence", () => {
    const report = makeCleanReport();
    report.verdict.oneSentence = "真实平台表现预计点击率 5%。";
    expect(() => assertNoRealPlatformClaims(report)).toThrow(/真实平台表现预测/);
  });

  it("throws when forbidden phrase appears in mainBlocker diagnosis", () => {
    const report = makeCleanReport();
    report.mainBlocker.diagnosis = "一定会爆，但存在信任风险。";
    expect(() => assertNoRealPlatformClaims(report)).toThrow(/真实平台表现预测/);
  });

  it("throws for each forbidden phrase", () => {
    const forbidden = [
      "发布后会获得高点赞",
      "真实平台表现预计",
      "一定会爆",
      "预测点击率",
      "预计将获得",
      "真实用户会",
      "平台将推荐",
      "将会爆",
      "必将爆款"
    ];
    for (const phrase of forbidden) {
      const report = makeCleanReport();
      report.verdict.topOpportunity = `${phrase}，这是被禁止的表述。`;
      expect(() => assertNoRealPlatformClaims(report), `phrase: ${phrase}`).toThrow(/真实平台表现预测/);
    }
  });
});

// -- assertNoInventedEvidenceRefs (post-validation guard) --

describe("assertNoInventedEvidenceRefs", () => {
  function makeReportAndValidIds(): { report: ReportOutput; validIds: Set<string> } {
    const pack = buildEvidencePack(makeBaseInput());
    const recommendation = recommendFromEvidence(pack);
    const mainBlocker = selectMainBlocker(pack.blockers);
    const report = buildFallbackReportOutput(pack, recommendation, mainBlocker, false);
    const validIds = new Set(Object.keys(pack.evidenceIndex));
    return { report, validIds };
  }

  it("passes when all refs are in validIds", () => {
    const { report, validIds } = makeReportAndValidIds();
    expect(() => assertNoInventedEvidenceRefs(report, validIds)).not.toThrow();
  });

  it("passes when evidenceRefs are empty", () => {
    const { report, validIds } = makeReportAndValidIds();
    report.verdict.evidenceRefs = [];
    report.mainBlocker.evidenceRefs = [];
    for (const seg of report.segments) seg.evidenceRefs = [];
    for (const g of report.audienceGroupAnalysis.groups) g.evidenceRefs = [];
    expect(() => assertNoInventedEvidenceRefs(report, validIds)).not.toThrow();
  });

  it("throws when verdict references an invented evidence id", () => {
    const { report, validIds } = makeReportAndValidIds();
    report.verdict.evidenceRefs = [
      ...report.verdict.evidenceRefs,
      { id: "invented:id-1", type: "metric", label: "虚构证据" }
    ];
    expect(() => assertNoInventedEvidenceRefs(report, validIds)).toThrow(/不存在的证据 id/);
    expect(() => assertNoInventedEvidenceRefs(report, validIds)).toThrow(/invented:id-1/);
  });

  it("throws when mainBlocker references an invented evidence id", () => {
    const { report, validIds } = makeReportAndValidIds();
    report.mainBlocker.evidenceRefs = [
      { id: "invented:blocker-1", type: "thought", label: "虚构阻断证据" }
    ];
    expect(() => assertNoInventedEvidenceRefs(report, validIds)).toThrow(/invented:blocker-1/);
  });

  it("throws when a segment references an invented evidence id", () => {
    const { report, validIds } = makeReportAndValidIds();
    const seg = report.segments[0]!;
    seg.evidenceRefs = [
      ...seg.evidenceRefs,
      { id: "invented:segment-1", type: "comment", label: "虚构分人群证据" }
    ];
    expect(() => assertNoInventedEvidenceRefs(report, validIds)).toThrow(/invented:segment-1/);
  });

  it("throws when a diagnostic references an invented evidence id", () => {
    const { report, validIds } = makeReportAndValidIds();
    const diag = report.diagnostics[0]!;
    diag.evidenceRefs = [
      ...diag.evidenceRefs,
      { id: "invented:diag-1", type: "metric", label: "虚构诊断证据" }
    ];
    expect(() => assertNoInventedEvidenceRefs(report, validIds)).toThrow(/invented:diag-1/);
  });

  it("throws when an audience group references an invented evidence id", () => {
    const { report, validIds } = makeReportAndValidIds();
    report.audienceGroupAnalysis.groups.push({
      directiveId: "synthetic-d",
      directiveName: "合成抽样组",
      role: "core_target",
      confidence: "medium",
      total: 1,
      opened: 1,
      readSkim: 0,
      readPartial: 0,
      readFull: 1,
      viewedComments: 0,
      liked: 1,
      favorited: 0,
      commented: 0,
      shared: 0,
      riskExitCount: 0,
      mainExitReasons: [],
      mainCommentIntents: [],
      representativeThoughts: [],
      representativeComments: [],
      representativeJourneys: [],
      evidenceRefs: [{ id: "invented:group-1", type: "group", label: "虚构抽样组证据" }]
    });
    expect(() => assertNoInventedEvidenceRefs(report, validIds)).toThrow(/invented:group-1/);
  });

  it("throws when an audience group representativeThoughts references an invented evidence id", () => {
    const { report, validIds } = makeReportAndValidIds();
    report.audienceGroupAnalysis.groups.push({
      directiveId: "synthetic-d",
      directiveName: "合成抽样组",
      role: "core_target",
      confidence: "medium",
      total: 1,
      opened: 1,
      readSkim: 0,
      readPartial: 0,
      readFull: 1,
      viewedComments: 0,
      liked: 1,
      favorited: 0,
      commented: 0,
      shared: 0,
      riskExitCount: 0,
      mainExitReasons: [],
      mainCommentIntents: [],
      representativeThoughts: [{ id: "invented:group-thought-1", type: "thought", label: "虚构代表性思考" }],
      representativeComments: [],
      representativeJourneys: [],
      evidenceRefs: []
    });
    expect(() => assertNoInventedEvidenceRefs(report, validIds)).toThrow(/invented:group-thought-1/);
  });

  it("throws when an audience group representativeComments references an invented evidence id", () => {
    const { report, validIds } = makeReportAndValidIds();
    report.audienceGroupAnalysis.groups.push({
      directiveId: "synthetic-d",
      directiveName: "合成抽样组",
      role: "core_target",
      confidence: "medium",
      total: 1,
      opened: 1,
      readSkim: 0,
      readPartial: 0,
      readFull: 1,
      viewedComments: 0,
      liked: 1,
      favorited: 0,
      commented: 0,
      shared: 0,
      riskExitCount: 0,
      mainExitReasons: [],
      mainCommentIntents: [],
      representativeThoughts: [],
      representativeComments: [{ id: "invented:group-comment-1", type: "comment", label: "虚构代表性评论" }],
      representativeJourneys: [],
      evidenceRefs: []
    });
    expect(() => assertNoInventedEvidenceRefs(report, validIds)).toThrow(/invented:group-comment-1/);
  });

  it("throws when an audience group representativeJourneys references an invented evidence id", () => {
    const { report, validIds } = makeReportAndValidIds();
    report.audienceGroupAnalysis.groups.push({
      directiveId: "synthetic-d",
      directiveName: "合成抽样组",
      role: "core_target",
      confidence: "medium",
      total: 1,
      opened: 1,
      readSkim: 0,
      readPartial: 0,
      readFull: 1,
      viewedComments: 0,
      liked: 1,
      favorited: 0,
      commented: 0,
      shared: 0,
      riskExitCount: 0,
      mainExitReasons: [],
      mainCommentIntents: [],
      representativeThoughts: [],
      representativeComments: [],
      representativeJourneys: [{ id: "invented:group-journey-1", type: "journey", label: "虚构代表性旅程" }],
      evidenceRefs: []
    });
    expect(() => assertNoInventedEvidenceRefs(report, validIds)).toThrow(/invented:group-journey-1/);
  });

  it("throws when audienceGroupAnalysis top-level evidenceRefs reference an invented id", () => {
    const { report, validIds } = makeReportAndValidIds();
    report.audienceGroupAnalysis.evidenceRefs = [
      ...report.audienceGroupAnalysis.evidenceRefs,
      { id: "invented:aga-top-1", type: "group", label: "虚构顶层抽样组证据" }
    ];
    expect(() => assertNoInventedEvidenceRefs(report, validIds)).toThrow(/invented:aga-top-1/);
  });

  it("throws when a segment representativeThoughts references an invented evidence id", () => {
    const { report, validIds } = makeReportAndValidIds();
    const seg = report.segments[0]!;
    seg.representativeThoughts = [
      ...seg.representativeThoughts,
      { id: "invented:seg-thought-1", type: "thought", label: "虚构代表性思考" }
    ];
    expect(() => assertNoInventedEvidenceRefs(report, validIds)).toThrow(/invented:seg-thought-1/);
  });

  it("throws when a segment representativeComments references an invented evidence id", () => {
    const { report, validIds } = makeReportAndValidIds();
    const seg = report.segments[0]!;
    seg.representativeComments = [
      ...seg.representativeComments,
      { id: "invented:seg-comment-1", type: "comment", label: "虚构代表性评论" }
    ];
    expect(() => assertNoInventedEvidenceRefs(report, validIds)).toThrow(/invented:seg-comment-1/);
  });

  it("throws when a keep item references an invented evidence id", () => {
    const { report, validIds } = makeReportAndValidIds();
    const keepItem = report.keepAndChange.keep[0]!;
    keepItem.evidenceRefs = [
      ...keepItem.evidenceRefs,
      { id: "invented:keep-1", type: "journey", label: "虚构保留项证据" }
    ];
    expect(() => assertNoInventedEvidenceRefs(report, validIds)).toThrow(/invented:keep-1/);
  });

  it("throws when a change item references an invented evidence id", () => {
    const { report, validIds } = makeReportAndValidIds();
    const changeItem = report.keepAndChange.change[0]!;
    changeItem.evidenceRefs = [
      ...changeItem.evidenceRefs,
      { id: "invented:change-1", type: "journey", label: "虚构修改项证据" }
    ];
    expect(() => assertNoInventedEvidenceRefs(report, validIds)).toThrow(/invented:change-1/);
  });

  it("throws when a revision plan item references an invented evidence id", () => {
    const { report, validIds } = makeReportAndValidIds();
    if (report.revisionPlan.length === 0) {
      report.revisionPlan.push({
        priority: "P0",
        title: "测试用修改项",
        action: "测试动作",
        reason: "测试原因",
        affectedSegment: "skipped",
        expectedImpact: "测试影响",
        retestQuestion: "测试问题",
        evidenceRefs: [{ id: "invented:revision-1", type: "blocker", label: "虚构修改计划证据" }]
      });
    } else {
      const rev = report.revisionPlan[0]!;
      rev.evidenceRefs = [
        ...rev.evidenceRefs,
        { id: "invented:revision-1", type: "blocker", label: "虚构修改计划证据" }
      ];
    }
    expect(() => assertNoInventedEvidenceRefs(report, validIds)).toThrow(/invented:revision-1/);
  });

  it("throws when top-level evidenceRefs reference an invented id", () => {
    const { report, validIds } = makeReportAndValidIds();
    report.evidenceRefs = [
      ...report.evidenceRefs,
      { id: "invented:top-1", type: "metric", label: "虚构顶层证据" }
    ];
    expect(() => assertNoInventedEvidenceRefs(report, validIds)).toThrow(/invented:top-1/);
  });
});

// ── 阶段 3 新增字段断言 ──
// 覆盖 keyFindings / rewriteSuggestions / diagnostics.reason /
// retestPlan.hypothesis 的推导结果，避免 mock 路径产出形状回归。

describe("buildFallbackReportOutput Stage 3 new fields", () => {
  function makeOutput(overrides?: Partial<EvidencePackInput>) {
    const pack = buildEvidencePack(makeBaseInput(overrides));
    const recommendation = recommendFromEvidence(pack);
    const mainBlocker = selectMainBlocker(pack.blockers);
    return buildFallbackReportOutput(pack, recommendation, mainBlocker, false);
  }

  it("keyFindings has at most 3 items, each with finding/evidence/impact/action", () => {
    const output = makeOutput({ audienceCount: 10, completedCount: 8, failedCount: 1 });
    expect(output.keyFindings).toBeDefined();
    const keyFindings = output.keyFindings!;
    expect(keyFindings.length).toBeLessThanOrEqual(3);
    expect(keyFindings.length).toBeGreaterThanOrEqual(1);
    for (const f of keyFindings) {
      expect(typeof f.finding).toBe("string");
      expect(f.finding.length).toBeGreaterThan(0);
      expect(typeof f.evidence).toBe("string");
      expect(typeof f.impact).toBe("string");
      expect(typeof f.action).toBe("string");
      expect(Array.isArray(f.evidenceRefs)).toBe(true);
    }
  });

  it("keyFindings fills up to 3 with fallbacks when mainBlocker/segments are sparse", () => {
    // 极小样本 + 无 blocker 触发 fallback 路径
    const output = makeOutput({ audienceCount: 2, completedCount: 2, failedCount: 0 });
    expect(output.keyFindings).toBeDefined();
    const keyFindings = output.keyFindings!;
    expect(keyFindings.length).toBeGreaterThanOrEqual(1);
    for (const f of keyFindings) {
      expect(f.finding).toBeTruthy();
      expect(f.action).toBeTruthy();
    }
  });

  it("rewriteSuggestions includes recommendedTitles (>=1), opening, commentPrompt, tags", () => {
    const output = makeOutput({ audienceCount: 10, completedCount: 8, failedCount: 1 });
    expect(output.rewriteSuggestions).toBeDefined();
    const rs = output.rewriteSuggestions!;
    expect(rs.recommendedTitles.length).toBeGreaterThanOrEqual(1);
    for (const t of rs.recommendedTitles) {
      expect(typeof t.text).toBe("string");
      expect(t.text.length).toBeGreaterThan(0);
      expect(typeof t.reason).toBe("string");
      expect(t.reason.length).toBeGreaterThan(0);
    }
    // recommendedOpening 即使 mainBlocker=null 也应该有值（R5 修复）
    expect(rs.recommendedOpening).toBeDefined();
    expect(rs.recommendedOpening!.text).toBeTruthy();
    expect(rs.recommendedOpening!.reason).toBeTruthy();
    expect(rs.recommendedCommentPrompt).toBeDefined();
    expect(rs.recommendedTags.length).toBeGreaterThan(0);
  });

  it("diagnostics every area has non-empty reason", () => {
    const output = makeOutput({ audienceCount: 10, completedCount: 8, failedCount: 1 });
    expect(output.diagnostics.length).toBe(5);
    for (const d of output.diagnostics) {
      expect(d.reason).toBeTruthy();
      expect(d.reason!.length).toBeGreaterThan(0);
    }
  });

  it("retestPlan every item has hypothesis starting with H and testVersionLabel", () => {
    const output = makeOutput({ audienceCount: 10, completedCount: 8, failedCount: 1 });
    // 如果有 retestPlan，每条 hypothesis 必须以 H 开头
    for (const r of output.retestPlan) {
      expect(r.hypothesis).toBeTruthy();
      expect(r.hypothesis!.startsWith("H")).toBe(true);
      expect(r.testVersionLabel).toBeTruthy();
      expect(r.testVersionLabel!.length).toBeGreaterThan(0);
    }
  });

  it("summaryMarkdown is non-empty", () => {
    const output = makeOutput({ audienceCount: 10, completedCount: 8, failedCount: 1 });
    expect(output.summaryMarkdown).toBeDefined();
    expect(output.summaryMarkdown!.length).toBeGreaterThan(0);
  });
});