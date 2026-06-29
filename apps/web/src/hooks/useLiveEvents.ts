import { useEffect, useRef } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { LiveEventEnvelope, LiveEventType } from "@trycue/shared/live-events";
import type { AppRoute, UiStatus } from "../types.js";

/**
 * SSE connection status. The state is owned by the caller (App.tsx) so that
 * future consumers can read it; the hook only pushes updates via
 * `onConnectionStatusChange`.
 */
export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed";

/**
 * All SSE event types the workbench subscribes to. Kept in sync with
 * `assertLiveEventTypeExhaustive` in App.tsx — adding a new type there requires
 * adding it here (and vice versa).
 */
const LIVE_EVENT_TYPES: readonly LiveEventType[] = [
  "post_state.updated",
  "comments.page_loaded",
  "comment.created",
  "comment.updated",
  "action_log.created",
  "summary.updated",
  "insight.created",
  "audience.status_updated",
  "audience.action_happened",
  "audience.generation.job.started",
  "audience.generation.job.completed",
  "audience.generation.job.failed",
  "audience.generation.job.canceled",
  "audience.plan.started",
  "audience.plan.progress",
  "audience.plan.frame",
  "audience.plan.ready",
  "audience.plan.updated",
  "audience.plan.confirmed",
  "audience.plan.failed",
  "audience.profile.expansion.started",
  "audience.profile.expansion.directive_started",
  "audience.profile.expansion.directive_ready",
  "audience.profile.expansion.directive_failed",
  "audience.profile.expansion.ready",
  "audience.profile.created",
  "audience.identity.started",
  "audience.identity.ready",
  "audience.identity.failed",
  "audience.updated",
  "run.clock.updated",
  "run.started",
  "run.pausing",
  "run.paused",
  "run.resumed",
  "run_log.created",
  "run.completed"
];

export interface UseLiveEventsParams {
  /** Current run id; empty string when on the create page. */
  runId: string;
  /** Current route kind — SSE is only opened on the workbench route. */
  routeKind: AppRoute["kind"];
  /** Restored run id; SSE waits until restore completes before connecting. */
  restoredRunId: string | null;
  /** Ref to the latest uiStatus — SSE is not opened when status is "completed". */
  uiStatusRef: RefObject<UiStatus>;
  /** Ref to the latest durable event sequence — used to build the `?after=` replay param. */
  latestLiveEventSequenceRef: RefObject<string | null>;
  /** Callback for each parsed event; equivalent to the previous `handleLiveEvent`. */
  onEvent: (event: LiveEventEnvelope, sourceRunId: string) => void;
  /** Pushes connection status updates back to the caller's state. */
  onConnectionStatusChange: Dispatch<SetStateAction<ConnectionStatus>>;
  /** Called once when the first malformed SSE payload is observed. */
  onMalformed: () => void;
}

/**
 * Manages the EventSource lifecycle for a run's live event stream.
 *
 * Behavior preserved from the original inline useEffect in App.tsx:
 * - Opens only when `runId` is set, route is not "report", restore is done, and
 *   uiStatus is not "completed".
 * - On open, transitions from "idle" → "connecting" or any other status →
 *   "reconnecting".
 * - Subscribes to all `LIVE_EVENT_TYPES`; malformed JSON is reported once via
 *   `onMalformed`, then silently dropped.
 * - Reconnect uses `?after=<latestLiveEventSequence>` so durable events are
 *   replayed; ephemeral events (non-numeric ids) are not replayed.
 * - On cleanup, closes the source and transitions to "closed".
 */
export function useLiveEvents(params: UseLiveEventsParams): void {
  const {
    runId,
    routeKind,
    restoredRunId,
    uiStatusRef,
    latestLiveEventSequenceRef,
    onEvent,
    onConnectionStatusChange,
    onMalformed
  } = params;

  // Refs that capture the latest callbacks without bloating the effect dep
  // array. The effect must only re-run when the SSE connection identity
  // changes (runId / routeKind / restoredRunId), not when callbacks change.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onConnectionStatusChangeRef = useRef(onConnectionStatusChange);
  onConnectionStatusChangeRef.current = onConnectionStatusChange;
  const onMalformedRef = useRef(onMalformed);
  onMalformedRef.current = onMalformed;

  // Tracks whether we've already notified the user about malformed payloads —
  // avoids spamming toasts on repeated JSON parse failures.
  const malformedNotifiedRef = useRef(false);

  useEffect(() => {
    if (!runId || routeKind === "report" || restoredRunId !== runId || uiStatusRef.current === "completed") return;
    onConnectionStatusChangeRef.current((current) => (current === "idle" ? "connecting" : "reconnecting"));
    const sourceRunId = runId;
    const afterSeq = latestLiveEventSequenceRef.current;
    const sseUrl = afterSeq ? `/api/runs/${runId}/events?after=${encodeURIComponent(afterSeq)}` : `/api/runs/${runId}/events`;
    const source = new EventSource(sseUrl);
    source.onopen = () => onConnectionStatusChangeRef.current("connected");
    source.onerror = () => onConnectionStatusChangeRef.current("reconnecting");

    for (const eventType of LIVE_EVENT_TYPES) {
      source.addEventListener(eventType, (event) => {
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
        onEventRef.current(payload, sourceRunId);
      });
    }

    return () => {
      source.close();
      onConnectionStatusChangeRef.current("closed");
    };
    // Deliberately exclude callback/refs from deps — see onEventRef comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, routeKind, restoredRunId]);
}
