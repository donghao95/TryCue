import type { FastifyInstance } from "fastify";
import {
  CreateCommentRequestSchema,
  CreateReplyRequestSchema,
  LikeCommentRequestSchema,
  SetPostReactionRequestSchema
} from "@trycue/shared/api";
import { ApiError } from "../errors.js";
import { pushLiveEvent } from "../liveEvents.js";
import {
  getPostState,
  listComments,
  userCreateComment,
  userLikeComment,
  userOpenPost,
  userSetFavorite,
  userSetLike,
  userSharePost
} from "../services/postInteractionService.js";
import { getRunId, parseBody, parsePageQuery, wrapHandler } from "./routeHelpers.js";

/**
 * Registers all post interaction routes (human UI interactions with the simulated post).
 *
 * Routes migrated from app.ts:
 * - GET  /api/runs/:runId/post-state
 * - GET  /api/runs/:runId/comments
 * - POST /api/runs/:runId/post/open
 * - POST /api/runs/:runId/post/like
 * - POST /api/runs/:runId/post/favorite
 * - POST /api/runs/:runId/post/share
 * - POST /api/runs/:runId/comments
 * - POST /api/runs/:runId/comments/:commentId/replies
 * - POST /api/runs/:runId/comments/:commentId/like
 *
 * Event pushing pattern: the service records live events inside the transaction
 * and returns them; the route pushes them outside the transaction (same as the
 * original inline handlers).
 */
export async function postInteractionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/runs/:runId/post-state", wrapHandler(async (request) => {
    const runId = getRunId(request.params);
    return getPostState(runId);
  }));

  app.get("/api/runs/:runId/comments", wrapHandler(async (request) => {
    const runId = getRunId(request.params);
    const { limit } = parsePageQuery(request.query);
    const query = request.query as { sort?: string; order?: string; cursor?: string };
    return listComments(runId, {
      limit,
      cursor: query.cursor,
      sort: query.sort ?? (query.order === "latest" ? "latest" : query.order)
    });
  }));

  app.post("/api/runs/:runId/post/open", wrapHandler(async (request) => {
    const runId = getRunId(request.params);
    const result = await userOpenPost(runId);
    for (const event of result.events) pushLiveEvent(runId, event);
    return { postState: result.postState, simulatedTime: result.simulatedTime };
  }));

  app.post("/api/runs/:runId/post/like", wrapHandler(async (request) => {
    const runId = getRunId(request.params);
    const body = parseBody(SetPostReactionRequestSchema, request.body ?? {});
    const result = await userSetLike(runId, body.active ?? true);
    for (const event of result.events) pushLiveEvent(runId, event);
    return { active: result.active, postState: result.postState, simulatedTime: result.simulatedTime };
  }));

  app.post("/api/runs/:runId/post/favorite", wrapHandler(async (request) => {
    const runId = getRunId(request.params);
    const body = parseBody(SetPostReactionRequestSchema, request.body ?? {});
    const result = await userSetFavorite(runId, body.active ?? true);
    for (const event of result.events) pushLiveEvent(runId, event);
    return { active: result.active, postState: result.postState, simulatedTime: result.simulatedTime };
  }));

  app.post("/api/runs/:runId/post/share", wrapHandler(async (request) => {
    const runId = getRunId(request.params);
    const result = await userSharePost(runId);
    for (const event of result.events) pushLiveEvent(runId, event);
    return { postState: result.postState, simulatedTime: result.simulatedTime };
  }));

  app.post("/api/runs/:runId/comments", wrapHandler(async (request) => {
    const runId = getRunId(request.params);
    const body = parseBody(CreateCommentRequestSchema, request.body ?? {});
    const result = await userCreateComment(runId, {
      content: body.content,
      parentCommentId: body.parentCommentId ?? body.replyToCommentId
    });
    for (const event of result.events) pushLiveEvent(runId, event);
    return { comment: result.comment, postState: result.postState, simulatedTime: result.simulatedTime };
  }));

  app.post("/api/runs/:runId/comments/:commentId/replies", wrapHandler(async (request) => {
    const runId = getRunId(request.params);
    const commentId = (request.params as { commentId?: string }).commentId;
    if (!commentId) throw new ApiError("VALIDATION_ERROR", "评论 ID 缺失", 400);
    const body = parseBody(CreateReplyRequestSchema, request.body ?? {});
    const result = await userCreateComment(runId, {
      content: body.content,
      parentCommentId: commentId
    });
    for (const event of result.events) pushLiveEvent(runId, event);
    return { comment: result.comment, postState: result.postState, simulatedTime: result.simulatedTime };
  }));

  app.post("/api/runs/:runId/comments/:commentId/like", wrapHandler(async (request) => {
    const runId = getRunId(request.params);
    const commentId = (request.params as { commentId?: string }).commentId;
    if (!commentId) throw new ApiError("VALIDATION_ERROR", "评论 ID 缺失", 400);
    const body = parseBody(LikeCommentRequestSchema, request.body ?? {});
    const result = await userLikeComment(runId, commentId, body.active ?? true);
    for (const event of result.events) pushLiveEvent(runId, event);
    return { comment: result.comment, simulatedTime: result.simulatedTime };
  }));
}
