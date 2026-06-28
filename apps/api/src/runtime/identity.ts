import type { Prisma } from "@trycue/db";

export type ActorIdentity = {
  userId: string;
  agentId?: string;
  platformAccountId: string;
};

export async function createAgentIdentity(
  tx: Prisma.TransactionClient,
  params: {
    displayName: string;
    avatarUrl?: string | null;
    personaJson?: Prisma.InputJsonValue;
    originRunId?: string;
    sourceProfileId?: string;
  }
): Promise<Required<ActorIdentity>> {
  const retentionPolicy = params.originRunId ? "delete_with_origin_run" : "retain";
  const user = await tx.user.create({
    data: {
      userType: "agent",
      nickname: params.displayName,
      avatarUrl: params.avatarUrl
    }
  });
  const agent = await tx.agent.create({
    data: {
      userId: user.id,
      originRunId: params.originRunId,
      sourceProfileId: params.sourceProfileId,
      retentionPolicy,
      personaJson: params.personaJson ?? {}
    }
  });
  const platformAccount = await tx.platformAccount.create({
    data: {
      userId: user.id,
      platform: "xiaohongshu"
    }
  });
  return { userId: user.id, agentId: agent.id, platformAccountId: platformAccount.id };
}

export function actorFromParticipant(participant: {
  id: string;
  userId: string;
  agentId: string | null;
  platformAccountId: string;
}) {
  return {
    participantId: participant.id,
    actorUserId: participant.userId,
    agentId: participant.agentId ?? undefined,
    platformAccountId: participant.platformAccountId,
    source: "agent_tool" as const
  };
}

export async function getDefaultHumanActor(tx: Prisma.TransactionClient) {
  let user = await tx.user.findFirst({ where: { userType: "human", nickname: "前端用户" } });
  user ??= await tx.user.create({
    data: {
      userType: "human",
      nickname: "前端用户"
    }
  });
  let platformAccount = await tx.platformAccount.findUnique({
    where: {
      userId_platform: {
        userId: user.id,
        platform: "xiaohongshu"
      }
    }
  });
  platformAccount ??= await tx.platformAccount.create({
    data: {
      userId: user.id,
      platform: "xiaohongshu"
    }
  });
  return {
    actorUserId: user.id,
    platformAccountId: platformAccount.id,
    source: "human_ui" as const
  };
}

export async function findDefaultHumanActor(tx: Prisma.TransactionClient) {
  const user = await tx.user.findFirst({ where: { userType: "human", nickname: "前端用户" } });
  if (!user) return null;
  const platformAccount = await tx.platformAccount.findUnique({
    where: {
      userId_platform: {
        userId: user.id,
        platform: "xiaohongshu"
      }
    }
  });
  if (!platformAccount) return null;
  return {
    actorUserId: user.id,
    platformAccountId: platformAccount.id,
    source: "human_ui" as const
  };
}
