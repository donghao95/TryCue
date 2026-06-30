import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@trycue/db";
import { fail } from "@trycue/shared/api";
import {
  encodeSse,
  listLiveEvents,
  onRunLiveEvent
} from "../liveEvents.js";
import { getRunId } from "./routeHelpers.js";

/**
 * Deps injected from buildApp.
 */
export interface LiveEventRoutesDeps {
  sseHeartbeatIntervalSeconds: number;
}

/**
 * Registers the SSE live events route.
 *
 * Routes migrated from app.ts:
 * - GET /api/runs/:runId/events
 *
 * This handler does NOT use `wrapHandler` because it directly manipulates
 * `reply.raw` (SSE stream): writes headers, replays history, subscribes to
 * live events, runs a heartbeat interval, and listens for `request.raw.close`.
 *
 * `liveOnly` semantics (PR13, must be preserved exactly):
 * - `liveOnly=true` skips the *initial* historical replay when no cursor is
 *   provided — used by subscribers that only need real-time updates (e.g. the
 *   report page's `useReportEvents` hook, which loads current state via REST
 *   on mount and only cares about future regenerations).
 * - On browser-driven reconnects EventSource re-sends `Last-Event-ID`, and
 *   the client may also pass `?after=`. In those cases we DO replay missed
 *   durable events from that cursor forward — otherwise events produced
 *   during the disconnect (e.g. a `report.regenerated`) would be permanently
 *   lost. So `liveOnly` only suppresses the no-cursor initial replay; it
 *   never suppresses cursor-driven replay.
 *
 * The guard `shouldReplay = !liveOnly || afterSequence !== undefined` is the
 * critical line — do NOT simplify to `if (!liveOnly)`.
 */
export function liveEventRoutes(deps: LiveEventRoutesDeps): FastifyPluginAsync {
  const { sseHeartbeatIntervalSeconds } = deps;
  return async (app) => {
    app.get("/api/runs/:runId/events", async (request, reply) => {
      const runId = getRunId(request.params);
      const run = await prisma.testRun.findUnique({ where: { id: runId } });
      if (!run) {
        return reply.status(404).send(fail("RUN_NOT_FOUND", "试映任务不存在"));
      }
      const lastEventId = request.headers["last-event-id"];
      const query = request.query as { after?: unknown; liveOnly?: unknown };
      const queryAfter = query.after;
      const liveOnly = typeof query.liveOnly === "string" && query.liveOnly === "true";
      const afterSequence = Array.isArray(lastEventId)
        ? lastEventId[0] || (typeof queryAfter === "string" ? queryAfter : undefined)
        : lastEventId || (typeof queryAfter === "string" ? queryAfter : undefined);
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      const shouldReplay = !liveOnly || afterSequence !== undefined;
      if (shouldReplay) {
        for (const event of await listLiveEvents(runId, afterSequence)) {
          reply.raw.write(encodeSse(event));
        }
      }
      let destroyed = false;
      const safeWrite = (data: string) => {
        if (destroyed) return;
        try { reply.raw.write(data); } catch { /* stream already closed */ }
      };
      const off = onRunLiveEvent(runId, (event) => safeWrite(encodeSse(event)));
      const heartbeat = setInterval(() => {
        safeWrite(`event: heartbeat\ndata: ${JSON.stringify({ now: new Date().toISOString() })}\n\n`);
      }, sseHeartbeatIntervalSeconds * 1000);
      request.raw.on("close", () => {
        destroyed = true;
        clearInterval(heartbeat);
        off();
        reply.raw.end();
      });
    });
  };
}
