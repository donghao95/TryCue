import {
  type EvidencePack,
  type Recommendation,
  type EvidenceBlocker,
  type ReportOutput,
  type VerdictCard,
  type FunnelCard,
  type MainBlockerCard,
  type SegmentCard,
  type DiagnosticCard,
  type KeepAndChange,
  type RevisionAction,
  type RetestQuestion,
  type EvidenceRef,
  type SegmentKey,
  type SegmentEvidence,
  type KeyFinding,
  type RewriteSuggestions,
  type RewriteSuggestionItem
} from "@trycue/shared/report";
import {
  RECOMMENDATION_LABELS,
  SEGMENT_NAMES,
  BLOCKER_TITLES,
  DIAGNOSTIC_TITLES
} from "../runtime/reportRefs.js";
import {
  buildFallbackKeyFindings,
  buildFallbackRewriteSuggestions,
  buildFallbackRetestPlan,
  fallbackDiagnosticContent,
  computeDiagnosticStatus
} from "../runtime/reportFallbackShared.js";

// ── Output parsing & coercion ──

export function parseJsonLoose(raw: string): Record<string, unknown> {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const text = jsonMatch ? jsonMatch[0] : raw;
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Coerce the LLM's raw JSON into a complete ReportOutput, backfilling deterministic
 * fields from the EvidencePack and clamping recommendation so it never upgrades past
 * the candidate. This is defensive: even if the LLM drops a field, we still produce
 * a structurally-complete object that Zod can validate.
 *
 * Exported so reportAgent.test.ts can unit-test the coercion logic in isolation
 * (no LLM call required).
 *
 * R1 fix (Stage 4 review): when the LLM produces no usable keyFindings /
 * rewriteSuggestions, we now fall back to the mock-path builders in
 * reportBuilders.ts. This guarantees the real-LLM path never silently omits
 * these high-value first-screen modules — parity with the mock path.
 */
export function coerceReportOutput(
  parsed: Record<string, unknown>,
  pack: EvidencePack,
  candidate: Recommendation,
  mainBlocker: EvidenceBlocker | null
): ReportOutput {
  const funnel = buildFunnelCardFromPack(pack, parsed.funnel);
  const mainBlockerCard = buildMainBlockerCardFromPack(pack, mainBlocker, parsed.mainBlocker);
  const audienceGroupAnalysis = pack.audienceGroups;
  const segments = buildSegmentCardsFromPack(pack, parsed.segments);
  const verdict = buildVerdictCard(parsed.verdict, candidate, pack);
  const diagnostics = buildDiagnostics(parsed.diagnostics, pack);
  const keepAndChange = buildKeepAndChange(parsed.keepAndChange);
  const revisionPlan = buildRevisionPlan(parsed.revisionPlan);
  const retestPlan = buildRetestPlan(parsed.retestPlan, pack, mainBlocker);
  // R1 fix: LLM 产出无效时复用 mock fallback builder，保证 keyFindings / rewriteSuggestions
  // 始终有值（与 mock 路径产出一致），避免首屏决策摘要和改稿建议缺失。
  // RECOMMENDED fix: spec §5 要求 keyFindings "固定 3 条"，LLM 有效项不足 3 条时用 fallback 补齐。
  const llmKeyFindings = buildKeyFindings(parsed.keyFindings);
  const fallbackKeyFindings = buildFallbackKeyFindings(pack, candidate, mainBlocker);
  let keyFindings: KeyFinding[];
  if (!llmKeyFindings || llmKeyFindings.length === 0) {
    keyFindings = fallbackKeyFindings;
  } else if (llmKeyFindings.length >= 3) {
    keyFindings = llmKeyFindings.slice(0, 3);
  } else {
    // LLM 有效项不足 3 条，用 fallback 补齐剩余位置（按 finding 文本去重避免重复）
    const seenFindings = new Set(llmKeyFindings.map((f) => f.finding));
    const backfill = fallbackKeyFindings.filter((f) => !seenFindings.has(f.finding));
    keyFindings = [...llmKeyFindings, ...backfill].slice(0, 3);
  }
  const rewriteSuggestions = buildRewriteSuggestions(parsed.rewriteSuggestions) ?? buildFallbackRewriteSuggestions(pack, candidate, mainBlocker);
  const evidenceRefs = collectEvidenceRefs({
    verdict,
    mainBlocker: mainBlockerCard,
    segments,
    diagnostics,
    keepAndChange,
    revisionPlan,
    retestPlan,
    keyFindings
  });
  const summaryMarkdown = typeof parsed.summaryMarkdown === "string" ? parsed.summaryMarkdown : undefined;

  return {
    verdict,
    funnel,
    mainBlocker: mainBlockerCard,
    audienceGroupAnalysis,
    segments,
    diagnostics,
    keepAndChange,
    revisionPlan,
    retestPlan,
    evidenceRefs,
    keyFindings,
    rewriteSuggestions,
    ...(summaryMarkdown !== undefined ? { summaryMarkdown } : {})
  };
}

function buildVerdictCard(raw: unknown, candidate: Recommendation, pack: EvidencePack): VerdictCard {
  const obj = objectRecord(raw);
  const recommendation = clampRecommendation(obj.recommendation, candidate, pack);
  const evidenceRefs = readEvidenceRefs(obj.evidenceRefs);
  return {
    recommendation,
    recommendationLabel: RECOMMENDATION_LABELS[recommendation],
    confidence: readEnum(obj.confidence, ["low", "medium", "high"], defaultConfidence(pack)),
    headline: typeof obj.headline === "string" ? obj.headline : "",
    oneSentence: typeof obj.oneSentence === "string" ? obj.oneSentence : "",
    topOpportunity: typeof obj.topOpportunity === "string" ? obj.topOpportunity : "",
    topRisk: typeof obj.topRisk === "string" ? obj.topRisk : "",
    priorityFix: typeof obj.priorityFix === "string" ? obj.priorityFix : "",
    evidenceRefs
  };
}

function buildFunnelCardFromPack(pack: EvidencePack, raw: unknown): FunnelCard {
  const obj = objectRecord(raw);
  const f = pack.funnel;
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
    notes: typeof obj.notes === "string" ? obj.notes : ""
  };
}

function buildMainBlockerCardFromPack(pack: EvidencePack, candidate: EvidenceBlocker | null, raw: unknown): MainBlockerCard {
  const obj = objectRecord(raw);
  // Prefer the LLM-chosen blockerType if it's valid and exists in pack.blockers; otherwise use candidate.
  const allowedBlockerTypes = [
    "feed_attraction", "opening_retention", "trust_evidence",
    "action_motivation", "comment_risk", "target_mismatch", "evidence_quality"
  ] as const;
  const llmBlockerType = typeof obj.blockerType === "string" && (allowedBlockerTypes as readonly string[]).includes(obj.blockerType)
    ? (obj.blockerType as EvidenceBlocker["blockerType"])
    : null;
  const chosen = llmBlockerType
    ? pack.blockers.find((b) => b.blockerType === llmBlockerType) ?? candidate
    : candidate;
  if (!chosen) {
    // No blocker at all — emit a placeholder evidence_quality blocker.
    return {
      blockerType: "evidence_quality",
      title: "证据质量不足",
      severity: "low",
      affectedCount: 0,
      summary: "未检测到明显阻断点。",
      diagnosis: typeof obj.diagnosis === "string" ? obj.diagnosis : "",
      evidenceRefs: readEvidenceRefs(obj.evidenceRefs)
    };
  }
  return {
    blockerType: chosen.blockerType,
    title: BLOCKER_TITLES[chosen.blockerType],
    severity: chosen.severity,
    affectedCount: chosen.affectedCount,
    summary: chosen.summary,
    diagnosis: typeof obj.diagnosis === "string" ? obj.diagnosis : "",
    evidenceRefs: readEvidenceRefs(obj.evidenceRefs)
  };
}

function buildSegmentCardsFromPack(pack: EvidencePack, raw: unknown): SegmentCard[] {
  const arr = Array.isArray(raw) ? raw : [];
  const byKey: Record<SegmentKey, SegmentEvidence | undefined> = {
    persuaded: pack.segments.persuaded,
    interested_but_not_convinced: pack.segments.interestedButNotConvinced,
    skipped: pack.segments.skipped,
    skeptical: pack.segments.skeptical
  };
  const keys: SegmentKey[] = ["persuaded", "interested_but_not_convinced", "skipped", "skeptical"];
  return keys.map((key) => {
    const evidence = byKey[key]!;
    const llmCard = objectRecord(arr.find((item) => objectRecord(item).key === key));
    return {
      key,
      name: SEGMENT_NAMES[key],
      size: evidence.size,
      percentage: evidence.percentage,
      summary: typeof llmCard.summary === "string" && llmCard.summary ? llmCard.summary : evidence.summary,
      commonTraits: evidence.commonTraits,
      representativeThoughts: readEvidenceRefs(llmCard.representativeThoughts),
      representativeComments: readEvidenceRefs(llmCard.representativeComments),
      suggestedAction: typeof llmCard.suggestedAction === "string" ? llmCard.suggestedAction : "",
      evidenceRefs: readEvidenceRefs(llmCard.evidenceRefs)
    };
  });
}

function buildDiagnostics(raw: unknown, pack: EvidencePack): DiagnosticCard[] {
  const arr = Array.isArray(raw) ? raw : [];
  const areas: DiagnosticCard["area"][] = ["feed_attraction", "reading_retention", "trust_evidence", "save_value", "comment_risk"];
  return areas.map((area) => {
    const llmCard = objectRecord(arr.find((item) => objectRecord(item).area === area));
    // R2 fix: 规格 §14 要求每个诊断项统一"判断→证据→原因→动作"四要素。
    // reason 是"为什么会这样"的机制解释，不能因为 LLM 没给就省略。
    // 当 LLM 未给出 reason 时，从 fallbackDiagnosticContent 取对应 area/status 的 reason。
    //
    // 当 LLM 未给出有效 status 时，从 computeDiagnosticStatus 取（而非硬编码 "medium"）。
    // 这样保证 real-LLM 路径与 mock 路径在 LLM 缺失 status 时产出一致的 status 和 reason，
    // 符合 R1 fix 的 mock/real 路径产出一致性原则。
    const fallbackStatus = computeDiagnosticStatus(area, pack);
    const status = readEnum(llmCard.status, ["strong", "medium", "weak", "risk"], fallbackStatus);
    const fallbackReason = fallbackDiagnosticContent(area, status, pack).reason;
    const card: DiagnosticCard = {
      area,
      title: DIAGNOSTIC_TITLES[area],
      status,
      finding: typeof llmCard.finding === "string" ? llmCard.finding : "",
      evidenceRefs: readEvidenceRefs(llmCard.evidenceRefs),
      suggestedFix: typeof llmCard.suggestedFix === "string" ? llmCard.suggestedFix : "",
      reason: typeof llmCard.reason === "string" && llmCard.reason.length > 0 ? llmCard.reason : fallbackReason
    };
    return card;
  });
}

function buildKeepAndChange(raw: unknown): KeepAndChange {
  const obj = objectRecord(raw);
  const keepRaw = Array.isArray(obj.keep) ? obj.keep : [];
  const changeRaw = Array.isArray(obj.change) ? obj.change : [];
  const mapItems = (arr: unknown[]) => arr.map((item) => {
    const o = objectRecord(item);
    return {
      item: typeof o.item === "string" ? o.item : "",
      reason: typeof o.reason === "string" ? o.reason : "",
      evidenceRefs: readEvidenceRefs(o.evidenceRefs)
    };
  });
  return {
    keep: mapItems(keepRaw),
    change: mapItems(changeRaw)
  };
}

function buildRevisionPlan(raw: unknown): RevisionAction[] {
  const arr = Array.isArray(raw) ? raw : [];
  const items = arr.map((item) => {
    const o = objectRecord(item);
    const priority = readEnum(o.priority, ["P0", "P1", "P2"], "P2");
    return {
      priority,
      title: typeof o.title === "string" ? o.title : "",
      action: typeof o.action === "string" ? o.action : "",
      reason: typeof o.reason === "string" ? o.reason : "",
      affectedSegment: readAffectedSegment(o.affectedSegment),
      expectedImpact: typeof o.expectedImpact === "string" ? o.expectedImpact : "",
      retestQuestion: typeof o.retestQuestion === "string" ? o.retestQuestion : "",
      evidenceRefs: readEvidenceRefs(o.evidenceRefs),
      // Spec §12.4: impactLevel / costLevel for priority matrix.
      impactLevel: readEnumOptional(o.impactLevel, ["high", "medium", "low"]) ?? (priority === "P0" ? "high" : priority === "P1" ? "medium" : "low"),
      costLevel: readEnumOptional(o.costLevel, ["high", "medium", "low"]) ?? "medium"
    } satisfies RevisionAction;
  });
  // Enforce: max 1 P0, max 2 P1, max 1 P2.
  const p0 = items.filter((i) => i.priority === "P0").slice(0, 1);
  const p1 = items.filter((i) => i.priority === "P1").slice(0, 2);
  const p2 = items.filter((i) => i.priority === "P2").slice(0, 1);
  return [...p0, ...p1, ...p2];
}

function buildRetestPlan(raw: unknown, pack: EvidencePack, mainBlocker: EvidenceBlocker | null): RetestQuestion[] {
  const arr = Array.isArray(raw) ? raw : [];
  // R3 fix: 规格 §17 要求每条 retestPlan 都带 hypothesis（H1/H2/H3 形式）
  // 和 testVersionLabel（A/B/C 版标签）。LLM 未给出时不能省略，从 fallback 取。
  // fallback 按 relatedAction 匹配；匹配不到时按 index 取；最终兜底用首条 fallback。
  const fallbackPlan = buildFallbackRetestPlan(pack, mainBlocker);
  const findFallback = (relatedAction: string, index: number): RetestQuestion | undefined => {
    return fallbackPlan.find((q) => q.relatedAction === relatedAction)
      ?? fallbackPlan[index]
      ?? fallbackPlan[0];
  };
  const items = arr.map((item, index) => {
    const o = objectRecord(item);
    const question = typeof o.question === "string" ? o.question : "";
    if (!question) return null;
    const relatedAction = typeof o.relatedAction === "string" ? o.relatedAction : "";
    const fallback = findFallback(relatedAction, index);
    const q: RetestQuestion = {
      question,
      relatedAction,
      metricToWatch: typeof o.metricToWatch === "string" ? o.metricToWatch : (fallback?.metricToWatch ?? ""),
      expectedDirection: typeof o.expectedDirection === "string" ? o.expectedDirection : (fallback?.expectedDirection ?? "")
    };
    // hypothesis：LLM 优先，缺失时从 fallback 取
    const llmHypothesis = typeof o.hypothesis === "string" && o.hypothesis.length > 0 ? o.hypothesis : null;
    q.hypothesis = llmHypothesis ?? fallback?.hypothesis ?? "";
    // testVersionLabel：LLM 优先，缺失时从 fallback 取
    const llmTestVersionLabel = typeof o.testVersionLabel === "string" && o.testVersionLabel.length > 0 ? o.testVersionLabel : null;
    q.testVersionLabel = llmTestVersionLabel ?? fallback?.testVersionLabel ?? "";
    return q;
  }).filter((q): q is RetestQuestion => q !== null);
  // 如果 LLM 完全没有产出有效 retestPlan，直接用 fallback
  const result = items.length > 0 ? items : fallbackPlan;
  return result.slice(0, 4);
}

function collectEvidenceRefs(parts: {
  verdict: VerdictCard;
  mainBlocker: MainBlockerCard;
  segments: SegmentCard[];
  diagnostics: DiagnosticCard[];
  keepAndChange: KeepAndChange;
  revisionPlan: RevisionAction[];
  retestPlan: RetestQuestion[];
  keyFindings?: KeyFinding[];
}): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  const push = (list: EvidenceRef[] | undefined) => {
    if (!list) return;
    for (const r of list) refs.push(r);
  };
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
  // 阶段 4：keyFindings.evidenceRefs 也纳入顶层汇总
  if (parts.keyFindings) {
    for (const f of parts.keyFindings) push(f.evidenceRefs);
  }
  // Deduplicate by id (keep first occurrence).
  const seen = new Set<string>();
  return refs.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

/**
 * Coerce LLM-produced keyFindings into a valid KeyFinding[].
 * - Filters out items missing required string fields (finding/evidence/impact/action).
 * - Clamps to at most 3 items per spec §5 "固定 3 条".
 * - Returns undefined if the LLM produced no usable items, so coerceReportOutput
 *   can omit the field entirely (schema allows undefined).
 */
function buildKeyFindings(raw: unknown): KeyFinding[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items: KeyFinding[] = [];
  for (const item of raw) {
    const o = objectRecord(item);
    const finding = typeof o.finding === "string" ? o.finding : "";
    const evidence = typeof o.evidence === "string" ? o.evidence : "";
    const impact = typeof o.impact === "string" ? o.impact : "";
    const action = typeof o.action === "string" ? o.action : "";
    // 必填字段任一为空则丢弃，避免污染 keyFindings
    if (!finding || !evidence || !impact || !action) continue;
    items.push({
      finding,
      evidence,
      impact,
      action,
      evidenceRefs: readEvidenceRefs(o.evidenceRefs)
    });
  }
  if (items.length === 0) return undefined;
  return items.slice(0, 3);
}

/**
 * Coerce LLM-produced rewriteSuggestions into a valid RewriteSuggestions object.
 * - Each sub-item (title/opening/cover/body/commentPrompt) requires non-empty text+reason.
 * - recommendedTags is a string array; non-string entries are dropped.
 * - Returns undefined if the LLM produced nothing usable.
 */
function buildRewriteSuggestions(raw: unknown): RewriteSuggestions | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;

  const readItem = (v: unknown): RewriteSuggestionItem | undefined => {
    const io = objectRecord(v);
    const text = typeof io.text === "string" ? io.text : "";
    const reason = typeof io.reason === "string" ? io.reason : "";
    if (!text || !reason) return undefined;
    return { text, reason };
  };

  const readItemList = (v: unknown): RewriteSuggestionItem[] => {
    if (!Array.isArray(v)) return [];
    return v.map(readItem).filter((x): x is RewriteSuggestionItem => x !== undefined);
  };

  const recommendedTitles = readItemList(o.recommendedTitles);
  const recommendedTags = Array.isArray(o.recommendedTags)
    ? o.recommendedTags.filter((t): t is string => typeof t === "string" && t.length > 0)
    : [];

  // 至少需要有一项有效内容才返回 rewriteSuggestions，避免空对象污染
  const recommendedCoverText = readItem(o.recommendedCoverText);
  const recommendedOpening = readItem(o.recommendedOpening);
  const recommendedBodyStructure = readItem(o.recommendedBodyStructure);
  const recommendedCommentPrompt = readItem(o.recommendedCommentPrompt);
  const hasAny =
    recommendedTitles.length > 0 ||
    recommendedTags.length > 0 ||
    recommendedCoverText !== undefined ||
    recommendedOpening !== undefined ||
    recommendedBodyStructure !== undefined ||
    recommendedCommentPrompt !== undefined;
  if (!hasAny) return undefined;

  const result: RewriteSuggestions = { recommendedTitles, recommendedTags };
  if (recommendedCoverText) result.recommendedCoverText = recommendedCoverText;
  if (recommendedOpening) result.recommendedOpening = recommendedOpening;
  if (recommendedBodyStructure) result.recommendedBodyStructure = recommendedBodyStructure;
  if (recommendedCommentPrompt) result.recommendedCommentPrompt = recommendedCommentPrompt;
  return result;
}

// ── Helpers ──

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Like readEnum but returns undefined instead of a fallback when value is missing/invalid. */
function readEnumOptional<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function readEvidenceRefs(value: unknown): EvidenceRef[] {
  if (!Array.isArray(value)) return [];
  const allowedTypes: EvidenceRef["type"][] = ["metric", "thought", "comment", "tool_call", "journey", "segment", "blocker", "group"];
  return value
    .map((item) => {
      const o = objectRecord(item);
      const id = typeof o.id === "string" ? o.id : null;
      const type = typeof o.type === "string" && (allowedTypes as string[]).includes(o.type) ? (o.type as EvidenceRef["type"]) : null;
      if (!id || !type) return null;
      const ref: EvidenceRef = { id, type, label: typeof o.label === "string" ? o.label : id };
      if (typeof o.participantId === "string") ref.participantId = o.participantId;
      return ref;
    })
    .filter((r): r is EvidenceRef => r !== null);
}

function readAffectedSegment(value: unknown): RevisionAction["affectedSegment"] {
  if (typeof value !== "string") return "overall";
  if (value === "overall") return "overall";
  const allowed: SegmentKey[] = ["persuaded", "interested_but_not_convinced", "skipped", "skeptical"];
  return (allowed as string[]).includes(value) ? (value as SegmentKey) : "overall";
}

function clampRecommendation(value: unknown, candidate: Recommendation, pack: EvidencePack): Recommendation {
  // evidenceQuality low → must retest
  if (pack.meta.evidenceQuality === "low") return "recommend_retest";
  const order: Recommendation[] = ["recommend_publish", "modify_then_publish", "not_recommend_current_version", "recommend_retest"];
  const candidateRank = order.indexOf(candidate);
  const llmRank = typeof value === "string" && (order as string[]).includes(value) ? order.indexOf(value as Recommendation) : order.length;
  // LLM may not upgrade (lower rank number) past candidate.
  return llmRank >= candidateRank ? (order[llmRank] ?? candidate) : candidate;
}

function defaultConfidence(pack: EvidencePack): "low" | "medium" | "high" {
  return pack.meta.evidenceQuality === "low" ? "low" : pack.meta.evidenceQuality === "high" ? "high" : "medium";
}
