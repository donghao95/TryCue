import type { Prisma, TestRun } from "@trycue/db";
import type { RunClockSnapshot, RunStatus } from "@trycue/shared/run";
import type { RunClockUpdateReason } from "@trycue/shared/live-events";
import { recordLiveEvent } from "../liveEvents.js";

type RunClock = Pick<TestRun, "clockElapsedMs" | "clockAnchorAt" | "clockScale">;

export function getSimulatedElapsedMs(run: RunClock, now = new Date()): number {
  const accumulated = Math.max(0, run.clockElapsedMs);
  if (!run.clockAnchorAt) return accumulated;
  const delta = Math.max(0, now.getTime() - run.clockAnchorAt.getTime());
  return accumulated + delta * run.clockScale;
}

export function getSimulatedTime(run: RunClock, now = new Date()): number {
  return Math.floor(getSimulatedElapsedMs(run, now) / 1000);
}

export async function getRunSimulatedTime(tx: Prisma.TransactionClient, runId: string, now = new Date()): Promise<number> {
  const run = await tx.testRun.findUniqueOrThrow({
    where: { id: runId },
    select: { clockElapsedMs: true, clockAnchorAt: true, clockScale: true }
  });
  return getSimulatedTime(run, now);
}

export function freezeRunClockData(run: RunClock, now = new Date()) {
  return {
    clockElapsedMs: getSimulatedElapsedMs(run, now),
    clockAnchorAt: null
  };
}

export function runClockSnapshot(run: RunClock, now = new Date()): RunClockSnapshot {
  return {
    serverNow: now.toISOString(),
    clockElapsedMs: getSimulatedElapsedMs(run, now),
    clockAnchorAt: run.clockAnchorAt?.toISOString() ?? null,
    clockScale: run.clockScale
  };
}

export async function recordRunClockUpdatedEvent(
  tx: Prisma.TransactionClient,
  input: {
    runId: string;
    reason: RunClockUpdateReason;
    status: RunStatus;
    run: RunClock;
    now?: Date;
  }
) {
  return recordLiveEvent(tx, {
    runId: input.runId,
    eventType: "run.clock.updated",
    payload: {
      reason: input.reason,
      status: input.status,
      clock: runClockSnapshot(input.run, input.now)
    }
  });
}
