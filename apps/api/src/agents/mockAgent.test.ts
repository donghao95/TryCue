import { describe, expect, it } from "vitest";
import { MockAgentProvider, planMockTools } from "./mockAgent.js";
import type { RunParticipantContext } from "./types.js";

// 确保测试不继承开发者本地设置的 MOCK_AGENT_DELAY_MS,避免测试被人为延迟拖慢
delete process.env.MOCK_AGENT_DELAY_MS;

const postTools = ["read_post", "view_comments", "like_post", "favorite_post", "share_post", "write_comment", "like_comment", "exit_browsing"] as const;

function context(overrides: Partial<RunParticipantContext>): RunParticipantContext {
  return {
    runId: "run-1",
    participantId: "participant-1",
    actionId: "action-1",
    stepIndex: 1,
    journeyId: "journey-1",
    hasOpenedPost: true,
    displayName: "陈琳",
    persona: {
      profile: "陈琳，28岁，新一线城市，正处于相关决策期。",
      personality: "做购买前功课，重视具体型号，没有依据会怀疑。",
      mbtiType: "ISTJ",
      responseStyle: "短句、口语化。"
    },
    messages: [],
    availableTools: [...postTools],
    ...overrides
  };
}

describe("planMockTools", () => {
  it("can generate share_post in post detail mock turns", () => {
    const calls = planMockTools(context({ hasOpenedPost: true }), 7);

    expect(calls).toContainEqual({ toolName: "share_post", args: {} });
  });

  it("can generate like_comment in post mock turns when a viewed comment is in transcript", () => {
    const calls = planMockTools(
      context({
        hasOpenedPost: true,
        messages: [
          {
            role: "tool",
            content: [{
              type: "tool-result",
              toolCallId: "call-comments",
              toolName: "view_comments",
              output: {
                type: "json",
                value: {
                  ok: true,
                  comments: [{ id: "comment-1", commentText: "这条评论说中了" }]
                }
              }
            }]
          }
        ],
        availableTools: [...postTools]
      }),
      10
    );

    expect(calls).toContainEqual({ toolName: "like_comment", args: { commentId: "comment-1" } });
  });

  it("varies mock comment text by deterministic index", () => {
    const first = planMockTools(context({ hasOpenedPost: true }), 1);
    const second = planMockTools(context({ hasOpenedPost: true }), 5);
    const firstComment = first.find((call) => call.toolName === "write_comment");
    const secondComment = second.find((call) => call.toolName === "write_comment");

    expect(firstComment?.args.content).toEqual(expect.any(String));
    expect(secondComment?.args.content).toEqual(expect.any(String));
    expect(firstComment?.args.content).not.toEqual(secondComment?.args.content);
  });
});

describe("MockAgentProvider audience generation", () => {
  it("generates a directive-based sampling plan with an exact total", async () => {
    const provider = new MockAgentProvider();
    const plan = await provider.generateAudienceSamplingPlan({
      title: "30 岁新手爸妈装修避坑清单",
      coverImageUrl: "https://example.com/cover.jpg",
      imageUrls: ["https://example.com/cover.jpg"],
      bodyText: "这是一篇给新手爸妈的家居装修避坑内容，重点讲预算、收纳和真实使用反馈。",
      count: 12
    });

    expect(plan.totalCount).toBe(12);
    expect(plan.directives).toHaveLength(4);
    expect(plan.directives.reduce((sum, directive) => sum + directive.quantity, 0)).toBe(12);
    expect(new Set(plan.directives.map((directive) => directive.name))).toEqual(new Set(["核心用户", "相邻用户", "挑剔用户", "路人用户"]));
    expect(plan.directives.every((directive) => directive.quantity > 0)).toBe(true);
    expect(plan.planMarkdown).toContain("装修避坑清单");
    expect(plan.planMarkdown).toContain("真实经验");
    expect(plan.planMarkdown).not.toContain("12 位观众");
  });

  it("uses the documented mock segment ratios for standard-sized plans", async () => {
    const provider = new MockAgentProvider();
    const plan = await provider.generateAudienceSamplingPlan({
      title: "30 岁新手爸妈装修避坑清单",
      coverImageUrl: "https://example.com/cover.jpg",
      imageUrls: ["https://example.com/cover.jpg"],
      bodyText: "这是一篇给新手爸妈的家居装修避坑内容，重点讲预算、收纳和真实使用反馈。",
      count: 20
    });

    expect(Object.fromEntries(plan.directives.map((directive) => [directive.name, directive.quantity]))).toMatchObject({
      核心用户: 8,
      相邻用户: 5,
      挑剔用户: 4,
      路人用户: 3
    });
  });

  it("expands profile metadata into consistent four-part personas", async () => {
    const provider = new MockAgentProvider();
    const plan = await provider.generateAudienceSamplingPlan({
      title: "预算有限也能做好的家居避坑清单",
      coverImageUrl: "https://example.com/cover.jpg",
      imageUrls: ["https://example.com/cover.jpg"],
      bodyText: "正文包含预算、平替、家人共同决策和评论区反馈。",
      count: 4
    });
    const directive = {
      ...plan.directives[0]!,
      id: "directive-1",
      sortOrder: 0,
      expansionStatus: "pending",
      expansionError: null
    };
    const profiles: Array<{ samplingLabel: string; demographics: Record<string, unknown> }> = [];
    await provider.expandAudienceProfiles({
      title: "预算有限也能做好的家居避坑清单",
      coverImageUrl: "https://example.com/cover.jpg",
      imageUrls: ["https://example.com/cover.jpg"],
      bodyText: "正文包含预算、平替、家人共同决策和评论区反馈。",
      plan: {
        planId: "plan-1",
        runId: "run-1",
        totalCount: plan.totalCount,
        status: "confirmed",
        planMarkdown: plan.planMarkdown,
        dimensions: plan.dimensions,
        directives: [directive]
      },
      directive,
      chunkStart: 0,
      chunkCount: directive.quantity,
      onFrame: (frame) => {
        if (frame.type === "profile_completed") profiles.push(frame.profile);
      }
    });
    const persona = await provider.generateAudiencePersona({
      profile: { profileId: profiles[0]!.samplingLabel, demographics: profiles[0]!.demographics }
    });

    expect(persona.persona.profile).toBeTruthy();
    expect(persona.persona.personality).toBeTruthy();
    expect(persona.persona.mbtiType).toMatch(/^(INTJ|INTP|ENTJ|ENTP|INFJ|INFP|ENFJ|ENFP|ISTJ|ISFJ|ESTJ|ESFJ|ISTP|ISFP|ESTP|ESFP)$/);
    expect(persona.persona.responseStyle.trim().length > 0).toBe(true);
    expect(persona.displayName).toBeTruthy();
  });
});
