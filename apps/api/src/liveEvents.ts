import { EventEmitter } from "node:events";
import type { Prisma } from "@trycue/db";
import { prisma } from "@trycue/db";
import type { LiveEventEnvelope, LiveEventType } from "@trycue/shared/live-events";

type StoredLiveEvent = {
  sequence: string;
  eventType: string;
  payload: LiveEventEnvelope;
};

const DURABLE_LIVE_EVENT_TYPES = new Set<LiveEventType>([
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
  "audience.profile.expansion.ready",
  "audience.profile.expansion.directive_started",
  "audience.profile.expansion.directive_ready",
  "audience.profile.expansion.directive_failed",
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
  "run.completed",
  "run_log.created",
  "report.regenerated"
]);

const liveEventBus = new EventEmitter();
liveEventBus.setMaxListeners(500);

export function onRunLiveEvent(runId: string, listener: (event: StoredLiveEvent) => void) {
  const eventName = `run:${runId}`;
  liveEventBus.on(eventName, listener);
  return () => liveEventBus.off(eventName, listener);
}

export function pushLiveEvent(runId: string, event: StoredLiveEvent) {
  liveEventBus.emit(`run:${runId}`, event);
}

export function encodeSse(event: StoredLiveEvent): string {
  return [
    `id: ${event.sequence}`,
    `event: ${event.eventType}`,
    `data: ${JSON.stringify(event.payload)}`,
    "",
    ""
  ].join("\n");
}

export async function recordLiveEvent(
  tx: Prisma.TransactionClient,
  input: {
    runId: string;
    eventType: LiveEventType;
    payload: Omit<LiveEventEnvelope, "eventId" | "type" | "runId" | "createdAt"> &
      Partial<Pick<LiveEventEnvelope, "type" | "runId" | "createdAt">>;
  }
): Promise<StoredLiveEvent> {
  assertDurableLiveEvent(input.eventType, input.payload);
  const created = await tx.liveEvent.create({
    data: {
      runId: input.runId,
      eventType: input.eventType,
      payload: {
        ...input.payload,
        eventId: "0",
        type: input.eventType,
        runId: input.runId,
        createdAt: new Date().toISOString()
      } as Prisma.InputJsonValue
    }
  });
  const sequence = created.sequence.toString();
  const payload = {
    ...(created.payload as object),
    ...input.payload,
    eventId: sequence,
    type: input.eventType,
    runId: input.runId,
    createdAt: created.createdAt.toISOString()
  } as LiveEventEnvelope;
  await tx.liveEvent.update({
    where: { sequence: created.sequence },
    data: { payload: payload as Prisma.InputJsonValue }
  });
  return { sequence, eventType: input.eventType, payload };
}

function assertDurableLiveEvent(eventType: LiveEventType, payload: Record<string, unknown>) {
  if (!DURABLE_LIVE_EVENT_TYPES.has(eventType)) {
    throw new Error(`Event type ${eventType} is not allowed in durable live_events.`);
  }
  if (eventType !== "audience.plan.frame") return;
  if (typeof payload.jobId !== "string" || !payload.jobId) {
    throw new Error("audience.plan.frame must include jobId.");
  }
  if (typeof payload.frameSeq !== "number" || !Number.isInteger(payload.frameSeq)) {
    throw new Error("audience.plan.frame must include integer frameSeq.");
  }
  const hasPlanId = typeof payload.planId === "string" && payload.planId.length > 0;
  const hasPreviewId = typeof payload.previewId === "string" && payload.previewId.length > 0;
  if (!hasPlanId && !hasPreviewId) {
    throw new Error("audience.plan.frame must include planId or previewId.");
  }
}

export async function listLiveEvents(runId: string, afterSequence?: string): Promise<StoredLiveEvent[]> {
  const sequence = afterSequence && /^\d+$/.test(afterSequence) ? BigInt(afterSequence) : undefined;
  const rows = await prisma.liveEvent.findMany({
    where: {
      runId,
      ...(sequence !== undefined ? { sequence: { gt: sequence } } : {})
    },
    orderBy: { sequence: "asc" }
  });
  return rows.map((row) => ({
    sequence: row.sequence.toString(),
    eventType: row.eventType,
    payload: row.payload as LiveEventEnvelope
  }));
}

export async function getLatestLiveEventSequence(runId: string): Promise<string | null> {
  const row = await prisma.liveEvent.findFirst({
    where: { runId },
    orderBy: { sequence: "desc" },
    select: { sequence: true }
  });
  return row ? row.sequence.toString() : null;
}
