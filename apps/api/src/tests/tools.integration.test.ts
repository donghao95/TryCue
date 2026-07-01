import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@trycue/db";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, jsonSchema, stepCountIs, tool, type StepResult, type ToolSet } from "ai";
import { executeAiSdkPlannedToolCall, persistStep } from "../tools/toolExecutor.js";
import { PROMPT_VERSION_AGENT } from "../agents/promptVersions.js";
import { getDefaultHumanActor } from "../runtime/identity.js";
import { exitBrowsing, openPost, setPostReaction } from "../runtime/interactions.js";
import { aiSdkTrace } from "../llm/aiSdkTracing.js";
import { createToolTestBundle, resetDatabase } from "./helpers.js";

describe("audience events emission", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("emits audience.status_updated and audience.action_happened on open_post", async () => {
    const { action } = await createToolTestBundle(false);
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0,
      toolName: "open_post",
      args: {},
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-open", type: "function", function: { name: "open_post", arguments: "{}" } }
    });
    const events = await prisma.liveEvent.findMany({ where: { runId: action.runId } });
    const statusEvent = events.find((e) => e.eventType === "audience.status_updated");
    const actionEvent = events.find((e) => e.eventType === "audience.action_happened");
    expect(statusEvent).toBeTruthy();
    expect(actionEvent).toBeTruthy();
    const statusPayload = statusEvent!.payload as Record<string, unknown>;
    expect(statusPayload.participantId).toBe(action.participantId);
    expect(statusPayload.status).toBe("watching");
    const actionPayload = actionEvent!.payload as Record<string, unknown>;
    expect(actionPayload.action).toBe("open_post");
    expect(actionPayload.animationHint).toBe("none");
  });

  it("creates feed and post transcript items on open_post", async () => {
    const { action } = await createToolTestBundle(false);
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0,
      toolName: "open_post",
      args: {},
      sdkCallId: "call-open",
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-open", type: "function", function: { name: "open_post", arguments: "{}" } }
    });

    const allItems = await prisma.agentTranscriptItem.findMany({ where: { journeyId: action.journeyId }, orderBy: { seq: "asc" } });
    const feedItems = allItems.filter((item) => {
      const obs = item.observationJson as Record<string, unknown> | null;
      const post = (obs?.post ?? {}) as Record<string, unknown>;
      return typeof post.bodyPreview === "string";
    });
    const postItems = allItems.filter((item) => {
      const obs = item.observationJson as Record<string, unknown> | null;
      const post = (obs?.post ?? {}) as Record<string, unknown>;
      return typeof post.bodyText === "string";
    });
    const toolResultItems = allItems.filter((item) => item.itemType === "tool_result");
    expect(feedItems.map((item) => item.itemType)).toEqual(["initial_observation"]);
    expect(postItems.map((item) => item.itemType)).toEqual(["initial_observation"]);
    expect(toolResultItems).toHaveLength(1);
    expect(feedItems[0]!.observationJson).toMatchObject({ post: { bodyPreview: expect.any(String) } });
    expect(feedItems[0]!.observationJson).not.toHaveProperty("post.bodyText");
    expect(postItems[0]!.observationJson).toMatchObject({ post: { bodyText: expect.any(String) } });

    const toolCall = await prisma.agentToolCall.findFirstOrThrow({ where: { agentTurnId: action.id } });
    expect(toolCall.output).toMatchObject({ ok: true, transition: "post_detail_observed" });
    expect(JSON.stringify(toolCall.output)).not.toContain("imageUrls");
  });

  it("commits read_post with transcript, social event, no counter update and audience event", async () => {
    const { action, run, content } = await createToolTestBundle(true);
    const beforeState = await prisma.simulatedPostState.findUniqueOrThrow({
      where: { contentVersionId: content.id }
    });
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0,
      toolName: "read_post",
      args: { postId: action.contentVersionId, depth: "partial", focus: ["price"] },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-read", type: "function", function: { name: "read_post", arguments: JSON.stringify({ depth: "partial", focus: ["price"] }) } }
    });

    const toolCall = await prisma.agentToolCall.findFirstOrThrow({ where: { agentTurnId: action.id } });
    expect(toolCall.status).toBe("committed");
    expect(toolCall.output).toMatchObject({ ok: true, postId: action.contentVersionId, status: "read", depth: "partial", focus: ["price"] });

    const resultItem = await prisma.agentTranscriptItem.findFirstOrThrow({ where: { toolCallId: toolCall.id, itemType: "tool_result" } });
    expect(resultItem.toolResultJson).toMatchObject({ ok: true, depth: "partial" });

    const interaction = await prisma.socialInteractionEvent.findFirstOrThrow({
      where: { contentVersionId: content.id, interactionType: "read_post" }
    });
    expect(interaction.source).toBe("agent_tool");

    const afterState = await prisma.simulatedPostState.findUniqueOrThrow({
      where: { contentVersionId: content.id }
    });
    expect(afterState.likeCount).toBe(beforeState.likeCount);
    expect(afterState.favoriteCount).toBe(beforeState.favoriteCount);
    expect(afterState.commentCount).toBe(beforeState.commentCount);
    expect(afterState.shareCount).toBe(beforeState.shareCount);

    const actionLog = await prisma.actionLog.findFirstOrThrow({
      where: { journeyActionId: action.id, action: "read_post" }
    });
    expect(actionLog.eventKind).toBe("tool_call");
    expect(actionLog.eventPayloadJson).toMatchObject({
      toolName: "read_post",
      input: { postId: action.contentVersionId, depth: "partial", focus: ["price"] },
      output: { postId: action.contentVersionId, status: "read", depth: "partial", focus: ["price"] }
    });

    const events = await prisma.liveEvent.findMany({ where: { runId: run.id } });
    const actionEvent = events.find((e) => e.eventType === "audience.action_happened");
    expect(actionEvent).toBeTruthy();
    const payload = actionEvent!.payload as Record<string, unknown>;
    expect(payload.action).toBe("read_post");
    expect(payload.animationHint).toBe("none");
    expect(payload.text).toContain("阅读了正文");
  });

  it("emits audience events with heart hint on like_post", async () => {
    const { action } = await createToolTestBundle(true);
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0,
      toolName: "like_post",
      args: { postId: action.contentVersionId },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-like", type: "function", function: { name: "like_post", arguments: "{}" } }
    });
    const events = await prisma.liveEvent.findMany({ where: { runId: action.runId } });
    const actionEvent = events.find((e) => e.eventType === "audience.action_happened");
    expect(actionEvent).toBeTruthy();
    const payload = actionEvent!.payload as Record<string, unknown>;
    expect(payload.action).toBe("like_post");
    expect(payload.animationHint).toBe("heart");
  });

  it("emits audience events with star hint on favorite_post", async () => {
    const { action } = await createToolTestBundle(true);
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0,
      toolName: "favorite_post",
      args: { postId: action.contentVersionId },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-fav", type: "function", function: { name: "favorite_post", arguments: "{}" } }
    });
    const events = await prisma.liveEvent.findMany({ where: { runId: action.runId } });
    const actionEvent = events.find((e) => e.eventType === "audience.action_happened");
    expect(actionEvent).toBeTruthy();
    const payload = actionEvent!.payload as Record<string, unknown>;
    expect(payload.action).toBe("favorite_post");
    expect(payload.animationHint).toBe("star");
  });

  it("emits audience events with comment hint on write_comment", async () => {
    const { action } = await createToolTestBundle(true);
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0,
      toolName: "write_comment",
      args: { postId: action.contentVersionId, intent: "ask", content: "测试评论", replyToCommentId: null },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-comment", type: "function", function: { name: "write_comment", arguments: JSON.stringify({ content: "测试评论", intent: "ask" }) } }
    });
    const events = await prisma.liveEvent.findMany({ where: { runId: action.runId } });
    const actionEvent = events.find((e) => e.eventType === "audience.action_happened");
    expect(actionEvent).toBeTruthy();
    const payload = actionEvent!.payload as Record<string, unknown>;
    expect(payload.action).toBe("write_comment");
    expect(payload.animationHint).toBe("comment");
  });

  it("does not emit audience.action_happened on view_comments", async () => {
    const { action } = await createToolTestBundle(true);
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0,
      toolName: "view_comments",
      args: { postId: action.contentVersionId },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-comments", type: "function", function: { name: "view_comments", arguments: "{}" } }
    });
    const events = await prisma.liveEvent.findMany({ where: { runId: action.runId } });
    expect(events.some((event) => event.eventType === "comments.page_loaded")).toBe(true);
    expect(events.some((event) => event.eventType === "audience.status_updated")).toBe(true);
    expect(events.some((event) => event.eventType === "audience.action_happened")).toBe(false);
  });

  // 注:commitSharePost/commitWriteComment/commitLikeComment 的 emitAudienceEvents 参数
  // 已对齐为传 updatedJourney(与其他 6 个 commit 一致)。这是防御性对齐:
  // sharePost/createComment/likeComment 当前不修改 agentJourney,故 journey 在工具执行
  // 前后相同,无法构造能区分"传旧快照 vs 新快照"的黑盒回归测试。如果未来这些工具
  // 开始修改 journey 字段,现有的 open_post/like_post 等测试模式可参考扩展。

  it("persists viewed comments in tool output and transcript only after view_comments", async () => {
    const { action } = await createToolTestBundle(true);
    await prisma.simulatedComment.create({
      data: {
        contentVersionId: action.contentVersionId,
        actorUserId: action.actorUserId,
        platformAccountId: action.platformAccountId,
        participantId: action.participantId,
        source: "system_seed",
        commentText: "隐藏评论，必须主动看评论后才可见",
        simulatedTime: 1
      }
    });
    const beforeViewItems = await prisma.agentTranscriptItem.findMany({ where: { journeyId: action.journeyId }, orderBy: { seq: "asc" } });
    expect(JSON.stringify(beforeViewItems)).not.toContain("隐藏评论");

    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0,
      toolName: "view_comments",
      args: { postId: action.contentVersionId, cursor: null, sort: "latest" },
      sdkCallId: "call-comments",
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-comments", type: "function", function: { name: "view_comments", arguments: JSON.stringify({ cursor: null, sort: "latest" }) } }
    });

    const viewCall = await prisma.agentToolCall.findFirstOrThrow({ where: { agentTurnId: action.id, callIndex: 0 } });
    expect(viewCall.output).toMatchObject({
      ok: true,
      comments: [expect.objectContaining({ commentText: "隐藏评论，必须主动看评论后才可见" })],
      cursor: null,
      sort: "latest"
    });
    const resultItem = await prisma.agentTranscriptItem.findFirstOrThrow({ where: { toolCallId: viewCall.id } });
    expect(resultItem.itemType).toBe("tool_result");
    expect(resultItem.toolResultJson).toMatchObject({ comments: [expect.objectContaining({ commentText: "隐藏评论，必须主动看评论后才可见" })] });
  });

  it("allows loading the first comments page separately for each sort", async () => {
    const { action } = await createToolTestBundle(true);
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0,
      toolName: "view_comments",
      args: { postId: action.contentVersionId, cursor: null, sort: "latest" },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-0", type: "function", function: { name: "view_comments", arguments: "{}" } }
    });
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 1,
      toolName: "view_comments",
      args: { postId: action.contentVersionId, cursor: null, sort: "hot" },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:1`,
      rawToolCall: { id: "call-1", type: "function", function: { name: "view_comments", arguments: "{}" } }
    });

    const calls = await prisma.agentToolCall.findMany({ where: { runId: action.runId }, orderBy: { callIndex: "asc" } });
    expect(calls.map((call) => call.status)).toEqual(["committed", "committed"]);
    const pages = await prisma.loadedCommentPage.findMany({ where: { contentVersionId: action.contentVersionId }, orderBy: { sort: "asc" } });
    expect(pages.map((page) => page.sort)).toEqual(["hot", "latest"]);
    expect(pages.map((page) => page.cursor)).toEqual(["", ""]);
  });

  it("ignores a repeated first comments page for the same sort", async () => {
    const { action } = await createToolTestBundle(true);
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0,
      toolName: "view_comments",
      args: { postId: action.contentVersionId, cursor: null, sort: "latest" },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-0", type: "function", function: { name: "view_comments", arguments: "{}" } }
    });
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 1,
      toolName: "view_comments",
      args: { postId: action.contentVersionId, cursor: null, sort: "latest" },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:1`,
      rawToolCall: { id: "call-1", type: "function", function: { name: "view_comments", arguments: "{}" } }
    });

    const calls = await prisma.agentToolCall.findMany({ where: { runId: action.runId }, orderBy: { callIndex: "asc" } });
    expect(calls.map((call) => call.status)).toEqual(["committed", "ignored"]);
    expect(await prisma.loadedCommentPage.count({ where: { contentVersionId: action.contentVersionId, cursor: "", sort: "latest" } })).toBe(1);
  });

  it("treats feed_card exit_browsing as skipped", async () => {
    const { action } = await createToolTestBundle(false);
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0,
      toolName: "exit_browsing",
      args: { reasonCategory: "not_relevant", readingDepth: "feed_only", interestLevel: "low", trustLevel: "low" },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-exit", type: "function", function: { name: "exit_browsing", arguments: "{}" } }
    });
    const events = await prisma.liveEvent.findMany({ where: { runId: action.runId } });
    const actionEvent = events.find((e) => e.eventType === "audience.action_happened");
    expect(actionEvent).toBeTruthy();
    const payload = actionEvent!.payload as Record<string, unknown>;
    expect(payload.action).toBe("exit_browsing");
    expect(payload.animationHint).toBe("skip");
    const statusEvent = events.find((e) => e.eventType === "audience.status_updated");
    expect(statusEvent).toBeTruthy();
    const statusPayload = statusEvent!.payload as Record<string, unknown>;
    expect(statusPayload.status).toBe("skipped");
    expect(statusPayload.exitOutcome).toBe("skipped");
    const journey = await prisma.agentJourney.findUniqueOrThrow({ where: { id: action.journeyId } });
    expect(journey.exitOutcome).toBe("skipped");
  });

  it("treats post_detail exit_browsing as browsed and left", async () => {
    const { action } = await createToolTestBundle(true);
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0,
      toolName: "exit_browsing",
      args: { reasonCategory: "no_more_action", readingDepth: "full", interestLevel: "medium", trustLevel: "medium" },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-exit", type: "function", function: { name: "exit_browsing", arguments: "{}" } }
    });
    const events = await prisma.liveEvent.findMany({ where: { runId: action.runId } });
    const actionEvent = events.find((e) => e.eventType === "audience.action_happened");
    expect(actionEvent).toBeTruthy();
    const payload = actionEvent!.payload as Record<string, unknown>;
    expect(payload.action).toBe("exit_browsing");
    expect(payload.animationHint).toBe("none");
    expect(payload.text).toBe("测试用户 结束了浏览");
    const statusEvent = events.find((e) => e.eventType === "audience.status_updated");
    expect(statusEvent).toBeTruthy();
    const statusPayload = statusEvent!.payload as Record<string, unknown>;
    expect(statusPayload.status).toBe("finished");
    expect(statusPayload.exitOutcome).toBe("browsed_and_left");
    const journey = await prisma.agentJourney.findUniqueOrThrow({ where: { id: action.journeyId } });
    expect(journey.exitOutcome).toBe("browsed_and_left");
  });
});

describe("tool direct commit state machine", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("ignores write_comment on feed_card", async () => {
    const { action, run, content } = await createToolTestBundle(false);
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0,
      toolName: "write_comment",
      args: { postId: action.contentVersionId, content: "不应该在信息流直接评论", replyToCommentId: null },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-0", type: "function", function: { name: "write_comment", arguments: "{}" } }
    });
    expect(await prisma.simulatedComment.count({ where: { contentVersionId: content.id } })).toBe(0);
    const toolCall = await prisma.agentToolCall.findFirstOrThrow({ where: { runId: run.id } });
    expect(toolCall.status).toBe("ignored");
    const state = await prisma.simulatedPostState.findUniqueOrThrow({
      where: { contentVersionId: content.id }
    });
    expect(state.commentCount).toBe(0);
    expect(toolCall.output).toMatchObject({ ok: false, reason: "post_not_opened" });
    const resultItem = await prisma.agentTranscriptItem.findFirstOrThrow({ where: { toolCallId: toolCall.id } });
    expect(resultItem.toolResultJson).toMatchObject({ reason: "post_not_opened" });
  });

  it("keeps favorite idempotent for one journey", async () => {
    const { action, run, content } = await createToolTestBundle(true);
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0,
      toolName: "favorite_post",
      args: { postId: action.contentVersionId },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-0", type: "function", function: { name: "favorite_post", arguments: "{}" } }
    });
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 1,
      toolName: "favorite_post",
      args: { postId: action.contentVersionId },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:1`,
      rawToolCall: { id: "call-1", type: "function", function: { name: "favorite_post", arguments: "{}" } }
    });
    const state = await prisma.simulatedPostState.findUniqueOrThrow({
      where: { contentVersionId: content.id }
    });
    expect(state.favoriteCount).toBe(1);
    const calls = await prisma.agentToolCall.findMany({ where: { runId: run.id }, orderBy: { callIndex: "asc" } });
    expect(calls.map((call) => call.status)).toEqual(["committed", "ignored"]);
  });

  it("returns structured already_liked without toggling or double counting", async () => {
    const { action, run, content } = await createToolTestBundle(true);
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0,
      toolName: "like_post",
      args: { postId: action.contentVersionId },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-0", type: "function", function: { name: "like_post", arguments: "{}" } }
    });
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 1,
      toolName: "like_post",
      args: { postId: action.contentVersionId },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:1`,
      rawToolCall: { id: "call-1", type: "function", function: { name: "like_post", arguments: "{}" } }
    });

    const state = await prisma.simulatedPostState.findUniqueOrThrow({ where: { contentVersionId: content.id } });
    expect(state.likeCount).toBe(1);
    const calls = await prisma.agentToolCall.findMany({ where: { runId: run.id }, orderBy: { callIndex: "asc" } });
    expect(calls[1]!.status).toBe("ignored");
    expect(calls[1]!.output).toMatchObject({ ok: false, reason: "already_liked", liked: true, likeCount: 1 });
    const resultItem = await prisma.agentTranscriptItem.findFirstOrThrow({ where: { toolCallId: calls[1]!.id } });
    expect(resultItem.toolResultJson).toMatchObject({ reason: "already_liked", likeCount: 1 });
  });

  it("saves empty assistant content without fallback thought", async () => {
    const bundle = await createToolTestBundle(false);
    await persistStep(bundle.action.id, {
      text: "",
      toolCalls: [],
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      request: { body: { unavailable: true } },
      response: { body: { provider: "test" } },
      model: { modelId: "test-model" }
    } as unknown as StepResult<ToolSet>);

    const action = await prisma.agentTurn.findUniqueOrThrow({ where: { id: bundle.action.id } });
    expect(action.thoughtText).toBeNull();
    expect(await prisma.actionLog.count({ where: { journeyActionId: bundle.action.id } })).toBe(0);
  });

  it("commits multiple tool calls in callIndex order", async () => {
    const { action, run, content } = await createToolTestBundle(true);
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0, toolName: "like_post", args: { postId: action.contentVersionId },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-0", type: "function", function: { name: "like_post", arguments: "{}" } }
    });
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 1, toolName: "favorite_post", args: { postId: action.contentVersionId },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:1`,
      rawToolCall: { id: "call-1", type: "function", function: { name: "favorite_post", arguments: "{}" } }
    });
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 2,
      toolName: "write_comment",
      args: { postId: action.contentVersionId, intent: "ask", content: "码住了，想看具体来源", replyToCommentId: null },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:2`,
      rawToolCall: { id: "call-2", type: "function", function: { name: "write_comment", arguments: JSON.stringify({ content: "码住了，想看具体来源" }) } }
    });
    const state = await prisma.simulatedPostState.findUniqueOrThrow({
      where: { contentVersionId: content.id }
    });
    expect(state.likeCount).toBe(1);
    expect(state.favoriteCount).toBe(1);
    expect(state.commentCount).toBe(1);
    const calls = await prisma.agentToolCall.findMany({ where: { runId: run.id }, orderBy: { callIndex: "asc" } });
    expect(calls.map((call) => call.toolName)).toEqual(["like_post", "favorite_post", "write_comment"]);
    expect(calls.every((call) => call.status === "committed")).toBe(true);
  });

  it("rejects reusing a pending tool call row for a different tool input", async () => {
    const { action } = await createToolTestBundle(true);
    await prisma.agentToolCall.create({
      data: {
        agentTurnId: action.id,
        runId: action.runId,
        journeyId: action.journeyId,
        participantId: action.participantId,
        actorUserId: action.actorUserId,
        platformAccountId: action.platformAccountId,
        source: "agent_tool",
        contentVersionId: action.contentVersionId,
        callIndex: 0,
        idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
        toolName: "like_post",
        toolCategory: "interaction",
        input: {},
        output: {},
        status: "pending",
        simulatedTime: 0
      }
    });

    await expect(
      executeAiSdkPlannedToolCall(action.id, {
        callIndex: 0,
        toolName: "favorite_post",
        args: { postId: action.contentVersionId },
        idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
        rawToolCall: { id: "call-0", type: "function", function: { name: "favorite_post", arguments: "{}" } }
      })
    ).rejects.toThrow("Tool call idempotency conflict");
  });

  it("commits share_post through the unified interaction facts", async () => {
    const { action, run, content } = await createToolTestBundle(true);
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0, toolName: "share_post", args: { postId: action.contentVersionId },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-0", type: "function", function: { name: "share_post", arguments: "{}" } }
    });
    const state = await prisma.simulatedPostState.findUniqueOrThrow({
      where: { contentVersionId: content.id }
    });
    expect(state.shareCount).toBe(1);
    const interaction = await prisma.socialInteractionEvent.findFirstOrThrow({ where: { contentVersionId: content.id, interactionType: "share_post" } });
    expect(interaction.source).toBe("agent_tool");
    const calls = await prisma.agentToolCall.findMany({ where: { runId: run.id }, orderBy: { callIndex: "asc" } });
    expect(calls.map((call) => call.status)).toEqual(["committed"]);
  });

  it("commits like_comment once for the same actor and comment", async () => {
    const { action, run, content } = await createToolTestBundle(true);
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0, toolName: "write_comment",
      args: { postId: action.contentVersionId, intent: "agree", content: "这个评论用于点赞", replyToCommentId: null },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-0", type: "function", function: { name: "write_comment", arguments: "{}" } }
    });
    const comment = await prisma.simulatedComment.findFirstOrThrow({ where: { contentVersionId: content.id } });
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 1, toolName: "like_comment", args: { commentId: comment.id },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:1`,
      rawToolCall: { id: "call-1", type: "function", function: { name: "like_comment", arguments: JSON.stringify({ commentId: comment.id }) } }
    });
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 2, toolName: "like_comment", args: { commentId: comment.id },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:2`,
      rawToolCall: { id: "call-2", type: "function", function: { name: "like_comment", arguments: JSON.stringify({ commentId: comment.id }) } }
    });
    const updated = await prisma.simulatedComment.findUniqueOrThrow({ where: { id: comment.id } });
    expect(updated.likeCount).toBe(1);
    expect(await prisma.socialReaction.count({ where: { contentVersionId: content.id, targetType: "comment", targetId: comment.id, reactionType: "like", active: true } })).toBe(1);
    const updateEvent = await prisma.liveEvent.findFirstOrThrow({ where: { runId: run.id, eventType: "comment.updated" } });
    const updatePayload = updateEvent.payload as Record<string, unknown>;
    expect(updatePayload.commentId).toBe(comment.id);
    expect(updatePayload.comment).toBeUndefined();
    expect(updatePayload.patch).toMatchObject({ likeCount: 1, replyCount: 0 });
    const calls = await prisma.agentToolCall.findMany({ where: { runId: run.id }, orderBy: { callIndex: "asc" } });
    expect(calls.map((call) => call.status)).toEqual(["committed", "committed", "ignored"]);
  });

  it("emits a comment patch when a reply updates the parent reply count", async () => {
    const { action, run, content } = await createToolTestBundle(true);
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0, toolName: "write_comment",
      args: { postId: action.contentVersionId, intent: "share_experience", content: "父评论", replyToCommentId: null },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-0", type: "function", function: { name: "write_comment", arguments: "{}" } }
    });
    const parent = await prisma.simulatedComment.findFirstOrThrow({ where: { contentVersionId: content.id, parentCommentId: null } });

    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 1, toolName: "write_comment",
      args: { postId: action.contentVersionId, intent: "agree", content: "回复父评论", replyToCommentId: parent.id },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:1`,
      rawToolCall: { id: "call-1", type: "function", function: { name: "write_comment", arguments: JSON.stringify({ replyToCommentId: parent.id }) } }
    });

    const updatedParent = await prisma.simulatedComment.findUniqueOrThrow({ where: { id: parent.id } });
    expect(updatedParent.replyCount).toBe(1);
    const updateEvent = await prisma.liveEvent.findFirstOrThrow({ where: { runId: run.id, eventType: "comment.updated" } });
    const updatePayload = updateEvent.payload as Record<string, unknown>;
    expect(updatePayload.commentId).toBe(parent.id);
    expect(updatePayload.comment).toBeUndefined();
    expect(updatePayload.patch).toMatchObject({ likeCount: 0, replyCount: 1 });
  });

  it("supports nested replies to another agent reply", async () => {
    const { action, content } = await createToolTestBundle(true);
    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 0, toolName: "write_comment",
      args: { postId: action.contentVersionId, intent: "share_experience", content: "父评论", replyToCommentId: null },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:0`,
      rawToolCall: { id: "call-0", type: "function", function: { name: "write_comment", arguments: "{}" } }
    });
    const parent = await prisma.simulatedComment.findFirstOrThrow({ where: { contentVersionId: content.id, parentCommentId: null } });

    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 1, toolName: "write_comment",
      args: { postId: action.contentVersionId, intent: "agree", content: "回复父评论", replyToCommentId: parent.id },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:1`,
      rawToolCall: { id: "call-1", type: "function", function: { name: "write_comment", arguments: JSON.stringify({ replyToCommentId: parent.id }) } }
    });
    const firstReply = await prisma.simulatedComment.findFirstOrThrow({ where: { contentVersionId: content.id, parentCommentId: parent.id } });

    await executeAiSdkPlannedToolCall(action.id, {
      callIndex: 2, toolName: "write_comment",
      args: { postId: action.contentVersionId, intent: "agree", content: "继续回复上一条回复", replyToCommentId: firstReply.id },
      idempotencyKey: `${action.runId}:${action.participantId}:${action.id}:2`,
      rawToolCall: { id: "call-2", type: "function", function: { name: "write_comment", arguments: JSON.stringify({ replyToCommentId: firstReply.id }) } }
    });

    const nestedReply = await prisma.simulatedComment.findFirstOrThrow({ where: { contentVersionId: content.id, parentCommentId: firstReply.id } });
    expect(firstReply.rootCommentId).toBe(parent.id);
    expect(nestedReply.rootCommentId).toBe(parent.id);
    const updatedParent = await prisma.simulatedComment.findUniqueOrThrow({ where: { id: parent.id } });
    const updatedFirstReply = await prisma.simulatedComment.findUniqueOrThrow({ where: { id: firstReply.id } });
    expect(updatedParent.replyCount).toBe(1);
    expect(updatedFirstReply.replyCount).toBe(1);
  });

  it("rejects comment interactions across run boundaries", async () => {
    const first = await createToolTestBundle(true);
    await executeAiSdkPlannedToolCall(first.action.id, {
      callIndex: 0, toolName: "write_comment",
      args: { postId: first.action.contentVersionId, intent: "share_experience", content: "只属于第一个 run", replyToCommentId: null },
      idempotencyKey: `${first.action.runId}:${first.action.participantId}:${first.action.id}:0`,
      rawToolCall: { id: "call-0", type: "function", function: { name: "write_comment", arguments: "{}" } }
    });
    const foreignComment = await prisma.simulatedComment.findFirstOrThrow({ where: { contentVersionId: first.content.id } });

    const second = await createToolTestBundle(true);
    await executeAiSdkPlannedToolCall(second.action.id, {
      callIndex: 0, toolName: "like_comment", args: { commentId: foreignComment.id },
      idempotencyKey: `${second.action.runId}:${second.action.participantId}:${second.action.id}:0`,
      rawToolCall: { id: "call-0", type: "function", function: { name: "like_comment", arguments: JSON.stringify({ commentId: foreignComment.id }) } }
    });
    await executeAiSdkPlannedToolCall(second.action.id, {
      callIndex: 1, toolName: "write_comment",
      args: { postId: second.action.contentVersionId, intent: "pushback", content: "不能跨 run 回复", replyToCommentId: foreignComment.id },
      idempotencyKey: `${second.action.runId}:${second.action.participantId}:${second.action.id}:1`,
      rawToolCall: { id: "call-1", type: "function", function: { name: "write_comment", arguments: JSON.stringify({ replyToCommentId: foreignComment.id }) } }
    });

    const unchanged = await prisma.simulatedComment.findUniqueOrThrow({ where: { id: foreignComment.id } });
    expect(unchanged.likeCount).toBe(0);
    expect(unchanged.replyCount).toBe(0);
    expect(await prisma.socialReaction.count({ where: { contentVersionId: second.content.id } })).toBe(0);
    const calls = await prisma.agentToolCall.findMany({ where: { runId: second.run.id }, orderBy: { callIndex: "asc" } });
    expect(calls.map((call) => call.status)).toEqual(["ignored", "ignored"]);
  });

  it("applies reaction deltas idempotently without negative counts", async () => {
    const { run, content } = await createToolTestBundle(true);
    await prisma.$transaction(async (tx) => {
      const actor = await getDefaultHumanActor(tx);
      await setPostReaction(tx, { runId: run.id, contentVersionId: content.id, actor, reactionType: "like", active: false });
      await setPostReaction(tx, { runId: run.id, contentVersionId: content.id, actor, reactionType: "like", active: true });
      await setPostReaction(tx, { runId: run.id, contentVersionId: content.id, actor, reactionType: "like", active: true });
      await setPostReaction(tx, { runId: run.id, contentVersionId: content.id, actor, reactionType: "like", active: false });
      await setPostReaction(tx, { runId: run.id, contentVersionId: content.id, actor, reactionType: "like", active: false });
    });
    const state = await prisma.simulatedPostState.findUniqueOrThrow({
      where: { contentVersionId: content.id }
    });
    expect(state.likeCount).toBe(0);
    const reaction = await prisma.socialReaction.findFirstOrThrow({ where: { contentVersionId: content.id, reactionType: "like" } });
    expect(reaction.active).toBe(false);
  });

  it("does not increment openCount for repeated opens by the same actor", async () => {
    const { run, content, audience, journey, action } = await createToolTestBundle(false);
    await prisma.$transaction(async (tx) => {
      const actor = {
        actorUserId: audience.userId,
        platformAccountId: audience.platformAccountId,
        participantId: audience.id,
        agentId: audience.agentId,
        source: "agent_tool" as const
      };
      const first = await openPost(tx, {
        runId: run.id,
        contentVersionId: content.id,
        actor,
        journeyId: journey.id,
        journeyActionId: action.id,
        simulatedTime: 1
      });
      const second = await openPost(tx, {
        runId: run.id,
        contentVersionId: content.id,
        actor,
        journeyId: journey.id,
        journeyActionId: action.id,
        simulatedTime: 2
      });
      expect(first.changed).toBe(true);
      expect(second.changed).toBe(false);
      expect(second.reason).toBe("already_opened");
    });

    const state = await prisma.simulatedPostState.findUniqueOrThrow({ where: { contentVersionId: content.id } });
    expect(state.openCount).toBe(1);
    const events = await prisma.socialInteractionEvent.findMany({
      where: { contentVersionId: content.id, interactionType: "open_post" }
    });
    expect(events).toHaveLength(2);
  });

  it("does not increment exitCount when an already finished journey exits again", async () => {
    const { run, content, audience, journey, action } = await createToolTestBundle(true);
    await prisma.$transaction(async (tx) => {
      const actor = {
        actorUserId: audience.userId,
        platformAccountId: audience.platformAccountId,
        participantId: audience.id,
        agentId: audience.agentId,
        source: "agent_tool" as const
      };
      const first = await exitBrowsing(tx, {
        runId: run.id,
        contentVersionId: content.id,
        actor,
        exitOutcome: "browsed_and_left",
        exitReason: "结束浏览",
        journeyId: journey.id,
        journeyActionId: action.id,
        simulatedTime: 1
      });
      const second = await exitBrowsing(tx, {
        runId: run.id,
        contentVersionId: content.id,
        actor,
        exitOutcome: "browsed_and_left",
        exitReason: "重复结束浏览",
        journeyId: journey.id,
        journeyActionId: action.id,
        simulatedTime: 2
      });
      expect(first.changed).toBe(true);
      expect(second.changed).toBe(false);
      expect(second.reason).toBe("journey_already_finished");
    });

    const state = await prisma.simulatedPostState.findUniqueOrThrow({ where: { contentVersionId: content.id } });
    expect(state.exitCount).toBe(1);
    const events = await prisma.socialInteractionEvent.findMany({
      where: { contentVersionId: content.id, interactionType: "exit_browsing" }
    });
    expect(events).toHaveLength(1);
  });

  it("persists AgentTurn raw audit fields (requestJson, rawResponseJson, parsedToolCallsJson, model, promptVersion)", async () => {
    const bundle = await createToolTestBundle(false);
    const requestJson = { model: "gpt-4o-mini", messages: [{ role: "user", content: "test" }] };
    const rawResponseJson = { id: "chatcmpl-123", choices: [{ message: { role: "assistant", content: "ok" } }] };
    const parsedToolCallsJson = [{ id: "call-1", type: "function", function: { name: "open_post", arguments: "{}" } }];

    await persistStep(bundle.action.id, {
      text: "测试想法",
      reasoningText: "模型推理文本",
      toolCalls: [{ toolCallId: "call-1", toolName: "open_post", input: {} }],
      finishReason: "tool_calls",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      request: requestJson,
      response: rawResponseJson,
      model: { modelId: "gpt-4o-mini" }
    } as unknown as StepResult<ToolSet>, { promptVersion: PROMPT_VERSION_AGENT });

    const turn = await prisma.agentTurn.findUniqueOrThrow({ where: { id: bundle.action.id } });
    expect(turn.requestJson).toEqual(requestJson);
    expect(turn.rawResponseJson).toEqual(rawResponseJson);
    expect(turn.parsedToolCallsJson).toEqual([
      expect.objectContaining({
        toolName: "open_post",
        sdkCallId: "call-1",
        rawToolCall: parsedToolCallsJson[0]
      })
    ]);
    expect(turn.model).toBe("gpt-4o-mini");
    expect(turn.promptVersion).toBe(PROMPT_VERSION_AGENT);

    const thoughtLog = await prisma.actionLog.findFirstOrThrow({
      where: { journeyActionId: bundle.action.id, action: "thought" }
    });
    expect(thoughtLog.eventKind).toBe("thought");
    expect(thoughtLog.eventPayloadJson).toMatchObject({
      content: "测试想法",
      reasoningContent: "模型推理文本",
      source: "agent_thought"
    });
  });

  it("redacts sensitive audit fields and fills missing audit fallbacks", async () => {
    const bundle = await createToolTestBundle(false);
    await persistStep(bundle.action.id, {
      text: "测试想法",
      toolCalls: [],
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      request: { unavailable: true, reason: "request_json_not_provided" },
      response: { apiKey: "should-not-persist", nested: { authorization: "Bearer secret" } },
      model: { modelId: "test-model" }
    } as unknown as StepResult<ToolSet>, { promptVersion: PROMPT_VERSION_AGENT });

    const turn = await prisma.agentTurn.findUniqueOrThrow({ where: { id: bundle.action.id } });
    expect(turn.requestJson).toMatchObject({ unavailable: true, reason: "request_json_not_provided" });
    expect(turn.rawResponseJson).toMatchObject({ apiKey: "[redacted]", nested: { authorization: "[redacted]" } });
    expect(turn.parsedToolCallsJson).toEqual([]);
  });

  it("redacts image data URLs from AgentTurn audit JSON", async () => {
    const bundle = await createToolTestBundle(false);
    const imageDataUrl = "data:image/png;base64,AQIDBAUG";
    await persistStep(bundle.action.id, {
      text: "测试想法",
      toolCalls: [],
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      request: { messages: [{ role: "user", content: [{ type: "image", image: imageDataUrl }] }] },
      response: { body: { echoed: imageDataUrl } },
      model: { modelId: "test-model" }
    } as unknown as StepResult<ToolSet>, { promptVersion: PROMPT_VERSION_AGENT });

    const turn = await prisma.agentTurn.findUniqueOrThrow({ where: { id: bundle.action.id } });
    const serialized = JSON.stringify({ request: turn.requestJson, response: turn.rawResponseJson });
    expect(serialized).not.toContain(imageDataUrl);
    expect(serialized).toContain("[redacted image/png data url");
  });

  it("persists per-step AI SDK usage traces and run-level totals", async () => {
    const { run } = await createToolTestBundle(false);
    const responses = [
      {
        id: "chatcmpl-trace-1",
        object: "chat.completion",
        created: 1,
        model: "trace-model",
        choices: [{
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_probe",
              type: "function",
              function: { name: "probe", arguments: JSON.stringify({ value: "x" }) }
            }]
          }
        }],
        usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }
      },
      {
        id: "chatcmpl-trace-2",
        object: "chat.completion",
        created: 2,
        model: "trace-model",
        choices: [{
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: "done" }
        }],
        usage: { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22 }
      }
    ];
    const provider = createOpenAICompatible({
      name: "trace-test",
      baseURL: "https://trace.test/v1",
      apiKey: "test-key",
      fetch: async () => {
        const response = responses.shift();
        if (!response) throw new Error("unexpected extra model call");
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    await generateText({
      model: provider.chatModel("trace-model"),
      prompt: "call the probe tool once, then finish",
      tools: {
        probe: tool({
          inputSchema: jsonSchema({
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
            additionalProperties: false
          }),
          execute: async () => ({ ok: true })
        })
      },
      stopWhen: stepCountIs(2),
      ...aiSdkTrace({
        runId: run.id,
        taskType: "trace_test",
        promptVersion: "trace_test_v1",
        metadata: { source: "integration_test" }
      })
    });

    const traces = await prisma.llmCallTrace.findMany({
      where: { runId: run.id, taskType: "trace_test" },
      orderBy: { stepNumber: "asc" }
    });
    expect(traces.map((trace) => ({
      stepNumber: trace.stepNumber,
      inputTokens: trace.inputTokens,
      outputTokens: trace.outputTokens,
      totalTokens: trace.totalTokens,
      finishReason: trace.finishReason
    }))).toEqual([
      { stepNumber: 0, inputTokens: 10, outputTokens: 1, totalTokens: 11, finishReason: "tool-calls" },
      { stepNumber: 1, inputTokens: 20, outputTokens: 2, totalTokens: 22, finishReason: "stop" }
    ]);
    expect(traces[0]!.metadataJson).toMatchObject({
      source: "integration_test",
      functionId: "trace_test",
      toolCallCount: 1
    });

    const summary = await prisma.runLlmUsageSummary.findUniqueOrThrow({ where: { runId: run.id } });
    expect(summary.callCount).toBe(2);
    expect(summary.inputTokens).toBe(30);
    expect(summary.outputTokens).toBe(3);
    expect(summary.totalTokens).toBe(33);
  });

  it("persists AgentToolCall.rawToolCallJson on executeAiSdkPlannedToolCall", async () => {
    const bundle = await createToolTestBundle(true);
    const rawToolCall = { id: "call-raw-1", type: "function", function: { name: "like_post", arguments: "{}" } };

    await executeAiSdkPlannedToolCall(bundle.action.id, {
      callIndex: 0,
      toolName: "like_post",
      args: { postId: bundle.action.contentVersionId },
      sdkCallId: "call-raw-1",
      idempotencyKey: `${bundle.action.runId}:${bundle.action.participantId}:${bundle.action.id}:0`,
      rawToolCall
    });

    const toolCall = await prisma.agentToolCall.findFirstOrThrow({
      where: { agentTurnId: bundle.action.id, callIndex: 0 }
    });
    expect(toolCall.rawToolCallJson).toEqual(rawToolCall);
    expect(toolCall.status).toBe("committed");
  });
});

describe("persistStep post-exit_browsing guard", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persists a step that contains exit_browsing tool call including preceding thought", async () => {
    const bundle = await createToolTestBundle(true);
    await executeAiSdkPlannedToolCall(bundle.action.id, {
      callIndex: 0,
      toolName: "exit_browsing",
      args: { reasonCategory: "no_more_action", readingDepth: "full", interestLevel: "medium", trustLevel: "medium" },
      idempotencyKey: `${bundle.action.runId}:${bundle.action.participantId}:${bundle.action.id}:0`,
      rawToolCall: { id: "call-exit", type: "function", function: { name: "exit_browsing", arguments: "{}" } }
    });

    const journey = await prisma.agentJourney.findUniqueOrThrow({ where: { id: bundle.action.journeyId } });
    expect(journey.status).toBe("finished");

    await persistStep(bundle.action.id, {
      text: "内容看完了，没什么要补充的，划走吧。",
      toolCalls: [{ toolCallId: "call-exit", toolName: "exit_browsing", input: { reasonCategory: "no_more_action", readingDepth: "full", interestLevel: "medium", trustLevel: "medium" } }],
      finishReason: "tool-calls",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      request: { body: { provider: "test" } },
      response: { body: { provider: "test" } },
      model: { modelId: "test-model" }
    } as unknown as StepResult<ToolSet>);

    const turn = await prisma.agentTurn.findUniqueOrThrow({ where: { id: bundle.action.id } });
    expect(turn.thoughtText).toBe("内容看完了，没什么要补充的，划走吧。");
    const thoughtLogs = await prisma.actionLog.findMany({
      where: { journeyActionId: bundle.action.id, action: "thought" }
    });
    expect(thoughtLogs.map((log) => log.thoughtText)).toEqual(["内容看完了，没什么要补充的，划走吧。"]);
  });

  it("does not persist trailing text-only step after journey is finished", async () => {
    const bundle = await createToolTestBundle(true);
    await executeAiSdkPlannedToolCall(bundle.action.id, {
      callIndex: 0,
      toolName: "exit_browsing",
      args: { reasonCategory: "no_more_action", readingDepth: "full", interestLevel: "medium", trustLevel: "medium" },
      idempotencyKey: `${bundle.action.runId}:${bundle.action.participantId}:${bundle.action.id}:0`,
      rawToolCall: { id: "call-exit", type: "function", function: { name: "exit_browsing", arguments: "{}" } }
    });

    const journey = await prisma.agentJourney.findUniqueOrThrow({ where: { id: bundle.action.journeyId } });
    expect(journey.status).toBe("finished");

    await persistStep(bundle.action.id, {
      text: "内容看完了，没什么要补充的，划走吧。",
      toolCalls: [{ toolCallId: "call-exit", toolName: "exit_browsing", input: { reasonCategory: "no_more_action", readingDepth: "full", interestLevel: "medium", trustLevel: "medium" } }],
      finishReason: "tool-calls",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      request: { body: { provider: "test" } },
      response: { body: { provider: "test" } },
      model: { modelId: "test-model" }
    } as unknown as StepResult<ToolSet>);

    await persistStep(bundle.action.id, {
      text: "任务完成，用户已离开。",
      toolCalls: [],
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      request: { body: { provider: "test" } },
      response: { body: { provider: "test" } },
      model: { modelId: "test-model" }
    } as unknown as StepResult<ToolSet>);

    const turn = await prisma.agentTurn.findUniqueOrThrow({ where: { id: bundle.action.id } });
    expect(turn.thoughtText).toBe("内容看完了，没什么要补充的，划走吧。");
    const thoughtLogs = await prisma.actionLog.findMany({
      where: { journeyActionId: bundle.action.id, action: "thought" },
      orderBy: { createdAt: "asc" }
    });
    expect(thoughtLogs.map((log) => log.thoughtText)).toEqual(["内容看完了，没什么要补充的，划走吧。"]);
  });
});
