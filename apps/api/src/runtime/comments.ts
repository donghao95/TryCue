import type { Prisma, SimulatedComment } from "@trycue/db";

export type CommentSort = "latest" | "hot" | "time";

type CommentPageCursor = {
  likeCount?: number;
  replyCount?: number;
  simulatedTime: number;
  createdAt: Date;
  id: string;
};

type CommentStore = Pick<Prisma.TransactionClient, "simulatedComment">;

export async function listCommentPage(
  db: CommentStore,
  params: {
    contentVersionId: string;
    limit: number;
    cursor?: string | null;
    sort?: CommentSort;
  }
) {
  const sort = params.sort ?? "latest";
  const cursor = decodeCommentCursor(params.cursor);
  const where: Prisma.SimulatedCommentWhereInput = {
    contentVersionId: params.contentVersionId,
    ...(cursor ? commentCursorFilter(cursor, sort) : {})
  };
  const comments = await db.simulatedComment.findMany({
    where,
    orderBy: commentOrderBy(sort),
    take: params.limit + 1
  });
  const page = comments.slice(0, params.limit);
  const lastComment = page.length ? page[page.length - 1] : null;
  return {
    comments: page,
    hasMore: comments.length > params.limit,
    nextCursor: comments.length > params.limit && lastComment ? encodeCommentCursor(lastComment, sort) : null,
    sort
  };
}

export function parseCommentSort(value?: string | null): CommentSort {
  if (value === "hot" || value === "latest" || value === "time") return value;
  return "latest";
}

function commentOrderBy(sort: CommentSort): Prisma.SimulatedCommentOrderByWithRelationInput[] {
  if (sort === "hot") {
    return [
      { likeCount: "desc" },
      { replyCount: "desc" },
      { simulatedTime: "desc" },
      { createdAt: "desc" },
      { id: "desc" }
    ];
  }
  if (sort === "time") return [{ simulatedTime: "asc" }, { createdAt: "asc" }, { id: "asc" }];
  return [{ simulatedTime: "desc" }, { createdAt: "desc" }, { id: "desc" }];
}

function encodeCommentCursor(comment: SimulatedComment, sort: CommentSort) {
  return Buffer.from(JSON.stringify({
    sort,
    likeCount: comment.likeCount,
    replyCount: comment.replyCount,
    simulatedTime: comment.simulatedTime,
    createdAt: comment.createdAt.toISOString(),
    id: comment.id
  })).toString("base64url");
}

function decodeCommentCursor(value?: string | null): CommentPageCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<{
      likeCount: number;
      replyCount: number;
      simulatedTime: number;
      createdAt: string;
      id: string;
    }>;
    const createdAt = parsed.createdAt ? new Date(parsed.createdAt) : null;
    if (typeof parsed.simulatedTime !== "number" || !parsed.id || !createdAt || Number.isNaN(createdAt.valueOf())) return null;
    return {
      likeCount: typeof parsed.likeCount === "number" ? parsed.likeCount : 0,
      replyCount: typeof parsed.replyCount === "number" ? parsed.replyCount : 0,
      simulatedTime: parsed.simulatedTime,
      createdAt,
      id: parsed.id
    };
  } catch {
    return null;
  }
}

function commentCursorFilter(cursor: CommentPageCursor, sort: CommentSort): Prisma.SimulatedCommentWhereInput {
  if (sort === "hot") {
    const likeCount = cursor.likeCount ?? 0;
    const replyCount = cursor.replyCount ?? 0;
    return {
      OR: [
        { likeCount: { lt: likeCount } },
        { likeCount, replyCount: { lt: replyCount } },
        { likeCount, replyCount, simulatedTime: { lt: cursor.simulatedTime } },
        { likeCount, replyCount, simulatedTime: cursor.simulatedTime, createdAt: { lt: cursor.createdAt } },
        { likeCount, replyCount, simulatedTime: cursor.simulatedTime, createdAt: cursor.createdAt, id: { lt: cursor.id } }
      ]
    };
  }
  if (sort === "time") {
    return {
      OR: [
        { simulatedTime: { gt: cursor.simulatedTime } },
        { simulatedTime: cursor.simulatedTime, createdAt: { gt: cursor.createdAt } },
        { simulatedTime: cursor.simulatedTime, createdAt: cursor.createdAt, id: { gt: cursor.id } }
      ]
    };
  }
  return {
    OR: [
      { simulatedTime: { lt: cursor.simulatedTime } },
      { simulatedTime: cursor.simulatedTime, createdAt: { lt: cursor.createdAt } },
      { simulatedTime: cursor.simulatedTime, createdAt: cursor.createdAt, id: { lt: cursor.id } }
    ]
  };
}
