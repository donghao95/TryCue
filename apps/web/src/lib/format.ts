import type { AudienceSeatStatus, RunHistoryItem, RunStatus, RuntimeLogItem } from "@trycue/shared";
import type { AudienceDraft, UiStatus } from "../types.js";
import i18n from "../i18n.js";

export function statusLabel(status: AudienceSeatStatus) {
  return i18n.t(`status.seat.${status}`);
}

export function lifecycleLabel(status: AudienceSeatStatus) {
  if (status === "not_started") return i18n.t("status.lifecycle.not_started");
  if (status === "failed") return i18n.t("status.lifecycle.failed");
  if (status === "skipped" || status === "finished" || status === "risk_exit") return i18n.t("status.lifecycle.left");
  return i18n.t("status.lifecycle.active");
}

export function statusLabelForRun(status: UiStatus) {
  if (status === "planning_audience") return i18n.t("status.run.planning_audience");
  if (status === "generating_audience") return i18n.t("status.run.generating_audience");
  if (status === "audience_ready") return i18n.t("status.run.audience_ready");
  if (status === "pausing") return i18n.t("status.run.pausing");
  if (status === "paused") return i18n.t("status.run.paused");
  if (status === "completed" || status === "report_generating") return i18n.t("status.run.completed");
  return i18n.t("status.run.running");
}

export function historyRunStatusLabel(status: RunStatus) {
  return i18n.t(`status.historyRun.${status}`);
}

export function historyStatusTone(status: RunStatus) {
  if (status === "completed") return "complete";
  if (status === "running" || status === "pausing" || status === "report_generating") return "live";
  if (status === "paused") return "paused";
  return "prep";
}

export function primaryHistoryAction(run: RunHistoryItem): { kind: "run" | "report"; label: string } {
  if (run.status === "completed" && run.hasReport) return { kind: "report", label: i18n.t("status.historyAction.viewReport") };
  if (run.status === "completed") return { kind: "run", label: i18n.t("status.historyAction.reviewData") };
  if (run.status === "report_generating") return { kind: "run", label: i18n.t("status.historyAction.viewReportGenerating") };
  if (run.status === "paused") return { kind: "run", label: i18n.t("status.historyAction.backToVenue") };
  if (["running", "pausing"].includes(run.status)) return { kind: "run", label: i18n.t("status.historyAction.openVenue") };
  if (run.status === "audience_ready") return { kind: "run", label: i18n.t("status.historyAction.startRun") };
  if (run.status === "generating_audience") return { kind: "run", label: i18n.t("status.historyAction.viewProgress") };
  if (run.status === "planning_audience") return { kind: "run", label: i18n.t("status.historyAction.continuePrep") };
  return { kind: "run", label: i18n.t("status.historyAction.continueEdit") };
}

export function canDeleteHistoryRun(status: RunStatus) {
  return !["running", "pausing", "report_generating"].includes(status);
}

export function mergeHistoryRuns(current: RunHistoryItem[], incoming: RunHistoryItem[]) {
  const map = new Map(current.map((run) => [run.runId, run]));
  for (const run of incoming) map.set(run.runId, run);
  return [...map.values()];
}

export function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString(i18n.language, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function personaSectionText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function audienceProfileSummary(audience: AudienceDraft) {
  const label = audience.samplingLabel?.trim();
  return label ? i18n.t("audience.profileSummary", { label }) : i18n.t("audience.profileSummaryEmpty");
}

export function audienceProfileLabel(audience: AudienceDraft) {
  return audience.samplingLabel;
}

// 匹配后端采样标签的中文格式（"标签：内容" / "避免与同组其他观众重复"）。
// 后端采样标签始终是中文，所以这里不随 i18n locale 切换。
function cleanAudienceSummary(value: string) {
  return value
    .replace(/^.+?：/, "")
    .replace(/，?避免与同组其他观众重复/g, "")
    .replace(/\s*\/\s*/g, " / ")
    .split(" / ")
    .map((part) => part.trim())
    .filter((part) => part && !/^mock-\d+$/i.test(part))
    .join(" / ");
}

export function consoleFilterLabel(value: string) {
  const key = `console.filter.${value}`;
  const translated = i18n.t(key);
  return translated === key ? value : translated;
}

export function recommendationLabel(value: string) {
  const key = `recommendation.${value}`;
  const translated = i18n.t(key);
  return translated === key ? value : translated;
}

export function dimensionTitle(value: string) {
  const key = `dimension.${value}`;
  const translated = i18n.t(key);
  return translated === key ? value : translated;
}

export function commentPreviewTitle(value: string) {
  const key = `commentPreview.${value}`;
  const translated = i18n.t(key);
  return translated === key ? value : translated;
}

function normalizeLogType(value?: string | null) {
  if (!value) return "action";
  if (value === "error") return "exception";
  return value;
}

export function runtimeLogCategory(log: RuntimeLogItem) {
  const action = normalizeLogType(log.action);
  const logType = normalizeLogType(log.logType);
  if (action === "thought") return "thought";
  if (action === "write_comment") return "comment";
  if (["open_post", "read_post", "view_comments", "like_post", "favorite_post", "share_post", "write_comment", "like_comment", "exit_browsing"].includes(action)) return "action";
  if (["generation", "dispatch", "result", "waiting", "control", "exception"].includes(logType)) return logType;
  if (["generation", "dispatch", "result", "waiting", "control", "exception"].includes(action)) return action;
  return logType === "action" ? "action" : logType;
}

export function sortRuntimeLogs(logs: RuntimeLogItem[]) {
  return [...logs].sort((a, b) => {
    const timeDiff = (b.simulatedTime ?? 0) - (a.simulatedTime ?? 0);
    if (timeDiff !== 0) return timeDiff;
    const createdA = a.createdAt ? Date.parse(a.createdAt) : 0;
    const createdB = b.createdAt ? Date.parse(b.createdAt) : 0;
    if (createdA !== createdB) return createdB - createdA;
    return b.id.localeCompare(a.id);
  });
}

export function formatRuntimeLogTime(log: RuntimeLogItem) {
  if (typeof log.simulatedTime === "number") return formatTime(log.simulatedTime);
  if (log.createdAt) {
    const date = new Date(log.createdAt);
    if (!Number.isNaN(date.valueOf())) {
      return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
    }
  }
  return "--:--";
}

export function formatRuntimeLogText(log: RuntimeLogItem) {
  const text = log.message ?? log.text ?? "";
  const name = log.audienceName?.trim();
  if (!name) return text;
  const commentPrefix = i18n.t("runtimeLog.commentPrefix");
  return text
    .replace(new RegExp(`^${escapeRegExp(name)}\\s*${escapeRegExp(commentPrefix)}`), commentPrefix)
    .replace(new RegExp(`^${escapeRegExp(name)}\\s*`), "")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type DrawerTimelineKind = "thought" | "action" | "comment" | "exception" | "result" | "hidden";

const ACTION_TO_KIND: Record<string, DrawerTimelineKind> = {
  thought: "thought",
  write_comment: "comment",
  open_post: "action",
  read_post: "action",
  view_comments: "action",
  like_post: "action",
  favorite_post: "action",
  share_post: "action",
  like_comment: "action",
  exit_browsing: "action"
};

export function classifyDrawerTimelineItem(action: string | undefined, logType?: string): DrawerTimelineKind {
  const normalized = (action ?? "").trim().toLowerCase();
  if (ACTION_TO_KIND[normalized]) return ACTION_TO_KIND[normalized];
  if (normalized === "exception" || logType === "exception") return "exception";
  if (normalized === "result" || logType === "result") return "result";
  if (logType === "thought" || normalized === "thought") return "thought";
  return "hidden";
}

export function formatClock(seconds: number) {
  const hour = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const minute = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const second = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${hour}:${minute}:${second}`;
}

export function formatTime(seconds: number) {
  const minute = Math.floor(seconds / 60).toString().padStart(2, "0");
  const second = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minute}:${second}`;
}

export function formatCompact(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

export function formatValue(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).filter(Boolean).join(i18n.t("common.listSeparator"));
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map((item) => formatValue(item)).filter(Boolean).join(i18n.t("common.listSeparator"));
  }
  return String(value);
}

export function formatReportValue(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const parts = [
      record.target ? i18n.t("audience.reportValue.target", { value: formatValue(record.target) }) : "",
      record.problem ? i18n.t("audience.reportValue.problem", { value: formatValue(record.problem) }) : "",
      record.direction ? i18n.t("audience.reportValue.direction", { value: formatValue(record.direction) }) : "",
      record.example ? i18n.t("audience.reportValue.example", { value: formatValue(record.example) }) : "",
      record.evidence ? i18n.t("audience.reportValue.evidence", { value: formatValue(record.evidence) }) : ""
    ].filter(Boolean);
    if (parts.length) return parts.join(i18n.t("common.reportSeparator"));
  }
  return formatValue(value);
}

export function hashSeed(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
