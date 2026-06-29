import { describe, expect, it } from "vitest";
import type { CommentItem, LiveSummary } from "@trycue/shared/run";
import { mergeById, mergeSeatSummary } from "./collections.js";

const baseSummary: LiveSummary = {
  audienceTotal: 12,
  reachedCount: 12,
  openedCount: 9,
  finishedCount: 9,
  skippedCount: 3,
  browsedAndLeftCount: 6,
  riskExitCount: 0,
  maxStepsCount: 0,
  likedCount: 4,
  favoritedCount: 7,
  commentedCount: 6,
  trustConcernCount: 2,
  adConcernCount: 2,
  questionCount: 1
};

describe("mergeSeatSummary", () => {
  it("preserves concern counts from live summary updates", () => {
    expect(
      mergeSeatSummary(baseSummary, {
        total: 12,
        activeCount: 0,
        commentedCount: 6,
        favoritedCount: 7,
        skippedCount: 3,
        doubtCount: 0,
        riskExitCount: 0,
        finishedCount: 9
      })
    ).toMatchObject({
      audienceTotal: 12,
      finishedCount: 12,
      skippedCount: 3,
      trustConcernCount: 2,
      adConcernCount: 2
    });
  });
});

describe("mergeById", () => {
  it("uses incoming comment counts while preserving missing viewer state", () => {
    const existing: CommentItem = {
      id: "comment-1",
      audienceName: "陈琳",
      segment: "核心用户",
      commentText: "旧评论",
      likeCount: 0,
      likedByMe: true
    };
    const incoming: CommentItem = {
      ...existing,
      commentText: "新评论",
      likeCount: 1
    };

    expect(mergeById([existing], [incoming])).toEqual([
      expect.objectContaining({
        id: "comment-1",
        commentText: "新评论",
        likeCount: 1,
        likedByMe: true
      })
    ]);
  });
});
