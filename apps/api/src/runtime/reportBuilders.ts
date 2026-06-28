import type {
  EvidencePack,
  EvidenceBlocker,
  Recommendation,
  VerdictCard,
  FunnelCard,
  MainBlockerCard,
  SegmentCard,
  DiagnosticCard,
  DiagnosticStatus,
  KeepAndChange,
  RevisionAction,
  RetestQuestion,
  EvidenceRef,
  SegmentKey,
  BlockerType,
  KeyFinding,
  RewriteSuggestions,
  RewriteSuggestionItem
} from "@trycue/shared";

// ── Shared constants (used by both report.ts fallback path and reportAgent.ts real-LLM fallback) ──

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  recommend_publish: "建议发布",
  modify_then_publish: "修改后发布",
  not_recommend_current_version: "不建议当前版本发布",
  recommend_retest: "建议重测"
};

export const SEGMENT_NAMES: Record<SegmentKey, string> = {
  persuaded: "被打动的人",
  interested_but_not_convinced: "高兴趣低信任的人",
  skipped: "直接流失的人",
  skeptical: "质疑/反驳的人"
};

const SEGMENT_ACTIONS: Record<SegmentKey, string> = {
  persuaded: "保留当前打动他们的标题与开头，在下一轮继续放大这类信号。",
  interested_but_not_convinced: "在正文开头补充数据来源、检测报告或非广告说明，降低 need_more_evidence 离开。",
  skipped: "重写信息流首图标题，强化与该人群痛点的关联，减少直接划走。",
  skeptical: "提前准备置顶评论回应质疑，正文补充适用边界和个人经验。"
};

export const BLOCKER_TITLES: Record<BlockerType, string> = {
  feed_attraction: "信息流吸引力不足",
  opening_retention: "点开后开头留存不足",
  trust_evidence: "信任证据不足",
  action_motivation: "行动刺激不足",
  comment_risk: "评论风险偏高",
  target_mismatch: "目标人群未命中",
  evidence_quality: "证据质量不足"
};

export const DIAGNOSTIC_TITLES: Record<DiagnosticCard["area"], string> = {
  feed_attraction: "信息流吸引力",
  reading_retention: "正文留存力",
  trust_evidence: "信任证据",
  save_value: "收藏价值",
  comment_risk: "评论风险与机会"
};

// ── Helpers ──

export function ref(id: string, type: EvidenceRef["type"], label: string, participantId?: string): EvidenceRef {
  return participantId ? { id, type, label, participantId } : { id, type, label };
}

export function fallbackBlockerAction(type: BlockerType): string {
  switch (type) {
    case "feed_attraction": return "重写标题与封面，强化与目标人群痛点的关联。";
    case "opening_retention": return "优化正文开头 3 行，加入悬念或关键结论。";
    case "trust_evidence": return "补充检测数据来源、使用边界和非广告说明。";
    case "action_motivation": return "在正文结尾加入行动引导。";
    case "comment_risk": return "提前准备置顶评论回应质疑。";
    case "target_mismatch": return "重新评估选题与目标人群的匹配度。";
    case "evidence_quality": return "扩大样本量重测，确保证据质量。";
  }
}

// ── KeyFindings fallback ──

/**
 * Build up to 3 fixed-structure KeyFindings following the
 * "结论 → 证据 → 影响 → 动作" pattern required by the report optimization spec.
 * Each finding pulls from a different angle: blocker signal, segment signal,
 * and group/fit signal, so the user gets a multi-faceted first screen.
 *
 * Used by:
 * - report.ts `buildFallbackReportOutput` (mock path)
 * - reportAgent.ts `coerceReportOutput` (real LLM path, when LLM output invalid)
 */
export function buildFallbackKeyFindings(pack: EvidencePack, recommendation: Recommendation, mainBlocker: EvidenceBlocker | null): KeyFinding[] {
  const findings: KeyFinding[] = [];

  // Finding 1: 基于 mainBlocker 的核心问题
  if (mainBlocker && mainBlocker.blockerType !== "evidence_quality") {
    const finding: KeyFinding = {
      finding: BLOCKER_TITLES[mainBlocker.blockerType] + `（影响 ${mainBlocker.affectedCount} 人）`,
      evidence: mainBlocker.summary,
      impact: recommendation === "recommend_publish"
        ? "当前问题可控，但如果不处理会在下一轮放大。"
        : "如果不处理，内容可能在这一点上持续流失观众。",
      action: fallbackBlockerAction(mainBlocker.blockerType),
      evidenceRefs: mainBlocker.evidenceRefs.slice(0, 2)
    };
    findings.push(finding);
  }

  // Finding 2: 基于被打动人群的机会信号
  const persuaded = pack.segments.persuaded;
  if (persuaded.size > 0) {
    const finding: KeyFinding = {
      finding: `${persuaded.size} 人被打动并产生正向行为，存在可放大的有效信号。`,
      evidence: persuaded.summary,
      impact: "保留并放大这部分信号是当前最大机会。",
      action: "识别打动他们的标题/开头/正文片段，在下一轮继续放大。",
      evidenceRefs: persuaded.evidenceRefs.slice(0, 2)
    };
    findings.push(finding);
  } else if (pack.segments.skipped.size > 0) {
    // 没有被打动人群时，强调流失风险
    const finding: KeyFinding = {
      finding: `${pack.segments.skipped.size} 人在信息流直接流失，吸引力问题严重。`,
      evidence: pack.segments.skipped.summary,
      impact: "如果不重写标题/封面，下一轮仍会大量流失。",
      action: "重写信息流首图标题，强化与目标人群痛点的关联。",
      evidenceRefs: pack.segments.skipped.evidenceRefs.slice(0, 2)
    };
    findings.push(finding);
  }

  // Finding 3: 基于人群匹配度的命中信号
  const coreGroup = pack.audienceGroups.groups.find((g) => g.role === "core_target");
  if (coreGroup && coreGroup.total > 0) {
    const coreOpenRate = coreGroup.opened / coreGroup.total;
    const finding: KeyFinding = {
      finding: coreOpenRate >= 0.5
        ? `核心目标人群点开率 ${(coreOpenRate * 100).toFixed(0)}%，选题与目标人群匹配。`
        : `核心目标人群点开率 ${(coreOpenRate * 100).toFixed(0)}% 偏低，选题匹配度不足。`,
      evidence: `${coreGroup.directiveName}：${coreGroup.total} 人中点开 ${coreGroup.opened} 人。`,
      impact: coreOpenRate >= 0.5
        ? "保留选题方向，重点优化执行细节。"
        : "需要重新评估选题与核心人群的匹配度。",
      action: coreOpenRate >= 0.5
        ? "保留选题，针对执行细节（开头、证据、行动刺激）做精修。"
        : "重新评估选题是否对准核心人群的真实痛点。",
      evidenceRefs: coreGroup.evidenceRefs.slice(0, 2)
    };
    findings.push(finding);
  }

  // 规格 §5 要求"关键发现固定 3 条"。当 mainBlocker 缺失、persuaded/skipped 都为 0、
  // 或 coreGroup 不存在时，上述三条可能不足 3 条。这里补充基于其他段位和整体证据质量的
  // 通用 finding，保证首屏决策摘要始终有足够支撑。
  if (findings.length < 3) {
    // 补充基于 skeptical / interested_but_not_convinced 段位的 finding
    const skepticalSize = pack.segments.skeptical.size;
    const interestedSize = pack.segments.interestedButNotConvinced.size;
    if (findings.length < 3 && skepticalSize > 0) {
      findings.push({
        finding: `${skepticalSize} 人表达质疑或反驳，评论区存在风险信号。`,
        evidence: pack.segments.skeptical.summary,
        impact: "如果不提前准备置顶评论回应质疑，负面信号会被放大。",
        action: "提前准备置顶评论回应质疑，补充型号/价格/适用人群等关键信息。",
        evidenceRefs: pack.segments.skeptical.evidenceRefs.slice(0, 2)
      });
    }
    if (findings.length < 3 && interestedSize > 0) {
      findings.push({
        finding: `${interestedSize} 人有兴趣但未被打动，存在信任或证据缺口。`,
        evidence: pack.segments.interestedButNotConvinced.summary,
        impact: "这部分人是潜在转化对象，补足证据后可能转化为被打动人群。",
        action: "在正文开头补充数据来源、检测报告或非广告说明，降低信任缺口。",
        evidenceRefs: pack.segments.interestedButNotConvinced.evidenceRefs.slice(0, 2)
      });
    }
    // 最终兜底：基于整体证据质量的 finding，确保至少返回 1 条
    if (findings.length === 0) {
      findings.push({
        finding: `${pack.meta.completedCount}/${pack.meta.audienceCount} 位模拟观众完成试映，证据质量${pack.meta.evidenceQuality === "high" ? "稳定" : pack.meta.evidenceQuality === "medium" ? "中等" : "偏弱"}。`,
        evidence: pack.meta.evidenceQualityReason,
        impact: pack.meta.evidenceQuality === "high"
          ? "当前样本量足以支撑主要结论，可执行修改后发布。"
          : "样本量偏小，结论仅供参考，建议扩大样本重测后再决策。",
        action: pack.meta.evidenceQuality === "high"
          ? "按本报告的修改建议执行后发布。"
          : "扩大样本量重测，确保证据质量后再决策。",
        evidenceRefs: []
      });
    }
  }

  return findings.slice(0, 3);
}

// ── RewriteSuggestions fallback ──

/**
 * Build concrete, copyable rewrite suggestions.
 * The mock path produces conservative but specific suggestions based on
 * the main blocker and content snapshot. The real LLM path produces richer
 * suggestions via the report prompt (Stage 4), but falls back to this when
 * the LLM output is invalid.
 */
export function buildFallbackRewriteSuggestions(pack: EvidencePack, recommendation: Recommendation, mainBlocker: EvidenceBlocker | null): RewriteSuggestions {
  const title = pack.content.title;
  const recommendedTitles: RewriteSuggestionItem[] = [];

  // 基于 mainBlocker 推导推荐标题
  if (mainBlocker) {
    switch (mainBlocker.blockerType) {
      case "feed_attraction":
        recommendedTitles.push({
          text: `${title}：先看这 3 件事再决定`,
          reason: "前置具体收益和数量，让信息流阶段的用户立刻知道能获得什么。"
        });
        break;
      case "opening_retention":
        recommendedTitles.push({
          text: `${title}，关键是前 3 步`,
          reason: "在标题中暗示正文结构，让点开后的用户有继续阅读的预期。"
        });
        break;
      case "trust_evidence":
        recommendedTitles.push({
          text: `${title}（附检测数据和个人经验）`,
          reason: "在标题中暗示有证据支撑，降低点开后因信任不足离开的风险。"
        });
        break;
      default:
        break;
    }
  }
  // 如果没有 mainBlocker 或上述未匹配，给一个通用建议
  if (recommendedTitles.length === 0) {
    recommendedTitles.push({
      text: title.length > 20 ? `${title.slice(0, 18)}…` : title,
      reason: "保留当前标题主体，仅根据后续反馈微调。"
    });
  }

  // 推荐开头：mainBlocker 为 null 时（高质量样本）也给通用建议，
  // 避免首屏改稿模块缺失关键部分（规格 §14/§16 把"推荐正文开头"列为高价值模块）。
  const recommendedOpening: RewriteSuggestionItem = mainBlocker
    ? {
      text: mainBlocker.blockerType === "trust_evidence"
        ? "在写这篇内容前，我查了 3 份检测报告和 5 位真实用户的反馈，下面只说结论。"
        : mainBlocker.blockerType === "opening_retention"
          ? "如果你也遇到过这个问题，下面这 3 个细节最容易被忽略。"
          : "先把结论放在最前面：这件事的关键不在于预算，而在于顺序。",
      reason: "在正文前 3 行加入问题 + 代价 + 结论，让点开后的用户立刻获得继续阅读理由。"
    }
    : {
      text: "保留当前开头结构，仅在首句加入具体收益或风险数字，让点开后的用户立刻获得继续阅读理由。",
      reason: "当前样本未出现明显开头留存问题，但前置具体数字仍能进一步提升承接力。"
    };

  // 推荐评论引导
  const recommendedCommentPrompt: RewriteSuggestionItem = {
    text: "如果你正在做同样的功课，评论区告诉我你最担心踩哪个坑，我会补充对应的避坑细节。",
    reason: "用提问引导用户参与，把评论区从风险区转成互动区。"
  };

  // 推荐标签
  const recommendedTags = recommendation === "recommend_publish"
    ? ["避坑", "清单", "新手必看"]
    : ["避坑", "新手", "实用"];

  return {
    recommendedTitles,
    recommendedOpening,
    recommendedCommentPrompt,
    recommendedTags
  };
}

// ── Diagnostics fallback ──

/**
 * Compute the fallback diagnostic status for a single area based on EvidencePack metrics.
 * Used by:
 * - report.ts `buildFallbackDiagnostics` (full fallback)
 * - reportAgent.ts `buildDiagnostics` (when LLM omits status, to keep mock/real path parity)
 *
 * R2 fix (Stage 4 review): the real-LLM path previously defaulted LLM-omitted status to
 * "medium", while the mock path computed status from pack metrics. The divergence broke
 * mock/real parity for `reason` (which is status-dependent). Sharing this function makes
 * the two paths produce identical diagnostics when the LLM omits status.
 */
export function computeDiagnosticStatus(area: DiagnosticCard["area"], pack: EvidencePack): DiagnosticStatus {
  const f = pack.funnel;
  switch (area) {
    case "feed_attraction":
      return f.openRate != null && f.openRate >= 0.6 ? "strong" : f.openRate != null && f.openRate >= 0.3 ? "medium" : "weak";
    case "reading_retention":
      return f.readRateAfterOpen != null && f.readRateAfterOpen >= 0.6 ? "strong" : f.readRateAfterOpen != null && f.readRateAfterOpen >= 0.3 ? "medium" : "weak";
    case "trust_evidence": {
      const riskExitCount = pack.exitAnalysis.riskExitCount;
      return riskExitCount === 0 ? "strong" : riskExitCount <= 2 ? "medium" : "weak";
    }
    case "save_value":
      return f.favoritedActors >= 3 ? "strong" : f.favoritedActors >= 1 ? "medium" : "weak";
    case "comment_risk": {
      const doubtCount = pack.commentAnalysis.byIntent.doubt + pack.commentAnalysis.byIntent.pushback;
      return doubtCount === 0 && f.commentedActors > 0 ? "strong" : doubtCount <= 1 ? "medium" : "risk";
    }
  }
}

export function buildFallbackDiagnostics(pack: EvidencePack): DiagnosticCard[] {
  const areas: Array<DiagnosticCard["area"]> = ["feed_attraction", "reading_retention", "trust_evidence", "save_value", "comment_risk"];
  return areas.map((area) => {
    const status = computeDiagnosticStatus(area, pack);
    const { finding, reason, suggestedFix, evidenceRefs } = fallbackDiagnosticContent(area, status, pack);
    return {
      area,
      title: DIAGNOSTIC_TITLES[area],
      status,
      finding,
      reason,
      evidenceRefs,
      suggestedFix
    };
  });
}

/**
 * Returns the fallback content for a single diagnostic area.
 * Used by:
 * - report.ts `buildFallbackDiagnostics` (full fallback)
 * - reportAgent.ts `buildDiagnostics` (only `reason` is used when LLM omits it)
 */
export function fallbackDiagnosticContent(area: DiagnosticCard["area"], status: DiagnosticStatus, pack: EvidencePack): { finding: string; reason: string; suggestedFix: string; evidenceRefs: EvidenceRef[] } {
  const f = pack.funnel;
  switch (area) {
    case "feed_attraction": {
      const openRateText = f.openRate != null ? `${(f.openRate * 100).toFixed(0)}%` : "未知";
      return {
        finding: `${f.exposedActors} 人曝光，${f.openedActors} 人点开（点开率 ${openRateText}）。`,
        reason: status === "strong"
          ? "标题与封面的清单感和痛点表达触发了足够的点开动机。"
          : status === "medium"
            ? "标题能吸引一部分人点开，但点开率偏低，说明标题与目标人群痛点的关联还不够强。"
            : "标题或封面未触发足够的点开动机，可能因为缺少具体收益、清单感或与目标人群痛点的直接关联。",
        suggestedFix: status === "strong"
          ? "保留当前标题与封面的清单感和痛点表达。"
          : "重写信息流首图标题，强化与目标人群痛点的关联，避免绝对化承诺。",
        evidenceRefs: [ref("metric:openRate", "metric", "点开率"), ref("metric:exposedActors", "metric", "曝光人数"), ref("metric:openedActors", "metric", "点开人数")]
      };
    }
    case "reading_retention": {
      const readRateText = f.readRateAfterOpen != null ? `${(f.readRateAfterOpen * 100).toFixed(0)}%` : "未知";
      return {
        finding: `${f.openedActors} 人点开，${f.readActors} 人阅读正文（阅读率 ${readRateText}），其中完整阅读 ${f.readFullActors} 人。`,
        reason: status === "strong"
          ? "正文开头能留住人，结构和信息密度合理。"
          : status === "medium"
            ? "正文开头承接不足，部分人快速扫读后离开，可能因为开头缺少悬念或关键结论。"
            : "正文开头未能留住观众，快速浏览偏高说明前 3 行没有给出继续阅读理由。",
        suggestedFix: status === "strong"
          ? "正文开头留存良好，保留当前开头结构。"
          : "在正文前 3 行加入悬念或关键结论，减少快速扫读后离开。",
        evidenceRefs: [ref("metric:readRateAfterOpen", "metric", "点开后阅读率")]
      };
    }
    case "trust_evidence": {
      const riskCount = pack.exitAnalysis.riskExitCount;
      const needEvidence = pack.exitAnalysis.byReasonCategory.need_more_evidence;
      const lowTrust = pack.exitAnalysis.byReasonCategory.low_trust;
      const adLike = pack.exitAnalysis.byReasonCategory.too_ad_like;
      const parts: string[] = [];
      if (lowTrust > 0) parts.push(`${lowTrust} 人因信任感低离开`);
      if (adLike > 0) parts.push(`${adLike} 人因广告感强离开`);
      if (needEvidence > 0) parts.push(`${needEvidence} 人因证据不足离开`);
      return {
        finding: parts.length ? parts.join("，") + "。" : "未出现明显信任风险离开。",
        reason: status === "strong"
          ? "正文中的来源说明、使用边界和非广告信号足以建立信任。"
          : riskCount > 0
            ? "用户因为缺少检测数据来源、使用边界或非广告说明而离开，正文没有快速建立信任。"
            : "暂未出现明显信任风险，但建议提前补充证据表达以应对更大样本。",
        suggestedFix: status === "strong"
          ? "信任证据表达充足，保留当前来源说明。"
          : "在正文开头补充检测数据来源、使用边界和非广告说明。",
        evidenceRefs: [ref("metric:riskExitCount", "metric", "风险离开人数"), ref("metric:riskExitRate", "metric", "风险离开率")]
      };
    }
    case "save_value": {
      return {
        finding: `${f.favoritedActors} 人收藏，${f.sharedActors} 人分享。`,
        reason: status === "strong"
          ? "内容提供了可复查的工具价值，用户愿意保存或转发。"
          : "内容缺少可复查信息或对照表，用户读完没有保存动机。",
        suggestedFix: status === "strong"
          ? "收藏价值明确，保留可复查信息列表。"
          : "把可复查信息做成更清楚的列表或对照表，提升复看价值。",
        evidenceRefs: [ref("metric:favoriteRateAfterOpen", "metric", "点开后收藏率"), ref("metric:shareRateAfterOpen", "metric", "点开后分享率")]
      };
    }
    case "comment_risk": {
      const doubt = pack.commentAnalysis.byIntent.doubt;
      const pushback = pack.commentAnalysis.byIntent.pushback;
      const ask = pack.commentAnalysis.byIntent.ask;
      return {
        finding: `${f.commentedActors} 人评论，共 ${pack.commentAnalysis.totalComments} 条评论，其中质疑 ${doubt}、反驳 ${pushback}、提问 ${ask}。`,
        reason: status === "risk"
          ? "评论中存在较多质疑或反驳信号，可能因为正文缺少适用边界、个人经验或证据支撑，引发用户反驳动机。"
          : status === "strong"
            ? "评论区以认同和分享经验为主，没有明显风险信号。"
            : "评论以提问为主，说明用户有兴趣但缺少关键信息（如型号、价格、适用人群）。",
        suggestedFix: status === "risk"
          ? "提前准备置顶评论回应质疑，补充型号、价格、适用人群。"
          : status === "strong"
            ? "评论区风险低，保留当前互动引导。"
            : "关注提问型评论，提前准备 FAQ 置顶。",
        evidenceRefs: pack.commentAnalysis.representativeComments.slice(0, 3).map((c) => ref(c.evidenceId, "comment", c.content.slice(0, 30), c.participantId))
      };
    }
  }
}

// ── RetestPlan fallback ──

/**
 * Build fallback retest plan with hypothesis (H1-H5) and testVersionLabel (A-D 版).
 * Used by:
 * - report.ts `buildFallbackReportOutput` (mock path)
 * - reportAgent.ts `buildRetestPlan` (real LLM path, when LLM omits hypothesis/testVersionLabel)
 */
export function buildFallbackRetestPlan(pack: EvidencePack, mainBlocker: EvidenceBlocker | null): RetestQuestion[] {
  const plan: RetestQuestion[] = [];
  if (pack.blockers.some((b) => b.blockerType === "trust_evidence")) {
    plan.push({
      question: "补充检测数据来源后，need_more_evidence / low_trust 离开是否下降？",
      hypothesis: "H1: 如果在正文开头前置检测数据来源和使用边界，need_more_evidence / low_trust 离开人数会下降。",
      testVersionLabel: "A 版：前置证据来源",
      relatedAction: "补充检测数据和材料来源",
      metricToWatch: "exitAnalysis.byReasonCategory.need_more_evidence",
      expectedDirection: "下降"
    });
  }
  if (pack.blockers.some((b) => b.blockerType === "feed_attraction")) {
    plan.push({
      question: "修改标题后，核心目标人群点开率是否提升？",
      hypothesis: "H2: 如果标题前置具体收益或风险数字，核心目标人群点开率会提升。",
      testVersionLabel: "B 版：标题前置收益",
      relatedAction: "重写信息流首图标题",
      metricToWatch: "funnel.openRate",
      expectedDirection: "上升"
    });
  }
  if (pack.commentAnalysis.byIntent.doubt + pack.commentAnalysis.byIntent.pushback > 0) {
    plan.push({
      question: "增加 FAQ 置顶后，ask/doubt 评论是否减少？",
      hypothesis: "H3: 如果在评论区置顶 FAQ 回应型号/价格/适用人群，ask/doubt 评论数量会下降。",
      testVersionLabel: "C 版：置顶 FAQ",
      relatedAction: "准备置顶评论回应质疑",
      metricToWatch: "commentAnalysis.byIntent.doubt",
      expectedDirection: "下降"
    });
  }
  if (mainBlocker) {
    plan.push({
      question: `修改后 ${mainBlocker.blockerType} 是否下降？`,
      hypothesis: `H4: 优先处理 ${BLOCKER_TITLES[mainBlocker.blockerType]} 后，受影响人数会下降。`,
      testVersionLabel: `D 版：处理 ${BLOCKER_TITLES[mainBlocker.blockerType]}`,
      relatedAction: `优先处理：${BLOCKER_TITLES[mainBlocker.blockerType]}`,
      metricToWatch: `blockers.${mainBlocker.blockerType}.affectedCount`,
      expectedDirection: "下降"
    });
  }
  if (plan.length === 0) {
    plan.push({
      question: "下一轮试映中，正向行为率是否保持或提升？",
      hypothesis: "H5: 保留当前内容结构，正向行为率会保持或提升。",
      testVersionLabel: "A 版：保留当前结构",
      relatedAction: "保留当前内容结构",
      metricToWatch: "funnel.positiveActionRate",
      expectedDirection: "上升或持平"
    });
  }
  return plan.slice(0, 4);
}

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
