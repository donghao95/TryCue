import type { UIEvent } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RuntimeLogItem } from "@trycue/shared/run";
import { consoleFilterLabel, formatRuntimeLogText, formatRuntimeLogTime, runtimeLogCategory, sortRuntimeLogs } from "../lib/format.js";

export function RuntimeLogStrip({
  expanded,
  hasMore,
  isComplete,
  loading,
  logs,
  filter,
  tabMode,
  panelId,
  tabId,
  onExpandedChange,
  onFilterChange,
  onLoadMore,
  onScroll
}: {
  expanded: boolean;
  hasMore: boolean;
  isComplete: boolean;
  loading: boolean;
  logs: RuntimeLogItem[];
  filter: string;
  tabMode?: boolean;
  panelId?: string;
  tabId?: string;
  onExpandedChange?: (value: boolean) => void;
  onFilterChange: (value: string) => void;
  onLoadMore: () => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
}) {
  const { t } = useTranslation();
  const filters = ["all", "generation", "dispatch", "thought", "action", "result", "waiting", "comment", "control", "exception"];
  const filteredLogs = sortRuntimeLogs(logs.filter((log) => filter === "all" || runtimeLogCategory(log) === filter));
  const modeText = t("console.loadedN", { count: filteredLogs.length });
  return (
    <section
      className={`runtimeConsole ${expanded ? "expanded" : "compact"} ${isComplete ? "complete" : ""}`}
      aria-label={t("console.liveLogs")}
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
    >
      <header>
        <strong>{isComplete ? t("console.runningLogs") : t("console.liveLogs")}<small>{modeText}</small></strong>
        <div>
          {filters.map((item) => (
            <button className={filter === item ? "active" : ""} key={item} type="button" onClick={() => onFilterChange(item)}>
              {consoleFilterLabel(item)}
            </button>
          ))}
          {tabMode ? null : (
            <button className="consoleExpandButton" type="button" onClick={() => onExpandedChange?.(!expanded)}>
              {expanded ? t("console.collapseLogs") : t("console.expandLogs")}
            </button>
          )}
        </div>
      </header>
      <div className="consoleRows" onScroll={onScroll}>
        {filteredLogs.length ? (
          filteredLogs.map((log, index) => (
            <p className={`consoleRow consoleRow-${runtimeLogCategory(log)}`} key={`${log.id}-${index}`}>
              <time>{formatRuntimeLogTime(log)}</time>
              <span>{consoleFilterLabel(runtimeLogCategory(log))}</span>
              {log.audienceName ? <strong>【{log.audienceName}】</strong> : null}
              <em>{formatRuntimeLogText(log)}</em>
            </p>
          ))
        ) : (
          <p className="consoleRow consoleRow-waiting"><time>--:--</time><span>{t("console.waiting")}</span><em>{t("console.empty")}</em></p>
        )}
        {loading ? (
          <p className="consoleLoadState"><Loader2 className="spin" size={14} />{t("console.loadMore")}</p>
        ) : hasMore ? (
          <button className="consoleLoadMore" type="button" onClick={onLoadMore}>{t("console.loadMore")}</button>
        ) : logs.length ? (
          <p className="consoleLoadState">{t("console.allLoaded")}</p>
        ) : null}
      </div>
    </section>
  );
}
