/**
 * API envelope 契约：所有 API response 都使用 ApiResponse<T>，
 * 后端使用 ok()/fail() 构造，前端通过 success 字段做窄化。
 */

import { z } from "zod";
import { MAX_COMMENT_LENGTH } from "./tool.js";

export type ApiSuccess<T> = {
  success: true;
  data: T;
};

export type ApiFailure = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function ok<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

export function fail(code: string, message: string, details?: unknown): ApiFailure {
  return { success: false, error: { code, message, details } };
}

// ── Post interaction request schemas ──
// 这些 schema 用于校验前端用户（human UI）对模拟帖子的交互请求 body。
// 与 tool.ts 里的 *ArgsSchema（Agent 工具参数）分开，因为语义不同：
// 工具参数含 postId/intent 等 Agent 决策字段；用户交互只有 active/content 等用户输入。

/** POST /api/runs/:runId/post/like | /favorite body */
export const SetPostReactionRequestSchema = z.object({
  active: z.boolean().optional()
}).strict();

/** POST /api/runs/:runId/comments body */
export const CreateCommentRequestSchema = z.object({
  content: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
  parentCommentId: z.string().trim().min(1).nullable().optional(),
  replyToCommentId: z.string().trim().min(1).nullable().optional()
}).strict();

/** POST /api/runs/:runId/comments/:commentId/replies body */
export const CreateReplyRequestSchema = z.object({
  content: z.string().trim().min(1).max(MAX_COMMENT_LENGTH)
}).strict();

/** POST /api/runs/:runId/comments/:commentId/like body */
export const LikeCommentRequestSchema = z.object({
  active: z.boolean().optional()
}).strict();
