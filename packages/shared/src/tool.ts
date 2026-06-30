import { z, toJSONSchema } from "zod";

// ── 工具名 ──

export const ToolNameSchema = z.enum([
  "open_post",
  "read_post",
  "view_comments",
  "like_post",
  "favorite_post",
  "share_post",
  "write_comment",
  "like_comment",
  "exit_browsing"
]);
export type ToolName = z.infer<typeof ToolNameSchema>;

// ── read_post / exit_browsing / write_comment structured enums ──

export const ReadDepthSchema = z.enum(["skim", "partial", "full"]);
export type ReadDepth = z.infer<typeof ReadDepthSchema>;

export const ExitReasonCategorySchema = z.enum([
  "not_relevant",
  "not_interested",
  "low_trust",
  "too_ad_like",
  "content_too_long",
  "need_more_evidence",
  "finished_normally",
  "no_more_action"
]);
export type ExitReasonCategory = z.infer<typeof ExitReasonCategorySchema>;

export const ExitReadingDepthSchema = z.enum(["feed_only", "skimmed", "partial", "full"]);
export type ExitReadingDepth = z.infer<typeof ExitReadingDepthSchema>;

export const InterestTrustLevelSchema = z.enum(["low", "medium", "high"]);
export type InterestTrustLevel = z.infer<typeof InterestTrustLevelSchema>;

export const CommentIntentSchema = z.enum([
  "ask",
  "doubt",
  "share_experience",
  "agree",
  "joke",
  "pushback"
]);
export type CommentIntent = z.infer<typeof CommentIntentSchema>;

export const ToolCategorySchema = z.enum(["navigation", "interaction"]);
export type ToolCategory = z.infer<typeof ToolCategorySchema>;

// ── 工具参数 schema ──

/** Max character length for user/audience comments */
export const MAX_COMMENT_LENGTH = 200;

export const ViewCommentsArgsSchema = z.object({
  postId: z.string().trim().min(1),
  cursor: z.string().nullable().optional(),
  sort: z.enum(["latest", "hot"]).nullable().optional()
});

export const PostIdArgsSchema = z.object({
  postId: z.string().trim().min(1)
});

export const ReadPostArgsSchema = z.object({
  postId: z.string().trim().min(1),
  depth: ReadDepthSchema,
  focus: z.array(z.string().trim().min(1).max(20)).max(3).optional()
});
export type ReadPostArgs = z.infer<typeof ReadPostArgsSchema>;

export const ExitBrowsingArgsSchema = z.object({
  reasonCategory: ExitReasonCategorySchema,
  readingDepth: ExitReadingDepthSchema,
  interestLevel: InterestTrustLevelSchema,
  trustLevel: InterestTrustLevelSchema
});
export type ExitBrowsingArgs = z.infer<typeof ExitBrowsingArgsSchema>;

export const WriteCommentArgsSchema = z.object({
  postId: z.string().trim().min(1),
  intent: CommentIntentSchema,
  content: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
  replyToCommentId: z.string().nullable().optional()
});
export type WriteCommentArgs = z.infer<typeof WriteCommentArgsSchema>;

export const LikeCommentArgsSchema = z.object({
  commentId: z.string().trim().min(1)
});

export const ToolCallInputSchema = z.discriminatedUnion("toolName", [
  z.object({ toolName: z.literal("open_post"), args: z.object({}).default({}) }),
  z.object({ toolName: z.literal("read_post"), args: ReadPostArgsSchema }),
  z.object({ toolName: z.literal("view_comments"), args: ViewCommentsArgsSchema }),
  z.object({ toolName: z.literal("like_post"), args: PostIdArgsSchema }),
  z.object({ toolName: z.literal("favorite_post"), args: PostIdArgsSchema }),
  z.object({ toolName: z.literal("share_post"), args: PostIdArgsSchema }),
  z.object({ toolName: z.literal("write_comment"), args: WriteCommentArgsSchema }),
  z.object({ toolName: z.literal("like_comment"), args: LikeCommentArgsSchema }),
  z.object({ toolName: z.literal("exit_browsing"), args: ExitBrowsingArgsSchema })
]);
export type ToolCallInput = z.infer<typeof ToolCallInputSchema>;

// ── 工具分类 helper ──

export function categoryForTool(toolName: ToolName): ToolCategory {
  return toolName === "like_post" || toolName === "favorite_post" || toolName === "share_post" || toolName === "write_comment" || toolName === "like_comment"
    ? "interaction"
    : "navigation";
}

// ── 工具 input JSON schema 派生 ──
//
// 阶段12 spike 决策：shared Zod schema 是工具参数契约的唯一事实源。
// toolExecutor 通过 toolInputJsonSchema() 派生 AI SDK jsonSchema()，
// 不再手写内联 JSON Schema，消除"模型看到的 schema"与"shared 定义"的漂移。
// 运行时参数校验仍由 toolExecutor 的 *Arg helper 负责（保留 snake_case 兼容）。

/** open_post 无参数，但需要显式 strict 空对象以保证 additionalProperties: false。 */
const OpenPostArgsSchema = z.object({}).strict();

const TOOL_ARGS_SCHEMAS: Record<ToolName, z.ZodType> = {
  open_post: OpenPostArgsSchema,
  read_post: ReadPostArgsSchema,
  view_comments: ViewCommentsArgsSchema,
  like_post: PostIdArgsSchema,
  favorite_post: PostIdArgsSchema,
  share_post: PostIdArgsSchema,
  write_comment: WriteCommentArgsSchema,
  like_comment: LikeCommentArgsSchema,
  exit_browsing: ExitBrowsingArgsSchema
};

/**
 * 从 shared Zod schema 派生 AI SDK tool inputSchema。
 * 去掉 Zod v4 toJSONSchema 默认输出的 $schema 元数据字段（部分 OpenAI 兼容 API 会拒绝）。
 * 返回值可直接传入 AI SDK 的 jsonSchema()。
 */
export function toolInputJsonSchema(name: ToolName): Record<string, unknown> {
  const schema = TOOL_ARGS_SCHEMAS[name];
  const generated = toJSONSchema(schema) as Record<string, unknown>;
  delete generated["$schema"];
  return generated;
}
