import { Prisma, type AgentJourney, type RunParticipant, type SocialReactionType } from "@trycue/db";
import { ApiError } from "../errors.js";
import { getRunSimulatedTime } from "./clock.js";
import { listCommentPage, type CommentSort } from "./comments.js";

export type ActorContext = {
  actorUserId: string;
  platformAccountId: string;
  participantId?: string;
  agentId?: string;
  source: "agent_tool" | "human_ui" | "system_seed" | "replay";
};

type InteractionContext = {
  participant?: RunParticipant;
  journey?: AgentJourney;
};

export async function ensurePostState(tx: Prisma.TransactionClient, runId: string, contentVersionId: string) {
  await assertContentVersionInRun(tx, runId, contentVersionId);
  return tx.simulatedPostState.upsert({
    where: { contentVersionId },
    create: { contentVersionId },
    update: {}
  });
}

export async function recordInteractionEvent(
  tx: Prisma.TransactionClient,
  params: {
    runId: string;
    contentVersionId: string;
    actor: ActorContext;
    interactionType: string;
    targetType?: "post" | "comment";
    targetId?: string;
    journeyId?: string;
    journeyActionId?: string;
    toolCallId?: string;
    cursor?: string | null;
    simulatedTime?: number;
  }
) {
  await resolveInteractionContext(tx, params);
  const simulatedTime = params.simulatedTime ?? await getRunSimulatedTime(tx, params.runId);
  return tx.socialInteractionEvent.create({
    data: {
      contentVersionId: params.contentVersionId,
      actorUserId: params.actor.actorUserId,
      platformAccountId: params.actor.platformAccountId,
      participantId: params.actor.participantId,
      agentId: params.actor.agentId,
      source: params.actor.source,
      journeyId: params.journeyId,
      journeyActionId: params.journeyActionId,
      toolCallId: params.toolCallId,
      interactionType: params.interactionType,
      targetType: params.targetType,
      targetId: params.targetId,
      cursor: params.cursor ?? undefined,
      simulatedTime
    }
  });
}

export async function openPost(
  tx: Prisma.TransactionClient,
  params: {
    runId: string;
    contentVersionId: string;
    actor: ActorContext;
    journeyId?: string;
    journeyActionId?: string;
    toolCallId?: string;
    simulatedTime?: number;
  }
) {
  const context = await resolveInteractionContext(tx, params);
  const simulatedTime = params.simulatedTime ?? await getRunSimulatedTime(tx, params.runId);
  await ensurePostState(tx, params.runId, params.contentVersionId);
  const existingOpen = await tx.socialInteractionEvent.findFirst({
    where: {
      contentVersionId: params.contentVersionId,
      actorUserId: params.actor.actorUserId,
      platformAccountId: params.actor.platformAccountId,
      interactionType: "open_post",
      targetType: "post",
      targetId: params.contentVersionId
    }
  });
  const postState = existingOpen
    ? await tx.simulatedPostState.findUniqueOrThrow({
        where: { contentVersionId: params.contentVersionId }
      })
    : await tx.simulatedPostState.update({
        where: { contentVersionId: params.contentVersionId },
        data: { openCount: { increment: 1 } }
      });
  await recordInteractionEvent(tx, {
    ...params,
    interactionType: "open_post",
    targetType: "post",
    targetId: params.contentVersionId,
    simulatedTime
  });
  return { postState, journey: context.journey, simulatedTime, changed: !existingOpen, reason: existingOpen ? "already_opened" : undefined };
}

/**
 * Record a "read but not interact" behavior. Does NOT modify any post state
 * counters (openCount/likeCount/favoriteCount/commentCount/shareCount/exitCount).
 * Only writes a social_interaction_events row so the reading behavior is
 * observable by the report layer and front-end. See docs/features "read_post".
 */
export async function readPost(
  tx: Prisma.TransactionClient,
  params: {
    runId: string;
    contentVersionId: string;
    actor: ActorContext;
    depth: "skim" | "partial" | "full";
    focus?: string[];
    journeyId?: string;
    journeyActionId?: string;
    toolCallId?: string;
    simulatedTime?: number;
  }
) {
  const context = await resolveInteractionContext(tx, params);
  const simulatedTime = params.simulatedTime ?? await getRunSimulatedTime(tx, params.runId);
  await ensurePostState(tx, params.runId, params.contentVersionId);
  await recordInteractionEvent(tx, {
    runId: params.runId,
    contentVersionId: params.contentVersionId,
    actor: params.actor,
    interactionType: "read_post",
    targetType: "post",
    targetId: params.contentVersionId,
    journeyId: params.journeyId,
    journeyActionId: params.journeyActionId,
    toolCallId: params.toolCallId,
    simulatedTime
  });
  return { journey: context.journey, simulatedTime, depth: params.depth, focus: params.focus ?? [] };
}

export async function viewComments(
  tx: Prisma.TransactionClient,
  params: {
    runId: string;
    contentVersionId: string;
    actor: ActorContext;
    cursor?: string | null;
    sort: CommentSort;
    limit: number;
    journeyId?: string;
    journeyActionId?: string;
    toolCallId?: string;
    simulatedTime?: number;
  }
) {
  const context = await resolveInteractionContext(tx, params);
  const simulatedTime = params.simulatedTime ?? await getRunSimulatedTime(tx, params.runId);
  const page = await listCommentPage(tx, {
    contentVersionId: params.contentVersionId,
    limit: params.limit,
    cursor: params.cursor,
    sort: params.sort
  });
  await recordInteractionEvent(tx, {
    ...params,
    interactionType: "view_comments",
    cursor: params.cursor ?? null,
    simulatedTime
  });
  if (params.actor.source === "agent_tool") {
    await tx.loadedCommentPage.create({
      data: {
        contentVersionId: params.contentVersionId,
        participantId: params.actor.participantId,
        actorUserId: params.actor.actorUserId,
        platformAccountId: params.actor.platformAccountId,
        source: params.actor.source,
        journeyId: params.journeyId,
        journeyActionId: params.journeyActionId,
        toolCallId: params.toolCallId,
        cursor: params.cursor ?? "",
        nextCursor: page.nextCursor,
        sort: params.sort,
        commentIdsJson: page.comments.map((comment) => comment.id),
        hasMore: page.hasMore,
        simulatedTime
      }
    });
  }
  return { page, journey: context.journey, simulatedTime };
}

export async function setPostReaction(
  tx: Prisma.TransactionClient,
  params: {
    runId: string;
    contentVersionId: string;
    actor: ActorContext;
    reactionType: SocialReactionType;
    active?: boolean;
    journeyId?: string;
    journeyActionId?: string;
    toolCallId?: string;
    simulatedTime?: number;
  }
) {
  await resolveInteractionContext(tx, params);
  await ensurePostState(tx, params.runId, params.contentVersionId);
  const active = params.active ?? true;
  const simulatedTime = params.simulatedTime ?? await getRunSimulatedTime(tx, params.runId);
  const key = {
    contentVersionId: params.contentVersionId,
    actorUserId: params.actor.actorUserId,
    platformAccountId: params.actor.platformAccountId,
    targetType: "post" as const,
    targetId: params.contentVersionId,
    reactionType: params.reactionType
  };
  const existing = await tx.socialReaction.findUnique({
    where: { contentVersionId_actorUserId_platformAccountId_targetType_targetId_reactionType: key }
  });
  const oldActive = existing?.active ?? false;
  const delta = Number(active) - Number(oldActive);
  const reaction = active || existing
    ? await tx.socialReaction.upsert({
        where: { contentVersionId_actorUserId_platformAccountId_targetType_targetId_reactionType: key },
        create: {
          contentVersionId: params.contentVersionId,
          actorUserId: params.actor.actorUserId,
          platformAccountId: params.actor.platformAccountId,
          participantId: params.actor.participantId,
          agentId: params.actor.agentId,
          source: params.actor.source,
          targetType: "post",
          targetId: params.contentVersionId,
          reactionType: params.reactionType,
          active,
          simulatedTime
        },
        update: {
          participantId: params.actor.participantId,
          agentId: params.actor.agentId,
          source: params.actor.source,
          active,
          simulatedTime
        }
      })
    : null;
  await applyPostReactionDelta(tx, params.contentVersionId, params.reactionType, delta);
  if (active && delta > 0) {
    await recordInteractionEvent(tx, {
      runId: params.runId,
      contentVersionId: params.contentVersionId,
      actor: params.actor,
      interactionType: params.reactionType === "like" ? "like_post" : "favorite_post",
      targetType: "post",
      targetId: params.contentVersionId,
      journeyId: params.journeyId,
      journeyActionId: params.journeyActionId,
      toolCallId: params.toolCallId,
      simulatedTime
    });
  }
  return { reaction, changed: delta !== 0, active, delta, simulatedTime };
}

export async function sharePost(
  tx: Prisma.TransactionClient,
  params: {
    runId: string;
    contentVersionId: string;
    actor: ActorContext;
    journeyId?: string;
    journeyActionId?: string;
    toolCallId?: string;
    simulatedTime?: number;
  }
) {
  await resolveInteractionContext(tx, params);
  await ensurePostState(tx, params.runId, params.contentVersionId);
  const simulatedTime = params.simulatedTime ?? await getRunSimulatedTime(tx, params.runId);
  const existingShare = await tx.socialInteractionEvent.findFirst({
    where: {
      contentVersionId: params.contentVersionId,
      actorUserId: params.actor.actorUserId,
      platformAccountId: params.actor.platformAccountId,
      interactionType: "share_post",
      targetType: "post",
      targetId: params.contentVersionId
    }
  });
  if (existingShare) {
    const postState = await tx.simulatedPostState.findUniqueOrThrow({
      where: { contentVersionId: params.contentVersionId }
    });
    return { postState, simulatedTime, changed: false, active: true };
  }
  const postState = await tx.simulatedPostState.update({
    where: { contentVersionId: params.contentVersionId },
    data: { shareCount: { increment: 1 } }
  });
  await recordInteractionEvent(tx, {
    runId: params.runId,
    contentVersionId: params.contentVersionId,
    actor: params.actor,
    interactionType: "share_post",
    targetType: "post",
    targetId: params.contentVersionId,
    journeyId: params.journeyId,
    journeyActionId: params.journeyActionId,
    toolCallId: params.toolCallId,
    simulatedTime
  });
  return { postState, simulatedTime, changed: true, active: true };
}

export async function createComment(
  tx: Prisma.TransactionClient,
  params: {
    runId: string;
    contentVersionId: string;
    actor: ActorContext;
    content: string;
    parentCommentId?: string | null;
    journeyId?: string;
    journeyActionId?: string;
    toolCallId?: string;
    simulatedTime?: number;
  }
) {
  await resolveInteractionContext(tx, params);
  await ensurePostState(tx, params.runId, params.contentVersionId);
  const simulatedTime = params.simulatedTime ?? await getRunSimulatedTime(tx, params.runId);
  const parent = params.parentCommentId
    ? await findCommentInContent(tx, params.runId, params.contentVersionId, params.parentCommentId)
    : null;
  if (params.parentCommentId && !parent) {
    throw new ApiError("PARENT_COMMENT_NOT_FOUND", "回复目标评论不存在", 404);
  }
  const comment = await tx.simulatedComment.create({
    data: {
      contentVersionId: params.contentVersionId,
      actorUserId: params.actor.actorUserId,
      platformAccountId: params.actor.platformAccountId,
      participantId: params.actor.participantId,
      agentId: params.actor.agentId,
      source: params.actor.source,
      journeyId: params.journeyId,
      journeyActionId: params.journeyActionId,
      toolCallId: params.toolCallId,
      parentCommentId: params.parentCommentId ?? null,
      rootCommentId: parent?.rootCommentId ?? parent?.id ?? null,
      commentText: params.content,
      mentionedUserIdsJson: [],
      mentionedCommentIdsJson: [],
      simulatedTime
    }
  });
  const fixed = comment.rootCommentId ? comment : await tx.simulatedComment.update({ where: { id: comment.id }, data: { rootCommentId: comment.id } });
  const parentComment = parent
    ? await tx.simulatedComment.update({ where: { id: parent.id }, data: { replyCount: { increment: 1 } } })
    : null;
  const postState = await tx.simulatedPostState.update({
    where: { contentVersionId: params.contentVersionId },
    data: { commentCount: { increment: 1 } }
  });
  await recordInteractionEvent(tx, {
    runId: params.runId,
    contentVersionId: params.contentVersionId,
    actor: params.actor,
    interactionType: "write_comment",
    targetType: parent ? "comment" : "post",
    targetId: parent?.id ?? params.contentVersionId,
    journeyId: params.journeyId,
    journeyActionId: params.journeyActionId,
    toolCallId: params.toolCallId,
    simulatedTime
  });
  return { comment: fixed, parentComment, postState, simulatedTime };
}

export async function likeComment(
  tx: Prisma.TransactionClient,
  params: {
    runId: string;
    contentVersionId: string;
    actor: ActorContext;
    commentId: string;
    active?: boolean;
    journeyId?: string;
    journeyActionId?: string;
    toolCallId?: string;
    simulatedTime?: number;
  }
) {
  await resolveInteractionContext(tx, params);
  const targetComment = await findCommentInContent(tx, params.runId, params.contentVersionId, params.commentId);
  if (!targetComment) throw new ApiError("TARGET_COMMENT_NOT_FOUND", "评论不存在", 404);
  const active = params.active ?? true;
  const simulatedTime = params.simulatedTime ?? await getRunSimulatedTime(tx, params.runId);
  const key = {
    contentVersionId: params.contentVersionId,
    actorUserId: params.actor.actorUserId,
    platformAccountId: params.actor.platformAccountId,
    targetType: "comment" as const,
    targetId: params.commentId,
    reactionType: "like" as const
  };
  const existing = await tx.socialReaction.findUnique({
    where: { contentVersionId_actorUserId_platformAccountId_targetType_targetId_reactionType: key }
  });
  const oldActive = existing?.active ?? false;
  const delta = Number(active) - Number(oldActive);
  if (active || existing) {
    await tx.socialReaction.upsert({
      where: { contentVersionId_actorUserId_platformAccountId_targetType_targetId_reactionType: key },
      create: {
        contentVersionId: params.contentVersionId,
        actorUserId: params.actor.actorUserId,
        platformAccountId: params.actor.platformAccountId,
        participantId: params.actor.participantId,
        agentId: params.actor.agentId,
        source: params.actor.source,
        targetType: "comment",
        targetId: params.commentId,
        reactionType: "like",
        active,
        simulatedTime
      },
      update: {
        participantId: params.actor.participantId,
        agentId: params.actor.agentId,
        active,
        source: params.actor.source,
        simulatedTime
      }
    });
  }
  const comment = await applyCommentLikeDelta(tx, params.commentId, delta);
  if (active && delta > 0) {
    await recordInteractionEvent(tx, {
      runId: params.runId,
      contentVersionId: params.contentVersionId,
      actor: params.actor,
      interactionType: "like_comment",
      targetType: "comment",
      targetId: params.commentId,
      journeyId: params.journeyId,
      journeyActionId: params.journeyActionId,
      toolCallId: params.toolCallId,
      simulatedTime
    });
  }
  return { comment, changed: delta !== 0, active, delta, simulatedTime };
}

export async function exitBrowsing(
  tx: Prisma.TransactionClient,
  params: {
    runId: string;
    contentVersionId: string;
    actor: ActorContext;
    exitOutcome: "skipped" | "browsed_and_left" | "risk_exit" | "max_steps";
    exitReason: string;
    journeyId: string;
    journeyActionId?: string;
    toolCallId?: string;
    simulatedTime?: number;
  }
) {
  const context = await resolveInteractionContext(tx, params);
  if (!params.actor.participantId || !context.participant || !context.journey) {
    throw new ApiError("TOOL_CONTEXT_MISMATCH", "结束浏览需要有效的观众与 journey", 409);
  }
  await ensurePostState(tx, params.runId, params.contentVersionId);
  const simulatedTime = params.simulatedTime ?? await getRunSimulatedTime(tx, params.runId);
  if (context.journey.status !== "active") {
    const postState = await tx.simulatedPostState.findUniqueOrThrow({
      where: { contentVersionId: params.contentVersionId }
    });
    return { postState, journey: context.journey, participant: context.participant, simulatedTime, changed: false, reason: "journey_already_finished" };
  }
  const postState = await tx.simulatedPostState.update({
    where: { contentVersionId: params.contentVersionId },
    data: { exitCount: { increment: 1 } }
  });
  const journey = await tx.agentJourney.update({
    where: { id: context.journey.id },
    data: {
      status: "finished",
      finalSummary: params.exitReason,
      exitOutcome: params.exitOutcome,
      exitReason: params.exitReason,
      completedAt: new Date()
    }
  });
  const participant = await tx.runParticipant.update({
    where: { id: context.participant.id },
    data: { runtimeStatus: params.exitOutcome === "skipped" ? "skipped" : "finished" }
  });
  await recordInteractionEvent(tx, {
    runId: params.runId,
    contentVersionId: params.contentVersionId,
    actor: params.actor,
    interactionType: "exit_browsing",
    targetType: "post",
    targetId: params.contentVersionId,
    journeyId: params.journeyId,
    journeyActionId: params.journeyActionId,
    toolCallId: params.toolCallId,
    simulatedTime
  });
  return { postState, journey, participant, simulatedTime, changed: true };
}

async function resolveInteractionContext(
  tx: Prisma.TransactionClient,
  params: {
    runId: string;
    contentVersionId: string;
    actor: ActorContext;
    journeyId?: string;
    journeyActionId?: string;
    toolCallId?: string;
  }
): Promise<InteractionContext> {
  await assertContentVersionInRun(tx, params.runId, params.contentVersionId);
  const participant = await assertActorInRun(tx, params.runId, params.actor);
  const journey = params.journeyId
    ? await tx.agentJourney.findFirst({
        where: {
          id: params.journeyId,
          runId: params.runId,
          contentVersionId: params.contentVersionId,
          actorUserId: params.actor.actorUserId,
          platformAccountId: params.actor.platformAccountId,
          ...(params.actor.participantId ? { participantId: params.actor.participantId } : {})
        }
      })
    : undefined;
  if (params.journeyId && !journey) throw new ApiError("JOURNEY_RUN_MISMATCH", "journey 不属于当前 run 或 actor", 409);
  if (params.journeyActionId) {
    const action = await tx.agentTurn.findFirst({
      where: {
        id: params.journeyActionId,
        runId: params.runId,
        contentVersionId: params.contentVersionId,
        actorUserId: params.actor.actorUserId,
        platformAccountId: params.actor.platformAccountId,
        ...(params.actor.participantId ? { participantId: params.actor.participantId } : {}),
        ...(params.journeyId ? { journeyId: params.journeyId } : {})
      }
    });
    if (!action) throw new ApiError("TOOL_CONTEXT_MISMATCH", "journey action 不属于当前 run 或 actor", 409);
  }
  if (params.toolCallId) {
    const toolCall = await tx.agentToolCall.findFirst({
      where: {
        id: params.toolCallId,
        runId: params.runId,
        contentVersionId: params.contentVersionId,
        actorUserId: params.actor.actorUserId,
        platformAccountId: params.actor.platformAccountId,
        ...(params.actor.participantId ? { participantId: params.actor.participantId } : {}),
        ...(params.journeyId ? { journeyId: params.journeyId } : {}),
        ...(params.journeyActionId ? { agentTurnId: params.journeyActionId } : {})
      }
    });
    if (!toolCall) throw new ApiError("TOOL_CONTEXT_MISMATCH", "tool call 不属于当前 run 或 actor", 409);
  }
  return { participant, journey: journey ?? undefined };
}

async function assertContentVersionInRun(tx: Prisma.TransactionClient, runId: string, contentVersionId: string) {
  const content = await tx.contentVersion.findFirst({ where: { id: contentVersionId, runId }, select: { id: true } });
  if (!content) throw new ApiError("CONTENT_NOT_FOUND", "内容版本不存在或不属于当前 run", 404);
}

async function assertActorInRun(tx: Prisma.TransactionClient, runId: string, actor: ActorContext) {
  if (!actor.participantId) return undefined;
  const participant = await tx.runParticipant.findFirst({ where: { id: actor.participantId, runId } });
  if (!participant) throw new ApiError("ACTOR_RUN_MISMATCH", "行为主体不属于当前 run", 409);
  if (
    participant.userId !== actor.actorUserId ||
    participant.platformAccountId !== actor.platformAccountId ||
    (actor.agentId && participant.agentId !== actor.agentId)
  ) {
    throw new ApiError("ACTOR_RUN_MISMATCH", "行为主体身份与 run participant 不一致", 409);
  }
  return participant;
}

async function findCommentInContent(tx: Prisma.TransactionClient, runId: string, contentVersionId: string, commentId: string) {
  await assertContentVersionInRun(tx, runId, contentVersionId);
  return tx.simulatedComment.findFirst({ where: { id: commentId, contentVersionId } });
}

async function applyPostReactionDelta(
  tx: Prisma.TransactionClient,
  contentVersionId: string,
  reactionType: SocialReactionType,
  delta: number
) {
  if (delta === 0) return;
  const countField = reactionType === "like" ? "likeCount" : "favoriteCount";
  const data = countField === "likeCount"
    ? { likeCount: { increment: delta } }
    : { favoriteCount: { increment: delta } };
  if (delta > 0) {
    await tx.simulatedPostState.update({
      where: { contentVersionId },
      data
    });
    return;
  }
  const where = countField === "likeCount"
    ? { contentVersionId, likeCount: { gt: 0 } }
    : { contentVersionId, favoriteCount: { gt: 0 } };
  await tx.simulatedPostState.updateMany({ where, data });
}

async function applyCommentLikeDelta(tx: Prisma.TransactionClient, commentId: string, delta: number) {
  if (delta > 0) {
    return tx.simulatedComment.update({ where: { id: commentId }, data: { likeCount: { increment: 1 } } });
  }
  if (delta < 0) {
    const updated = await tx.simulatedComment.updateMany({
      where: { id: commentId, likeCount: { gt: 0 } },
      data: { likeCount: { increment: -1 } }
    });
    if (updated.count > 0) return tx.simulatedComment.findUniqueOrThrow({ where: { id: commentId } });
  }
  return tx.simulatedComment.findUniqueOrThrow({ where: { id: commentId } });
}
