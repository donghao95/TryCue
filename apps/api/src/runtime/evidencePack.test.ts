import { describe, expect, it } from "vitest";
import {
  buildEvidencePack,
  recommendFromEvidence,
  selectMainBlocker,
  type EvidencePackInput
} from "./evidencePack.js";
import type { EvidenceBlocker, EvidencePack } from "@trycue/shared";

// -- test fixtures --

function makeBaseInput(overrides: Partial<EvidencePackInput> = {}): EvidencePackInput {
  return {
    runId: "run-1",
    contentVersionId: "cv-1",
    content: {
      title: "test title",
      bodyText: "test body",
      imageUrlsJson: [],
      coverImageUrl: null
    },
    postState: {
      exposureCount: 10,
      openCount: 6,
      likeCount: 3,
      favoriteCount: 2,
      commentCount: 1,
      shareCount: 1,
      exitCount: 4
    },
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

function makeBlocker(overrides: Partial<EvidenceBlocker> = {}): EvidenceBlocker {
  return {
    blockerType: "feed_attraction",
    severity: "medium",
    affectedCount: 3,
    summary: "test blocker summary",
    evidenceRefs: [],
    ...overrides
  };
}

// -- buildEvidencePack basic tests --

describe("buildEvidencePack", () => {
  it("returns an EvidencePack with all top-level fields", () => {
    const pack = buildEvidencePack(makeBaseInput());
    expect(pack).toBeDefined();
    expect(pack.meta).toBeDefined();
    expect(pack.content).toBeDefined();
    expect(pack.funnel).toBeDefined();
    expect(pack.exitAnalysis).toBeDefined();
    expect(pack.commentAnalysis).toBeDefined();
    expect(pack.thoughtAnalysis).toBeDefined();
    expect(pack.segments).toBeDefined();
    expect(pack.blockers).toBeDefined();
    expect(pack.audienceGroups).toBeDefined();
    expect(pack.journeySamples).toBeDefined();
    expect(pack.evidenceIndex).toBeDefined();
  });

  it("populates funnel actor counts from participant facts", () => {
    // 构造有 5 个参与者的输入，其中 3 个打开了帖子
    const input = makeBaseInput({
      participants: [
        { id: "p1", displayNameSnapshot: "A", profileSnapshotJson: {}, samplingDirectiveId: null },
        { id: "p2", displayNameSnapshot: "B", profileSnapshotJson: {}, samplingDirectiveId: null },
        { id: "p3", displayNameSnapshot: "C", profileSnapshotJson: {}, samplingDirectiveId: null },
        { id: "p4", displayNameSnapshot: "D", profileSnapshotJson: {}, samplingDirectiveId: null },
        { id: "p5", displayNameSnapshot: "E", profileSnapshotJson: {}, samplingDirectiveId: null }
      ],
      toolCalls: [
        { id: "tc1", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 0, toolName: "open_post", status: "committed", input: {}, output: {}, simulatedTime: null },
        { id: "tc2", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 1, toolName: "like_post", status: "committed", input: { postId: "post-1" }, output: {}, simulatedTime: null },
        { id: "tc3", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 2, toolName: "exit_browsing", status: "committed", input: {}, output: { reasonCategory: "finished_normally", readingDepth: "full", interestLevel: "high", trustLevel: "high" }, simulatedTime: null },
        { id: "tc4", agentTurnId: null, journeyId: null, participantId: "p2", callIndex: 0, toolName: "open_post", status: "committed", input: {}, output: {}, simulatedTime: null },
        { id: "tc5", agentTurnId: null, journeyId: null, participantId: "p2", callIndex: 1, toolName: "favorite_post", status: "committed", input: { postId: "post-1" }, output: {}, simulatedTime: null },
        { id: "tc6", agentTurnId: null, journeyId: null, participantId: "p2", callIndex: 2, toolName: "exit_browsing", status: "committed", input: {}, output: { reasonCategory: "not_interested", readingDepth: "skimmed", interestLevel: "low", trustLevel: "medium" }, simulatedTime: null },
        { id: "tc7", agentTurnId: null, journeyId: null, participantId: "p3", callIndex: 0, toolName: "open_post", status: "committed", input: {}, output: {}, simulatedTime: null },
        { id: "tc8", agentTurnId: null, journeyId: null, participantId: "p3", callIndex: 1, toolName: "write_comment", status: "committed", input: { postId: "post-1", intent: "agree", content: "好文" }, output: { commentId: "c1", intent: "agree" }, simulatedTime: null },
        { id: "tc9", agentTurnId: null, journeyId: null, participantId: "p3", callIndex: 2, toolName: "share_post", status: "committed", input: { postId: "post-1" }, output: {}, simulatedTime: null },
        { id: "tc10", agentTurnId: null, journeyId: null, participantId: "p3", callIndex: 3, toolName: "exit_browsing", status: "committed", input: {}, output: { reasonCategory: "finished_normally", readingDepth: "full", interestLevel: "high", trustLevel: "high" }, simulatedTime: null }
      ],
      audienceCount: 5
    });
    const pack = buildEvidencePack(input);
    expect(pack.funnel.exposedActors).toBe(5); // 5 participants
    expect(pack.funnel.openedActors).toBe(3); // p1, p2, p3
    expect(pack.funnel.likedActors).toBe(1); // p1
    expect(pack.funnel.favoritedActors).toBe(1); // p2
    expect(pack.funnel.commentedActors).toBe(1); // p3
    expect(pack.funnel.sharedActors).toBe(1); // p3
    expect(pack.funnel.exitedActors).toBe(3); // p1, p2, p3
    expect(pack.funnel.positiveActionActors).toBe(3); // p1(liked), p2(favorited), p3(commented+shared)
    expect(pack.funnel.commentEvents).toBe(1);
    expect(pack.funnel.shareEvents).toBe(1);
  });

  it("computes open rate from exposed/opened actors", () => {
    const input = makeBaseInput({
      participants: [
        { id: "p1", displayNameSnapshot: "A", profileSnapshotJson: {}, samplingDirectiveId: null },
        { id: "p2", displayNameSnapshot: "B", profileSnapshotJson: {}, samplingDirectiveId: null }
      ],
      toolCalls: [
        { id: "tc1", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 0, toolName: "open_post", status: "committed", input: {}, output: {}, simulatedTime: null }
      ],
      audienceCount: 2
    });
    const pack = buildEvidencePack(input);
    // 2 exposed, 1 opened → 0.5
    expect(pack.funnel.openRate).toBeCloseTo(0.5, 5);
  });

  it("returns null openRate when no participants", () => {
    const pack = buildEvidencePack(makeBaseInput({
      participants: [],
      toolCalls: [],
      audienceCount: 0
    }));
    expect(pack.funnel.openRate).toBeNull();
  });

  it("records metric evidence items in evidenceIndex", () => {
    const pack = buildEvidencePack(makeBaseInput());
    expect(pack.evidenceIndex["metric:audienceCount"]).toBeDefined();
    expect(pack.evidenceIndex["metric:completedCount"]).toBeDefined();
    expect(pack.evidenceIndex["metric:failedCount"]).toBeDefined();
    expect(pack.evidenceIndex["metric:audienceCount"]?.type).toBe("metric");
  });
});

// -- evidenceQuality rules --

describe("evidenceQuality rules", () => {
  it("marks quality as low when audienceCount < 3", () => {
    const pack = buildEvidencePack(makeBaseInput({ audienceCount: 2, completedCount: 2 }));
    expect(pack.meta.evidenceQuality).toBe("low");
  });

  it("marks quality as low when completedCount < audienceCount * 0.5", () => {
    const pack = buildEvidencePack(makeBaseInput({ audienceCount: 10, completedCount: 4 }));
    expect(pack.meta.evidenceQuality).toBe("low");
  });

  it("marks quality as low when failedCount > audienceCount * 0.3", () => {
    const pack = buildEvidencePack(makeBaseInput({ audienceCount: 10, completedCount: 8, failedCount: 4 }));
    expect(pack.meta.evidenceQuality).toBe("low");
  });

  it("marks quality as high when completedCount >= 80% and failedCount < 10%", () => {
    const pack = buildEvidencePack(makeBaseInput({ audienceCount: 10, completedCount: 9, failedCount: 0 }));
    expect(pack.meta.evidenceQuality).toBe("high");
  });

  it("marks quality as medium otherwise", () => {
    const pack = buildEvidencePack(makeBaseInput({ audienceCount: 10, completedCount: 6, failedCount: 2 }));
    expect(pack.meta.evidenceQuality).toBe("medium");
  });
});

// -- recommendFromEvidence rules --

describe("recommendFromEvidence", () => {
  function makePack(overrides: Partial<EvidencePack> = {}): EvidencePack {
    const base = buildEvidencePack(makeBaseInput({ audienceCount: 10, completedCount: 8, failedCount: 1 }));
    return { ...base, ...overrides };
  }

  it("returns recommend_retest when evidenceQuality is low", () => {
    const base = buildEvidencePack(makeBaseInput());
    const pack = makePack({ meta: { ...base.meta, evidenceQuality: "low" } });
    expect(recommendFromEvidence(pack)).toBe("recommend_retest");
  });

  it("returns recommend_publish when core open rate high, no high blocker, low risk exit, positive action > 0.3", () => {
    const base = buildEvidencePack(makeBaseInput());
    const pack = makePack({
      meta: { ...base.meta, evidenceQuality: "medium", audienceCount: 10 },
      funnel: { ...base.funnel, openRate: 0.7, positiveActionRate: 0.5 },
      audienceGroups: {
        ...base.audienceGroups,
        groups: [{
          directiveId: "d1",
          directiveName: "core",
          role: "core_target",
          confidence: "medium",
          total: 10,
          opened: 7,
          readSkim: 2,
          readPartial: 3,
          readFull: 2,
          viewedComments: 4,
          liked: 3,
          favorited: 2,
          commented: 1,
          shared: 1,
          riskExitCount: 1,
          mainExitReasons: [],
          mainCommentIntents: [],
          representativeThoughts: [],
          representativeComments: [],
          representativeJourneys: [],
          evidenceRefs: []
        }]
      },
      exitAnalysis: { ...base.exitAnalysis, riskExitCount: 1 },
      blockers: []
    });
    expect(recommendFromEvidence(pack)).toBe("recommend_publish");
  });

  it("returns modify_then_publish when core open rate >= 0.4 and has medium blocker", () => {
    const base = buildEvidencePack(makeBaseInput());
    const pack = makePack({
      meta: { ...base.meta, evidenceQuality: "medium", audienceCount: 10 },
      funnel: { ...base.funnel, openRate: 0.5, positiveActionRate: 0.4 },
      audienceGroups: {
        ...base.audienceGroups,
        groups: [{
          directiveId: "d1",
          directiveName: "core",
          role: "core_target",
          confidence: "medium",
          total: 10,
          opened: 5,
          readSkim: 1,
          readPartial: 2,
          readFull: 2,
          viewedComments: 3,
          liked: 2,
          favorited: 1,
          commented: 1,
          shared: 0,
          riskExitCount: 1,
          mainExitReasons: [],
          mainCommentIntents: [],
          representativeThoughts: [],
          representativeComments: [],
          representativeJourneys: [],
          evidenceRefs: []
        }]
      },
      exitAnalysis: { ...base.exitAnalysis, riskExitCount: 1 },
      blockers: [makeBlocker({ severity: "medium" })]
    });
    expect(recommendFromEvidence(pack)).toBe("modify_then_publish");
  });

  it("returns not_recommend_current_version when core open rate low and no blockers", () => {
    const base = buildEvidencePack(makeBaseInput());
    const pack = makePack({
      meta: { ...base.meta, evidenceQuality: "medium", audienceCount: 10 },
      funnel: { ...base.funnel, openRate: 0.2, positiveActionRate: 0.1 },
      audienceGroups: {
        ...base.audienceGroups,
        groups: [{
          directiveId: "d1",
          directiveName: "core",
          role: "core_target",
          confidence: "medium",
          total: 10,
          opened: 2,
          readSkim: 1,
          readPartial: 1,
          readFull: 0,
          viewedComments: 1,
          liked: 0,
          favorited: 0,
          commented: 0,
          shared: 0,
          riskExitCount: 2,
          mainExitReasons: [],
          mainCommentIntents: [],
          representativeThoughts: [],
          representativeComments: [],
          representativeJourneys: [],
          evidenceRefs: []
        }]
      },
      blockers: []
    });
    expect(recommendFromEvidence(pack)).toBe("not_recommend_current_version");
  });

  it("falls back to funnel.openRate when no core_target group exists", () => {
    const base = buildEvidencePack(makeBaseInput());
    const pack = makePack({
      meta: { ...base.meta, evidenceQuality: "medium", audienceCount: 10 },
      funnel: { ...base.funnel, openRate: 0.7, positiveActionRate: 0.5 },
      audienceGroups: { ...base.audienceGroups, groups: [] },
      exitAnalysis: { ...base.exitAnalysis, riskExitCount: 1 },
      blockers: []
    });
    expect(recommendFromEvidence(pack)).toBe("recommend_publish");
  });
});

// -- selectMainBlocker rules --

describe("selectMainBlocker", () => {
  it("returns null for empty blockers", () => {
    expect(selectMainBlocker([])).toBeNull();
  });

  it("returns the single blocker when only one exists", () => {
    const blocker = makeBlocker({ severity: "medium" });
    expect(selectMainBlocker([blocker])).toStrictEqual(blocker);
  });

  it("prefers high severity over medium", () => {
    const high = makeBlocker({ blockerType: "trust_evidence", severity: "high", affectedCount: 1 });
    const medium = makeBlocker({ blockerType: "feed_attraction", severity: "medium", affectedCount: 10 });
    expect(selectMainBlocker([medium, high])).toStrictEqual(high);
  });

  it("prefers medium severity over low", () => {
    const medium = makeBlocker({ blockerType: "trust_evidence", severity: "medium", affectedCount: 1 });
    const low = makeBlocker({ blockerType: "feed_attraction", severity: "low", affectedCount: 10 });
    expect(selectMainBlocker([low, medium])).toStrictEqual(medium);
  });

  it("breaks ties by affectedCount descending", () => {
    const a = makeBlocker({ blockerType: "trust_evidence", severity: "high", affectedCount: 3 });
    const b = makeBlocker({ blockerType: "feed_attraction", severity: "high", affectedCount: 7 });
    expect(selectMainBlocker([a, b])).toStrictEqual(b);
  });

  it("does not mutate the input array", () => {
    const a = makeBlocker({ blockerType: "trust_evidence", severity: "high", affectedCount: 3 });
    const b = makeBlocker({ blockerType: "feed_attraction", severity: "high", affectedCount: 7 });
    const input = [a, b];
    selectMainBlocker(input);
    expect(input[0]).toBe(a);
    expect(input[1]).toBe(b);
  });
});


// -- non-empty fixture tests (participant-driven aggregation) --
// 该 fixture 构造 4 个参与者、2 个 directive（core_target / contrast）、
// 4 条 journey 与配套 toolCalls/turns/logs/comments，覆盖 segment 分类、
// blocker 检测、phase 分配、evidenceRef 完整性、抽样组聚合、阅读深度、
// 离开原因与评论意图统计。
//
// 预期 segment 归属（每类恰好 1 人，便于精确断言）：
//   p1 -> persuaded                 （点开 + 完整阅读 + 点赞）
//   p2 -> skipped                   （未点开，feed_only 离开）
//   p3 -> interested_but_not_convinced （点开 + 部分阅读/看评论 + 证据不足离开）
//   p4 -> skeptical                 （质疑评论 doubt）
//
// 预期 blocker：feed_attraction(p2)、opening_retention(p4)、trust_evidence(p3)、comment_risk(p4)
// 不触发：action_motivation（p1 点赞、p4 评论均有正向行为）、
//         target_mismatch（核心人群点开率 2/2=1.0）、evidence_quality（样本质量 high）

function makeNonEmptyInput(): EvidencePackInput {
  const turns: EvidencePackInput["turns"] = [
    { id: "t1", thoughtText: "标题挺吸引人，点开看看" },
    { id: "t2", thoughtText: "正文内容详实有用" },
    { id: "t3", thoughtText: null },
    { id: "t4", thoughtText: "看完了，点个赞离开" },
    { id: "t5", thoughtText: "这条不太相关，直接划走" },
    { id: "t6", thoughtText: "标题有点意思，点开看看" },
    { id: "t7", thoughtText: "正文有点长，先看部分" },
    { id: "t8", thoughtText: "看看大家怎么评论的" },
    { id: "t9", thoughtText: "证据不太够，先离开了" },
    { id: "t10", thoughtText: "点开看看具体内容" },
    { id: "t11", thoughtText: "快速扫一遍" },
    { id: "t12", thoughtText: "这个说法我得质疑一下" },
    { id: "t13", thoughtText: "不太信任这篇内容" }
  ];

  const toolCalls: EvidencePackInput["toolCalls"] = [
    // p1 (d1 core_target) -> persuaded
    { id: "tc1", agentTurnId: "t1", journeyId: "j1", participantId: "p1", callIndex: 0, toolName: "open_post", status: "committed", input: {}, output: {}, simulatedTime: 10 },
    { id: "tc2", agentTurnId: "t2", journeyId: "j1", participantId: "p1", callIndex: 1, toolName: "read_post", status: "committed", input: {}, output: { depth: "full" }, simulatedTime: 20 },
    { id: "tc3", agentTurnId: "t3", journeyId: "j1", participantId: "p1", callIndex: 2, toolName: "like_post", status: "committed", input: {}, output: {}, simulatedTime: 30 },
    { id: "tc4", agentTurnId: "t4", journeyId: "j1", participantId: "p1", callIndex: 3, toolName: "exit_browsing", status: "committed", input: {}, output: { reasonCategory: "finished_normally", readingDepth: "full", interestLevel: "high", trustLevel: "high" }, simulatedTime: 40 },
    // p2 (d2 contrast) -> skipped
    { id: "tc5", agentTurnId: "t5", journeyId: "j2", participantId: "p2", callIndex: 0, toolName: "exit_browsing", status: "committed", input: {}, output: { reasonCategory: "not_interested", readingDepth: "feed_only", interestLevel: "low", trustLevel: "low" }, simulatedTime: 10 },
    // p3 (d1 core_target) -> interested_but_not_convinced
    { id: "tc6", agentTurnId: "t6", journeyId: "j3", participantId: "p3", callIndex: 0, toolName: "open_post", status: "committed", input: {}, output: {}, simulatedTime: 10 },
    { id: "tc7", agentTurnId: "t7", journeyId: "j3", participantId: "p3", callIndex: 1, toolName: "read_post", status: "committed", input: {}, output: { depth: "partial" }, simulatedTime: 20 },
    { id: "tc8", agentTurnId: "t8", journeyId: "j3", participantId: "p3", callIndex: 2, toolName: "view_comments", status: "committed", input: {}, output: {}, simulatedTime: 30 },
    { id: "tc9", agentTurnId: "t9", journeyId: "j3", participantId: "p3", callIndex: 3, toolName: "exit_browsing", status: "committed", input: {}, output: { reasonCategory: "need_more_evidence", readingDepth: "partial", interestLevel: "high", trustLevel: "low" }, simulatedTime: 40 },
    // p4 (d2 contrast) -> skeptical
    { id: "tc10", agentTurnId: "t10", journeyId: "j4", participantId: "p4", callIndex: 0, toolName: "open_post", status: "committed", input: {}, output: {}, simulatedTime: 10 },
    { id: "tc11", agentTurnId: "t11", journeyId: "j4", participantId: "p4", callIndex: 1, toolName: "read_post", status: "committed", input: {}, output: { depth: "skim" }, simulatedTime: 20 },
    { id: "tc12", agentTurnId: "t12", journeyId: "j4", participantId: "p4", callIndex: 2, toolName: "write_comment", status: "committed", input: { content: "这个说法有依据吗？" }, output: { intent: "doubt", commentId: "c1" }, simulatedTime: 30 },
    { id: "tc13", agentTurnId: "t13", journeyId: "j4", participantId: "p4", callIndex: 3, toolName: "exit_browsing", status: "committed", input: {}, output: { reasonCategory: "finished_normally", readingDepth: "skimmed", interestLevel: "medium", trustLevel: "medium" }, simulatedTime: 40 }
  ];

  return {
    runId: "run-1",
    contentVersionId: "cv-1",
    content: { title: "测试帖子", bodyText: "正文内容".repeat(20), imageUrlsJson: [], coverImageUrl: null },
    postState: { exposureCount: 4, openCount: 3, likeCount: 1, favoriteCount: 0, commentCount: 1, shareCount: 0, exitCount: 4 },
    journeys: [
      { id: "j1", status: "completed", exitOutcome: "normal", exitReason: "finished_normally", participantId: "p1", thoughtSummary: "p1 旅程摘要", finalSummary: "p1 最终摘要" },
      { id: "j2", status: "completed", exitOutcome: "skipped", exitReason: "not_interested", participantId: "p2", thoughtSummary: "p2 旅程摘要", finalSummary: "p2 最终摘要" },
      { id: "j3", status: "completed", exitOutcome: "normal", exitReason: "need_more_evidence", participantId: "p3", thoughtSummary: "p3 旅程摘要", finalSummary: "p3 最终摘要" },
      { id: "j4", status: "completed", exitOutcome: "normal", exitReason: "finished_normally", participantId: "p4", thoughtSummary: "p4 旅程摘要", finalSummary: "p4 最终摘要" }
    ],
    participants: [
      { id: "p1", displayNameSnapshot: "小芳", profileSnapshotJson: { demographicsJson: { gender: "female", ageRange: "25-30", lifeStage: "职场白领", role: "白领" } }, samplingDirectiveId: "d1" },
      { id: "p2", displayNameSnapshot: "大伟", profileSnapshotJson: { demographicsJson: { gender: "male", ageRange: "30-35", lifeStage: "宝爸", role: "工程师" } }, samplingDirectiveId: "d2" },
      { id: "p3", displayNameSnapshot: "小丽", profileSnapshotJson: { demographicsJson: { gender: "female", ageRange: "25-30", lifeStage: "职场白领", role: "白领" } }, samplingDirectiveId: "d1" },
      { id: "p4", displayNameSnapshot: "老王", profileSnapshotJson: { demographicsJson: { gender: "male", ageRange: "30-35", lifeStage: "宝爸", role: "工程师" } }, samplingDirectiveId: "d2" }
    ],
    directives: [
      { id: "d1", name: "核心目标人群", description: "核心", groupRole: "core_target", samplingReason: "核心" },
      { id: "d2", name: "对照组", description: "对比", groupRole: "contrast", samplingReason: "对比" }
    ],
    comments: [
      { id: "c1", commentText: "这个说法有依据吗？", participantId: "p4", simulatedTime: 30 }
    ],
    logs: [
      // 通过未识别 action 触发 determineThoughtPhase 回退到全局 phase map（buildPhaseMaps）
      { id: "log1", logText: "feed scroll", action: "feed_scroll", thoughtText: "信息流里看到这条先扫一眼标题", participantId: "p1", journeyActionId: "t1", toolCallId: null, simulatedTime: 5 },
      { id: "log2", logText: "post read", action: "post_read_more", thoughtText: "进入正文了仔细读读看", participantId: "p1", journeyActionId: "t2", toolCallId: null, simulatedTime: 15 }
    ],
    toolCalls,
    turns,
    audienceCount: 4,
    completedCount: 4,
    failedCount: 0,
    skippedCount: 0,
    wasEndedEarly: false
  };
}

describe("buildEvidencePack with non-empty fixtures", () => {
  // 收集 pack 中所有 EvidenceRef，用于完整性校验
  function collectAllRefs(pack: EvidencePack): Array<{ id: string }> {
    const refs: Array<{ id: string }> = [];
    for (const seg of [pack.segments.persuaded, pack.segments.interestedButNotConvinced, pack.segments.skipped, pack.segments.skeptical]) {
      refs.push(...seg.evidenceRefs);
    }
    for (const b of pack.blockers) refs.push(...b.evidenceRefs);
    for (const g of pack.audienceGroups.groups) {
      refs.push(...g.evidenceRefs);
      refs.push(...g.representativeThoughts);
      refs.push(...g.representativeComments);
      refs.push(...g.representativeJourneys);
    }
    refs.push(...pack.audienceGroups.evidenceRefs);
    for (const s of pack.journeySamples) refs.push(...s.evidenceRefs);
    for (const t of pack.thoughtAnalysis.themes) refs.push(...t.examples);
    return refs;
  }

  it("classifies participants into 4 segments with correct sizes", () => {
    const pack = buildEvidencePack(makeNonEmptyInput());
    expect(pack.segments.persuaded.size).toBe(1);
    expect(pack.segments.persuaded.participantIds).toContain("p1");
    expect(pack.segments.interestedButNotConvinced.size).toBe(1);
    expect(pack.segments.interestedButNotConvinced.participantIds).toContain("p3");
    expect(pack.segments.skipped.size).toBe(1);
    expect(pack.segments.skipped.participantIds).toContain("p2");
    expect(pack.segments.skeptical.size).toBe(1);
    expect(pack.segments.skeptical.participantIds).toContain("p4");
  });

  it("detects expected blockers with correct affected counts", () => {
    const pack = buildEvidencePack(makeNonEmptyInput());
    const byType = new Map(pack.blockers.map((b) => [b.blockerType, b]));
    expect(byType.has("feed_attraction")).toBe(true);
    expect(byType.get("feed_attraction")!.affectedCount).toBe(1);
    expect(byType.has("opening_retention")).toBe(true);
    expect(byType.get("opening_retention")!.affectedCount).toBe(1);
    expect(byType.has("trust_evidence")).toBe(true);
    expect(byType.get("trust_evidence")!.affectedCount).toBe(1);
    expect(byType.has("comment_risk")).toBe(true);
    expect(byType.get("comment_risk")!.affectedCount).toBe(1);
    // action_motivation 不应触发：p1 点赞、p4 评论，均有正向行为
    expect(byType.has("action_motivation")).toBe(false);
    // target_mismatch 不应触发：核心人群 d1 点开率 2/2 = 1.0 >= 0.5
    expect(byType.has("target_mismatch")).toBe(false);
    // evidence_quality 不应触发：audienceCount=4, completedCount=4, failedCount=0 -> quality high
    expect(byType.has("evidence_quality")).toBe(false);
  });

  it("assigns feed/post phase to thoughts based on global open_post boundary", () => {
    const pack = buildEvidencePack(makeNonEmptyInput());
    // log1.journeyActionId=t1（首个 committed open_post 所在 turn，仍属 feed 阶段）
    // log2.journeyActionId=t2（open_post 之后的 turn，属 post 阶段）
    // action 为未识别工具名，determineThoughtPhase 回退到 buildPhaseMaps 的全局 phase
    const log1Thought = pack.thoughtAnalysis.representativeThoughts.find((t) => t.evidenceId === "thought:log1");
    const log2Thought = pack.thoughtAnalysis.representativeThoughts.find((t) => t.evidenceId === "thought:log2");
    expect(log1Thought).toBeDefined();
    expect(log2Thought).toBeDefined();
    expect(log1Thought!.phase).toBe("feed");
    expect(log2Thought!.phase).toBe("post");
    // 覆盖 4 种 ThoughtPhase
    const phases = new Set(pack.thoughtAnalysis.representativeThoughts.map((t) => t.phase));
    expect(phases.has("feed")).toBe(true);
    expect(phases.has("post")).toBe(true);
    expect(phases.has("comments")).toBe(true);
    expect(phases.has("exit")).toBe(true);
  });

  it("ensures every evidenceRef id resolves to an evidenceIndex item", () => {
    const pack = buildEvidencePack(makeNonEmptyInput());
    const refs = collectAllRefs(pack);
    expect(refs.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const r of refs) {
      if (!(r.id in pack.evidenceIndex)) missing.push(r.id);
    }
    expect(missing).toEqual([]);
  });

  it("aggregates audience groups by directive with correct role and totals", () => {
    const pack = buildEvidencePack(makeNonEmptyInput());
    expect(pack.audienceGroups.groups).toHaveLength(2);
    const d1 = pack.audienceGroups.groups.find((g) => g.directiveId === "d1");
    const d2 = pack.audienceGroups.groups.find((g) => g.directiveId === "d2");
    expect(d1).toBeDefined();
    expect(d2).toBeDefined();
    expect(d1!.role).toBe("core_target");
    expect(d1!.total).toBe(2);
    expect(d1!.opened).toBe(2);
    expect(d1!.readSkim).toBe(0);
    expect(d1!.readPartial).toBe(1);
    expect(d1!.readFull).toBe(1);
    expect(d1!.viewedComments).toBe(1);
    expect(d1!.liked).toBe(1);
    expect(d1!.favorited).toBe(0);
    expect(d1!.commented).toBe(0);
    expect(d1!.shared).toBe(0);
    expect(d1!.riskExitCount).toBe(1);
    expect(d2!.role).toBe("contrast");
    expect(d2!.total).toBe(2);
    expect(d2!.opened).toBe(1);
    expect(d2!.readSkim).toBe(1);
    expect(d2!.readPartial).toBe(0);
    expect(d2!.readFull).toBe(0);
    expect(d2!.viewedComments).toBe(0);
    expect(d2!.liked).toBe(0);
    expect(d2!.favorited).toBe(0);
    expect(d2!.commented).toBe(1);
    expect(d2!.shared).toBe(0);
    expect(d2!.riskExitCount).toBe(0);
  });

  it("computes reading depth stats from participant facts", () => {
    const pack = buildEvidencePack(makeNonEmptyInput());
    // p1=full, p3=partial, p4=skim, p2=none（未点开，无 read_post）
    expect(pack.funnel.readSkimActors).toBe(1);
    expect(pack.funnel.readPartialActors).toBe(1);
    expect(pack.funnel.readFullActors).toBe(1);
    expect(pack.funnel.viewedCommentsActors).toBe(1);
  });

  // ── 关键口径测试 ──

  it("一人点赞+收藏+评论，positiveActionActors 只算 1", () => {
    const input = makeBaseInput({
      participants: [
        { id: "p1", displayNameSnapshot: "A", profileSnapshotJson: {}, samplingDirectiveId: null }
      ],
      toolCalls: [
        { id: "tc1", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 0, toolName: "open_post", status: "committed", input: {}, output: {}, simulatedTime: null },
        { id: "tc2", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 1, toolName: "like_post", status: "committed", input: { postId: "p" }, output: {}, simulatedTime: null },
        { id: "tc3", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 2, toolName: "favorite_post", status: "committed", input: { postId: "p" }, output: {}, simulatedTime: null },
        { id: "tc4", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 3, toolName: "write_comment", status: "committed", input: { postId: "p", intent: "agree", content: "不错" }, output: { commentId: "c1", intent: "agree" }, simulatedTime: null },
        { id: "tc5", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 4, toolName: "exit_browsing", status: "committed", input: {}, output: { reasonCategory: "finished_normally", readingDepth: "full", interestLevel: "high", trustLevel: "high" }, simulatedTime: null }
      ],
      audienceCount: 1
    });
    const pack = buildEvidencePack(input);
    expect(pack.funnel.likedActors).toBe(1);
    expect(pack.funnel.favoritedActors).toBe(1);
    expect(pack.funnel.commentedActors).toBe(1);
    expect(pack.funnel.positiveActionActors).toBe(1); // 同一人，只算 1
  });

  it("一人三条评论，commentedActors=1，commentEvents=3，commentRateAfterOpen 用 1 人算", () => {
    const input = makeBaseInput({
      participants: [
        { id: "p1", displayNameSnapshot: "A", profileSnapshotJson: {}, samplingDirectiveId: null }
      ],
      toolCalls: [
        { id: "tc1", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 0, toolName: "open_post", status: "committed", input: {}, output: {}, simulatedTime: null },
        { id: "tc2", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 1, toolName: "write_comment", status: "committed", input: { postId: "p", intent: "agree", content: "评论1" }, output: { commentId: "c1", intent: "agree" }, simulatedTime: null },
        { id: "tc3", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 2, toolName: "write_comment", status: "committed", input: { postId: "p", intent: "ask", content: "评论2" }, output: { commentId: "c2", intent: "ask" }, simulatedTime: null },
        { id: "tc4", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 3, toolName: "write_comment", status: "committed", input: { postId: "p", intent: "share_experience", content: "评论3" }, output: { commentId: "c3", intent: "share_experience" }, simulatedTime: null },
        { id: "tc5", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 4, toolName: "exit_browsing", status: "committed", input: {}, output: { reasonCategory: "finished_normally", readingDepth: "full", interestLevel: "high", trustLevel: "high" }, simulatedTime: null }
      ],
      audienceCount: 1
    });
    const pack = buildEvidencePack(input);
    expect(pack.funnel.commentedActors).toBe(1);
    expect(pack.funnel.commentEvents).toBe(3);
    expect(pack.funnel.commentRateAfterOpen).toBeCloseTo(1.0, 5); // 1 人 / 1 人
    expect(pack.commentAnalysis.totalComments).toBe(3);
  });

  it("read skim 后 full，readFullActors=1，readSkimActors=0（取最高深度）", () => {
    const input = makeBaseInput({
      participants: [
        { id: "p1", displayNameSnapshot: "A", profileSnapshotJson: {}, samplingDirectiveId: null }
      ],
      toolCalls: [
        { id: "tc1", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 0, toolName: "open_post", status: "committed", input: {}, output: {}, simulatedTime: null },
        { id: "tc2", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 1, toolName: "read_post", status: "committed", input: { postId: "p", depth: "skim" }, output: { depth: "skim" }, simulatedTime: null },
        { id: "tc3", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 2, toolName: "read_post", status: "committed", input: { postId: "p", depth: "full" }, output: { depth: "full" }, simulatedTime: null },
        { id: "tc4", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 3, toolName: "exit_browsing", status: "committed", input: {}, output: { reasonCategory: "finished_normally", readingDepth: "full", interestLevel: "high", trustLevel: "high" }, simulatedTime: null }
      ],
      audienceCount: 1
    });
    const pack = buildEvidencePack(input);
    expect(pack.funnel.readFullActors).toBe(1);
    expect(pack.funnel.readSkimActors).toBe(0);
    expect(pack.funnel.readActors).toBe(1);
    expect(pack.funnel.readEvents).toBe(2); // 两次 read_post 调用
  });

  it("open_post 重复调用不增加打开人数（actor 去重）", () => {
    const input = makeBaseInput({
      participants: [
        { id: "p1", displayNameSnapshot: "A", profileSnapshotJson: {}, samplingDirectiveId: null }
      ],
      toolCalls: [
        { id: "tc1", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 0, toolName: "open_post", status: "committed", input: {}, output: {}, simulatedTime: null },
        { id: "tc2", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 1, toolName: "open_post", status: "committed", input: {}, output: {}, simulatedTime: null },
        { id: "tc3", agentTurnId: null, journeyId: null, participantId: "p1", callIndex: 2, toolName: "exit_browsing", status: "committed", input: {}, output: { reasonCategory: "finished_normally", readingDepth: "full", interestLevel: "high", trustLevel: "high" }, simulatedTime: null }
      ],
      audienceCount: 1
    });
    const pack = buildEvidencePack(input);
    expect(pack.funnel.openedActors).toBe(1); // 只有 1 人
    expect(pack.funnel.openEvents).toBe(2);   // 但有 2 次 open_post 调用
  });

  it("aggregates exit reason category counts", () => {
    const pack = buildEvidencePack(makeNonEmptyInput());
    expect(pack.exitAnalysis.byReasonCategory.finished_normally).toBe(2);
    expect(pack.exitAnalysis.byReasonCategory.not_interested).toBe(1);
    expect(pack.exitAnalysis.byReasonCategory.need_more_evidence).toBe(1);
    expect(pack.exitAnalysis.byReasonCategory.low_trust).toBe(0);
    expect(pack.exitAnalysis.byReasonCategory.too_ad_like).toBe(0);
    expect(pack.exitAnalysis.riskExitCount).toBe(1);
    expect(pack.exitAnalysis.riskExitRate).toBeCloseTo(0.25, 5);
  });

  it("aggregates comment intent counts", () => {
    const pack = buildEvidencePack(makeNonEmptyInput());
    expect(pack.commentAnalysis.totalComments).toBe(1);
    expect(pack.commentAnalysis.byIntent.doubt).toBe(1);
    expect(pack.commentAnalysis.byIntent.agree).toBe(0);
    expect(pack.commentAnalysis.byIntent.ask).toBe(0);
    const rep = pack.commentAnalysis.representativeComments.find((c) => c.evidenceId === "comment:c1");
    expect(rep).toBeDefined();
    expect(rep!.intent).toBe("doubt");
  });
});

// ── 阶段 3 新增：AudienceGroupStats 5 个 optional 字段推导逻辑测试 ──
// 覆盖规格 §11.2 / §11.4 的 targetAudienceFit / modificationWeight / typicalMotivation
// / mainBarrier / handlingSuggestion 推导规则，避免回归。

describe("buildAudienceGroups 5 new fields (Stage 3)", () => {
  it("derives targetAudienceFit and modificationWeight from role + positive action", () => {
    const pack = buildEvidencePack(makeNonEmptyInput());
    const d1 = pack.audienceGroups.groups.find((g) => g.directiveId === "d1");
    const d2 = pack.audienceGroups.groups.find((g) => g.directiveId === "d2");

    // d1 = core_target，p1 点赞 → hasPositiveAction=true
    expect(d1!.targetAudienceFit).toBe("high");
    expect(d1!.modificationWeight).toBe("high");

    // d2 = contrast，p4 评论 → hasPositiveAction=true，但 fit=low
    // 修改权重仍为 low（contrast 组不驱动主要修改方向）
    expect(d2!.targetAudienceFit).toBe("low");
    expect(d2!.modificationWeight).toBe("low");
  });

  it("typicalMotivation is non-empty when group has thoughts, truncated to 80 chars", () => {
    const pack = buildEvidencePack(makeNonEmptyInput());
    const d1 = pack.audienceGroups.groups.find((g) => g.directiveId === "d1");
    // d1 含 p1/p3 的 thoughts，无匹配动机词时回退到首条 thought
    expect(d1!.typicalMotivation).toBeTruthy();
    expect(d1!.typicalMotivation!.length).toBeLessThanOrEqual(80);
  });

  it("mainBarrier is undefined when main exit reason is finished_normally", () => {
    const pack = buildEvidencePack(makeNonEmptyInput());
    const d1 = pack.audienceGroups.groups.find((g) => g.directiveId === "d1");
    // d1 exitReasons[0] = p1 的 finished_normally → mainBarrier 不写
    expect(d1!.mainBarrier).toBeUndefined();
  });

  it("mainBarrier is `${label}导致离开` for risk exit reasons", () => {
    const pack = buildEvidencePack(makeNonEmptyInput());
    const d2 = pack.audienceGroups.groups.find((g) => g.directiveId === "d2");
    // d2 exitReasons[0] = p2 的 not_interested → mainBarrier = "不感兴趣导致离开"
    expect(d2!.mainBarrier).toBe("不感兴趣导致离开");
  });

  it("handlingSuggestion covers §11.4 four quadrants", () => {
    const pack = buildEvidencePack(makeNonEmptyInput());
    const d1 = pack.audienceGroups.groups.find((g) => g.directiveId === "d1");
    const d2 = pack.audienceGroups.groups.find((g) => g.directiveId === "d2");

    // d1: high fit + hasPositiveAction → 核心机会人群
    expect(d1!.handlingSuggestion).toContain("核心目标人群重点优化");
    expect(d1!.handlingSuggestion).toContain("保留打动他们的部分");

    // d2: low fit + hasPositiveAction → 意外扩展人群（R1 修复后覆盖此象限）
    expect(d2!.handlingSuggestion).toContain("意外扩展信号");
    expect(d2!.handlingSuggestion).toContain("下一轮单独验证");
  });

  it("mainBarrier is undefined for no_more_action exit reason", () => {
    // 单独构造一个 no_more_action 离开的 participant，验证 mainBarrier 不写
    const input = makeNonEmptyInput();
    // 把 p2 的 exit reason 改成 no_more_action
    input.toolCalls = input.toolCalls.map((tc) =>
      tc.id === "tc5"
        ? { ...tc, output: { reasonCategory: "no_more_action", readingDepth: "feed_only", interestLevel: "low", trustLevel: "low" } }
        : tc
    );
    input.journeys = input.journeys.map((j) =>
      j.id === "j2" ? { ...j, exitReason: "no_more_action" } : j
    );
    const pack = buildEvidencePack(input);
    const d2 = pack.audienceGroups.groups.find((g) => g.directiveId === "d2");
    // d2 exitReasons[0] = p2 的 no_more_action → mainBarrier 不写
    expect(d2!.mainBarrier).toBeUndefined();
  });
});