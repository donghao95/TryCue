import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { getSharedCapacityManager, getSharedRateLimitedFetch } from "../llm/rateLimitedFetch.js";
import { aiSdkTrace } from "../llm/aiSdkTracing.js";
import { PROMPT_VERSION_REPORT } from "./promptVersions.js";
import {
  ReportOutputSchema,
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
  buildFallbackKeyFindings,
  buildFallbackRewriteSuggestions,
  buildFallbackRetestPlan,
  fallbackDiagnosticContent,
  computeDiagnosticStatus,
  RECOMMENDATION_LABELS,
  SEGMENT_NAMES,
  BLOCKER_TITLES,
  DIAGNOSTIC_TITLES
} from "../runtime/reportBuilders.js";

export interface ReportLLMInput {
  runId?: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  /** Cover image (and any additional post images) to send to the vision-capable report model. */
  imageUrls?: string[];
  /** Compact content snapshot used for the prompt header. */
  contentHeader: { title: string; bodyPreview: string; imageCount: number };
  /** Deterministically-built EvidencePack — the only source of truth the LLM may cite. */
  evidencePack: EvidencePack;
  /** Code-generated recommendation candidate; the LLM may agree or downgrade but cannot upgrade past it. */
  recommendationCandidate: Recommendation;
  /** Code-selected main blocker; the LLM may pick a different one but must justify it. */
  mainBlocker: EvidenceBlocker | null;
}

export interface ReportLLMResult {
  /** Validated, fully-formed ReportOutput. */
  reportOutput: ReportOutput;
  /** Recommendation that was actually emitted in the verdict (always a valid enum value, never `backup_version`). */
  recommendation: Recommendation;
  model: string;
  promptVersion: string;
}

/**
 * Build the report via the decision-dashboard LLM. The LLM receives a deterministically
 * generated EvidencePack and must emit a structured ReportOutput that validates against
 * ReportOutputSchema. The LLM is explicitly told it may only cite evidenceRef ids that
 * already exist in `evidencePack.evidenceIndex`.
 */
export async function generateReportWithLLM(input: ReportLLMInput): Promise<ReportLLMResult> {
  if (!input.apiKey) throw new Error("generateReportWithLLM: apiKey is required");
  if (!input.baseUrl) throw new Error("generateReportWithLLM: baseUrl is required");
  const provider = createOpenAICompatible({
    name: "trycue-report",
    apiKey: input.apiKey,
    baseURL: input.baseUrl,
    fetch: getSharedRateLimitedFetch()
  });

  const evidencePack = input.evidencePack;
  const validEvidenceIds = new Set(Object.keys(evidencePack.evidenceIndex));
  const candidate = input.recommendationCandidate;
  const mainBlocker = input.mainBlocker;

  const systemPrompt = buildSystemPrompt({
    validEvidenceIds,
    recommendationCandidate: candidate,
    mainBlocker
  });
  const userPrompt = buildUserPrompt({
    contentHeader: input.contentHeader,
    evidencePack,
    recommendationCandidate: candidate,
    mainBlocker
  });

  const imageUrls = input.imageUrls?.length ? input.imageUrls : [];

  const result = await generateText({
    model: provider.chatModel(input.model),
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: userPrompt },
          ...imageUrls.map((url) => ({
            type: "image" as const,
            image: url
          }))
        ]
      }
    ],
    temperature: 0.3,
    maxRetries: getSharedCapacityManager().getMaxRetries(),
    ...aiSdkTrace({ runId: input.runId, taskType: "report", promptVersion: PROMPT_VERSION_REPORT })
  });

  const raw = result.text || "{}";
  const parsed = parseJsonLoose(raw);
  const reportOutput = coerceReportOutput(parsed, evidencePack, candidate, mainBlocker);

  // Final Zod validation — guarantees the persisted blob conforms to the shared contract.
  // ReportOutputSchema is `.strict()`, so unknown keys (e.g. sneaked-in score fields) fail here.
  const validation = ReportOutputSchema.safeParse(reportOutput);
  if (!validation.success) {
    throw new Error(`ReportOutput schema 校验失败: ${validation.error.issues.map((i) => `${i.path.join(".")}:${i.message}`).join("; ")}`);
  }

  // Reject any report that still claims `backup_version` or invents evidence refs.
  assertNoInventedEvidenceRefs(validation.data, validEvidenceIds);
  // Scan the *raw* LLM JSON (pre-Zod) for banned score/grade patterns that may have
  // been stripped by `.strict()` parsing. Catching them here lets us fail loudly instead
  // of silently dropping the violation.
  assertNoBannedScoreFields(parsed);
  // Scan for forbidden "real platform performance" claims in any string field.
  assertNoRealPlatformClaims(validation.data);

  return {
    reportOutput: validation.data,
    recommendation: validation.data.verdict.recommendation,
    model: input.model,
    promptVersion: PROMPT_VERSION_REPORT
  };
}

// ── Prompt builders ──

function buildSystemPrompt(params: {
  validEvidenceIds: Set<string>;
  recommendationCandidate: Recommendation;
  mainBlocker: EvidenceBlocker | null;
}): string {
  const { validEvidenceIds, recommendationCandidate, mainBlocker } = params;
  const evidenceIdList = [...validEvidenceIds].sort();
  const candidateLabel = RECOMMENDATION_LABELS[recommendationCandidate];
  const mainBlockerLine = mainBlocker
    ? `代码候选最大阻断点：${mainBlocker.blockerType}（severity=${mainBlocker.severity}, affected=${mainBlocker.affectedCount}）。`
    : "代码未检测到明确最大阻断点。";

  return `你是 TryCue 的发布前内容诊断分析师。

你会基于 AI 观众试映产生的 Evidence Pack，生成发布决策报告。你的任务是帮助内容创作者判断当前版本能不能发布、主要卡点是什么、应该先改什么、下一轮重测什么。

## 硬性约束

1. 你只能基于 Evidence Pack 输出结论，不能编造 Evidence Pack 中不存在的数据、人数、比例、分组或证据。
2. 你不能输出精确分数（例如 87 分、B+、可信度 72、发布潜力 8.6）。结论信心只能用 高 / 中 / 低 表达。
3. 你不能预测真实平台表现（例如"发布后会获得高点赞""真实平台表现预计很好""这条内容一定会爆"）。只能表达"在本次 AI 观众试映中……""模拟观众表现显示……""当前试映证据表明……"。
4. TryCue 是 AI 观众试映模拟系统，你的报告必须诚实表达"模拟观众 / AI 观众试映"，不得把模拟结果包装成真实用户行为。
5. 每个核心判断都必须带 evidenceRefs，引用的 id 必须来自下方"可用证据 id 列表"。引用不存在的 id 视为编造事实。
6. 你的建议必须具体可执行，不要输出"优化标题""增强吸引力""提升可信度""补充细节""优化内容结构"这类泛泛之词。要改成类似"在正文开头补充检测数据来源，降低高兴趣低信任人群的 need_more_evidence 离开"。
7. recommendation 只能从这四个值中选一个：recommend_publish、modify_then_publish、not_recommend_current_version、recommend_retest。不得输出 backup_version 或其他值。
8. 代码给出的推荐候选是"${candidateLabel}"。你可以维持或降级（publish→modify→not_recommend→retest），但不得升级。若 evidenceQuality 为 low，必须输出 recommend_retest。
9. ${mainBlockerLine}你可以在报告中维持该阻断点，或改选另一个 Evidence Pack 中存在的阻断点，但必须给出理由。

## 可用证据 id 列表

${evidenceIdList.length ? evidenceIdList.map((id) => `- ${id}`).join("\n") : "- （无）"}

## 输出要求

输出严格合法的 JSON，且必须满足 ReportOutputSchema：
- verdict: { recommendation, recommendationLabel, confidence("low"|"medium"|"high"), headline, oneSentence, topOpportunity, topRisk, priorityFix, evidenceRefs[] }
- funnel: 直接回填 EvidencePack.funnel 的数值，并写一句 notes 说明漏斗解读。注意：所有人数指标（exposedActors、openedActors、readActors 等）都是按参与者去重的人数，不是行为次数。事件次数（openEvents、commentEvents 等）是辅助指标。比率全部用人数计算
- mainBlocker: { blockerType, title, severity, affectedCount, summary, diagnosis, evidenceRefs[] }。diagnosis 必须解释为什么这是最大阻断点
- audienceGroupAnalysis: 直接回填 EvidencePack.audienceGroups，不增删字段
- segments: 数组，每类人群一个 SegmentCard。key/name/size/percentage/commonTraits 直接回填 EvidencePack.segments；summary 写对该人群的判断；suggestedAction 写针对该人群的修改建议；representativeThoughts/representativeComments 引用 EvidencePack 中的证据 id
- diagnostics: 五个 DiagnosticCard，area 分别为 feed_attraction / reading_retention / trust_evidence / save_value / comment_risk。status ∈ strong|medium|weak|risk。finding 写基于证据的判断；reason 写"为什么会这样"的机制解释（如"标题能让人点进来，但正文开头没有快速兑现标题承诺"）；suggestedFix 写可执行建议
- keepAndChange: { keep: [{item, reason, evidenceRefs[]}], change: [{item, reason, evidenceRefs}] }。至少各 1 条
- revisionPlan: 修改计划，最多 1 个 P0、2 个 P1、1 个 P2。每条含 priority/title/action/reason/affectedSegment/expectedImpact/retestQuestion/evidenceRefs[]。另必须给 impactLevel（high/medium/low，影响程度）和 costLevel（high/medium/low，修改成本），用于问题优先级矩阵。P0 通常 impactLevel=high，P2 通常 impactLevel=low；成本取决于动作类型（改标题=low，重写正文=high）
- retestPlan: 2-4 个重测问题，每条含 question/relatedAction/metricToWatch/expectedDirection。另外必须给 hypothesis（H1/H2/H3 形式的可证伪假设，如"H1: 如果在正文开头前置检测数据来源，need_more_evidence 离开人数会下降"）和 testVersionLabel（A/B/C 版标签，如"A 版：前置证据来源"）
- keyFindings: 固定 3 条关键发现，每条含 finding（结论）/evidence（证据）/impact（影响）/action（动作）/evidenceRefs[]。三条应分别来自不同信号源（如 blocker、segment、人群匹配度），不要三条都讲同一件事。示例：
  {"finding":"信任证据不足（影响 3 人）","evidence":"3 人因 low_trust/need_more_evidence 离开","impact":"如果不处理，内容可能在这一点上持续流失观众","action":"补充检测数据来源、使用边界和非广告说明","evidenceRefs":[{"id":"blocker:trust_evidence","type":"blocker","label":"信任证据不足"}]}
- rewriteSuggestions: 直接改稿建议。recommendedTitles（2-3 条，每条含 text+reason）；recommendedOpening（含 text+reason，正文前 3 行）；recommendedCommentPrompt（含 text+reason，评论引导）；recommendedTags（3-5 个标签字符串）。可选：recommendedCoverText / recommendedBodyStructure。示例：
  {"recommendedTitles":[{"text":"装修别急着下单，全屋定制先问这 5 个问题","reason":"前置具体收益和数量"}],"recommendedOpening":{"text":"如果你准备做全屋定制，先别急着交定金。","reason":"在正文前 3 行加入问题+代价+结论"},"recommendedCommentPrompt":{"text":"你现在最纠结的是板材、报价还是安装？","reason":"用提问引导用户参与"},"recommendedTags":["避坑","清单","新手必看"]}
- evidenceRefs: 顶层汇总所有子结构用到的证据 id（去重）
- summaryMarkdown: 可选，不超过 200 字的摘要

只输出 JSON，不要输出其他文字，不要使用 markdown 代码块。`;
}

function buildUserPrompt(params: {
  contentHeader: { title: string; bodyPreview: string; imageCount: number };
  evidencePack: EvidencePack;
  recommendationCandidate: Recommendation;
  mainBlocker: EvidenceBlocker | null;
}): string {
  const { contentHeader, evidencePack, recommendationCandidate, mainBlocker } = params;
  const compactPack = buildCompactEvidencePack(evidencePack);
  return `请基于以下 Evidence Pack 生成发布决策报告。

## 内容快照
标题：${contentHeader.title}
正文预览：${contentHeader.bodyPreview}
图片数：${contentHeader.imageCount}

## 代码给出的推荐候选
${recommendationCandidate}（${RECOMMENDATION_LABELS[recommendationCandidate]}）

## 代码候选最大阻断点
${mainBlocker ? `${mainBlocker.blockerType}（${mainBlocker.severity}, affected=${mainBlocker.affectedCount}）— ${mainBlocker.summary}` : "无"}

## Evidence Pack（JSON）

${JSON.stringify(compactPack, null, 2)}

请基于以上 Evidence Pack 输出 ReportOutput JSON。所有 evidenceRefs 必须来自 Evidence Pack 的 evidenceIndex。`;
}

/**
 * Build a compact EvidencePack for the prompt. We must keep a slimmed-down
 * evidenceIndex — otherwise the LLM cannot see what each evidence id refers to
 * and cannot decide which refs to cite. We truncate long `content` strings to
 * keep prompt size manageable.
 */
function buildCompactEvidencePack(pack: EvidencePack): unknown {
  const compactIndex: Record<string, { id: string; type: string; title: string; content: string; participantId?: string }> = {};
  for (const [id, item] of Object.entries(pack.evidenceIndex)) {
    compactIndex[id] = {
      id: item.id,
      type: item.type,
      title: item.title,
      content: item.content.length > 200 ? item.content.slice(0, 200) + "…" : item.content,
      ...(item.participantId ? { participantId: item.participantId } : {})
    };
  }
  return {
    ...pack,
    evidenceIndex: compactIndex
  };
}

// ── Output parsing & coercion ──

function parseJsonLoose(raw: string): Record<string, unknown> {
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

// ── Post-validation guards ──

export function assertNoInventedEvidenceRefs(report: ReportOutput, validIds: Set<string>): void {
  const allRefs: EvidenceRef[] = [];
  const push = (list: EvidenceRef[] | undefined) => { if (list) allRefs.push(...list); };
  push(report.verdict.evidenceRefs);
  push(report.mainBlocker.evidenceRefs);
  for (const seg of report.segments) {
    push(seg.evidenceRefs);
    push(seg.representativeThoughts);
    push(seg.representativeComments);
  }
  for (const diag of report.diagnostics) push(diag.evidenceRefs);
  push(report.audienceGroupAnalysis.evidenceRefs);
  for (const g of report.audienceGroupAnalysis.groups) {
    push(g.evidenceRefs);
    push(g.representativeThoughts);
    push(g.representativeComments);
    push(g.representativeJourneys);
  }
  for (const k of report.keepAndChange.keep) push(k.evidenceRefs);
  for (const c of report.keepAndChange.change) push(c.evidenceRefs);
  for (const rev of report.revisionPlan) push(rev.evidenceRefs);
  push(report.evidenceRefs);
  const invented = allRefs.map((r) => r.id).filter((id) => !validIds.has(id));
  if (invented.length > 0) {
    throw new Error(`报告引用了不存在的证据 id: ${[...new Set(invented)].slice(0, 10).join(", ")}`);
  }
}

export function assertNoBannedScoreFields(parsed: Record<string, unknown>): void {
  // Scan the raw LLM JSON for banned numeric score fields. Because ReportOutputSchema
  // is `.strict()`, extra keys would already fail Zod validation; this guard catches
  // banned patterns embedded *inside* declared string fields (e.g. headline="87 分")
  // or inside arrays/objects that survived coercion.
  const json = JSON.stringify(parsed);
  const banned = [
    /"score"\s*:/,
    /"grade"\s*:/,
    /"rating"\s*:/,
    /"potential"\s*:\s*\d/,
    /"credibility"\s*:\s*\d/,
    /\b\d{1,3}\s*分(?!钟)/,
    /\bB\+/,
    /可信度\s*\d{1,3}/,
    /发布潜力\s*\d/,
    /转化指数\s*\d/
  ];
  for (const pattern of banned) {
    if (pattern.test(json)) {
      throw new Error(`报告包含被禁止的精确分数字段或表述: ${pattern.source}`);
    }
  }
}

export function assertNoRealPlatformClaims(report: ReportOutput): void {
  // Forbidden phrases that frame the AI-audience simulation as a prediction of real
  // platform performance. Only "在本次 AI 观众试映中 / 模拟观众表现显示 / 当前试映证据表明"
  // style phrasing is allowed.
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
  const json = JSON.stringify(report);
  for (const phrase of forbidden) {
    if (json.includes(phrase)) {
      throw new Error(`报告包含被禁止的"真实平台表现预测"表述: ${phrase}`);
    }
  }
}
