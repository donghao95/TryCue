import i18n from "../i18n.js";

/**
 * Unified metric dictionary for the report.
 *
 * Per spec §23.3: every metric shown in the report must pull its Chinese/English
 * name and one-line description from this dictionary so wording stays consistent
 * across the funnel card, charts, evidence drawer, and any future surfaces.
 *
 * Per spec §24.2: raw English keys (readSkim / readPartial / readFull) must never
 * be displayed alone — they must be accompanied by the localized name. Use
 * `metricLabelWithKey` when the audit-friendly "快速浏览 readSkim" format is needed.
 *
 * IMPORTANT: The MetricKey union MUST stay aligned with the backend
 * `METRIC_DICTIONARY` in `packages/shared/src/index.ts`. That dictionary is the
 * single source of truth for the key set; this frontend copy adds i18n paths
 * (zh-CN / en-US) on top of the same keys.
 */

export type MetricKey =
  | "readSkim"
  | "readPartial"
  | "readFull"
  | "exposed"
  | "opened"
  | "viewedComments"
  | "liked"
  | "favorited"
  | "commented"
  | "shared"
  | "exited"
  | "openRate"
  | "readRateAfterOpen"
  | "favoriteRateAfterOpen"
  | "commentRateAfterOpen"
  | "shareRateAfterOpen"
  | "positiveActionRate";

type MetricEntry = {
  /** i18n key for the short localized name (e.g. "快速浏览" / "Skim") */
  labelKey: string;
  /** i18n key for the one-line explanation (e.g. "用户只扫了几眼...") */
  descriptionKey: string;
};

/**
 * Static registry. Keys mirror the field names on FunnelCard so the dictionary
 * can be looked up directly from report data without translation layers.
 */
export const METRIC_DICTIONARY: Record<MetricKey, MetricEntry> = {
  readSkim: {
    labelKey: "report.metricDict.readSkim.label",
    descriptionKey: "report.metricDict.readSkim.description"
  },
  readPartial: {
    labelKey: "report.metricDict.readPartial.label",
    descriptionKey: "report.metricDict.readPartial.description"
  },
  readFull: {
    labelKey: "report.metricDict.readFull.label",
    descriptionKey: "report.metricDict.readFull.description"
  },
  exposed: {
    labelKey: "report.metricDict.exposed.label",
    descriptionKey: "report.metricDict.exposed.description"
  },
  opened: {
    labelKey: "report.metricDict.opened.label",
    descriptionKey: "report.metricDict.opened.description"
  },
  viewedComments: {
    labelKey: "report.metricDict.viewedComments.label",
    descriptionKey: "report.metricDict.viewedComments.description"
  },
  liked: {
    labelKey: "report.metricDict.liked.label",
    descriptionKey: "report.metricDict.liked.description"
  },
  favorited: {
    labelKey: "report.metricDict.favorited.label",
    descriptionKey: "report.metricDict.favorited.description"
  },
  commented: {
    labelKey: "report.metricDict.commented.label",
    descriptionKey: "report.metricDict.commented.description"
  },
  shared: {
    labelKey: "report.metricDict.shared.label",
    descriptionKey: "report.metricDict.shared.description"
  },
  exited: {
    labelKey: "report.metricDict.exited.label",
    descriptionKey: "report.metricDict.exited.description"
  },
  openRate: {
    labelKey: "report.metricDict.openRate.label",
    descriptionKey: "report.metricDict.openRate.description"
  },
  readRateAfterOpen: {
    labelKey: "report.metricDict.readRateAfterOpen.label",
    descriptionKey: "report.metricDict.readRateAfterOpen.description"
  },
  favoriteRateAfterOpen: {
    labelKey: "report.metricDict.favoriteRateAfterOpen.label",
    descriptionKey: "report.metricDict.favoriteRateAfterOpen.description"
  },
  commentRateAfterOpen: {
    labelKey: "report.metricDict.commentRateAfterOpen.label",
    descriptionKey: "report.metricDict.commentRateAfterOpen.description"
  },
  shareRateAfterOpen: {
    labelKey: "report.metricDict.shareRateAfterOpen.label",
    descriptionKey: "report.metricDict.shareRateAfterOpen.description"
  },
  positiveActionRate: {
    labelKey: "report.metricDict.positiveActionRate.label",
    descriptionKey: "report.metricDict.positiveActionRate.description"
  }
};

/**
 * Returns the localized short name for a metric (e.g. "快速浏览").
 * Falls back to the raw key if the i18n entry is missing, so the UI never goes blank.
 */
export function metricLabel(key: MetricKey): string {
  const entry = METRIC_DICTIONARY[key];
  if (!entry) return key;
  const translated = i18n.t(entry.labelKey);
  return translated === entry.labelKey ? key : translated;
}

/**
 * Returns the one-line localized description for a metric (e.g. "用户只扫了几眼...").
 * Returns an empty string when the i18n entry is missing, so callers can treat it
 * as optional without rendering raw key paths.
 */
export function metricDescription(key: MetricKey): string {
  const entry = METRIC_DICTIONARY[key];
  if (!entry) return "";
  const translated = i18n.t(entry.descriptionKey);
  return translated === entry.descriptionKey ? "" : translated;
}

/**
 * Returns the audit-friendly "中文label 英文key" format required by spec §24.2
 * (e.g. "快速浏览 readSkim"). Use this in chart legends, table tooltips, and any
 * place where reviewers need to confirm the metric mapping at a glance.
 *
 * If the i18n label is missing and `metricLabel` falls back to the raw key, this
 * returns just the key once (not "readSkim readSkim") to avoid redundant display.
 */
export function metricLabelWithKey(key: MetricKey): string {
  const label = metricLabel(key);
  return label === key ? key : `${label} ${key}`;
}
