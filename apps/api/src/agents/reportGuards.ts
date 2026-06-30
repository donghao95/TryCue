import {
  type ReportOutput,
  type EvidenceRef
} from "@trycue/shared/report";

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
