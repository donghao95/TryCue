import { describe, expect, it } from "vitest";
import { ReportOutputSchema } from "@trycue/shared";
import { buildEvidencePack, recommendFromEvidence, selectMainBlocker, type EvidencePackInput } from "../runtime/evidencePack.js";
import { coerceReportOutput, assertNoBannedScoreFields, assertNoRealPlatformClaims, assertNoInventedEvidenceRefs } from "./reportAgent.js";
import { fallbackDiagnosticContent } from "../runtime/reportBuilders.js";

// -- fixtures --

function makeBaseInput(overrides: Partial<EvidencePackInput> = {}): EvidencePackInput {
  return {
    runId: "run-1",
    contentVersionId: "cv-1",
    content: { title: "test", bodyText: "body", imageUrlsJson: [], coverImageUrl: null },
    postState: { exposureCount: 10, openCount: 6, likeCount: 3, favoriteCount: 2, commentCount: 1, shareCount: 1, exitCount: 4 },
    journeys: [],
    participants: [],
    directives: [],
    comments: [],
    logs: [],
    toolCalls: [],
    turns: [],
    audienceCount: 10,
    completedCount: 8,
    failedCount: 1,
    skippedCount: 1,
    wasEndedEarly: false,
    ...overrides
  };
}

function makePackAndContext() {
  const pack = buildEvidencePack(makeBaseInput());
  const candidate = recommendFromEvidence(pack);
  const mainBlocker = selectMainBlocker(pack.blockers);
  return { pack, candidate, mainBlocker };
}

// -- coerceReportOutput basic shape --

describe("coerceReportOutput basic shape", () => {
  it("produces a schema-valid ReportOutput from empty input", () => {
    const { pack, candidate, mainBlocker } = makePackAndContext();
    const output = coerceReportOutput({}, pack, candidate, mainBlocker);
    const result = ReportOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it("produces a schema-valid ReportOutput from empty object input", () => {
    const { pack, candidate, mainBlocker } = makePackAndContext();
    const output = coerceReportOutput({} as Record<string, unknown>, pack, candidate, mainBlocker);
    expect(() => ReportOutputSchema.parse(output)).not.toThrow();
  });

  it("always includes keyFindings and rewriteSuggestions (R1 fix)", () => {
    const { pack, candidate, mainBlocker } = makePackAndContext();
    const output = coerceReportOutput({}, pack, candidate, mainBlocker);
    expect(output.keyFindings).toBeDefined();
    expect(output.keyFindings!.length).toBeGreaterThan(0);
    expect(output.keyFindings!.length).toBeLessThanOrEqual(3);
    expect(output.rewriteSuggestions).toBeDefined();
    expect(output.rewriteSuggestions!.recommendedTitles.length).toBeGreaterThan(0);
    expect(output.rewriteSuggestions!.recommendedOpening).toBeDefined();
    expect(output.rewriteSuggestions!.recommendedCommentPrompt).toBeDefined();
    expect(output.rewriteSuggestions!.recommendedTags.length).toBeGreaterThan(0);
  });

  it("always includes reason in every diagnostic (R2 fix)", () => {
    const { pack, candidate, mainBlocker } = makePackAndContext();
    const output = coerceReportOutput({}, pack, candidate, mainBlocker);
    expect(output.diagnostics.length).toBe(5);
    for (const d of output.diagnostics) {
      expect(d.reason).toBeTruthy();
      expect(typeof d.reason).toBe("string");
      expect(d.reason!.length).toBeGreaterThan(0);
    }
  });

  it("always includes hypothesis and testVersionLabel in every retestPlan item (R3 fix)", () => {
    const { pack, candidate, mainBlocker } = makePackAndContext();
    const output = coerceReportOutput({}, pack, candidate, mainBlocker);
    expect(output.retestPlan.length).toBeGreaterThan(0);
    for (const q of output.retestPlan) {
      expect(q.hypothesis).toBeTruthy();
      expect(q.hypothesis).toMatch(/^H\d/);
      expect(q.testVersionLabel).toBeTruthy();
      expect(q.testVersionLabel!.length).toBeGreaterThan(0);
    }
  });
});

// -- coerceReportOutput with valid LLM input --

describe("coerceReportOutput with valid LLM input", () => {
  it("prefers LLM-produced keyFindings and backfills to 3 when LLM gives fewer", () => {
    const { pack, candidate, mainBlocker } = makePackAndContext();
    const llmKeyFindings = [
      {
        finding: "LLM finding 1",
        evidence: "LLM evidence 1",
        impact: "LLM impact 1",
        action: "LLM action 1",
        evidenceRefs: []
      },
      {
        finding: "LLM finding 2",
        evidence: "LLM evidence 2",
        impact: "LLM impact 2",
        action: "LLM action 2",
        evidenceRefs: []
      }
    ];
    const output = coerceReportOutput({ keyFindings: llmKeyFindings }, pack, candidate, mainBlocker);
    // spec §5 要求"固定 3 条"：LLM 给 2 条有效项，用 fallback 补齐到 3 条
    expect(output.keyFindings!.length).toBe(3);
    // 前 2 条是 LLM 产出（优先保留）
    expect(output.keyFindings![0]!.finding).toBe("LLM finding 1");
    expect(output.keyFindings![1]!.finding).toBe("LLM finding 2");
    // 第 3 条是 fallback 补齐（不与 LLM 重复）
    expect(output.keyFindings![2]!.finding).not.toBe("LLM finding 1");
    expect(output.keyFindings![2]!.finding).not.toBe("LLM finding 2");
    expect(output.keyFindings![2]!.finding).toBeTruthy();
  });

  it("clamps keyFindings to at most 3 items", () => {
    const { pack, candidate, mainBlocker } = makePackAndContext();
    const llmKeyFindings = Array.from({ length: 5 }, (_, i) => ({
      finding: `LLM finding ${i}`,
      evidence: `LLM evidence ${i}`,
      impact: `LLM impact ${i}`,
      action: `LLM action ${i}`,
      evidenceRefs: []
    }));
    const output = coerceReportOutput({ keyFindings: llmKeyFindings }, pack, candidate, mainBlocker);
    expect(output.keyFindings!.length).toBe(3);
  });

  it("prefers LLM-produced rewriteSuggestions over fallback", () => {
    const { pack, candidate, mainBlocker } = makePackAndContext();
    const llmRewrite = {
      recommendedTitles: [{ text: "LLM title", reason: "LLM reason" }],
      recommendedOpening: { text: "LLM opening", reason: "LLM reason" },
      recommendedCommentPrompt: { text: "LLM comment prompt", reason: "LLM reason" },
      recommendedTags: ["LLM-tag-1", "LLM-tag-2"]
    };
    const output = coerceReportOutput({ rewriteSuggestions: llmRewrite }, pack, candidate, mainBlocker);
    expect(output.rewriteSuggestions!.recommendedTitles[0]?.text).toBe("LLM title");
    expect(output.rewriteSuggestions!.recommendedTags).toEqual(["LLM-tag-1", "LLM-tag-2"]);
  });

  it("prefers LLM-produced reason in diagnostics over fallback", () => {
    const { pack, candidate, mainBlocker } = makePackAndContext();
    const llmDiagnostics = [
      { area: "feed_attraction", status: "weak", finding: "LLM finding", reason: "LLM reason", suggestedFix: "LLM fix", evidenceRefs: [] }
    ];
    const output = coerceReportOutput({ diagnostics: llmDiagnostics }, pack, candidate, mainBlocker);
    const feed = output.diagnostics.find((d) => d.area === "feed_attraction")!;
    expect(feed.reason).toBe("LLM reason");
  });

  it("prefers LLM-produced hypothesis/testVersionLabel over fallback", () => {
    const { pack, candidate, mainBlocker } = makePackAndContext();
    const llmRetest = [
      {
        question: "LLM question",
        relatedAction: "补充检测数据和材料来源",
        metricToWatch: "llm.metric",
        expectedDirection: "下降",
        hypothesis: "H9: LLM hypothesis",
        testVersionLabel: "Z 版：LLM"
      }
    ];
    const output = coerceReportOutput({ retestPlan: llmRetest }, pack, candidate, mainBlocker);
    expect(output.retestPlan[0]!.hypothesis).toBe("H9: LLM hypothesis");
    expect(output.retestPlan[0]!.testVersionLabel).toBe("Z 版：LLM");
  });
});

// -- coerceReportOutput with partially invalid LLM input --

describe("coerceReportOutput with partially invalid LLM input", () => {
  it("drops keyFindings items missing required string fields and falls back if all dropped", () => {
    const { pack, candidate, mainBlocker } = makePackAndContext();
    // All items missing `action` → should be dropped → fallback used
    const invalidKeyFindings = [
      { finding: "f", evidence: "e", impact: "i" /* missing action */ }
    ];
    const output = coerceReportOutput({ keyFindings: invalidKeyFindings }, pack, candidate, mainBlocker);
    expect(output.keyFindings!.length).toBeGreaterThan(0);
    expect(output.keyFindings!.length).toBeLessThanOrEqual(3);
    // Should be fallback content (not the invalid LLM input)
    expect(output.keyFindings![0]!.action).toBeTruthy();
  });

  it("drops rewriteSuggestions sub-items missing text or reason", () => {
    const { pack, candidate, mainBlocker } = makePackAndContext();
    // All sub-items invalid → hasAny=false → buildRewriteSuggestions returns undefined → fallback used.
    const invalidRewrite = {
      recommendedTitles: [{ text: "", reason: "r" }], // empty text → dropped
      recommendedTags: [123, null, true], // all non-strings → dropped
      recommendedOpening: { text: "opening", reason: "" } // empty reason → dropped
    };
    const output = coerceReportOutput({ rewriteSuggestions: invalidRewrite }, pack, candidate, mainBlocker);
    // No valid sub-items from LLM → falls back to mock builder
    expect(output.rewriteSuggestions!.recommendedTitles.length).toBeGreaterThan(0);
    expect(output.rewriteSuggestions!.recommendedOpening).toBeDefined();
  });

  it("fills missing reason in diagnostics from fallback when LLM gives empty string", () => {
    const { pack, candidate, mainBlocker } = makePackAndContext();
    const llmDiagnostics = [
      { area: "feed_attraction", status: "weak", finding: "LLM finding", reason: "", suggestedFix: "LLM fix", evidenceRefs: [] }
    ];
    const output = coerceReportOutput({ diagnostics: llmDiagnostics }, pack, candidate, mainBlocker);
    const feed = output.diagnostics.find((d) => d.area === "feed_attraction")!;
    // Empty reason → fallback used. 锁定 status→reason 依赖：reason 必须对应 LLM 给定的 status="weak"，
    // 而非 computeDiagnosticStatus 计算出的 status（pack 的 openRate=0.6 会算出 "strong"）。
    expect(feed.reason).toBeTruthy();
    expect(feed.reason).not.toBe("");
    expect(feed.reason).toBe(fallbackDiagnosticContent("feed_attraction", "weak", pack).reason);
  });

  it("fills missing hypothesis/testVersionLabel from fallback when LLM gives empty strings", () => {
    const { pack, candidate, mainBlocker } = makePackAndContext();
    const llmRetest = [
      {
        question: "LLM question",
        relatedAction: "补充检测数据和材料来源",
        metricToWatch: "llm.metric",
        expectedDirection: "下降",
        hypothesis: "",
        testVersionLabel: ""
      }
    ];
    const output = coerceReportOutput({ retestPlan: llmRetest }, pack, candidate, mainBlocker);
    expect(output.retestPlan[0]!.hypothesis).toBeTruthy();
    expect(output.retestPlan[0]!.hypothesis).toMatch(/^H\d/);
    expect(output.retestPlan[0]!.testVersionLabel).toBeTruthy();
  });

  it("falls back to full fallback retestPlan when LLM produces no valid items", () => {
    const { pack, candidate, mainBlocker } = makePackAndContext();
    // All items missing `question` → dropped → fallbackPlan used
    const invalidRetest = [
      { relatedAction: "x", metricToWatch: "m", expectedDirection: "d" /* missing question */ }
    ];
    const output = coerceReportOutput({ retestPlan: invalidRetest }, pack, candidate, mainBlocker);
    expect(output.retestPlan.length).toBeGreaterThan(0);
    for (const q of output.retestPlan) {
      expect(q.hypothesis).toMatch(/^H\d/);
      expect(q.testVersionLabel).toBeTruthy();
    }
  });
});

// -- coerceReportOutput recommendation clamping --

describe("coerceReportOutput recommendation clamping", () => {
  it("clamps LLM recommendation to not upgrade past candidate", () => {
    const { pack, candidate, mainBlocker } = makePackAndContext();
    // Try to upgrade to publish regardless of candidate
    const output = coerceReportOutput(
      { verdict: { recommendation: "recommend_publish" } },
      pack,
      candidate,
      mainBlocker
    );
    const order = ["recommend_publish", "modify_then_publish", "not_recommend_current_version", "recommend_retest"];
    const candidateRank = order.indexOf(candidate);
    const outputRank = order.indexOf(output.verdict.recommendation);
    expect(outputRank).toBeGreaterThanOrEqual(candidateRank);
  });

  it("forces recommend_retest when evidenceQuality is low", () => {
    const pack = buildEvidencePack(makeBaseInput({ audienceCount: 2, completedCount: 1 }));
    const candidate = recommendFromEvidence(pack);
    const mainBlocker = selectMainBlocker(pack.blockers);
    expect(pack.meta.evidenceQuality).toBe("low");
    const output = coerceReportOutput(
      { verdict: { recommendation: "recommend_publish" } },
      pack,
      candidate,
      mainBlocker
    );
    expect(output.verdict.recommendation).toBe("recommend_retest");
  });
});

// -- Guards re-used from reportAgent (regression coverage) --

describe("guards regression coverage", () => {
  it("assertNoBannedScoreFields throws on numeric score", () => {
    expect(() => assertNoBannedScoreFields({ verdict: { score: 87 } })).toThrow();
  });

  it("assertNoBannedScoreFields throws on B+ in string", () => {
    expect(() => assertNoBannedScoreFields({ verdict: { headline: "评级 B+" } })).toThrow();
  });

  it("assertNoRealPlatformClaims throws on forbidden phrase", () => {
    const { pack, candidate, mainBlocker } = makePackAndContext();
    const output = coerceReportOutput({}, pack, candidate, mainBlocker);
    output.verdict.headline = "发布后会获得高点赞";
    expect(() => assertNoRealPlatformClaims(output)).toThrow();
  });

  it("assertNoInventedEvidenceRefs throws on unknown id", () => {
    const { pack, candidate, mainBlocker } = makePackAndContext();
    const output = coerceReportOutput({}, pack, candidate, mainBlocker);
    output.verdict.evidenceRefs = [
      ...output.verdict.evidenceRefs,
      { id: "invented:test-1", type: "metric", label: "fake" }
    ];
    const validIds = new Set(Object.keys(pack.evidenceIndex));
    expect(() => assertNoInventedEvidenceRefs(output, validIds)).toThrow();
  });

  it("coerced output passes all three guards", () => {
    const { pack, candidate, mainBlocker } = makePackAndContext();
    const output = coerceReportOutput({}, pack, candidate, mainBlocker);
    const validIds = new Set(Object.keys(pack.evidenceIndex));
    expect(() => assertNoBannedScoreFields({})).not.toThrow();
    expect(() => assertNoRealPlatformClaims(output)).not.toThrow();
    expect(() => assertNoInventedEvidenceRefs(output, validIds)).not.toThrow();
  });
});

// -- Mock/real path parity --

describe("mock/real path parity (R1 fix)", () => {
  it("real-LLM path with empty input produces same keyFindings/rewriteSuggestions structure as mock path", async () => {
    const { buildFallbackReportOutput } = await import("../runtime/report.js");
    const { pack, candidate, mainBlocker } = makePackAndContext();

    const mockOutput = buildFallbackReportOutput(pack, candidate, mainBlocker, false);
    const realOutput = coerceReportOutput({}, pack, candidate, mainBlocker);

    // keyFindings: same count and same first finding text (both use buildFallbackKeyFindings)
    expect(realOutput.keyFindings!.length).toBe(mockOutput.keyFindings!.length);
    expect(realOutput.keyFindings![0]!.finding).toBe(mockOutput.keyFindings![0]!.finding);

    // rewriteSuggestions: same structure
    expect(realOutput.rewriteSuggestions!.recommendedTitles.length).toBe(mockOutput.rewriteSuggestions!.recommendedTitles.length);
    expect(realOutput.rewriteSuggestions!.recommendedTags).toEqual(mockOutput.rewriteSuggestions!.recommendedTags);

    // evidenceRefs parity 不要求完全一致：real path 的 verdict/segments/diagnostics 内容来自 LLM
    // （空输入→空 evidenceRefs），mock path 来自 fallback builder（有 evidenceRefs）。
    // MUST-FIX #1（collectTopLevelRefs 纳入 keyFindings.evidenceRefs）的正确性通过代码审查确认：
    // reportBuilders.ts 的 collectTopLevelRefs 接受可选 keyFindings 参数并 push 其 evidenceRefs，
    // report.ts 的 buildFallbackReportOutput 在调用 collectTopLevelRefs 时传入 keyFindings。
  });

  it("real-LLM path with empty input produces same diagnostics reason as mock path (R2 fix)", async () => {
    const { buildFallbackReportOutput } = await import("../runtime/report.js");
    const { pack, candidate, mainBlocker } = makePackAndContext();

    const mockOutput = buildFallbackReportOutput(pack, candidate, mainBlocker, false);
    const realOutput = coerceReportOutput({}, pack, candidate, mainBlocker);

    // Same reason content for each area (both use fallbackDiagnosticContent when LLM omits)
    for (const realDiag of realOutput.diagnostics) {
      const mockDiag = mockOutput.diagnostics.find((d) => d.area === realDiag.area)!;
      expect(realDiag.reason).toBe(mockDiag.reason);
    }
  });

  it("real-LLM path with empty input produces same retestPlan hypothesis as mock path (R3 fix)", async () => {
    const { buildFallbackReportOutput } = await import("../runtime/report.js");
    const { pack, candidate, mainBlocker } = makePackAndContext();

    const mockOutput = buildFallbackReportOutput(pack, candidate, mainBlocker, false);
    const realOutput = coerceReportOutput({}, pack, candidate, mainBlocker);

    expect(realOutput.retestPlan.length).toBe(mockOutput.retestPlan.length);
    for (let i = 0; i < realOutput.retestPlan.length; i++) {
      expect(realOutput.retestPlan[i]!.hypothesis).toBe(mockOutput.retestPlan[i]!.hypothesis);
      expect(realOutput.retestPlan[i]!.testVersionLabel).toBe(mockOutput.retestPlan[i]!.testVersionLabel);
    }
  });
});
