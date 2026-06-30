import { useEffect, useRef } from "react";
import type { LiveEventEnvelope } from "@trycue/shared/live-events";

/**
 * SSE subscription scoped to the report page (`/reports/:runId`).
 *
 * Why a separate hook instead of reusing `useLiveEvents`:
 * - `useLiveEvents` is gated on `routeKind !== "report"` and
 *   `uiStatus !== "completed"`, both of which are true on the report page.
 *   Relaxing those gates would pull the full workbench event stream (audience
 *   updates, comments, action logs, ...) into the report page, which is
 *   wasteful and risks unwanted state mutations.
 * - The report page only needs `report.regenerated` — when another session (or
 *   a server-side job) regenerates the report, the viewer reloads it.
 *
 * Behavior:
 * - Opens an SSE connection to the same `/api/runs/:runId/events` endpoint
 *   with `?liveOnly=true`.
 * - Only subscribes to `report.regenerated`; ignores everything else.
 * - Reconnects automatically via the browser's native EventSource retry.
 * - `?liveOnly=true` only suppresses the no-cursor initial replay: the report
 *   page loads the latest report on mount via `loadReport`, so historical
 *   events from before the connection are not needed. On browser-driven
 *   reconnects EventSource re-sends `Last-Event-ID`, and the server then
 *   DOES replay durable events from that cursor forward — so a
 *   `report.regenerated` produced during the disconnect is still delivered.
 */
export interface UseReportEventsParams {
  /** Run id from the report route; empty string when not on a report page. */
  runId: string;
  /** Called when a `report.regenerated` event arrives for this run. */
  onReportRegenerated: () => void;
  /** Called once when the first malformed SSE payload is observed. */
  onMalformed: () => void;
}

export function useReportEvents(params: UseReportEventsParams): void {
  const { runId, onReportRegenerated, onMalformed } = params;

  // Refs to capture the latest callbacks without re-running the effect on
  // every callback identity change.
  const onReportRegeneratedRef = useRef(onReportRegenerated);
  onReportRegeneratedRef.current = onReportRegenerated;
  const onMalformedRef = useRef(onMalformed);
  onMalformedRef.current = onMalformed;

  const malformedNotifiedRef = useRef(false);

  useEffect(() => {
    if (!runId) return;
    // `liveOnly=true` skips historical replay: the report page already loads
    // the latest report via REST on mount (`loadReport`), so we only need
    // regenerations that happen *after* the SSE connection is established.
    // Without this the server would replay every historical durable event
    // for the run, causing a redundant `loadReport` if any past
    // `report.regenerated` event is in the history.
    const sseUrl = `/api/runs/${runId}/events?liveOnly=true`;
    const source = new EventSource(sseUrl);

    source.addEventListener("report.regenerated", (event) => {
      let payload: LiveEventEnvelope;
      try {
        payload = JSON.parse((event as MessageEvent).data) as LiveEventEnvelope;
      } catch {
        if (!malformedNotifiedRef.current) {
          malformedNotifiedRef.current = true;
          onMalformedRef.current();
        }
        return;
      }
      // Guard against events from a stale connection (runId changed after the
      // effect was scheduled but before the listener fired).
      if (typeof payload.runId === "string" && payload.runId !== runId) return;
      onReportRegeneratedRef.current();
    });

    return () => {
      source.close();
    };
    // Only re-run when the run id changes — callback identity is captured via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);
}
