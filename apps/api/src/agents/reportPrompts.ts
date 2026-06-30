import {
  type EvidencePack,
  type Recommendation,
  type EvidenceBlocker
} from "@trycue/shared/report";
import { RECOMMENDATION_LABELS } from "../runtime/reportRefs.js";

// ── Prompt builders ──

export function buildSystemPrompt(params: {
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

export function buildUserPrompt(params: {
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
export function buildCompactEvidencePack(pack: EvidencePack): unknown {
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
