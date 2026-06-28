import type { AudienceSeatsSummary, CommentItem, CommentUpdatePatch, LiveSummary, PostStateView, RuntimeLogItem } from "@trycue/shared";
import type { AudienceDraft, UiStatus } from "../types.js";

export function mergeById(items: CommentItem[], incoming: CommentItem[]) {
  const map = new Map(items.map((item) => [item.id, item]));
  for (const item of incoming) {
    const existing = map.get(item.id);
    map.set(item.id, {
      ...existing,
      ...item,
      likedByMe: item.likedByMe ?? existing?.likedByMe
    });
  }
  return [...map.values()];
}

export function patchCommentById(items: CommentItem[], commentId: string, patch: CommentUpdatePatch) {
  return items.map((item) => item.id === commentId ? { ...item, ...patch } : item);
}

export function mergePostState(current: PostStateView, incoming: PostStateView) {
  return {
    ...current,
    ...incoming,
    likedByMe: incoming.likedByMe ?? current.likedByMe,
    favoritedByMe: incoming.favoritedByMe ?? current.favoritedByMe,
    sharedByMe: incoming.sharedByMe ?? current.sharedByMe
  };
}

export function mergeRuntimeLogsById(items: RuntimeLogItem[], incoming: RuntimeLogItem[]) {
  const map = new Map(items.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

export function sortPostComments(comments: CommentItem[], sort: "latest" | "hot") {
  return [...comments].sort((left, right) => {
    if (sort === "hot") {
      const likeDiff = (right.likeCount ?? 0) - (left.likeCount ?? 0);
      if (likeDiff !== 0) return likeDiff;
      const replyDiff = (right.replyCount ?? 0) - (left.replyCount ?? 0);
      if (replyDiff !== 0) return replyDiff;
    }
    const timeDiff = (right.simulatedTime ?? 0) - (left.simulatedTime ?? 0);
    if (timeDiff !== 0) return timeDiff;
    const createdDiff = (right.createdAt ? Date.parse(right.createdAt) : 0) - (left.createdAt ? Date.parse(left.createdAt) : 0);
    if (createdDiff !== 0) return createdDiff;
    return right.id.localeCompare(left.id);
  });
}

export function sortAudienceDrafts(left: AudienceDraft, right: AudienceDraft) {
  return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id);
}

export function isLiveStatus(status: UiStatus) {
  return [
    "planning_audience",
    "generating_audience",
    "audience_ready",
    "running",
    "pausing",
    "paused",
    "report_generating"
  ].includes(status);
}

export function hasRuntimeSnapshot(status: UiStatus) {
  return ["running", "pausing", "paused", "report_generating", "completed"].includes(status);
}

export function mergeSeatSummary(current: LiveSummary, summary: AudienceSeatsSummary): LiveSummary {
  return {
    ...current,
    audienceTotal: summary.total,
    finishedCount: summary.total - summary.activeCount,
    skippedCount: summary.skippedCount,
    riskExitCount: summary.riskExitCount,
    favoritedCount: summary.favoritedCount,
    commentedCount: summary.commentedCount
  };
}
