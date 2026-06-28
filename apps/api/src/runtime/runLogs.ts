import type { Prisma } from "@trycue/db";
import { recordLiveEvent } from "../liveEvents.js";
import { getRunSimulatedTime } from "./clock.js";

export async function createRunLogWithEvent(
  tx: Prisma.TransactionClient,
  input: {
    runId: string;
    logType: string;
    message: string;
    participantId?: string | null;
    actorUserId?: string | null;
    platformAccountId?: string | null;
    metadataJson?: Prisma.InputJsonValue;
    simulatedTime?: number;
  }
) {
  const simulatedTime = input.simulatedTime ?? await getRunSimulatedTime(tx, input.runId);
  const log = await tx.runLog.create({
    data: {
      runId: input.runId,
      logType: input.logType,
      message: input.message,
      participantId: input.participantId ?? undefined,
      actorUserId: input.actorUserId ?? undefined,
      platformAccountId: input.platformAccountId ?? undefined,
      metadataJson: input.metadataJson ?? {},
      simulatedTime
    }
  });
  return recordLiveEvent(tx, {
    runId: input.runId,
    eventType: "run_log.created",
    payload: {
      logId: log.id,
      logType: input.logType,
      message: input.message,
      participantId: input.participantId ?? undefined,
      simulatedTime,
      createdAt: log.createdAt.toISOString()
    }
  });
}
