import { useState, useCallback } from "react";
import type {
  ReportView,
  ReportOutput,
  EvidencePack,
  EvidenceRef,
  EvidenceItem,
  VerdictCard,
  FunnelCard,
  MainBlockerCard,
  SegmentCard,
  DiagnosticCard,
  KeepAndChange,
  RevisionAction,
  RetestQuestion,
  AudienceGroupStats,
  SegmentKey,
  DiagnosticStatus,
  Severity,
  Recommendation,
  BlockerType,
  KeyFinding,
  RewriteSuggestions,
  RewriteSuggestionItem
} from "@trycue/shared";
import { useTranslation } from "react-i18next";
import { recommendationLabel, formatHistoryDate } from "../lib/format.js";
import { Charts } from "./Charts.js";

// ── helpers ──

function confidenceLabel(t: (k: string) => string, confidence: VerdictCard["confidence"]): string {
  return confidence === "high" ? t("report.verdict.confidenceHigh") : confidence === "medium" ? t("report.verdict.confidenceMedium") : t("report.verdict.confidenceLow");
}

function severityLabel(t: (k: string) => string, severity: Severity): string {
  return severity === "high" ? t("report.blocker.severityHigh") : severity === "medium" ? t("report.blocker.severityMedium") : t("report.blocker.severityLow");
}

function diagnosticStatusLabel(t: (k: string) => string, status: DiagnosticStatus): string {
  const map: Record<DiagnosticStatus, string> = {
    strong: t("report.diagnostic.statusStrong"),
    medium: t("report.diagnostic.statusMedium"),
    weak: t("report.diagnostic.statusWeak"),
    risk: t("report.diagnostic.statusRisk")
  };
  return map[status];
}

function segmentLabel(t: (k: string) => string, key: SegmentKey): string {
  return t(`report.segment.${key}`);
}

function affectedSegmentLabel(t: (k: string) => string, value: SegmentKey | "overall"): string {
  return value === "overall" ? t("report.revisionPlan.affectedSegmentOverall") : segmentLabel(t, value);
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return "—";
  return String(value);
}

// ── EvidenceRef chip (clickable) ──

function EvidenceRefChip({ ref, onClick }: { ref: EvidenceRef; onClick: (ref: EvidenceRef) => void }) {
  return (
    <button
      type="button"
      className="evidenceChip"
      onClick={() => onClick(ref)}
      title={ref.label}
    >
      {ref.label}
    </button>
  );
}

function EvidenceRefList({ refs, onClick }: { refs: EvidenceRef[] | undefined; onClick: (ref: EvidenceRef) => void }) {
  if (!refs || refs.length === 0) return null;
  return (
    <div className="evidenceRefList">
      {refs.map((ref, i) => (
        <EvidenceRefChip key={`${ref.id}-${i}`} ref={ref} onClick={onClick} />
      ))}
    </div>
  );
}

// ── Evidence drawer ──

function EvidenceDrawer({
  item,
  onClose
}: {
  item: EvidenceItem | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!item) return null;
  const typeLabelMap: Record<string, string> = {
    metric: t("report.evidence.typeMetric"),
    thought: t("report.evidence.typeThought"),
    comment: t("report.evidence.typeComment"),
    tool_call: t("report.evidence.typeToolCall"),
    journey: t("report.evidence.typeJourney"),
    segment: t("report.evidence.typeSegment"),
    blocker: t("report.evidence.typeBlocker"),
    group: t("report.evidence.typeGroup")
  };
  const typeLabel = typeLabelMap[item.type] ?? item.type;
  return (
    <div className="evidenceDrawerOverlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={t("report.evidence.drawerTitle")}>
      <div className="evidenceDrawer" onClick={(e) => e.stopPropagation()}>
        <div className="evidenceDrawerHeader">
          <span className="evidenceType">{typeLabel}</span>
          <h4>{item.title}</h4>
          <button type="button" className="ghostButton" onClick={onClose}>
            {t("report.evidence.closeDrawer")}
          </button>
        </div>
        <div className="evidenceDrawerBody">
          <p className="evidenceContent">{item.content}</p>
          {item.participantId ? <p className="evidenceMeta">{t("report.evidence.participant")}{t("common.labelSeparator")}{item.participantId}</p> : null}
        </div>
      </div>
    </div>
  );
}

// ── Card components ──

function FunnelSection({
  funnel,
  onOpenEvidence: _onOpenEvidence
}: {
  funnel: FunnelCard;
  onOpenEvidence: (ref: EvidenceRef) => void;
}) {
  const { t } = useTranslation();
  const peopleUnit = t("report.unit.people");
  const countUnit = t("report.unit.count");
  const metrics: Array<[string, string]> = [
    [t("report.metric.exposedActors"), `${funnel.exposedActors} ${peopleUnit}`],
    [t("report.metric.openedActors"), `${funnel.openedActors} ${peopleUnit}`],
    [t("report.metric.readActors"), `${funnel.readActors} ${peopleUnit}`],
    [t("report.metric.deepReadActors"), `${funnel.deepReadActors} ${peopleUnit}`],
    [t("report.metric.readFullActors"), `${funnel.readFullActors} ${peopleUnit}`],
    [t("report.metric.readSkimActors"), `${funnel.readSkimActors} ${peopleUnit}`],
    [t("report.metric.readPartialActors"), `${funnel.readPartialActors} ${peopleUnit}`],
    [t("report.metric.likedActors"), `${funnel.likedActors} ${peopleUnit}`],
    [t("report.metric.favoritedActors"), `${funnel.favoritedActors} ${peopleUnit}`],
    [t("report.metric.commentedActors"), `${funnel.commentedActors} ${peopleUnit}（${funnel.commentEvents} ${countUnit}）`],
    [t("report.metric.sharedActors"), `${funnel.sharedActors} ${peopleUnit}`],
    [t("report.metric.viewedCommentsActors"), `${funnel.viewedCommentsActors} ${peopleUnit}`],
    [t("report.metric.positiveActionActors"), `${funnel.positiveActionActors} ${peopleUnit}`],
    [t("report.metric.exitedActors"), `${funnel.exitedActors} ${peopleUnit}`]
  ];
  const rates: Array<[string, string]> = [
    [t("report.funnel.openRate"), formatPercent(funnel.openRate)],
    [t("report.funnel.readRateAfterOpen"), formatPercent(funnel.readRateAfterOpen)],
    [t("report.funnel.deepReadRateAfterOpen"), formatPercent(funnel.deepReadRateAfterOpen)],
    [t("report.funnel.favoriteRateAfterOpen"), formatPercent(funnel.favoriteRateAfterOpen)],
    [t("report.funnel.commentRateAfterOpen"), formatPercent(funnel.commentRateAfterOpen)],
    [t("report.funnel.shareRateAfterOpen"), formatPercent(funnel.shareRateAfterOpen)],
    [t("report.funnel.positiveActionRate"), formatPercent(funnel.positiveActionRate)]
  ];
  return (
    <section className="reportSection">
      <h3>{t("report.section.funnel")}</h3>
      <div className="funnelMetrics">
        {metrics.map(([label, value]) => (
          <div key={label} className="funnelMetric">
            <span className="metricLabel">{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="funnelRates">
        {rates.map(([label, value]) => (
          <div key={label} className="funnelRate">
            <span className="metricLabel">{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="funnelMeta">
        <span>{t("report.funnel.audienceCount")}: {funnel.audienceCount}</span>
        <span>{t("report.funnel.completedCount")}: {funnel.completedCount}</span>
        <span>{t("report.funnel.failedCount")}: {funnel.failedCount}</span>
      </div>
      {funnel.notes ? <p className="funnelNotes">{funnel.notes}</p> : null}
    </section>
  );
}

function MainBlockerSection({
  blocker,
  onOpenEvidence
}: {
  blocker: MainBlockerCard;
  onOpenEvidence: (ref: EvidenceRef) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="reportSection reportBlocker">
      <p className="kicker">{t("report.section.mainBlocker")}</p>
      <h3>{blocker.title}</h3>
      <div className="blockerMeta">
        <span className={`severityBadge severity-${blocker.severity}`}>{severityLabel(t, blocker.severity)}</span>
        <span>{t("report.blocker.affectedCount")}: {blocker.affectedCount}</span>
      </div>
      {blocker.summary ? <p className="blockerSummary">{blocker.summary}</p> : null}
      {blocker.diagnosis ? <p className="blockerDiagnosis">{blocker.diagnosis}</p> : null}
      <EvidenceRefList refs={blocker.evidenceRefs} onClick={onOpenEvidence} />
    </section>
  );
}

function SegmentsSection({
  segments,
  onOpenEvidence
}: {
  segments: SegmentCard[];
  onOpenEvidence: (ref: EvidenceRef) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="reportSection wide">
      <h3>{t("report.section.segments")}</h3>
      <div className="segmentGrid">
        {segments.length === 0 ? (
          <p className="emptyHint">{t("report.segment.empty")}</p>
        ) : (
          segments.map((seg) => (
            <div key={seg.key} className={`segmentCard segment-${seg.key}`}>
              <div className="segmentHeader">
                <h4>{seg.name}</h4>
                <span className="segmentSize">{seg.size}{seg.percentage != null ? ` (${formatPercent(seg.percentage)})` : ""}</span>
              </div>
              {seg.summary ? <p className="segmentSummary">{seg.summary}</p> : null}
              {seg.commonTraits.length > 0 ? (
                <div className="segmentTraits">
                  {seg.commonTraits.map((trait, i) => (
                    <span key={i} className="traitChip">{trait}</span>
                  ))}
                </div>
              ) : null}
              {seg.suggestedAction ? (
                <p className="segmentAction"><span className="metaLabel">{t("report.segment.suggestedAction")}</span>{seg.suggestedAction}</p>
              ) : null}
              {seg.representativeThoughts.length > 0 ? (
                <div className="segmentEvidence">
                  <span className="metaLabel">{t("report.segment.representativeThoughts")}</span>
                  <EvidenceRefList refs={seg.representativeThoughts} onClick={onOpenEvidence} />
                </div>
              ) : null}
              {seg.representativeComments.length > 0 ? (
                <div className="segmentEvidence">
                  <span className="metaLabel">{t("report.segment.representativeComments")}</span>
                  <EvidenceRefList refs={seg.representativeComments} onClick={onOpenEvidence} />
                </div>
              ) : null}
              <EvidenceRefList refs={seg.evidenceRefs} onClick={onOpenEvidence} />
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function fitLabel(t: (k: string) => string, fit: string | undefined): string {
  if (fit === "high") return t("report.audienceGroup.fitHigh");
  if (fit === "medium") return t("report.audienceGroup.fitMedium");
  if (fit === "low") return t("report.audienceGroup.fitLow");
  return "—";
}

function weightLabel(t: (k: string) => string, weight: string | undefined): string {
  if (weight === "high") return t("report.audienceGroup.weightHigh");
  if (weight === "medium") return t("report.audienceGroup.weightMedium");
  if (weight === "low") return t("report.audienceGroup.weightLow");
  return "—";
}

function AudienceGroupSection({
  groups,
  coreTargetHit,
  coreTargetHighInterestLowTrust,
  peripheralExpansionOpportunity,
  contrastSkipExpected,
  contrastUnexpectedRisk,
  crossGroupSummary,
  onOpenEvidence
}: {
  groups: AudienceGroupStats[];
  coreTargetHit: boolean;
  coreTargetHighInterestLowTrust: boolean;
  peripheralExpansionOpportunity: boolean;
  contrastSkipExpected: boolean;
  contrastUnexpectedRisk: boolean;
  crossGroupSummary: string;
  onOpenEvidence: (ref: EvidenceRef) => void;
}) {
  const { t } = useTranslation();
  const flags: Array<[string, boolean]> = [
    [t("report.audienceGroup.coreTargetHit"), coreTargetHit],
    [t("report.audienceGroup.coreTargetHighInterestLowTrust"), coreTargetHighInterestLowTrust],
    [t("report.audienceGroup.peripheralExpansionOpportunity"), peripheralExpansionOpportunity],
    [t("report.audienceGroup.contrastSkipExpected"), contrastSkipExpected],
    [t("report.audienceGroup.contrastUnexpectedRisk"), contrastUnexpectedRisk]
  ];
  return (
    <section className="reportSection">
      <h3>{t("report.section.audienceGroup")}</h3>
      {groups.length === 0 ? (
        <p className="emptyHint">{t("report.audienceGroup.noGroups")}</p>
      ) : (
        <div className="groupGrid">
          {groups.map((g) => (
            <div key={g.directiveId} className={`groupCard role-${g.role}`}>
              <div className="groupHeader">
                <h4>{g.directiveName}</h4>
                <span className="roleChip">{t(`report.audienceGroup.role.${g.role}`)}</span>
              </div>
              {/* 结论层：目标命中度、反馈权重、处理建议 */}
              <div className="groupConclusion">
                <div className="groupConclusionRow">
                  <span className="metaLabel">{t("report.audienceGroup.targetAudienceFit")}</span>
                  <span className={`fitBadge fit-${g.targetAudienceFit ?? "unknown"}`}>{fitLabel(t, g.targetAudienceFit)}</span>
                  <span className="metaLabel">{t("report.audienceGroup.modificationWeight")}</span>
                  <span className={`weightBadge weight-${g.modificationWeight ?? "unknown"}`}>{weightLabel(t, g.modificationWeight)}</span>
                </div>
                {g.handlingSuggestion ? (
                  <p className="groupHandlingSuggestion">{g.handlingSuggestion}</p>
                ) : null}
              </div>
              {/* 解释层：典型动机、主要阻力 */}
              {(g.typicalMotivation || g.mainBarrier) ? (
                <div className="groupExplanation">
                  {g.typicalMotivation ? (
                    <p className="groupMotivation"><span className="metaLabel">{t("report.audienceGroup.typicalMotivation")}</span>{g.typicalMotivation}</p>
                  ) : null}
                  {g.mainBarrier ? (
                    <p className="groupBarrier"><span className="metaLabel">{t("report.audienceGroup.mainBarrier")}</span>{g.mainBarrier}</p>
                  ) : null}
                </div>
              ) : null}
              {/* 证据层：行为统计 */}
              <div className="groupEvidence">
                <p className="groupEvidenceTitle">{t("report.audienceGroup.behaviorEvidence")}</p>
                <div className="groupMetrics">
                  <span>{t("report.metric.opened")}: {g.opened}/{g.total}</span>
                  <span>{t("report.metric.liked")}: {g.liked}</span>
                  <span>{t("report.metric.favorited")}: {g.favorited}</span>
                  <span>{t("report.metric.commented")}: {g.commented}</span>
                  <span>{t("report.metric.viewedComments")}: {g.viewedComments}</span>
                  <span>{t("report.metric.shared")}: {g.shared}</span>
                </div>
                {g.mainExitReasons.length > 0 ? (
                  <p className="groupMeta">{t("report.audienceGroup.exitReasons")}{t("common.labelSeparator")}{g.mainExitReasons.join(t("common.listSeparator"))}</p>
                ) : null}
                {g.mainCommentIntents.length > 0 ? (
                  <p className="groupMeta">{t("report.audienceGroup.commentIntents")}{t("common.labelSeparator")}{g.mainCommentIntents.join(t("common.listSeparator"))}</p>
                ) : null}
              </div>
              <EvidenceRefList refs={g.evidenceRefs} onClick={onOpenEvidence} />
            </div>
          ))}
        </div>
      )}
      <div className="groupFlags">
        {flags.map(([label, hit]) => (
          <span key={label} className={`flagChip ${hit ? "flagHit" : "flagMiss"}`}>
            {label}
          </span>
        ))}
      </div>
      {crossGroupSummary ? <p className="groupSummary">{crossGroupSummary}</p> : null}
    </section>
  );
}

function DiagnosticsSection({
  diagnostics,
  onOpenEvidence
}: {
  diagnostics: DiagnosticCard[];
  onOpenEvidence: (ref: EvidenceRef) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="reportSection wide">
      <h3>{t("report.section.diagnostics")}</h3>
      <div className="diagnosticGrid">
        {diagnostics.map((d) => (
          <div key={d.area} className={`diagnosticCard status-${d.status}`}>
            <div className="diagnosticHeader">
              <h4>{d.title}</h4>
              <span className={`statusBadge status-${d.status}`}>{diagnosticStatusLabel(t, d.status)}</span>
            </div>
            {/* Spec §14: 判断 → 证据 → 原因 → 动作. finding = 判断, evidenceRefs = 证据, reason = 原因, suggestedFix = 建议 */}
            {d.finding ? <p className="diagnosticFinding"><span className="metaLabel">{t("report.diagnostic.finding")}</span>{d.finding}</p> : null}
            {d.evidenceRefs.length > 0 ? (
              <div className="diagnosticEvidence">
                <span className="metaLabel">{t("report.diagnostic.evidence")}</span>
                <EvidenceRefList refs={d.evidenceRefs} onClick={onOpenEvidence} />
              </div>
            ) : null}
            {d.reason ? <p className="diagnosticReason"><span className="metaLabel">{t("report.diagnostic.reason")}</span>{d.reason}</p> : null}
            {d.suggestedFix ? <p className="diagnosticFix"><span className="metaLabel">{t("report.diagnostic.suggestedFix")}</span>{d.suggestedFix}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function KeepAndChangeSection({
  keepAndChange,
  onOpenEvidence
}: {
  keepAndChange: KeepAndChange;
  onOpenEvidence: (ref: EvidenceRef) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="reportSection wide">
      <h3>{t("report.section.keepAndChange")}</h3>
      <div className="keepChangeGrid">
        <div className="keepColumn">
          <h4>{t("report.keepAndChange.keep")}</h4>
          {keepAndChange.keep.length === 0 ? (
            <p className="emptyHint">{t("report.keepAndChange.empty")}</p>
          ) : (
            keepAndChange.keep.map((item, i) => (
              <div key={i} className="keepChangeItem keep">
                <p className="itemText">{item.item}</p>
                <p className="itemReason">{item.reason}</p>
                <EvidenceRefList refs={item.evidenceRefs} onClick={onOpenEvidence} />
              </div>
            ))
          )}
        </div>
        <div className="changeColumn">
          <h4>{t("report.keepAndChange.change")}</h4>
          {keepAndChange.change.length === 0 ? (
            <p className="emptyHint">{t("report.keepAndChange.empty")}</p>
          ) : (
            keepAndChange.change.map((item, i) => (
              <div key={i} className="keepChangeItem change">
                <p className="itemText">{item.item}</p>
                <p className="itemReason">{item.reason}</p>
                <EvidenceRefList refs={item.evidenceRefs} onClick={onOpenEvidence} />
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function RevisionPlanSection({
  plan,
  onOpenEvidence
}: {
  plan: RevisionAction[];
  onOpenEvidence: (ref: EvidenceRef) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="reportSection wide">
      <h3>{t("report.section.revisionPlan")}</h3>
      {plan.length === 0 ? (
        <p className="emptyHint">{t("report.revisionPlan.empty")}</p>
      ) : (
        <div className="revisionList">
          {plan.map((item, i) => (
            <div key={i} className={`revisionItem priority-${item.priority}`}>
              <div className="revisionHeader">
                <span className="priorityBadge">{item.priority}</span>
                <h4>{item.title}</h4>
              </div>
              <p className="revisionAction">{item.action}</p>
              <p className="revisionReason"><span className="metaLabel">{t("report.revisionPlan.reason")}</span>{item.reason}</p>
              <div className="revisionMeta">
                <span><span className="metaLabel">{t("report.revisionPlan.affectedSegment")}</span>{affectedSegmentLabel(t, item.affectedSegment)}</span>
              </div>
              <p className="revisionImpact"><span className="metaLabel">{t("report.revisionPlan.expectedImpact")}</span>{item.expectedImpact}</p>
              {item.retestQuestion ? <p className="revisionRetest"><span className="metaLabel">{t("report.revisionPlan.retestQuestion")}</span>{item.retestQuestion}</p> : null}
              <EvidenceRefList refs={item.evidenceRefs} onClick={onOpenEvidence} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RetestPlanSection({ plan }: { plan: RetestQuestion[] }) {
  const { t } = useTranslation();
  return (
    <section className="reportSection wide">
      <h3>{t("report.section.retestPlan")}</h3>
      {plan.length === 0 ? (
        <p className="emptyHint">{t("report.retestPlan.empty")}</p>
      ) : (
        <ol className="retestList">
          {plan.map((item, i) => (
            <li key={i} className="retestItem">
              {/* Spec §17: 下轮测试目标 → 实验假设 → 建议测试版本 → 观察指标 → 预期方向 → 关联行动 */}
              <p className="retestQuestion"><span className="metaLabel">{t("report.retestPlan.question")}</span>{item.question}</p>
              {item.hypothesis ? (
                <p className="retestHypothesis" style={{ whiteSpace: "pre-line" }}><span className="metaLabel">{t("report.retestPlan.hypothesis")}</span>{item.hypothesis}</p>
              ) : null}
              {item.testVersionLabel ? (
                <p className="retestVersion" style={{ whiteSpace: "pre-line" }}><span className="metaLabel">{t("report.retestPlan.testVersionLabel")}</span>{item.testVersionLabel}</p>
              ) : null}
              <div className="retestMeta">
                {item.metricToWatch ? <span><span className="metaLabel">{t("report.retestPlan.metricToWatch")}</span>{item.metricToWatch}</span> : null}
                {item.expectedDirection ? <span><span className="metaLabel">{t("report.retestPlan.expectedDirection")}</span>{item.expectedDirection}</span> : null}
                {item.relatedAction ? <span><span className="metaLabel">{t("report.retestPlan.relatedAction")}</span>{item.relatedAction}</span> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ── Copy button (spec §22.2: rewrite items must support one-click copy) ──

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API unavailable (e.g. non-secure context) — silently ignore
    }
  }, [text]);
  return (
    <button type="button" className="copyButton" onClick={handleCopy}>
      {copied ? t("report.rewrite.copied") : t("report.rewrite.copy")}
    </button>
  );
}

// ── Decision summary card (spec §4: first-screen hero, left/right split) ──

function DecisionSummaryCard({
  verdict,
  recommendation,
  mainBlocker,
  revisionPlan,
  keepAndChange,
  onOpenEvidence
}: {
  verdict: VerdictCard;
  recommendation: Recommendation;
  mainBlocker: MainBlockerCard | null;
  revisionPlan: RevisionAction[];
  keepAndChange: KeepAndChange;
  onOpenEvidence: (ref: EvidenceRef) => void;
}) {
  const { t } = useTranslation();
  const p0Items = revisionPlan.filter((r) => r.priority === "P0");
  const p1Items = revisionPlan.filter((r) => r.priority === "P1");
  const keepItems = keepAndChange.keep;

  return (
    <section className="reportSection reportDecisionSummary">
      <p className="kicker">{t("report.section.decisionSummary")}</p>
      <div className="decisionSummaryGrid">
        {/* Left column: 结论 (verdict + confidence + core problem + opportunity/risk) */}
        <div className="decisionLeft">
          <h2 className="recommendationValue">{recommendationLabel(recommendation)}</h2>
          <div className="verdictConfidence">
            <span className="metaLabel">{t("report.verdict.confidence")}</span>
            <span className={`confidenceBadge confidence-${verdict.confidence}`}>{confidenceLabel(t, verdict.confidence)}</span>
          </div>
          {/* Spec §4: headline (summary) first, then one-sentence verdict (explanation) — matches CSS font-size hierarchy */}
          {verdict.headline ? <p className="verdictHeadline">{verdict.headline}</p> : null}
          {verdict.oneSentence ? <p className="verdictOneSentence">{verdict.oneSentence}</p> : null}
          {mainBlocker ? (
            <div className="decisionCell">
              <span className="metaLabel">{t("report.decisionSummary.coreProblem")}</span>
              <p>{mainBlocker.title}</p>
            </div>
          ) : null}
          {verdict.topOpportunity ? (
            <div className="decisionCell">
              <span className="metaLabel">{t("report.verdict.topOpportunity")}</span>
              <p>{verdict.topOpportunity}</p>
            </div>
          ) : null}
          {verdict.topRisk ? (
            <div className="decisionCell">
              <span className="metaLabel">{t("report.verdict.topRisk")}</span>
              <p>{verdict.topRisk}</p>
            </div>
          ) : null}
          <EvidenceRefList refs={verdict.evidenceRefs} onClick={onOpenEvidence} />
        </div>
        {/* Right column: 行动 (P0 must-fix + P1 suggested + keep items) */}
        <div className="decisionRight">
          {p0Items.length > 0 ? (
            <div className="decisionActionGroup">
              <h4>{t("report.decisionSummary.p0Actions")}</h4>
              <ul>
                {p0Items.map((item, i) => (
                  <li key={i}>{item.title}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {p1Items.length > 0 ? (
            <div className="decisionActionGroup">
              <h4>{t("report.decisionSummary.p1Actions")}</h4>
              <ul>
                {p1Items.map((item, i) => (
                  <li key={i}>{item.title}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {keepItems.length > 0 ? (
            <div className="decisionActionGroup">
              <h4>{t("report.decisionSummary.keepItems")}</h4>
              <ul>
                {keepItems.map((item, i) => (
                  <li key={i}>{item.item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ── Key findings section (spec §5: fixed 3 findings, 结论→证据→影响→动作) ──

function KeyFindingsSection({
  findings,
  onOpenEvidence
}: {
  findings: KeyFinding[];
  onOpenEvidence: (ref: EvidenceRef) => void;
}) {
  const { t } = useTranslation();
  if (findings.length === 0) {
    return (
      <section className="reportSection wide">
        <h3>{t("report.section.keyFindings")}</h3>
        <p className="emptyHint">{t("report.keyFinding.empty")}</p>
      </section>
    );
  }
  return (
    <section className="reportSection wide">
      <h3>{t("report.section.keyFindings")}</h3>
      <div className="keyFindingsGrid">
        {findings.map((f, i) => (
          <div key={i} className="keyFindingCard">
            <p className="keyFindingField"><span className="metaLabel">{t("report.keyFinding.finding")}</span>{f.finding}</p>
            <p className="keyFindingField"><span className="metaLabel">{t("report.keyFinding.evidence")}</span>{f.evidence}</p>
            <p className="keyFindingField"><span className="metaLabel">{t("report.keyFinding.impact")}</span>{f.impact}</p>
            <p className="keyFindingField"><span className="metaLabel">{t("report.keyFinding.action")}</span>{f.action}</p>
            <EvidenceRefList refs={f.evidenceRefs} onClick={onOpenEvidence} />
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Rewrite suggestions section (spec §16: copyable concrete rewrites) ──

function RewriteSuggestionItemBlock({
  item,
  copyable = true
}: {
  item: RewriteSuggestionItem;
  copyable?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="rewriteItem">
      <p className="rewriteText">{item.text}</p>
      <p className="rewriteReason"><span className="metaLabel">{t("report.rewrite.why")}</span>{item.reason}</p>
      {copyable ? <CopyButton text={item.text} /> : null}
    </div>
  );
}

function RewriteSuggestionsSection({
  suggestions
}: {
  suggestions: RewriteSuggestions;
}) {
  const { t } = useTranslation();
  const hasAny =
    suggestions.recommendedTitles.length > 0 ||
    suggestions.recommendedCoverText != null ||
    suggestions.recommendedOpening != null ||
    suggestions.recommendedBodyStructure != null ||
    suggestions.recommendedCommentPrompt != null ||
    suggestions.recommendedTags.length > 0;
  if (!hasAny) {
    return (
      <section className="reportSection wide">
        <h3>{t("report.section.rewriteSuggestions")}</h3>
        <p className="emptyHint">{t("report.rewrite.empty")}</p>
      </section>
    );
  }
  return (
    <section className="reportSection wide">
      <h3>{t("report.section.rewriteSuggestions")}</h3>
      <div className="rewriteSuggestions">
        {suggestions.recommendedTitles.length > 0 ? (
          <div className="rewriteGroup">
            <h4>{t("report.rewrite.recommendedTitles")}</h4>
            {suggestions.recommendedTitles.map((item, i) => (
              <RewriteSuggestionItemBlock key={i} item={item} />
            ))}
          </div>
        ) : null}
        {suggestions.recommendedCoverText ? (
          <div className="rewriteGroup">
            <h4>{t("report.rewrite.recommendedCoverText")}</h4>
            <RewriteSuggestionItemBlock item={suggestions.recommendedCoverText} />
          </div>
        ) : null}
        {suggestions.recommendedOpening ? (
          <div className="rewriteGroup">
            <h4>{t("report.rewrite.recommendedOpening")}</h4>
            <RewriteSuggestionItemBlock item={suggestions.recommendedOpening} />
          </div>
        ) : null}
        {suggestions.recommendedBodyStructure ? (
          <div className="rewriteGroup">
            <h4>{t("report.rewrite.recommendedBodyStructure")}</h4>
            <RewriteSuggestionItemBlock item={suggestions.recommendedBodyStructure} />
          </div>
        ) : null}
        {suggestions.recommendedCommentPrompt ? (
          <div className="rewriteGroup">
            <h4>{t("report.rewrite.recommendedCommentPrompt")}</h4>
            <RewriteSuggestionItemBlock item={suggestions.recommendedCommentPrompt} />
          </div>
        ) : null}
        {suggestions.recommendedTags.length > 0 ? (
          <div className="rewriteGroup">
            <h4>{t("report.rewrite.recommendedTags")}</h4>
            <div className="rewriteTags">
              {suggestions.recommendedTags.map((tag, i) => (
                <span key={i} className="traitChip">{tag}</span>
              ))}
              <CopyButton text={suggestions.recommendedTags.join(" ")} />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ── Main ReportPanel ──

export interface ReportPanelProps {
  report: ReportView;
  onRegenerate?: () => void;
  isRegenerating?: boolean;
}

export function ReportPanel({ report, onRegenerate, isRegenerating }: ReportPanelProps) {
  const { t } = useTranslation();
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);

  const output: ReportOutput | undefined = report.reportOutput;
  const pack: EvidencePack | undefined = report.evidencePack;
  const evidenceIndex = pack?.evidenceIndex ?? {};

  const handleOpenEvidence = useCallback((ref: EvidenceRef) => {
    setActiveEvidenceId(ref.id);
  }, []);

  const activeItem: EvidenceItem | null = activeEvidenceId ? evidenceIndex[activeEvidenceId] ?? null : null;

  // evidenceQuality low warning
  const evidenceQuality = pack?.meta.evidenceQuality;
  const isLowQuality = evidenceQuality === "low";

  if (!output) {
    return (
      <section className="reportBoard">
        <p className="error">{t("report.evidence.empty")}</p>
      </section>
    );
  }

  const promptVersion = report.promptVersion;
  const generatedAt = report.createdAt;
  const runId = report.runId;

  const modelDisplay = (value: string | null | undefined): string =>
    value && value.trim() ? value : t("report.modelUnknown");

  return (
    <section className="reportBoard">
      {/* evidence quality warning */}
      {isLowQuality ? (
        <div className="evidenceQualityWarning">
          <strong>{t("report.evidenceQuality.low")}</strong>
          <p>{t("report.evidenceQuality.lowHint")}</p>
        </div>
      ) : null}

      {/* first screen: decision summary hero (spec §4: 发布建议卡, contains Verdict + P0 + Keep + MainBlocker summary) */}
      <DecisionSummaryCard
        verdict={output.verdict}
        recommendation={report.recommendation}
        mainBlocker={output.mainBlocker}
        revisionPlan={output.revisionPlan}
        keepAndChange={output.keepAndChange}
        onOpenEvidence={handleOpenEvidence}
      />

      {/* 5 core cards per spec §4: 发布建议(Verdict, in DecisionSummaryCard) → 关键漏斗 → 最大阻断点 → 人群分组 → 优先修改计划 */}
      <FunnelSection funnel={output.funnel} onOpenEvidence={handleOpenEvidence} />

      {output.mainBlocker ? (
        <MainBlockerSection blocker={output.mainBlocker} onOpenEvidence={handleOpenEvidence} />
      ) : null}

      <SegmentsSection segments={output.segments} onOpenEvidence={handleOpenEvidence} />

      {/* full revision plan (P1, P2 and any non-P0; P0 surfaced in DecisionSummaryCard hero) */}
      {output.revisionPlan.filter((r) => r.priority !== "P0").length > 0 ? (
        <RevisionPlanSection plan={output.revisionPlan.filter((r) => r.priority !== "P0")} onOpenEvidence={handleOpenEvidence} />
      ) : null}

      {/* Spec §8/§22.1: four core charts, after the 5 core cards. */}
      <Charts
        funnel={output.funnel}
        groups={output.audienceGroupAnalysis?.groups ?? []}
        revisionPlan={output.revisionPlan}
      />

      {/* Spec §5: show section when field exists (undefined = legacy report, hide). Empty array shows emptyHint. */}
      {output.keyFindings ? (
        <KeyFindingsSection findings={output.keyFindings} onOpenEvidence={handleOpenEvidence} />
      ) : null}

      {/* detailed sections */}
      {output.audienceGroupAnalysis ? (
        <AudienceGroupSection
          groups={output.audienceGroupAnalysis.groups}
          coreTargetHit={output.audienceGroupAnalysis.coreTargetHit}
          coreTargetHighInterestLowTrust={output.audienceGroupAnalysis.coreTargetHighInterestLowTrust}
          peripheralExpansionOpportunity={output.audienceGroupAnalysis.peripheralExpansionOpportunity}
          contrastSkipExpected={output.audienceGroupAnalysis.contrastSkipExpected}
          contrastUnexpectedRisk={output.audienceGroupAnalysis.contrastUnexpectedRisk}
          crossGroupSummary={output.audienceGroupAnalysis.crossGroupSummary}
          onOpenEvidence={handleOpenEvidence}
        />
      ) : null}

      <DiagnosticsSection diagnostics={output.diagnostics} onOpenEvidence={handleOpenEvidence} />

      <KeepAndChangeSection keepAndChange={output.keepAndChange} onOpenEvidence={handleOpenEvidence} />

      {output.rewriteSuggestions ? (
        <RewriteSuggestionsSection suggestions={output.rewriteSuggestions} />
      ) : null}

      <RetestPlanSection plan={output.retestPlan} />

      {/* footer: regenerate + metadata */}
      <section className="reportSection wide reportFooter">
        {onRegenerate ? (
          <button
            type="button"
            className="ghostButton"
            onClick={onRegenerate}
            disabled={isRegenerating}
          >
            {isRegenerating ? t("report.regenerating") : t("report.regenerate")}
          </button>
        ) : null}
        <div className="reportMeta">
          <p className="metaGroupTitle">{t("report.runInfo")}</p>
          <span>{t("report.model")}{t("common.labelSeparator")}{modelDisplay(report.model)}</span>
          <span>{t("report.promptVersion")}{t("common.labelSeparator")}{promptVersion}</span>
          <span>{t("report.generatedAt")}{t("common.labelSeparator")}{formatHistoryDate(generatedAt)}</span>
          <span>{t("report.runId")}{t("common.labelSeparator")}{runId}</span>
        </div>
        <p className="reportDisclosure">{t("simulation.note")}</p>
      </section>

      {/* evidence drawer */}
      <EvidenceDrawer item={activeItem} onClose={() => setActiveEvidenceId(null)} />
    </section>
  );
}
