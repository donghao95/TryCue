import type {
  FunnelCard,
  AudienceGroupStats,
  RevisionAction,
  ImpactLevel,
  CostLevel,
  TargetAudienceFit
} from "@trycue/shared";
import { useTranslation } from "react-i18next";

// ── Shared helpers ──

/**
 * Compute content reaction strength (horizontal axis of audience matrix).
 * Spec §11.4: composite engagement rate = positive action actors / total.
 * Buckets: >=50% high, 20-50% medium, <20% low.
 *
 * 使用 positiveActionActors（按人去重）计算，避免单人多行为膨胀分子。
 * readFull 作为内容反应信号纳入计算。
 */
function computeEngagementLevel(g: AudienceGroupStats): "high" | "medium" | "low" {
  if (g.total <= 0) return "low";
  // 优先用 positiveActionActors（按人去重），回退到行为加总
  const positive = g.positiveActionActors ?? (g.liked + g.favorited + g.commented + g.shared);
  const rate = positive / g.total;
  if (rate >= 0.5) return "high";
  if (rate >= 0.2) return "medium";
  return "low";
}

// ── Chart 1: Behavior Funnel ──

type FunnelStage = {
  key: string;
  label: string;
  metricKey: string;
  count: number;
};

function FunnelChart({ funnel }: { funnel: FunnelCard }) {
  const { t } = useTranslation();
  const peopleUnit = t("report.unit.people");
  // 累计/递进漏斗口径：每一步都是人数，后续步骤是前一步的子集
  // 进入测试/曝光 → 点击进入 → 发生阅读 → 深度阅读 → 完整阅读 → 产生正向行为 → 收藏/分享
  const favoritedOrShared = Math.max(funnel.favoritedActors, funnel.sharedActors);
  const stages: FunnelStage[] = [
    { key: "exposedActors", label: t("report.chart.funnel.stageExposed"), metricKey: "exposedActors", count: funnel.exposedActors },
    { key: "openedActors", label: t("report.chart.funnel.stageOpened"), metricKey: "openedActors", count: funnel.openedActors },
    { key: "readActors", label: t("report.chart.funnel.stageRead"), metricKey: "readActors", count: funnel.readActors },
    { key: "deepReadActors", label: t("report.chart.funnel.stageDeepRead"), metricKey: "deepReadActors", count: funnel.deepReadActors },
    { key: "readFullActors", label: t("report.chart.funnel.stageReadFull"), metricKey: "readFullActors", count: funnel.readFullActors },
    { key: "positiveActionActors", label: t("report.chart.funnel.stagePositiveAction"), metricKey: "positiveActionActors", count: funnel.positiveActionActors },
    { key: "commentedActors", label: t("report.chart.funnel.stageCommented"), metricKey: "commentedActors", count: funnel.commentedActors }
  ];
  const total = funnel.audienceCount || 1;
  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  // Spec §20.4: empty state when sample too small (< 3 participants)
  if (funnel.audienceCount < 3) {
    return (
      <div className="chartCard funnelChart">
        <h4>{t("report.chart.funnel.title")}</h4>
        <p className="chartCaption">{t("report.chart.funnel.caption")}</p>
        <p className="chartEmpty">{t("report.chart.funnel.empty")}</p>
      </div>
    );
  }

  return (
    <div className="chartCard funnelChart">
      <h4>{t("report.chart.funnel.title")}</h4>
      <p className="chartCaption">{t("report.chart.funnel.caption")}</p>
      <div className="funnelBars">
        {stages.map((stage, i) => {
          const widthPct = (stage.count / maxCount) * 100;
          const sharePct = total > 0 ? (stage.count / total) * 100 : 0;
          const prevStage = i > 0 ? stages[i - 1] : undefined;
          const prevCount = prevStage ? prevStage.count : null;
          const drop = prevCount != null ? prevCount - stage.count : 0;
          return (
            <div key={stage.key} className="funnelRow">
              <div className="funnelRowLabel">
                <span className="funnelStage">{stage.label}</span>
                <span className="funnelMetricKey">{stage.metricKey}</span>
              </div>
              <div className="funnelBarTrack">
                <div className="funnelBarFill" style={{ width: `${widthPct}%` }} />
              </div>
              <div className="funnelRowValue">
                <span className="funnelCount">{stage.count} {peopleUnit}/{total} {peopleUnit}</span>
                <span className="funnelPercent">{sharePct.toFixed(0)}%</span>
                {stage.key === "commentedActors" ? (
                  <span className="funnelEventCount">{t("report.chart.funnel.commentEvents", { count: funnel.commentEvents })}</span>
                ) : null}
                {i > 0 && drop > 0 ? (
                  <span className="funnelDrop">{t("report.chart.funnel.dropHint", { count: drop })}</span>
                ) : null}
                {i > 0 && drop === 0 ? (
                  <span className="funnelNoDrop">{t("report.chart.funnel.noDrop")}</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {/* Spec §9.5/§20.2: funnel must have a natural-language interpretation below.
          Always use the rule-based interpretation; funnel.notes is a data summary, not an interpretation. */}
      <p className="chartInterpretation">
        <span className="metaLabel">{t("report.chart.interpretation")}</span>
        {buildFunnelInterpretation(funnel, t)}
      </p>
    </div>
  );
}

function buildFunnelInterpretation(
  funnel: FunnelCard,
  t: (k: string) => string
): string {
  const openRatePct = funnel.openRate != null ? funnel.openRate * 100 : 0;
  const skimRate = funnel.openedActors > 0 ? (funnel.readSkimActors / funnel.openedActors) * 100 : 0;
  if (openRatePct < 50) {
    return t("report.chart.funnel.interpOpenLow");
  }
  if (skimRate > 60) {
    return t("report.chart.funnel.interpSkimHigh");
  }
  if (funnel.readFullActors < funnel.readPartialActors) {
    return t("report.chart.funnel.interpFullLow");
  }
  return t("report.chart.funnel.interpStable");
}

// ── Chart 2: Reading Depth Distribution ──

function ReadDepthChart({ funnel }: { funnel: FunnelCard }) {
  const { t } = useTranslation();
  const peopleUnit = t("report.unit.people");
  if (funnel.audienceCount < 3) {
    return (
      <div className="chartCard readDepthChart">
        <h4>{t("report.chart.readDepth.title")}</h4>
        <p className="chartCaption">{t("report.chart.readDepth.caption")}</p>
        <p className="chartEmpty">{t("report.chart.readDepth.empty")}</p>
      </div>
    );
  }
  const items = [
    { key: "readSkimActors", label: t("report.metricDict.readSkim.label"), desc: t("report.metricDict.readSkim.description"), count: funnel.readSkimActors },
    { key: "readPartialActors", label: t("report.metricDict.readPartial.label"), desc: t("report.metricDict.readPartial.description"), count: funnel.readPartialActors },
    { key: "readFullActors", label: t("report.metricDict.readFull.label"), desc: t("report.metricDict.readFull.description"), count: funnel.readFullActors }
  ];
  const max = Math.max(...items.map((i) => i.count), 1);
  const total = funnel.readActors || 1;
  return (
    <div className="chartCard readDepthChart">
      <h4>{t("report.chart.readDepth.title")}</h4>
      <p className="chartCaption">{t("report.chart.readDepth.caption")}</p>
      <div className="hBarChart">
        {items.map((item) => {
          const widthPct = (item.count / max) * 100;
          const sharePct = total > 0 ? (item.count / total) * 100 : 0;
          return (
            <div key={item.key} className="hBarRow">
              <div className="hBarRowLabel">
                <span className="hBarLabel">{item.label}</span>
                <span className="hBarMetricKey">{item.key}</span>
              </div>
              <div className="hBarDesc">{item.desc}</div>
              <div className="hBarTrack">
                <div className="hBarFill" style={{ width: `${widthPct}%` }} />
              </div>
              <div className="hBarRowValue">
                <span className="hBarCount">{item.count} {peopleUnit}/{total} {peopleUnit}</span>
                <span className="hBarPercent">{sharePct.toFixed(0)}%</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="chartInterpretation">
        <span className="metaLabel">{t("report.chart.interpretation")}</span>
        {buildReadDepthInterpretation(funnel, t)}
      </p>
    </div>
  );
}

function buildReadDepthInterpretation(
  funnel: FunnelCard,
  t: (k: string) => string
): string {
  const max = Math.max(funnel.readSkimActors, funnel.readPartialActors, funnel.readFullActors);
  if (max === funnel.readSkimActors) {
    return t("report.chart.readDepth.interpSkimHigh");
  }
  if (max === funnel.readFullActors) {
    return t("report.chart.readDepth.interpFullHigh");
  }
  return t("report.chart.readDepth.interpPartialHigh");
}

// ── Chart 3: Target Audience Fit Matrix ──

function AudienceMatrixChart({ groups }: { groups: AudienceGroupStats[] }) {
  const { t } = useTranslation();
  if (groups.length === 0) {
    return (
      <div className="chartCard audienceMatrixChart">
        <h4>{t("report.chart.audienceMatrix.title")}</h4>
        <p className="chartCaption">{t("report.chart.audienceMatrix.caption")}</p>
        <p className="chartEmpty">{t("report.chart.audienceMatrix.empty")}</p>
      </div>
    );
  }
  const fitLabel = (f: TargetAudienceFit | undefined): string => {
    if (f === "high") return t("report.chart.audienceMatrix.fitHigh");
    if (f === "medium") return t("report.chart.audienceMatrix.fitMedium");
    return t("report.chart.audienceMatrix.fitLow");
  };
  const engageLabel = (e: "high" | "medium" | "low"): string => {
    if (e === "high") return t("report.chart.audienceMatrix.engageHigh");
    if (e === "medium") return t("report.chart.audienceMatrix.engageMedium");
    return t("report.chart.audienceMatrix.engageLow");
  };
  // 2x2 matrix: rows = fit (high/low), cols = engagement (low/high)
  // Layout (matching spec §11.4):
  //   top-left: high-fit + low-engage = 优先修复人群
  //   top-right: high-fit + high-engage = 核心机会人群
  //   bottom-left: low-fit + low-engage = 低参考权重人群
  //   bottom-right: low-fit + high-engage = 意外扩展人群
  // Note: spec §11.4 only defines high/low quadrants. Schema has high/medium/low.
  // We bucket medium into the "high" side (top row / right col) so that medium-fit
  // groups with strong engagement still surface as opportunities, not as low-weight.
  const inTopRow = (g: AudienceGroupStats) => g.targetAudienceFit === "high" || g.targetAudienceFit === "medium";
  const inRightCol = (g: AudienceGroupStats) => {
    const e = computeEngagementLevel(g);
    return e === "high" || e === "medium";
  };
  const quadItems = (topRow: boolean, rightCol: boolean) =>
    groups.filter((g) => {
      const top = inTopRow(g);
      const right = inRightCol(g);
      return top === topRow && right === rightCol;
    });

  const quadrantLabel = (topRow: boolean, rightCol: boolean): string => {
    if (topRow && rightCol) return t("report.chart.audienceMatrix.quadHighFitHighEngage");
    if (topRow && !rightCol) return t("report.chart.audienceMatrix.quadHighFitLowEngage");
    if (!topRow && rightCol) return t("report.chart.audienceMatrix.quadLowFitHighEngage");
    return t("report.chart.audienceMatrix.quadLowFitLowEngage");
  };

  return (
    <div className="chartCard audienceMatrixChart">
      <h4>{t("report.chart.audienceMatrix.title")}</h4>
      <p className="chartCaption">{t("report.chart.audienceMatrix.caption")}</p>
      <div className="matrixChart">
        <div className="matrixAxisY">
          <span className="matrixAxisLabel">{t("report.chart.audienceMatrix.axisFit")}</span>
          <span className="matrixAxisEnd matrixAxisHigh">{t("report.chart.audienceMatrix.fitHigh")}</span>
          <span className="matrixAxisEnd matrixAxisLow">{t("report.chart.audienceMatrix.fitLow")}</span>
        </div>
        <div className="matrixQuadrants">
          <div className="matrixQuadrant qTopLeft">
            <p className="quadrantName">{quadrantLabel(true, false)}</p>
            {quadItems(true, false).map((g) => (
              <MatrixGroupPill key={g.directiveId} g={g} fitLabel={fitLabel(g.targetAudienceFit)} engageLabel={engageLabel(computeEngagementLevel(g))} />
            ))}
          </div>
          <div className="matrixQuadrant qTopRight">
            <p className="quadrantName">{quadrantLabel(true, true)}</p>
            {quadItems(true, true).map((g) => (
              <MatrixGroupPill key={g.directiveId} g={g} fitLabel={fitLabel(g.targetAudienceFit)} engageLabel={engageLabel(computeEngagementLevel(g))} />
            ))}
          </div>
          <div className="matrixQuadrant qBottomLeft">
            <p className="quadrantName">{quadrantLabel(false, false)}</p>
            {quadItems(false, false).map((g) => (
              <MatrixGroupPill key={g.directiveId} g={g} fitLabel={fitLabel(g.targetAudienceFit)} engageLabel={engageLabel(computeEngagementLevel(g))} />
            ))}
          </div>
          <div className="matrixQuadrant qBottomRight">
            <p className="quadrantName">{quadrantLabel(false, true)}</p>
            {quadItems(false, true).map((g) => (
              <MatrixGroupPill key={g.directiveId} g={g} fitLabel={fitLabel(g.targetAudienceFit)} engageLabel={engageLabel(computeEngagementLevel(g))} />
            ))}
          </div>
        </div>
      </div>
      <div className="matrixAxisX">
        <span className="matrixAxisEnd matrixAxisLow">{t("report.chart.audienceMatrix.engageLow")}</span>
        <span className="matrixAxisLabel">{t("report.chart.audienceMatrix.axisEngagement")}</span>
        <span className="matrixAxisEnd matrixAxisHigh">{t("report.chart.audienceMatrix.engageHigh")}</span>
      </div>
    </div>
  );
}

function MatrixGroupPill({
  g,
  fitLabel,
  engageLabel
}: {
  g: AudienceGroupStats;
  fitLabel: string;
  engageLabel: string;
}) {
  return (
    <div className="matrixGroupPill" title={g.directiveName}>
      <span className="matrixGroupName">{g.directiveName}</span>
      <span className="matrixGroupMeta">{fitLabel} · {engageLabel}</span>
    </div>
  );
}

// ── Chart 4: Issue Priority Matrix ──

function PriorityMatrixChart({ plan }: { plan: RevisionAction[] }) {
  const { t } = useTranslation();
  if (plan.length === 0) {
    return (
      <div className="chartCard priorityMatrixChart">
        <h4>{t("report.chart.priorityMatrix.title")}</h4>
        <p className="chartCaption">{t("report.chart.priorityMatrix.caption")}</p>
        <p className="chartEmpty">{t("report.chart.priorityMatrix.empty")}</p>
      </div>
    );
  }
  // Derive impactLevel/costLevel when missing (backward compat with older reports).
  const deriveImpact = (r: RevisionAction): ImpactLevel =>
    r.impactLevel ?? (r.priority === "P0" ? "high" : r.priority === "P1" ? "medium" : "low");
  const deriveCost = (r: RevisionAction): CostLevel => r.costLevel ?? "medium";

  const impactLabel = (i: ImpactLevel): string => {
    if (i === "high") return t("report.chart.priorityMatrix.impactHigh");
    if (i === "medium") return t("report.chart.priorityMatrix.impactMedium");
    return t("report.chart.priorityMatrix.impactLow");
  };
  const costLabel = (c: CostLevel): string => {
    if (c === "high") return t("report.chart.priorityMatrix.costHigh");
    if (c === "medium") return t("report.chart.priorityMatrix.costMedium");
    return t("report.chart.priorityMatrix.costLow");
  };
  // 2x2: rows = impact (high/low), cols = cost (low/high)
  // Layout (spec §12.2):
  //   top-left: high-impact + low-cost = 马上改
  //   top-right: high-impact + high-cost = 重点规划
  //   bottom-left: low-impact + low-cost = 顺手改
  //   bottom-right: low-impact + high-cost = 暂不改
  // Note: spec §12.2 only defines high/low quadrants. Schema has high/medium/low.
  // We bucket medium into the "high" side (top row / right col) so medium-impact
  // issues still get visibility rather than falling into the "skip" quadrant.
  const inTopRow = (r: RevisionAction) => {
    const i = deriveImpact(r);
    return i === "high" || i === "medium";
  };
  const inRightCol = (r: RevisionAction) => {
    const c = deriveCost(r);
    return c === "high" || c === "medium";
  };
  const quadItems = (topRow: boolean, rightCol: boolean) =>
    plan.filter((r) => inTopRow(r) === topRow && inRightCol(r) === rightCol);
  const quadrantLabel = (topRow: boolean, rightCol: boolean): string => {
    if (topRow && rightCol) return t("report.chart.priorityMatrix.quadHighImpactHighCost");
    if (topRow && !rightCol) return t("report.chart.priorityMatrix.quadHighImpactLowCost");
    if (!topRow && rightCol) return t("report.chart.priorityMatrix.quadLowImpactHighCost");
    return t("report.chart.priorityMatrix.quadLowImpactLowCost");
  };

  return (
    <div className="chartCard priorityMatrixChart">
      <h4>{t("report.chart.priorityMatrix.title")}</h4>
      <p className="chartCaption">{t("report.chart.priorityMatrix.caption")}</p>
      <div className="matrixChart">
        <div className="matrixAxisY">
          <span className="matrixAxisLabel">{t("report.chart.priorityMatrix.axisImpact")}</span>
          <span className="matrixAxisEnd matrixAxisHigh">{t("report.chart.priorityMatrix.impactHigh")}</span>
          <span className="matrixAxisEnd matrixAxisLow">{t("report.chart.priorityMatrix.impactLow")}</span>
        </div>
        <div className="matrixQuadrants">
          <div className="matrixQuadrant qTopLeft">
            <p className="quadrantName">{quadrantLabel(true, false)}</p>
            {quadItems(true, false).map((r) => (
              <PriorityPill key={r.title} r={r} impactLabel={impactLabel(deriveImpact(r))} costLabel={costLabel(deriveCost(r))} />
            ))}
          </div>
          <div className="matrixQuadrant qTopRight">
            <p className="quadrantName">{quadrantLabel(true, true)}</p>
            {quadItems(true, true).map((r) => (
              <PriorityPill key={r.title} r={r} impactLabel={impactLabel(deriveImpact(r))} costLabel={costLabel(deriveCost(r))} />
            ))}
          </div>
          <div className="matrixQuadrant qBottomLeft">
            <p className="quadrantName">{quadrantLabel(false, false)}</p>
            {quadItems(false, false).map((r) => (
              <PriorityPill key={r.title} r={r} impactLabel={impactLabel(deriveImpact(r))} costLabel={costLabel(deriveCost(r))} />
            ))}
          </div>
          <div className="matrixQuadrant qBottomRight">
            <p className="quadrantName">{quadrantLabel(false, true)}</p>
            {quadItems(false, true).map((r) => (
              <PriorityPill key={r.title} r={r} impactLabel={impactLabel(deriveImpact(r))} costLabel={costLabel(deriveCost(r))} />
            ))}
          </div>
        </div>
      </div>
      <div className="matrixAxisX">
        <span className="matrixAxisEnd matrixAxisLow">{t("report.chart.priorityMatrix.costLow")}</span>
        <span className="matrixAxisLabel">{t("report.chart.priorityMatrix.axisCost")}</span>
        <span className="matrixAxisEnd matrixAxisHigh">{t("report.chart.priorityMatrix.costHigh")}</span>
      </div>
    </div>
  );
}

function PriorityPill({
  r,
  impactLabel,
  costLabel
}: {
  r: RevisionAction;
  impactLabel: string;
  costLabel: string;
}) {
  return (
    <div className="priorityPill" title={r.action}>
      <span className={`priorityTag priority-${r.priority}`}>{r.priority}</span>
      <span className="priorityTitle">{r.title}</span>
      <span className="priorityMeta">{impactLabel} · {costLabel}</span>
    </div>
  );
}

// ── Combined Charts section ──

export interface ChartsProps {
  funnel: FunnelCard;
  groups: AudienceGroupStats[];
  revisionPlan: RevisionAction[];
}

export function Charts({ funnel, groups, revisionPlan }: ChartsProps) {
  const { t } = useTranslation();
  return (
    <section className="reportSection wide reportCharts">
      <h3>{t("report.chart.section")}</h3>
      <div className="chartsGrid">
        <FunnelChart funnel={funnel} />
        <ReadDepthChart funnel={funnel} />
        <AudienceMatrixChart groups={groups} />
        <PriorityMatrixChart plan={revisionPlan} />
      </div>
    </section>
  );
}
