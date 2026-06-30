import type {
  EvidencePack,
  EvidenceBlocker,
  Recommendation,
  VerdictCard,
  FunnelCard,
  MainBlockerCard,
  SegmentCard,
  DiagnosticCard,
  KeepAndChange,
  RevisionAction,
  KeyFinding,
  EvidenceRef,
  SegmentKey,
  BlockerType
} from "@trycue/shared/report";
import { RECOMMENDATION_LABELS, SEGMENT_NAMES, SEGMENT_ACTIONS, BLOCKER_TITLES, ref, fallbackBlockerAction } from "./reportRefs.js";

// ── Other fallback builders (used only by report.ts buildFallbackReportOutput) ──

export function buildFallbackVerdict(pack: EvidencePack, recommendation: Recommendation, mainBlocker: EvidenceBlocker | null, wasEndedEarly: boolean): VerdictCard {
  const f = pack.funnel;
  const openRateText = f.openRate != null ? `${(f.openRate * 100).toFixed(0)}%` : "未知";
  const readRateText = f.readRateAfterOpen != null ? `${(f.readRateAfterOpen * 100).toFixed(0)}%` : "未知";
  const riskText = pack.exitAnalysis.riskExitCount > 0
    ? `${pack.exitAnalysis.riskExitCount} 人风险离开`
    : "未出现明显风险离开";
  const headline = recommendation === "recommend_publish"
    ? `在本次 AI 观众试映中，${pack.meta.completedCount}/${pack.meta.audienceCount} 位模拟观众完成试映，点开率 ${openRateText}，建议发布。`
    : recommendation === "modify_then_publish"
      ? `在本次 AI 观众试映中点开率 ${openRateText}，但存在可改进的阻断点，建议修改后发布。`
      : recommendation === "recommend_retest"
        ? `证据质量不足${wasEndedEarly ? "（试映提前结束）" : ""}，建议重测后再判断。`
        : `在本次 AI 观众试映中点开率 ${openRateText}，模拟观众反应偏弱，不建议当前版本发布。`;
  const oneSentence = `${pack.meta.completedCount}/${pack.meta.audienceCount} 完成，点开后阅读率 ${readRateText}，${riskText}。`;
  const topOpportunity = pack.segments.persuaded.size > 0
    ? `${pack.segments.persuaded.size} 人被打动，可保留打动他们的部分。`
    : "暂未出现明显被打动人群，需要重新设计吸引力。";
  const topRisk = pack.exitAnalysis.riskExitCount > 0
    ? `${pack.exitAnalysis.riskExitCount} 人因信任/广告感/证据不足离开。`
    : pack.audienceGroups.contrastUnexpectedRisk
      ? "对照组出现非预期质疑信号。"
      : "暂未出现明显风险信号。";
  const priorityFix = mainBlocker
    ? `优先处理：${BLOCKER_TITLES[mainBlocker.blockerType]}（影响 ${mainBlocker.affectedCount} 人）。`
    : "暂无明确优先修复点。";
  const evidenceRefs: EvidenceRef[] = [
    ref("metric:openRate", "metric", "点开率"),
    ref("metric:readRateAfterOpen", "metric", "点开后阅读率"),
    ref("metric:riskExitCount", "metric", "风险离开人数")
  ];
  return {
    recommendation,
    recommendationLabel: RECOMMENDATION_LABELS[recommendation],
    confidence: pack.meta.evidenceQuality === "low" ? "low" : pack.meta.evidenceQuality === "high" ? "high" : "medium",
    headline,
    oneSentence,
    topOpportunity,
    topRisk,
    priorityFix,
    evidenceRefs
  };
}

export function buildFallbackFunnel(pack: EvidencePack): FunnelCard {
  const f = pack.funnel;
  const openRateText = f.openRate != null ? `${(f.openRate * 100).toFixed(0)}%` : "未知";
  const readRateText = f.readRateAfterOpen != null ? `${(f.readRateAfterOpen * 100).toFixed(0)}%` : "未知";
  return {
    audienceCount: pack.meta.audienceCount,
    completedCount: pack.meta.completedCount,
    failedCount: pack.meta.failedCount,
    exposedActors: f.exposedActors,
    openedActors: f.openedActors,
    readActors: f.readActors,
    deepReadActors: f.deepReadActors,
    readSkimActors: f.readSkimActors,
    readPartialActors: f.readPartialActors,
    readFullActors: f.readFullActors,
    viewedCommentsActors: f.viewedCommentsActors,
    likedActors: f.likedActors,
    favoritedActors: f.favoritedActors,
    commentedActors: f.commentedActors,
    sharedActors: f.sharedActors,
    exitedActors: f.exitedActors,
    positiveActionActors: f.positiveActionActors,
    openEvents: f.openEvents,
    readEvents: f.readEvents,
    commentEvents: f.commentEvents,
    shareEvents: f.shareEvents,
    exitEvents: f.exitEvents,
    openRate: f.openRate,
    readRateAfterOpen: f.readRateAfterOpen,
    deepReadRateAfterOpen: f.deepReadRateAfterOpen,
    favoriteRateAfterOpen: f.favoriteRateAfterOpen,
    commentRateAfterOpen: f.commentRateAfterOpen,
    shareRateAfterOpen: f.shareRateAfterOpen,
    positiveActionRate: f.positiveActionRate,
    notes: `点开率 ${openRateText}（${f.openedActors}/${f.exposedActors} 人），点开后阅读率 ${readRateText}（${f.readActors}/${f.openedActors} 人）。`
  };
}

function fallbackBlockerDiagnosis(blocker: EvidenceBlocker, pack: EvidencePack): string {
  switch (blocker.blockerType) {
    case "feed_attraction":
      return `${blocker.affectedCount} 人在信息流阶段流失，点开率 ${(pack.funnel.openRate != null ? pack.funnel.openRate * 100 : 0).toFixed(0)}% 偏低，标题或封面未触发足够的点开动机。`;
    case "opening_retention":
      return `${blocker.affectedCount} 人点开后快速扫读或很快无更多动作，正文开头未留住观众。`;
    case "trust_evidence":
      return `${blocker.affectedCount} 人因信任感低、广告感强或证据不足离开，需要补充数据来源、检测报告或非广告说明。`;
    case "action_motivation":
      return `${blocker.affectedCount} 人阅读完整或正常结束但未产生点赞/收藏/评论/分享，正文缺少明确的行动刺激。`;
    case "comment_risk":
      return `${blocker.affectedCount} 人发表质疑或反驳评论，评论区存在风险信号。`;
    case "target_mismatch":
      return `核心目标人群点开和正向互动都偏弱，选题与目标人群匹配度不足。`;
    case "evidence_quality":
      return `证据质量不足（${pack.meta.completedCount}/${pack.meta.audienceCount} 完成），建议重测后再判断。`;
  }
}

export function buildFallbackMainBlocker(pack: EvidencePack, mainBlocker: EvidenceBlocker | null): MainBlockerCard {
  if (!mainBlocker) {
    return {
      blockerType: "evidence_quality",
      title: "证据质量不足",
      severity: "low",
      affectedCount: 0,
      summary: "未检测到明显阻断点。",
      diagnosis: "当前试映未出现明显行为阻断点，但仍建议关注证据质量。",
      evidenceRefs: [ref("metric:audienceCount", "metric", "试映观众数")]
    };
  }
  const diagnosis = fallbackBlockerDiagnosis(mainBlocker, pack);
  return {
    blockerType: mainBlocker.blockerType,
    title: BLOCKER_TITLES[mainBlocker.blockerType],
    severity: mainBlocker.severity,
    affectedCount: mainBlocker.affectedCount,
    summary: mainBlocker.summary,
    diagnosis,
    evidenceRefs: mainBlocker.evidenceRefs
  };
}

export function buildFallbackSegments(pack: EvidencePack): SegmentCard[] {
  const keys: SegmentKey[] = ["persuaded", "interested_but_not_convinced", "skipped", "skeptical"];
  const byKey: Record<SegmentKey, typeof pack.segments.persuaded> = {
    persuaded: pack.segments.persuaded,
    interested_but_not_convinced: pack.segments.interestedButNotConvinced,
    skipped: pack.segments.skipped,
    skeptical: pack.segments.skeptical
  };
  return keys.map((key) => {
    const ev = byKey[key];
    const thoughtRefs = ev.evidenceRefs.filter((r) => r.type === "thought").slice(0, 3);
    const commentRefs = ev.evidenceRefs.filter((r) => r.type === "comment").slice(0, 3);
    return {
      key,
      name: SEGMENT_NAMES[key],
      size: ev.size,
      percentage: ev.percentage,
      summary: ev.summary,
      commonTraits: ev.commonTraits,
      representativeThoughts: thoughtRefs,
      representativeComments: commentRefs,
      suggestedAction: SEGMENT_ACTIONS[key],
      evidenceRefs: ev.evidenceRefs
    };
  });
}

export function buildFallbackKeepAndChange(pack: EvidencePack): KeepAndChange {
  const f = pack.funnel;
  const keep: KeepAndChange["keep"] = [];
  const change: KeepAndChange["change"] = [];

  if (pack.segments.persuaded.size > 0) {
    keep.push({
      item: `打动 ${pack.segments.persuaded.size} 人的标题与开头信号`,
      reason: `${pack.segments.persuaded.size} 人点开并产生正向行为，这部分信号有效。`,
      evidenceRefs: [ref("segment:persuaded", "segment", "被打动的人")]
    });
  } else {
    keep.push({
      item: "当前内容中能产生曝光的部分",
      reason: `${f.exposedActors} 人曝光，基础触达存在。`,
      evidenceRefs: [ref("metric:exposedActors", "metric", "曝光人数")]
    });
  }
  if (f.readFullActors > 0) {
    keep.push({
      item: "能让人完整阅读的正文结构",
      reason: `${f.readFullActors} 人完整阅读正文，留存结构有效。`,
      evidenceRefs: [ref("metric:readRateAfterOpen", "metric", "点开后阅读率")]
    });
  }

  if (pack.exitAnalysis.riskExitCount > 0) {
    change.push({
      item: "信任证据表达",
      reason: `${pack.exitAnalysis.riskExitCount} 人因信任/广告感/证据不足离开。`,
      evidenceRefs: [ref("metric:riskExitCount", "metric", "风险离开人数")]
    });
  }
  if (pack.segments.skipped.size > Math.max(1, pack.meta.audienceCount * 0.3)) {
    change.push({
      item: "信息流首图标题",
      reason: `${pack.segments.skipped.size} 人在信息流直接流失。`,
      evidenceRefs: [ref("segment:skipped", "segment", "直接流失的人"), ref("metric:openRate", "metric", "点开率")]
    });
  }
  if (pack.commentAnalysis.byIntent.doubt + pack.commentAnalysis.byIntent.pushback > 0) {
    change.push({
      item: "评论区风险回应",
      reason: `${pack.commentAnalysis.byIntent.doubt + pack.commentAnalysis.byIntent.pushback} 人发表质疑或反驳评论。`,
      evidenceRefs: pack.commentAnalysis.representativeComments.filter((c) => c.intent === "doubt" || c.intent === "pushback").slice(0, 2).map((c) => ref(c.evidenceId, "comment", c.content.slice(0, 30), c.participantId))
    });
  }
  if (change.length === 0) {
    change.push({
      item: "证据表达的具体性",
      reason: "当前样本未集中出现质疑，但证据表达仍可更具体。",
      evidenceRefs: [ref("metric:riskExitCount", "metric", "风险离开人数")]
    });
  }
  return { keep, change };
}

export function buildFallbackRevisionPlan(pack: EvidencePack, mainBlocker: EvidenceBlocker | null): RevisionAction[] {
  const plan: RevisionAction[] = [];
  const has = (type: BlockerType) => pack.blockers.some((b) => b.blockerType === type);

  if (has("trust_evidence")) {
    const b = pack.blockers.find((x) => x.blockerType === "trust_evidence")!;
    plan.push({
      priority: "P0",
      title: "补充检测数据和材料来源",
      action: "在正文开头补充检测报告链接、数据来源和非广告说明，降低高兴趣低信任人群的 need_more_evidence 离开。",
      reason: `${b.affectedCount} 人因信任/广告感/证据不足离开，是当前最大阻断点之一。`,
      affectedSegment: "interested_but_not_convinced",
      expectedImpact: "降低 need_more_evidence / low_trust / too_ad_like 离开人数。",
      retestQuestion: "补充检测数据后，need_more_evidence 是否下降？",
      evidenceRefs: [ref("blocker:trust_evidence", "blocker", "信任证据不足"), ref("metric:riskExitCount", "metric", "风险离开人数")],
      // Spec §12.4: P0 信任证据缺失 — 高影响、低成本（补一段来源说明即可）
      impactLevel: "high",
      costLevel: "low"
    });
  } else if (has("feed_attraction")) {
    const b = pack.blockers.find((x) => x.blockerType === "feed_attraction")!;
    plan.push({
      priority: "P0",
      title: "重写信息流首图标题",
      action: "重写标题强化与核心目标人群痛点的关联，避免绝对化承诺，提升点开率。",
      reason: `${b.affectedCount} 人在信息流阶段流失，点开率偏低。`,
      affectedSegment: "skipped",
      expectedImpact: "提升核心目标人群点开率。",
      retestQuestion: "修改标题后，目标人群点开率是否提升？",
      evidenceRefs: [ref("blocker:feed_attraction", "blocker", "信息流吸引力不足"), ref("metric:openRate", "metric", "点开率")],
      // P0 标题/封面重写 — 高影响、低成本
      impactLevel: "high",
      costLevel: "low"
    });
  } else if (mainBlocker) {
    plan.push({
      priority: "P0",
      title: `优先处理：${BLOCKER_TITLES[mainBlocker.blockerType]}`,
      action: fallbackBlockerAction(mainBlocker.blockerType),
      reason: mainBlocker.summary,
      affectedSegment: "overall",
      expectedImpact: `降低 ${mainBlocker.blockerType} 的影响人数。`,
      retestQuestion: `修改后 ${mainBlocker.blockerType} 是否下降？`,
      evidenceRefs: mainBlocker.evidenceRefs,
      // P0 兜底 — 高影响、中成本
      impactLevel: "high",
      costLevel: "medium"
    });
  }

  if (has("comment_risk")) {
    plan.push({
      priority: "P1",
      title: "准备置顶评论回应质疑",
      action: "提前准备置顶评论回应型号、价格、适用人群和广告质疑。",
      reason: "出现质疑或反驳评论，评论区风险偏高。",
      affectedSegment: "skeptical",
      expectedImpact: "降低评论区质疑信号。",
      retestQuestion: "增加 FAQ 后，ask/doubt 评论是否减少？",
      evidenceRefs: [ref("blocker:comment_risk", "blocker", "评论风险偏高")],
      // P1 评论风险 — 中影响、低成本
      impactLevel: "medium",
      costLevel: "low"
    });
  }
  if (has("opening_retention")) {
    plan.push({
      priority: "P1",
      title: "优化正文开头 3 行",
      action: "在正文前 3 行加入悬念或关键结论，减少快速扫读后离开。",
      reason: "部分观众点开后快速扫读或很快无更多动作。",
      affectedSegment: "overall",
      expectedImpact: "提升点开后阅读率。",
      retestQuestion: "修改开头后，readRateAfterOpen 是否提升？",
      evidenceRefs: [ref("blocker:opening_retention", "blocker", "点开后开头留存不足"), ref("metric:readRateAfterOpen", "metric", "点开后阅读率")],
      // P1 正文开头 — 中影响、低成本
      impactLevel: "medium",
      costLevel: "low"
    });
  }
  if (has("action_motivation")) {
    plan.push({
      priority: "P2",
      title: "在正文结尾加入行动刺激",
      action: "在正文结尾加入明确的收藏/评论引导，但避免广告感。",
      reason: "部分观众阅读完整但未产生正向行为。",
      affectedSegment: "persuaded",
      expectedImpact: "提升正向行为率。",
      retestQuestion: "增加行动引导后，positiveActionRate 是否提升？",
      evidenceRefs: [ref("blocker:action_motivation", "blocker", "行动刺激不足"), ref("metric:positiveActionRate", "metric", "正向行为率")],
      // P2 行动刺激 — 低影响、低成本
      impactLevel: "low",
      costLevel: "low"
    });
  }
  return plan;
}

export function buildFallbackSummaryMarkdown(pack: EvidencePack, recommendation: Recommendation, mainBlocker: EvidenceBlocker | null): string {
  const f = pack.funnel;
  const openRateText = f.openRate != null ? `${(f.openRate * 100).toFixed(0)}%` : "未知";
  const lines: string[] = [];
  lines.push(`## ${RECOMMENDATION_LABELS[recommendation]}`);
  lines.push("");
  lines.push(`在本次 AI 观众试映中，${pack.meta.completedCount}/${pack.meta.audienceCount} 位模拟观众完成试映，点开率 ${openRateText}。`);
  if (mainBlocker) {
    lines.push(`最大阻断点：${BLOCKER_TITLES[mainBlocker.blockerType]}（影响 ${mainBlocker.affectedCount} 人）。`);
  }
  lines.push(`风险离开 ${pack.exitAnalysis.riskExitCount} 人，正向行为 ${f.positiveActionActors} 人（评论 ${f.commentEvents} 条）。`);
  lines.push("");
  lines.push("> 以下互动为 AI 试映模拟结果，不代表真实平台数据。");
  return lines.join("\n");
}

export function collectTopLevelRefs(parts: {
  verdict: VerdictCard;
  mainBlocker: MainBlockerCard;
  segments: SegmentCard[];
  diagnostics: DiagnosticCard[];
  keepAndChange: KeepAndChange;
  revisionPlan: RevisionAction[];
  keyFindings?: KeyFinding[];
}): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  const push = (list: EvidenceRef[] | undefined) => { if (list) refs.push(...list); };
  push(parts.verdict.evidenceRefs);
  push(parts.mainBlocker.evidenceRefs);
  for (const seg of parts.segments) {
    push(seg.evidenceRefs);
    push(seg.representativeThoughts);
    push(seg.representativeComments);
  }
  for (const diag of parts.diagnostics) push(diag.evidenceRefs);
  for (const k of parts.keepAndChange.keep) push(k.evidenceRefs);
  for (const c of parts.keepAndChange.change) push(c.evidenceRefs);
  for (const rev of parts.revisionPlan) push(rev.evidenceRefs);
  // Stage 4: keyFindings.evidenceRefs 也纳入顶层汇总，与 real-LLM 路径 collectEvidenceRefs 保持一致。
  if (parts.keyFindings) {
    for (const f of parts.keyFindings) push(f.evidenceRefs);
  }
  const seen = new Set<string>();
  return refs.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}
