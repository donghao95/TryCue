import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, FileText, History, Home, Loader2, Send, Trash2, X } from "lucide-react";
import type { RunHistoryItem } from "@trycue/shared";
import { AppHeader } from "../components/AppHeader.js";
import { request } from "../lib/api.js";
import { canDeleteHistoryRun, formatHistoryDate, historyRunStatusLabel, historyStatusTone, mergeHistoryRuns, primaryHistoryAction } from "../lib/format.js";

export function HistoryRoute({
  onHome,
  onOpenRun,
  onOpenReport
}: {
  onHome: () => void;
  onOpenRun: (runId: string) => void;
  onOpenReport: (runId: string) => void;
}) {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<RunHistoryItem[]>([]);
  const [cursor, setCursor] = useState<number | null>(0);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [pendingDeleteRun, setPendingDeleteRun] = useState<RunHistoryItem | null>(null);

  useEffect(() => {
    void loadRuns(true);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function loadRuns(reset = false) {
    const nextCursor = reset ? 0 : cursor;
    if (nextCursor === null) return;
    setLoading(true);
    setToast(null);
    const response = await request<{ runs: RunHistoryItem[]; hasMore: boolean; nextCursor: number | null }>(`/api/runs?limit=20&cursor=${nextCursor}`);
    setLoading(false);
    if (!response.success) {
      setToast({ tone: "error", text: response.error.message });
      return;
    }
    setRuns((current) => reset ? response.data.runs : mergeHistoryRuns(current, response.data.runs));
    setCursor(response.data.nextCursor);
  }

  async function deleteRun(run: RunHistoryItem) {
    if (!canDeleteHistoryRun(run.status)) return;
    setDeletingRunId(run.runId);
    setToast(null);
    const response = await request<{ runId: string; deleted: boolean }>(`/api/runs/${run.runId}`, { method: "DELETE" });
    setDeletingRunId(null);
    setPendingDeleteRun(null);
    if (!response.success) {
      setToast({ tone: "error", text: response.error.message });
      return;
    }
    setRuns((current) => current.filter((item) => item.runId !== run.runId));
    setToast({ tone: "success", text: t("history.deleted") });
  }

  return (
    <main className="historyShell">
      <AppHeader
        variant="narrow"
        kicker="TryCue MVP"
        title={t("history.title")}
        right={
          <button className="ghostButton iconTextButton" type="button" onClick={onHome}>
            <Home size={16} />
            {t("history.backHome")}
          </button>
        }
      />
      {toast ? (
        <div className={`historyToast ${toast.tone}`} role="status" aria-live="polite">
          {toast.tone === "success" ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
          <span>{toast.text}</span>
        </div>
      ) : null}
      {loading && runs.length === 0 ? (
        <div className="historyEmpty"><Loader2 className="spin" size={20} />{t("history.loading")}</div>
      ) : runs.length === 0 ? (
        <section className="historyEmpty">
          <div className="historyEmptyPanel">
            <div className="historyEmptyIcon" aria-hidden="true">
              <History size={26} />
            </div>
            <div className="historyEmptyCopy">
              <h2>{t("history.emptyTitle")}</h2>
              <p>{t("history.emptyBody")}</p>
            </div>
            <button className="primary historyEmptyAction" type="button" onClick={onHome}>
              <Send size={16} />
              {t("history.newRun")}
            </button>
          </div>
        </section>
      ) : (
        <section className="historyList" aria-label={t("history.listAria")}>
          {runs.map((run) => {
            const action = primaryHistoryAction(run);
            return (
              <article className="historyItem" key={run.runId}>
                <div className="historyThumb">
                  {run.coverImageUrl ? <img src={run.coverImageUrl} alt="" /> : <FileText size={24} />}
                </div>
                <div className="historyMain">
                  <div className="historyTitleRow">
                    <h2>{run.title}</h2>
                    <span className={`historyStatus ${historyStatusTone(run.status)}`}>{historyRunStatusLabel(run.status)}</span>
                  </div>
                  <p>{run.bodyPreview || t("history.bodyPreviewEmpty")}</p>
                  <div className="historyMeta">
                    <span>{formatHistoryDate(run.createdAt)}</span>
                    <span>{run.identityReadyCount}/{run.audienceTotal} {t("history.identityReady")}</span>
                    <span>{run.participantCount} {t("history.participants")}</span>
                    {run.hasReport ? <span>{t("history.hasReport")}</span> : null}
                  </div>
                </div>
                <div className="historyActions">
                  <button className="primary" type="button" onClick={() => action.kind === "report" ? onOpenReport(run.runId) : onOpenRun(run.runId)}>
                    {action.label}
                  </button>
                  <button
                    className="ghostButton iconTextButton dangerGhost"
                    type="button"
                    disabled={!canDeleteHistoryRun(run.status) || deletingRunId === run.runId}
                    title={canDeleteHistoryRun(run.status) ? t("history.delete.tooltip") : t("history.delete.tooltipDisabled")}
                    onClick={() => setPendingDeleteRun(run)}
                  >
                    {deletingRunId === run.runId ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                    {t("common.delete")}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}
      {cursor !== null && runs.length > 0 ? (
        <button className="ghostButton historyMore" type="button" disabled={loading} onClick={() => void loadRuns(false)}>
          {loading ? <Loader2 className="spin" size={16} /> : null}
          {t("history.loadMore")}
        </button>
      ) : null}
      {pendingDeleteRun ? (
        <div className="dialogOverlay historyDeleteOverlay" role="presentation">
          <section className="historyDeleteDialog" role="dialog" aria-modal="true" aria-labelledby="history-delete-title">
            <button className="drawerClose" type="button" aria-label={t("common.close")} onClick={() => setPendingDeleteRun(null)}>
              <X size={18} />
            </button>
            <div className="historyDeleteHeader">
              <div className="historyDeleteIcon">
                <AlertTriangle size={22} />
              </div>
              <div>
                <span>{t("history.delete.irrecoverable")}</span>
                <h2 id="history-delete-title">{t("history.delete.title")}</h2>
              </div>
            </div>
            <p>
              {t("history.delete.body", { title: pendingDeleteRun.title })}
            </p>
            <div className="historyDeleteActions">
              <button className="ghostButton" type="button" onClick={() => setPendingDeleteRun(null)} disabled={deletingRunId === pendingDeleteRun.runId}>
                {t("common.cancel")}
              </button>
              <button className="dangerButton" type="button" onClick={() => void deleteRun(pendingDeleteRun)} disabled={deletingRunId === pendingDeleteRun.runId}>
                {deletingRunId === pendingDeleteRun.runId ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                {t("common.delete")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
