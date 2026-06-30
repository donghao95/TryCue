import { prisma, type Prisma } from "@trycue/db";
import { MAX_COMMENT_LENGTH } from "@trycue/shared/tool";
import type { CommentItem, PostStateView } from "@trycue/shared/run";
import { ApiError } from "../errors.js";
import { recordLiveEvent, type StoredLiveEvent } from "../liveEvents.js";
import { listCommentPage, parseCommentSort } from "../runtime/comments.js";
import { requireSingleContentVersion } from "../runtime/contentVersions.js";
import { findDefaultHumanActor, getDefaultHumanActor } from "../runtime/identity.js";
import {
  createComment,
  ensurePostState,
  likeComment,
  openPost,
  setPostReaction,
  sharePost
} from "../runtime/interactions.js";
import { commentUpdatePatch, commentView, postStateView } from "../views.js";

/**
 * Returns the current human viewer's reaction state for a post.
 * Migrated from app.ts module-level private function.
 */
async function getPostViewerState(
  tx: Prisma.TransactionClient,
  contentVersionId: string,
  actor: { actorUserId: string; platformAccountId: string }
): Promise<{ likedByMe: boolean; favoritedByMe: boolean; sharedByMe: boolean }> {
  const [reactions, shareEvent] = await Promise.all([
    tx.socialReaction.findMany({
      where: {
        contentVersionId,
        actorUserId: actor.actorUserId,
        platformAccountId: actor.platformAccountId,
        targetType: "post",
        targetId: contentVersionId,
        reactionType: { in: ["like", "favorite"] },
        active: true
      },
      select: { reactionType: true }
    }),
    tx.socialInteractionEvent.findFirst({
      where: {
        contentVersionId,
        actorUserId: actor.actorUserId,
        platformAccountId: actor.platformAccountId,
        interactionType: "share_post",
        targetType: "post",
        targetId: contentVersionId
      },
      select: { id: true }
    })
  ]);
  const activeReactionTypes = new Set(reactions.map((reaction) => reaction.reactionType));
  return {
    likedByMe: activeReactionTypes.has("like"),
    favoritedByMe: activeReactionTypes.has("favorite"),
    sharedByMe: Boolean(shareEvent)
  };
}

// ── GET operations (no live events) ──

export async function getPostState(runId: string): Promise<{
  runId: string;
  contentVersionId: string;
  postState: PostStateView;
}> {
  const run = await prisma.testRun.findUnique({ where: { id: runId } });
  if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
  const content = await requireSingleContentVersion(prisma, runId);
  const state = await prisma.simulatedPostState.findUnique({ where: { contentVersionId: content.id } });
  if (!state) throw new ApiError("RUN_NOT_FOUND", "帖子状态不存在", 404);
  const actor = await findDefaultHumanActor(prisma);
  const viewerState = actor ? await getPostViewerState(prisma, content.id, actor) : {};
  return {
    runId,
    contentVersionId: state.contentVersionId,
    postState: postStateView(state, viewerState)
  };
}

export async function listComments(runId: string, params: {
  limit: number;
  cursor?: string;
  sort?: string;
}): Promise<{
  comments: CommentItem[];
  hasMore: boolean;
  nextCursor: string | null;
}> {
  const run = await prisma.testRun.findUnique({ where: { id: runId } });
  if (!run) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
  const content = await requireSingleContentVersion(prisma, runId);
  const page = await listCommentPage(prisma, {
    contentVersionId: content.id,
    limit: params.limit,
    cursor: params.cursor,
    sort: parseCommentSort(params.sort)
  });
  const audiences = await prisma.runParticipant.findMany({ where: { runId } });
  const audienceById = new Map(audiences.map((audience) => [audience.id, audience]));
  const actor = await findDefaultHumanActor(prisma);
  const commentIds = page.comments.map((comment) => comment.id);
  const likedCommentIds = actor && commentIds.length
    ? new Set((await prisma.socialReaction.findMany({
      where: {
        contentVersionId: content.id,
        actorUserId: actor.actorUserId,
        platformAccountId: actor.platformAccountId,
        targetType: "comment",
        targetId: { in: commentIds },
        reactionType: "like",
        active: true
      },
      select: { targetId: true }
    })).map((reaction) => reaction.targetId))
    : new Set<string>();
  return {
    comments: page.comments.map((comment) => commentView(
      comment,
      comment.participantId ? audienceById.get(comment.participantId) : undefined,
      { likedByMe: likedCommentIds.has(comment.id) }
    )),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor
  };
}

// ── POST operations (return events for the route layer to push) ──

export async function userOpenPost(runId: string): Promise<{
  postState: PostStateView;
  simulatedTime: number;
  events: StoredLiveEvent[];
}> {
  const result = await prisma.$transaction(async (tx) => {
    const content = await requireSingleContentVersion(tx, runId);
    const actor = await getDefaultHumanActor(tx);
    const opened = await openPost(tx, {
      runId,
      contentVersionId: content.id,
      actor
    });
    const event = await recordLiveEvent(tx, {
      runId,
      eventType: "post_state.updated",
      payload: {
        contentVersionId: content.id,
        simulatedTime: opened.simulatedTime,
        postState: postStateView(opened.postState)
      }
    });
    return { event, postState: opened.postState, simulatedTime: opened.simulatedTime };
  });
  return {
    postState: postStateView(result.postState),
    simulatedTime: result.simulatedTime,
    events: [result.event]
  };
}

export async function userSetLike(runId: string, active: boolean): Promise<{
  active: boolean;
  postState: PostStateView;
  simulatedTime: number;
  events: StoredLiveEvent[];
}> {
  return userSetPostReaction(runId, "like", active);
}

export async function userSetFavorite(runId: string, active: boolean): Promise<{
  active: boolean;
  postState: PostStateView;
  simulatedTime: number;
  events: StoredLiveEvent[];
}> {
  return userSetPostReaction(runId, "favorite", active);
}

async function userSetPostReaction(
  runId: string,
  reactionType: "like" | "favorite",
  active: boolean
): Promise<{
  active: boolean;
  postState: PostStateView;
  simulatedTime: number;
  events: StoredLiveEvent[];
}> {
  const result = await prisma.$transaction(async (tx) => {
    const content = await requireSingleContentVersion(tx, runId);
    await ensurePostState(tx, runId, content.id);
    const actor = await getDefaultHumanActor(tx);
    const reaction = await setPostReaction(tx, {
      runId,
      contentVersionId: content.id,
      actor,
      reactionType,
      active
    });
    const postState = await tx.simulatedPostState.findUniqueOrThrow({ where: { contentVersionId: content.id } });
    const viewerState = await getPostViewerState(tx, content.id, actor);
    const event = await recordLiveEvent(tx, {
      runId,
      eventType: "post_state.updated",
      payload: {
        contentVersionId: content.id,
        simulatedTime: reaction.simulatedTime,
        postState: postStateView(postState, viewerState)
      }
    });
    return { event, postState, viewerState, simulatedTime: reaction.simulatedTime, active: reaction.active };
  });
  return {
    active: result.active,
    postState: postStateView(result.postState, result.viewerState),
    simulatedTime: result.simulatedTime,
    events: [result.event]
  };
}

export async function userSharePost(runId: string): Promise<{
  postState: PostStateView;
  simulatedTime: number;
  events: StoredLiveEvent[];
}> {
  const result = await prisma.$transaction(async (tx) => {
    const content = await requireSingleContentVersion(tx, runId);
    await ensurePostState(tx, runId, content.id);
    const actor = await getDefaultHumanActor(tx);
    const shared = await sharePost(tx, { runId, contentVersionId: content.id, actor });
    const viewerState = await getPostViewerState(tx, content.id, actor);
    const event = await recordLiveEvent(tx, {
      runId,
      eventType: "post_state.updated",
      payload: {
        contentVersionId: content.id,
        simulatedTime: shared.simulatedTime,
        postState: postStateView(shared.postState, viewerState)
      }
    });
    return { event, postState: shared.postState, viewerState, simulatedTime: shared.simulatedTime };
  });
  return {
    postState: postStateView(result.postState, result.viewerState),
    simulatedTime: result.simulatedTime,
    events: [result.event]
  };
}

function validateCommentContent(contentText: string): void {
  if (!contentText) throw new ApiError("VALIDATION_ERROR", "评论内容不能为空", 400);
  if (contentText.length > MAX_COMMENT_LENGTH)
    throw new ApiError("VALIDATION_ERROR", `评论内容不能超过 ${MAX_COMMENT_LENGTH} 字`, 400);
}

export async function userCreateComment(runId: string, params: {
  content: string;
  parentCommentId?: string | null;
}): Promise<{
  comment: CommentItem;
  postState: PostStateView;
  simulatedTime: number;
  events: StoredLiveEvent[];
}> {
  const contentText = typeof params.content === "string" ? params.content.trim() : "";
  validateCommentContent(contentText);
  const result = await prisma.$transaction(async (tx) => {
    const content = await requireSingleContentVersion(tx, runId);
    await ensurePostState(tx, runId, content.id);
    const actor = await getDefaultHumanActor(tx);
    const created = await createComment(tx, {
      runId,
      contentVersionId: content.id,
      actor,
      content: contentText,
      parentCommentId: params.parentCommentId ?? null
    });
    const commentEvent = await recordLiveEvent(tx, {
      runId,
      eventType: "comment.created",
      payload: {
        contentVersionId: content.id,
        simulatedTime: created.simulatedTime,
        comment: commentView(created.comment)
      }
    });
    const parentCommentEvent = created.parentComment
      ? await recordLiveEvent(tx, {
        runId,
        eventType: "comment.updated",
        payload: {
          contentVersionId: content.id,
          simulatedTime: created.simulatedTime,
          commentId: created.parentComment.id,
          patch: commentUpdatePatch(created.parentComment)
        }
      })
      : null;
    const postEvent = await recordLiveEvent(tx, {
      runId,
      eventType: "post_state.updated",
      payload: {
        contentVersionId: content.id,
        simulatedTime: created.simulatedTime,
        postState: postStateView(created.postState)
      }
    });
    return {
      commentEvent,
      parentCommentEvent,
      postEvent,
      comment: created.comment,
      postState: created.postState,
      simulatedTime: created.simulatedTime
    };
  });
  const events = [result.commentEvent];
  if (result.parentCommentEvent) events.push(result.parentCommentEvent);
  events.push(result.postEvent);
  return {
    comment: commentView(result.comment),
    postState: postStateView(result.postState),
    simulatedTime: result.simulatedTime,
    events
  };
}

export async function userLikeComment(runId: string, commentId: string, active: boolean): Promise<{
  comment: CommentItem;
  simulatedTime: number;
  events: StoredLiveEvent[];
}> {
  if (!commentId) throw new ApiError("VALIDATION_ERROR", "评论 ID 缺失", 400);
  const result = await prisma.$transaction(async (tx) => {
    const content = await requireSingleContentVersion(tx, runId);
    const actor = await getDefaultHumanActor(tx);
    const liked = await likeComment(tx, {
      runId,
      contentVersionId: content.id,
      actor,
      commentId,
      active
    });
    const commentAudience = liked.comment.participantId
      ? await tx.runParticipant.findUnique({ where: { id: liked.comment.participantId } })
      : undefined;
    const event = await recordLiveEvent(tx, {
      runId,
      eventType: "comment.updated",
      payload: {
        contentVersionId: content.id,
        simulatedTime: liked.simulatedTime,
        commentId: liked.comment.id,
        patch: commentUpdatePatch(liked.comment)
      }
    });
    return {
      event,
      comment: commentView(liked.comment, commentAudience, { likedByMe: liked.active }),
      simulatedTime: liked.simulatedTime
    };
  });
  return {
    comment: result.comment,
    simulatedTime: result.simulatedTime,
    events: [result.event]
  };
}
