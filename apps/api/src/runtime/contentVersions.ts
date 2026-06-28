import type { ContentVersion, Prisma } from "@trycue/db";
import { ApiError } from "../errors.js";

type ContentVersionStore = Pick<Prisma.TransactionClient, "contentVersion">;

export async function requireSingleContentVersion(db: ContentVersionStore, runId: string): Promise<ContentVersion> {
  const versions = await db.contentVersion.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
    take: 2
  });
  if (versions.length === 0) throw new ApiError("CONTENT_INVALID", "内容版本不存在或不属于当前 run", 400);
  if (versions.length > 1) {
    throw new ApiError("UNSUPPORTED_CONTENT_VERSION_COUNT", "V1 仅支持一个 run 一个内容版本，当前 run 存在多个内容版本", 409);
  }
  return assertCompleteContentVersion(versions[0]!);
}

function assertCompleteContentVersion(contentVersion: ContentVersion) {
  if (!contentVersion.title || !contentVersion.bodyText) {
    throw new ApiError("CONTENT_INVALID", "内容字段不完整", 400);
  }
  return contentVersion;
}
