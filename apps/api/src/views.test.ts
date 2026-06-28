import { describe, expect, it } from "vitest";
import { audienceDetailView, audienceSeatView } from "./views.js";

function participant(overrides: Record<string, unknown> = {}) {
  return {
    id: "participant-1",
    runId: "run-1",
    sourceProfileId: "profile-1",
    samplingDirectiveId: "directive-1",
    sortOrder: 0,
    userId: "user-1",
    agentId: "agent-1",
    platformAccountId: "platform-1",
    source: "generated",
    displayNameSnapshot: "测试用户",
    avatarUrlSnapshot: "/uploads/avatar.png",
    profileSnapshotJson: {
      samplingLabel: "测试用户"
    },
    agentSnapshotJson: {
      profile: "新手妈妈，长期背景",
      personality: "看真实反馈，重视细节，怀疑硬广",
      mbtiType: "ISFJ",
      responseStyle: "口语化，短句"
    },
    platformAccountSnapshotJson: { platform: "xiaohongshu" },
    runtimeStatus: "ready",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

describe("audience views", () => {
  it("returns avatar snapshot URL for audience seats", () => {
    const seat = audienceSeatView({
      audience: participant() as never,
      interactionTypes: [],
      hasDoubt: false
    });

    expect(seat).toMatchObject({
      participantId: "participant-1",
      actorUserId: "user-1",
      agentId: "agent-1",
      platformAccountId: "platform-1",
      avatarUrl: "/uploads/avatar.png"
    });
  });

  it("returns four-part persona fields for audience detail", () => {
    const detail = audienceDetailView({
      audience: participant() as never,
      timeline: [],
      interactions: [],
      comments: []
    });

    expect(detail.avatarUrl).toBe("/uploads/avatar.png");
    expect(detail.persona).toMatchObject({
      profile: "新手妈妈，长期背景",
      personality: "看真实反馈，重视细节，怀疑硬广",
      mbtiType: "ISFJ",
      responseStyle: "口语化，短句"
    });
  });
});
