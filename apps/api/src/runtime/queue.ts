import type { Prisma } from "@trycue/db";
import { appendInitialObservation, buildFeedObservation } from "./agentSessions.js";
import { PROMPT_VERSION_AGENT } from "../agents/promptVersions.js";

export async function getNextQueueSeq(tx: Prisma.TransactionClient, runId: string): Promise<bigint> {
  const result = await tx.agentJourney.aggregate({
    where: { runId },
    _max: { queueSeq: true }
  });
  return (result._max.queueSeq ?? 0n) + 1n;
}

export async function admitWaitingAudiences(
  tx: Prisma.TransactionClient,
  params: { runId: string; contentVersionId: string; limit: number }
): Promise<number> {
  if (params.limit <= 0) return 0;
  const audiences = await tx.runParticipant.findMany({
    where: {
      runId: params.runId,
      runtimeStatus: "ready"
    },
    orderBy: [{ samplingDirectiveId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    take: params.limit
  });
  if (!audiences.length) return 0;

  let queueSeq = await getNextQueueSeq(tx, params.runId);
  const [contentVersion, postState] = await Promise.all([
    tx.contentVersion.findUniqueOrThrow({ where: { id: params.contentVersionId } }),
    tx.simulatedPostState.findUniqueOrThrow({ where: { contentVersionId: params.contentVersionId } })
  ]);
  for (const audience of audiences) {
    const journey = await tx.agentJourney.create({
      data: {
        runId: params.runId,
        participantId: audience.id,
        actorUserId: audience.userId,
        platformAccountId: audience.platformAccountId,
        contentVersionId: params.contentVersionId,
        promptVersion: PROMPT_VERSION_AGENT,
        status: "active",
        runnerStatus: "queued",
        queueSeq,
        currentStepIndex: 0
      }
    });
    await appendInitialObservation(tx, journey.id, journey.runId, buildFeedObservation(contentVersion, postState) as Prisma.InputJsonValue);
    queueSeq += 1n;
  }

  await tx.runParticipant.updateMany({
    where: { id: { in: audiences.map((audience) => audience.id) } },
    data: { runtimeStatus: "queued" }
  });
  await tx.simulatedPostState.update({
    where: { contentVersionId: params.contentVersionId },
    data: { exposureCount: { increment: audiences.length } }
  });
  return audiences.length;
}
