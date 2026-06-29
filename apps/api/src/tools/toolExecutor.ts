import type {
  RunParticipant,
  ContentVersion,
  AgentJourney,
  AgentTurn,
  JourneyExitOutcome,
  AgentToolCall,
  AgentToolCallStatus,
  Prisma,
  SimulatedPostState
} from "@trycue/db";
import { prisma } from "@trycue/db";
import {
  categoryForTool,
  type ExitReasonCategory,
  type ExitReadingDepth,
  type InterestTrustLevel,
  type LiveEventEnvelope,
  type ReadDepth,
  type ToolName
} from "@trycue/shared";
import { jsonSchema, tool, type StepResult, type Tool, type ToolSet } from "ai";
import { recordLiveEvent, pushLiveEvent } from "../liveEvents.js";
import { commentUpdatePatch, commentView, deriveSeatStatus, logView, postStateView } from "../views.js";
import type { ParsedToolCall } from "../agents/types.js";
import { getRunSimulatedTime } from "../runtime/clock.js";
import { parseCommentSort } from "../runtime/comments.js";
import { createComment, exitBrowsing, likeComment, openPost, readPost, setPostReaction, sharePost, viewComments, type ActorContext } from "../runtime/interactions.js";
import {
  ALL_TOOLS,
  appendAssistantMessageItem,
  appendInitialObservation,
  appendSystemNoticeItem,
  appendToolResultItem,
  buildPostObservation,
  contentImageUrls,
  renderSessionMessages
} from "../runtime/agentSessions.js";

import { PROMPT_VERSION_AGENT, PROMPT_VERSION_AGENT_V1 } from "../agents/promptVersions.js";
import { MAX_COMMENT_LENGTH } from "@trycue/shared";

export type ActionBundle = {
  action: AgentTurn;
  journey: AgentJourney;
  audience: RunParticipant;
  contentVersion: ContentVersion;
};

export type ToolContext = {
  tx: Prisma.TransactionClient;
  action: AgentTurn;
  journey: AgentJourney;
  audience: RunParticipant;
  contentVersion: ContentVersion;
  toolCall: AgentToolCall;
  simulatedTime: number;
};

function actorForAction(action: AgentTurn, audience?: RunParticipant | null): ActorContext {
  return {
    actorUserId: action.actorUserId,
    platformAccountId: action.platformAccountId,
    participantId: action.participantId,
    agentId: audience?.agentId ?? undefined,
    source: "agent_tool"
  };
}

/**
 * Derive whether the journey has entered the post phase by checking for a
 * committed open_post interaction event. Phase is now event-driven, not a
 * stored enum field. See docs/04 §2 invariant 8 ("open_post is the only
 * feed-to-post phase transition") and docs/18 §4.
 */
async function journeyHasOpenedPost(
  tx: Prisma.TransactionClient,
  journey: { id: string; contentVersionId: string; actorUserId: string; platformAccountId: string }
): Promise<boolean> {
  const event = await tx.socialInteractionEvent.findFirst({
    where: {
      contentVersionId: journey.contentVersionId,
      actorUserId: journey.actorUserId,
      platformAccountId: journey.platformAccountId,
      interactionType: "open_post",
      targetType: "post",
      targetId: journey.contentVersionId
    },
    select: { id: true }
  });
  return !!event;
}

type ToolExecutionResult = {
  status: "committed" | "ignored" | "failed";
  events: Array<{ sequence: string; eventType: string; payload: LiveEventEnvelope }>;
};

// ── Tool call state machine ──
// AGENTS.md: tool call status is `pending | committed | ignored | failed`.
// Only pending tool calls may transition to a terminal state. Terminal states
// are immutable. This whitelist makes the implicit state machine explicit and
// fails fast on illegal transitions instead of silently overwriting.
const ALLOWED_TOOL_CALL_TRANSITIONS: Record<AgentToolCallStatus, AgentToolCallStatus[]> = {
  pending: ["committed", "ignored", "failed"],
  committed: [],
  ignored: [],
  failed: []
};

function assertToolCallTransition(current: AgentToolCallStatus, target: AgentToolCallStatus): void {
  const allowed = ALLOWED_TOOL_CALL_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new Error(`Illegal tool call status transition: ${current} → ${target}`);
  }
}

type RegisteredToolIdentity = {
  toolName: ToolName;
  args: Record<string, unknown>;
  sdkCallId: string;
  callIndex: number;
  idempotencyKey: string;
};

export type AiSdkToolRuntimeContext = {
  runId: string;
  participantId: string;
  currentAgentTurnId: string;
  registerToolCall: (toolName: ToolName, args: Record<string, unknown>, sdkCallId: string) => RegisteredToolIdentity;
  resolveToolCallIdentity: (toolName: ToolName, args: Record<string, unknown>, sdkCallId: string | undefined) => RegisteredToolIdentity;
};

export function createAiSdkToolRuntimeContext(input: {
  runId: string;
  participantId: string;
  actionId: string;
}): AiSdkToolRuntimeContext {
  const identitiesByTurn = new Map<string, RegisteredToolIdentity[]>();
  const identitiesBySdkCallId = new Map<string, RegisteredToolIdentity>();
  const ctx: AiSdkToolRuntimeContext = {
    runId: input.runId,
    participantId: input.participantId,
    currentAgentTurnId: input.actionId,
    registerToolCall(toolName, args, sdkCallId) {
      const existing = identitiesBySdkCallId.get(sdkCallId);
      if (existing) return existing;
      const turnId = ctx.currentAgentTurnId;
      const turnIdentities = identitiesByTurn.get(turnId) ?? [];
      identitiesByTurn.set(turnId, turnIdentities);
      const callIndex = turnIdentities.length;
      const identity = {
        toolName,
        args,
        sdkCallId,
        callIndex,
        idempotencyKey: `${ctx.runId}:${ctx.participantId}:${turnId}:${callIndex}`
      };
      turnIdentities.push(identity);
      identitiesBySdkCallId.set(sdkCallId, identity);
      return identity;
    },
    resolveToolCallIdentity(toolName, args, sdkCallId) {
      if (!sdkCallId) {
        throw new Error(`AI SDK did not provide toolCallId for ${toolName}.`);
      }
      const identity = identitiesBySdkCallId.get(sdkCallId);
      if (!identity) {
        throw new Error(`Tool call ${sdkCallId} was not registered before execute; refusing to assign callIndex from execute order.`);
      }
      assertRegisteredToolCallMatches(identity, toolName, args);
      return identity;
    }
  };
  return ctx;
}

export function createAiSdkToolSet(ctx: AiSdkToolRuntimeContext): ToolSet {
  const executeTool = async (
    toolName: ToolName,
    args: Record<string, unknown>,
    sdkCallId: string | undefined,
    business: (txCtx: ToolContext, args: Record<string, unknown>) => Promise<ToolExecutionResult>
  ) => {
    const identity = ctx.resolveToolCallIdentity(toolName, args, sdkCallId);
    return withToolContext(ctx.currentAgentTurnId, {
      ...identity,
      toolName,
      args,
      rawToolCall: {
        id: sdkCallId,
        type: "function",
        function: { name: toolName, arguments: JSON.stringify(args) }
      }
    }, (txCtx) => business(txCtx, args));
  };

  const register = (toolName: ToolName, args: Record<string, unknown>, sdkCallId: string) => {
    ctx.registerToolCall(toolName, args, sdkCallId);
  };

  return {
    open_post: tool({
      description: "点开当前信息流帖子。适用于标题、封面、作者或首屏信息让你产生了继续看的兴趣。点开代表你愿意花更多时间了解详情，但不代表认可内容。点开后返回当前帖子的完整可观察信息和 postId。",
      inputSchema: jsonSchema({ type: "object", properties: {}, additionalProperties: false }),
      onInputAvailable: async ({ toolCallId }) => register("open_post", {}, toolCallId),
      execute: async (_args, { toolCallId }) => executeTool("open_post", {}, toolCallId, (txCtx) =>
        commitOpenPost(txCtx.tx, txCtx.action, txCtx.journey, txCtx.audience, txCtx.toolCall, txCtx.simulatedTime)
      ),
      toModelOutput: async ({ output }) => {
        // Do not return AI SDK content parts here. On the OpenAI-compatible
        // path, tool content parts are stringified into tool.content; data URL
        // images would become text tokens. Images are sent in the initial user
        // observation instead.
        const record = output as Record<string, unknown>;
        return { type: "text", value: JSON.stringify(record) };
      }
    }),
    read_post: runtimeTool({
      description: "阅读当前帖子正文。适用于你想继续看内容，但还没有明确点赞、收藏、评论或分享冲动的时候。depth 表示阅读深度：skim 快速扫几眼，partial 认真看了一部分，full 基本看完。focus 可以填写你这次主要关注的关键词（例如价格、材料、步骤、风险、证据），最多 3 个，不要编造正文里没有的信息。这是“看了但不互动”的中间状态，不改变任何计数。",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          postId: { type: "string" },
          depth: { type: "string", enum: ["skim", "partial", "full"] },
          focus: { type: "array", items: { type: "string" }, maxItems: 3 }
        },
        required: ["postId", "depth"],
        additionalProperties: false
      }),
      onInputAvailable: async ({ input, toolCallId }) => register("read_post", objectRecord(input), toolCallId),
      execute: async (args, { toolCallId }) => executeTool("read_post", objectRecord(args), toolCallId, (txCtx, input) =>
        commitReadPost(txCtx.tx, txCtx.action, txCtx.journey, txCtx.audience, txCtx.toolCall, input, txCtx.simulatedTime)
      )
    }),
    view_comments: runtimeTool({
      description: "查看或继续翻页评论区。适用于你想验证内容真实性、寻找其他人的补充经验、看看有没有争议、反例或更多细节。不是每次打开帖子都必须看评论。必须传入 open_post 返回的 postId。可选传入 sort（latest 或 hot，默认 latest）和 cursor（翻页用）。",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          postId: { type: "string" },
          cursor: { type: "string" },
          sort: { type: "string", enum: ["latest", "hot"] }
        },
        required: ["postId"],
        additionalProperties: false
      }),
      onInputAvailable: async ({ input, toolCallId }) => register("view_comments", objectRecord(input), toolCallId),
      execute: async (args, { toolCallId }) => executeTool("view_comments", objectRecord(args), toolCallId, (txCtx, input) =>
        commitViewComments(txCtx.tx, txCtx.action, txCtx.journey, txCtx.audience, txCtx.toolCall, input, txCtx.simulatedTime)
      )
    }),
    like_post: postTool("like_post", "点赞当前帖子。适用于你觉得内容有帮助、认同、情绪上支持，或者某个点说中了你的感受。点赞是低成本互动，但不要为了表示“看过”而点赞。必须传入 postId。", (txCtx) =>
      commitLikePost(txCtx.tx, txCtx.action, txCtx.journey, txCtx.toolCall, txCtx.simulatedTime)
    ),
    favorite_post: postTool("favorite_post", "收藏当前帖子。适用于你觉得内容以后可能要复查、照做、对比，或包含清单、步骤、价格、材料、避坑、案例等可保存信息。收藏通常比点赞更强，不要随意收藏。必须传入 postId。", (txCtx) =>
      commitFavoritePost(txCtx.tx, txCtx.action, txCtx.journey, txCtx.toolCall, txCtx.simulatedTime)
    ),
    share_post: postTool("share_post", "分享当前帖子。分享是低频强行为，只有当你明确想发给家人、朋友、同事或群聊，并且内容对对方有直接帮助、提醒价值或讨论价值时使用。必须传入 postId。", (txCtx) =>
      commitSharePost(txCtx.tx, txCtx.action, txCtx.journey, txCtx.audience, txCtx.toolCall, txCtx.simulatedTime)
    ),
    write_comment: runtimeTool({
      description: "发表评论或回复评论。只有当你有明确表达冲动时使用，例如提问、质疑、补充经验、表达共鸣、调侃、反驳。评论内容按你的 persona 和平台表达习惯自然生成，不要写成评审报告、总结或建议书。intent 标记你的评论意图：ask 提问、doubt 质疑、share_experience 补充个人经验、agree 认同/共鸣、joke 梗/调侃、pushback 反驳/不同意。必须传入 postId 和 intent；回复某条评论时额外传 replyToCommentId。",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          postId: { type: "string" },
          intent: { type: "string", enum: ["ask", "doubt", "share_experience", "agree", "joke", "pushback"] },
          content: { type: "string" },
          replyToCommentId: { type: "string" }
        },
        required: ["postId", "intent", "content"],
        additionalProperties: false
      }),
      onInputAvailable: async ({ input, toolCallId }) => register("write_comment", objectRecord(input), toolCallId),
      execute: async (args, { toolCallId }) => executeTool("write_comment", objectRecord(args), toolCallId, (txCtx, input) =>
        commitWriteComment(txCtx.tx, txCtx.action, txCtx.journey, txCtx.audience, txCtx.toolCall, input, txCtx.simulatedTime)
      )
    }),
    like_comment: runtimeTool({
      description: "点赞一条你已经看到的评论。适用于这条评论说出了你的想法、提供了有用补充，或你认同它的质疑、经验或玩笑。只能点赞你已经通过 view_comments 看过的评论，不能凭空点赞。必须传入 commentId。",
      inputSchema: jsonSchema({
        type: "object",
        properties: { commentId: { type: "string" } },
        required: ["commentId"],
        additionalProperties: false
      }),
      onInputAvailable: async ({ input, toolCallId }) => register("like_comment", objectRecord(input), toolCallId),
      execute: async (args, { toolCallId }) => executeTool("like_comment", objectRecord(args), toolCallId, (txCtx, input) =>
        commitLikeComment(txCtx.tx, txCtx.action, txCtx.journey, txCtx.audience, txCtx.toolCall, input, txCtx.simulatedTime)
      )
    }),
    exit_browsing: runtimeTool({
      description: "结束本次浏览。适用于你没有继续阅读、互动或停留的动机时。这是关键证据工具，离开时需要记录原因分类 reasonCategory、阅读深度 readingDepth、兴趣水平 interestLevel 和信任水平 trustLevel，代表真实用户划走、关闭或结束浏览。reasonCategory：not_relevant 与我无关、not_interested 不感兴趣、low_trust 信任不足、too_ad_like 广告感太强、content_too_long 内容太长、need_more_evidence 需要更多证据、finished_normally 正常看完离开、no_more_action 没有更多动作。readingDepth：feed_only 只看了信息流卡片、skimmed 快速扫读、partial 看了一部分、full 基本看完。",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          reasonCategory: { type: "string", enum: ["not_relevant", "not_interested", "low_trust", "too_ad_like", "content_too_long", "need_more_evidence", "finished_normally", "no_more_action"] },
          readingDepth: { type: "string", enum: ["feed_only", "skimmed", "partial", "full"] },
          interestLevel: { type: "string", enum: ["low", "medium", "high"] },
          trustLevel: { type: "string", enum: ["low", "medium", "high"] }
        },
        required: ["reasonCategory", "readingDepth", "interestLevel", "trustLevel"],
        additionalProperties: false
      }),
      onInputAvailable: async ({ input, toolCallId }) => register("exit_browsing", objectRecord(input), toolCallId),
      execute: async (args, { toolCallId }) => executeTool("exit_browsing", objectRecord(args), toolCallId, (txCtx, input) =>
        commitExitBrowsing(txCtx.tx, txCtx.action, txCtx.journey, txCtx.audience, txCtx.toolCall, input, txCtx.simulatedTime)
      )
    })
  } satisfies Record<ToolName, Tool>;

  function postTool(
    toolName: Extract<ToolName, "like_post" | "favorite_post" | "share_post">,
    description: string,
    business: (txCtx: ToolContext) => Promise<ToolExecutionResult>
  ) {
    return runtimeTool({
      description,
      inputSchema: jsonSchema({
        type: "object",
        properties: { postId: { type: "string" } },
        required: ["postId"],
        additionalProperties: false
      }),
      onInputAvailable: async ({ input, toolCallId }) => register(toolName, objectRecord(input), toolCallId),
      execute: async (args, { toolCallId }) => executeTool(toolName, objectRecord(args), toolCallId, (txCtx) => business(txCtx))
    });
  }
}

function runtimeTool(config: {
  description: string;
  inputSchema: ReturnType<typeof jsonSchema>;
  onInputAvailable: (options: { input: unknown; toolCallId: string }) => void | Promise<void>;
  execute: (input: unknown, options: { toolCallId: string }) => Promise<Record<string, unknown>>;
}): Tool<Record<string, unknown>, Record<string, unknown>> {
  return tool(config as never) as Tool<Record<string, unknown>, Record<string, unknown>>;
}

export async function withToolContext(
  actionId: string,
  call: {
    toolName: ToolName;
    callIndex: number;
    sdkCallId?: string;
    idempotencyKey: string;
    args: Record<string, unknown>;
    rawToolCall?: Record<string, unknown>;
  },
  business: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolExecutionResult>
): Promise<Record<string, unknown>> {
  const { output, events, runId } = await prisma.$transaction(async (tx) => {
    let action = await tx.agentTurn.findUniqueOrThrow({ where: { id: actionId } });
    const journey = await tx.agentJourney.findUniqueOrThrow({ where: { id: action.journeyId } });
    const audience = await tx.runParticipant.findUniqueOrThrow({ where: { id: action.participantId } });
    const contentVersion = await tx.contentVersion.findUniqueOrThrow({ where: { id: action.contentVersionId } });
    const simulatedTime = await getRunSimulatedTime(tx, action.runId);

    const existingByKey = await tx.agentToolCall.findUnique({
      where: { idempotencyKey: call.idempotencyKey }
    });
    const existingByIndex = await tx.agentToolCall.findUnique({
      where: {
        agentTurnId_callIndex: {
          agentTurnId: action.id,
          callIndex: call.callIndex
        }
      }
    });
    const existing = existingByKey ?? existingByIndex;
    if (existing) assertExistingToolCallMatches(existing, call);
    if (existing && existing.status !== "pending") {
      const hasResult = await tx.agentTranscriptItem.findFirst({
        where: { journeyId: action.journeyId, toolCallId: existing.id, itemType: "tool_result" },
        select: { id: true }
      });
      if (!hasResult) await appendToolResultItem(tx, action, existing);
      return { output: objectRecord(existing.output), events: [], runId: action.runId };
    }

    const toolCall = existing ?? await tx.agentToolCall.create({
      data: {
        agentTurnId: action.id,
        runId: action.runId,
        journeyId: action.journeyId,
        participantId: action.participantId,
        actorUserId: action.actorUserId,
        platformAccountId: action.platformAccountId,
        source: "agent_tool",
        contentVersionId: action.contentVersionId,
        callIndex: call.callIndex,
        sdkCallId: call.sdkCallId,
        idempotencyKey: call.idempotencyKey,
        rawToolCallJson: call.rawToolCall as Prisma.InputJsonValue ?? undefined,
        toolName: call.toolName,
        toolCategory: categoryForTool(call.toolName),
        input: call.args as Prisma.InputJsonValue,
        output: {},
        simulatedTime
      }
    });

    const normalizedArgs = normalizeToolArgs(call.toolName, call.args);
    const invalid = await validateAiSdkToolCall(tx, action, journey, call.toolName, normalizedArgs);
    if (invalid) {
      const ignored = await markToolIgnored(tx, action, toolCall.id, invalid.reason, invalid.output);
      return { output: objectRecord(ignored.output), events: [], runId: action.runId };
    }

    const result = await business({
      tx,
      action,
      journey,
      audience,
      contentVersion,
      toolCall,
      simulatedTime
    }, normalizedArgs);
    const updated = await tx.agentToolCall.findUniqueOrThrow({ where: { id: toolCall.id } });
    return { output: objectRecord(updated.output), events: result.events, runId: action.runId };
  });
  for (const event of events) pushLiveEvent(runId, event);
  return output;
}

export async function executeAiSdkPlannedToolCall(
  actionId: string,
  call: {
    toolName: ToolName;
    callIndex: number;
    sdkCallId?: string;
    idempotencyKey: string;
    args: Record<string, unknown>;
    rawToolCall?: Record<string, unknown>;
  }
): Promise<Record<string, unknown>> {
  return withToolContext(actionId, call, (txCtx, args) => {
    switch (call.toolName) {
      case "open_post":
        return commitOpenPost(txCtx.tx, txCtx.action, txCtx.journey, txCtx.audience, txCtx.toolCall, txCtx.simulatedTime);
      case "read_post":
        return commitReadPost(txCtx.tx, txCtx.action, txCtx.journey, txCtx.audience, txCtx.toolCall, args, txCtx.simulatedTime);
      case "view_comments":
        return commitViewComments(txCtx.tx, txCtx.action, txCtx.journey, txCtx.audience, txCtx.toolCall, args, txCtx.simulatedTime);
      case "like_post":
        return commitLikePost(txCtx.tx, txCtx.action, txCtx.journey, txCtx.toolCall, txCtx.simulatedTime);
      case "favorite_post":
        return commitFavoritePost(txCtx.tx, txCtx.action, txCtx.journey, txCtx.toolCall, txCtx.simulatedTime);
      case "share_post":
        return commitSharePost(txCtx.tx, txCtx.action, txCtx.journey, txCtx.audience, txCtx.toolCall, txCtx.simulatedTime);
      case "write_comment":
        return commitWriteComment(txCtx.tx, txCtx.action, txCtx.journey, txCtx.audience, txCtx.toolCall, args, txCtx.simulatedTime);
      case "like_comment":
        return commitLikeComment(txCtx.tx, txCtx.action, txCtx.journey, txCtx.audience, txCtx.toolCall, args, txCtx.simulatedTime);
      case "exit_browsing":
        return commitExitBrowsing(txCtx.tx, txCtx.action, txCtx.journey, txCtx.audience, txCtx.toolCall, args, txCtx.simulatedTime);
    }
  });
}

export async function persistStep(
  agentTurnId: string,
  step: StepResult<ToolSet>,
  audit: { promptVersion: string } = { promptVersion: PROMPT_VERSION_AGENT }
) {
  const action = await prisma.agentTurn.findUniqueOrThrow({ where: { id: agentTurnId } });
  const toolCalls = step.toolCalls.map((toolCall, callIndex) => ({
    toolName: toolCall.toolName as ToolName,
    args: objectRecord(toolCall.input),
    sdkCallId: toolCall.toolCallId,
    callIndex,
    idempotencyKey: idempotencyKeyFor(action, callIndex),
    rawToolCall: {
      id: toolCall.toolCallId,
      type: "function",
      function: {
        name: toolCall.toolName,
        arguments: JSON.stringify(toolCall.input)
      }
    }
  }));
  const trimmedThought = step.text.trim();
  const reasoningText = step.reasoningText?.trim() || null;
  const events = await prisma.$transaction(async (tx) => {
    const current = await tx.agentTurn.findUniqueOrThrow({ where: { id: agentTurnId } });
    const simulatedTime = await getRunSimulatedTime(tx, current.runId);
    if (trimmedThought || reasoningText || toolCalls.length) {
      await appendAssistantMessageItem(tx, current.journeyId, current.runId, current, trimmedThought, {
        modelOutput: { model: step.model.modelId, promptVersion: audit.promptVersion }
      } as Prisma.InputJsonValue, {
        reasoningContent: reasoningText,
        toolCalls
      });
    }
    await tx.agentTurn.update({
      where: { id: current.id },
      data: {
        thoughtText: trimmedThought || null,
        reasoningContent: reasoningText,
        rawAgentOutputJson: sanitizeAuditJson({
          text: step.text,
          reasoningText: step.reasoningText,
          toolCalls,
          finishReason: step.finishReason,
          rawFinishReason: step.rawFinishReason,
          usage: step.usage
        }) as Prisma.InputJsonValue,
        requestJson: sanitizeAuditJson(step.request) as Prisma.InputJsonValue,
        rawResponseJson: sanitizeAuditJson(step.response) as Prisma.InputJsonValue,
        parsedToolCallsJson: sanitizeAuditJson(toolCalls) as Prisma.InputJsonValue,
        model: step.model.modelId,
        promptVersion: audit.promptVersion
      }
    });
    if (!trimmedThought) return [];
    const log = await tx.actionLog.create({
      data: {
        runId: current.runId,
        contentVersionId: current.contentVersionId,
        participantId: current.participantId,
        actorUserId: current.actorUserId,
        platformAccountId: current.platformAccountId,
        journeyId: current.journeyId,
        journeyActionId: current.id,
        simulatedTime,
        logText: trimmedThought,
        action: "thought",
        thoughtText: trimmedThought,
        topicTagsJson: [],
        riskTagsJson: inferRiskTags(trimmedThought),
        eventKind: "thought",
        eventPayloadJson: {
          content: trimmedThought,
          reasoningContent: reasoningText ?? undefined,
          source: "agent_thought"
        } as Prisma.InputJsonValue
      }
    });
    return [await recordLiveEvent(tx, {
      runId: current.runId,
      eventType: "action_log.created",
      payload: {
        contentVersionId: current.contentVersionId,
        simulatedTime,
        log: logView(log, await tx.runParticipant.findUniqueOrThrow({ where: { id: current.participantId } }))
      }
    })];
  });
  for (const event of events) pushLiveEvent(action.runId, event);
}

export async function completeAiSdkStepAndPrepareNext(
  agentTurnId: string,
  step: StepResult<ToolSet>,
  maxSteps: number
): Promise<string | null> {
  const event = await prisma.$transaction(async (tx) => {
    const current = await tx.agentTurn.findUniqueOrThrow({ where: { id: agentTurnId } });
    if (current.status !== "completed") {
      await tx.agentTurn.update({
        where: { id: current.id },
        data: { status: "completed", completedAt: new Date(), lockedAt: null, lockedBy: null }
      });
    }
    const journey = await tx.agentJourney.findUniqueOrThrow({ where: { id: current.journeyId } });
    const audience = await tx.runParticipant.findUniqueOrThrow({ where: { id: current.participantId } });
    if (journey.status !== "active") {
      return { nextTurnId: null, event: null };
    }

    const nextStep = current.stepIndex + 1;
    if (step.toolCalls.length === 0) {
      // Thought-only turn: instead of ending the journey, advance to next step
      // and insert a system notice guiding the agent to take action
      if (nextStep >= maxSteps) {
        const statusEvent = await finishJourneyAtMaxStepsTx(tx, journey, nextStep);
        return { nextTurnId: null, event: statusEvent };
      }
      const hasOpenedPostForGuidance = await journeyHasOpenedPost(tx, journey);
      const guidance = hasOpenedPostForGuidance
        ? "这句想法已经记录。请把当前状态转成一个自然浏览动作：继续看用 read_post，准备离开用 exit_browsing，有明确冲动再互动。"
        : "这句想法已经记录。请把当前状态转成一个自然浏览动作：想看详情用 open_post，准备离开用 exit_browsing。";
      await appendSystemNoticeItem(tx, journey.id, journey.runId, guidance);
      await tx.agentJourney.update({
        where: { id: journey.id },
        data: { currentStepIndex: nextStep }
      });
      await tx.runParticipant.update({
        where: { id: current.participantId },
        data: { runtimeStatus: "thinking" }
      });
      const existing = await tx.agentTurn.findUnique({
        where: {
          journeyId_stepIndex: {
            journeyId: journey.id,
            stepIndex: nextStep
          }
        }
      });
      const nextTurn = existing
        ? await tx.agentTurn.update({
          where: { id: existing.id },
          data: {
            status: existing.status === "completed" ? "completed" : "created",
            lockedBy: null,
            lockedAt: null,
            startedAt: existing.startedAt ?? new Date()
          }
        })
        : await tx.agentTurn.create({
          data: {
            runId: journey.runId,
            participantId: journey.participantId,
            actorUserId: journey.actorUserId,
            platformAccountId: journey.platformAccountId,
            journeyId: journey.id,
            contentVersionId: journey.contentVersionId,
            stepIndex: nextStep,
            queueSeq: BigInt(nextStep),
            status: "created",
            model: current.model,
            promptVersion: current.promptVersion
          }
        });
      return { nextTurnId: nextTurn.status === "completed" ? null : nextTurn.id, event: null };
    }
    if (nextStep >= maxSteps) {
      const statusEvent = await finishJourneyAtMaxStepsTx(tx, journey, nextStep);
      return { nextTurnId: null, event: statusEvent };
    }

    await tx.agentJourney.update({
      where: { id: journey.id },
      data: { currentStepIndex: nextStep }
    });
    await tx.runParticipant.update({
      where: { id: current.participantId },
      data: { runtimeStatus: "thinking" }
    });
    const existing = await tx.agentTurn.findUnique({
      where: {
        journeyId_stepIndex: {
          journeyId: journey.id,
          stepIndex: nextStep
        }
      }
    });
    const nextTurn = existing
      ? await tx.agentTurn.update({
        where: { id: existing.id },
        data: {
          status: existing.status === "completed" ? "completed" : "created",
          lockedBy: null,
          lockedAt: null,
          startedAt: existing.startedAt ?? new Date()
        }
      })
      : await tx.agentTurn.create({
        data: {
          runId: current.runId,
          participantId: current.participantId,
          actorUserId: current.actorUserId,
          platformAccountId: current.platformAccountId,
          journeyId: current.journeyId,
          contentVersionId: current.contentVersionId,
          stepIndex: nextStep,
          queueSeq: BigInt(nextStep),
          status: "created",
          startedAt: new Date()
        }
      });
    const existingContext = await tx.agentTurnContext.findUnique({
      where: { agentTurnId: nextTurn.id },
      select: { id: true }
    });
    if (!existingContext) {
      const transcriptItems = await tx.agentTranscriptItem.findMany({
        where: { journeyId: journey.id },
        orderBy: [{ createdAt: "asc" }, { seq: "asc" }]
      });
      const messages = await renderSessionMessages(transcriptItems);
      const hasOpenedPost = await journeyHasOpenedPost(tx, journey);
      const contextJson = {
        persona: audience.agentSnapshotJson,
        displayName: audience.displayNameSnapshot,
        current_screen_snapshot: {
          hasOpenedPost,
          transcriptItemCount: transcriptItems.length
        },
        simulated_post_state: {},
        comments_page: {},
        available_tools_now: ALL_TOOLS,
        messages,
        last_action_summary: "",
        run_constraints: {
          max_steps_per_journey: maxSteps,
          can_use_multiple_tools: true,
          can_have_thought_only_turn: true,
          tool_use_must_reflect_real_user_behavior: true
        }
      };
      await tx.agentTurnContext.create({
        data: {
          agentTurnId: nextTurn.id,
          screenBeforeJson: contextJson.current_screen_snapshot,
          postStateBeforeJson: contextJson.simulated_post_state,
          commentsPageJson: contextJson.comments_page,
          thoughtSummary: journey.thoughtSummary,
          availableToolsJson: contextJson.available_tools_now,
          inputContextJson: contextJson as unknown as Prisma.InputJsonValue,
          model: current.model ?? "unknown",
          promptVersion: current.promptVersion ?? PROMPT_VERSION_AGENT
        }
      });
    }
    return { nextTurnId: nextTurn.status === "completed" ? null : nextTurn.id, event: null };
  });
  if (event.event) pushLiveEvent(event.event.payload.runId, event.event);
  return event.nextTurnId;
}

type ValidationFailure = {
  reason: string;
  output?: Record<string, unknown>;
};

async function validateToolCall(
  tx: Prisma.TransactionClient,
  action: AgentTurn,
  journey: AgentJourney,
  toolName: ToolName,
  args: Record<string, unknown>
): Promise<ValidationFailure | null> {
  if (journey.status !== "active") {
    return { reason: "journey_finished", output: { ok: false, reason: "journey_finished" } };
  }
  // Screen-based tool filtering (feed phase only allows open_post / exit_browsing)
  // is handled by the caller `validateAiSdkToolCall` before reaching here,
  // so this function only checks tool-internal idempotency / input validity.
  if (toolName === "like_post" || toolName === "favorite_post") {
    const reaction = await tx.socialReaction.findFirst({
      where: {
        contentVersionId: journey.contentVersionId,
        actorUserId: journey.actorUserId,
        platformAccountId: journey.platformAccountId,
        targetType: "post",
        targetId: journey.contentVersionId,
        reactionType: toolName === "like_post" ? "like" : "favorite",
        active: true
      }
    });
    if (reaction) {
      const state = await tx.simulatedPostState.findUniqueOrThrow({ where: { contentVersionId: action.contentVersionId } });
      if (toolName === "like_post") {
        return {
          reason: "already_liked",
          output: { ok: false, reason: "already_liked", liked: true, likeCount: state.likeCount }
        };
      }
      return {
        reason: "already_favorited",
        output: { ok: false, reason: "already_favorited", favorited: true, favoriteCount: state.favoriteCount }
      };
    }
  }
  if (toolName === "write_comment") {
    const content = typeof args.content === "string" ? args.content.trim() : "";
    if (!content) return { reason: "comment_content_required", output: { ok: false, reason: "comment_content_required" } };
    if (content.length > MAX_COMMENT_LENGTH) return { reason: "comment_content_too_long", output: { ok: false, reason: "comment_content_too_long" } };
    const intent = commentIntentArg(args);
    if (!intent) return { reason: "comment_intent_required", output: { ok: false, reason: "comment_intent_required" } };
    const replyTo = replyToCommentIdArg(args);
    if (replyTo) {
      const exists = await tx.simulatedComment.findFirst({
        where: { id: replyTo, contentVersionId: journey.contentVersionId }
      });
      if (!exists) return { reason: "reply_target_comment_not_found", output: { ok: false, reason: "reply_target_comment_not_found" } };
    }
  }
  if (toolName === "read_post") {
    const depth = readDepthArg(args);
    if (!depth) return { reason: "read_depth_required", output: { ok: false, reason: "read_depth_required" } };
    const focus = readFocusArg(args);
    if (focus === null) return { reason: "read_focus_invalid", output: { ok: false, reason: "read_focus_invalid" } };
  }
  if (toolName === "exit_browsing") {
    const reasonCategory = exitReasonCategoryArg(args);
    if (!reasonCategory) return { reason: "exit_reason_category_required", output: { ok: false, reason: "exit_reason_category_required" } };
    const readingDepth = exitReadingDepthArg(args);
    if (!readingDepth) return { reason: "exit_reading_depth_required", output: { ok: false, reason: "exit_reading_depth_required" } };
    const interestLevel = interestTrustLevelArg(args.interestLevel);
    if (!interestLevel) return { reason: "exit_interest_level_required", output: { ok: false, reason: "exit_interest_level_required" } };
    const trustLevel = interestTrustLevelArg(args.trustLevel);
    if (!trustLevel) return { reason: "exit_trust_level_required", output: { ok: false, reason: "exit_trust_level_required" } };
  }
  if (toolName === "like_comment") {
    const commentId = commentIdArg(args);
    if (!commentId) return { reason: "comment_id_required", output: { ok: false, reason: "comment_id_required" } };
    const target = await tx.simulatedComment.findFirst({
      where: { id: commentId, contentVersionId: journey.contentVersionId }
    });
    if (!target) return { reason: "target_comment_not_found", output: { ok: false, reason: "target_comment_not_found" } };
    const reaction = await tx.socialReaction.findFirst({
      where: {
        contentVersionId: journey.contentVersionId,
        actorUserId: journey.actorUserId,
        platformAccountId: journey.platformAccountId,
        targetType: "comment",
        targetId: commentId,
        reactionType: "like",
        active: true
      }
    });
    if (reaction) return { reason: "comment_already_liked", output: { ok: false, reason: "comment_already_liked", commentId, liked: true, likeCount: target.likeCount } };
  }
  if (toolName === "view_comments") {
    const cursor = typeof args.cursor === "string" ? args.cursor : null;
    const storedCursor = cursor ?? "";
    const sort = parseCommentSort(typeof args.sort === "string" ? args.sort : null);
    const duplicate = await tx.loadedCommentPage.findFirst({
      where: {
        contentVersionId: journey.contentVersionId,
        actorUserId: journey.actorUserId,
        platformAccountId: journey.platformAccountId,
        cursor: storedCursor,
        sort
      }
    });
    if (duplicate) return { reason: "comment_page_already_loaded", output: { ok: false, reason: "comment_page_already_loaded", cursor, sort } };
  }
  return null;
}

async function validateAiSdkToolCall(
  tx: Prisma.TransactionClient,
  action: AgentTurn,
  journey: AgentJourney,
  toolName: ToolName,
  args: Record<string, unknown>
): Promise<ValidationFailure | null> {
  if (journey.status !== "active") {
    return { reason: "journey_finished", output: { ok: false, reason: "journey_finished" } };
  }
  // Phase is derived from open_post tool call history (event-driven, not a stored field).
  // Before open_post, only open_post and exit_browsing are allowed (feed phase).
  const hasOpenedPost = await journeyHasOpenedPost(tx, journey);
  if (toolName !== "open_post" && toolName !== "exit_browsing" && !hasOpenedPost) {
    return { reason: "post_not_opened", output: { ok: false, reason: "post_not_opened" } };
  }
  if (requiresPostId(toolName)) {
    const postId = typeof args.postId === "string" ? args.postId.trim() : "";
    if (!postId) return { reason: "post_id_required", output: { ok: false, reason: "post_id_required" } };
    if (postId !== action.contentVersionId) return { reason: "post_not_found", output: { ok: false, reason: "post_not_found", postId } };
    // All requiresPostId tools reach here only when hasOpenedPost is true
    // (the early feed-phase gate at line 724 already blocks them).
  }
  const duplicateOrInputInvalid = await validateToolCall(tx, action, journey, toolName, args);
  if (duplicateOrInputInvalid) return duplicateOrInputInvalid;
  if (toolName === "exit_browsing") {
    const readingDepth = exitReadingDepthArg(args);
    if (readingDepth) {
      if (!hasOpenedPost && readingDepth !== "feed_only") {
        return { reason: "exit_reading_depth_invalid_for_feed", output: { ok: false, reason: "exit_reading_depth_invalid_for_feed" } };
      }
      if (hasOpenedPost && readingDepth === "feed_only") {
        return { reason: "exit_reading_depth_invalid_for_post", output: { ok: false, reason: "exit_reading_depth_invalid_for_post" } };
      }
    }
  }
  if (toolName === "like_comment") {
    const commentId = commentIdArg(args);
    if (!commentId) return { reason: "comment_id_required", output: { ok: false, reason: "comment_id_required" } };
    const observed = await agentObservedComment(tx, action, commentId);
    if (!observed) return { reason: "comment_not_observed", output: { ok: false, reason: "comment_not_observed", commentId } };
  }
  return null;
}

function requiresPostId(toolName: ToolName) {
  return toolName === "read_post" || toolName === "view_comments" || toolName === "like_post" || toolName === "favorite_post" || toolName === "share_post" || toolName === "write_comment";
}

async function agentObservedComment(tx: Prisma.TransactionClient, action: AgentTurn, commentId: string) {
  const ownComment = await tx.simulatedComment.findFirst({
    where: { id: commentId, contentVersionId: action.contentVersionId, actorUserId: action.actorUserId, platformAccountId: action.platformAccountId },
    select: { id: true }
  });
  if (ownComment) return true;
  const pages = await tx.loadedCommentPage.findMany({
    where: {
      contentVersionId: action.contentVersionId,
      actorUserId: action.actorUserId,
      platformAccountId: action.platformAccountId
    },
    select: { commentIdsJson: true }
  });
  return pages.some((page) => Array.isArray(page.commentIdsJson) && page.commentIdsJson.includes(commentId));
}

async function markToolIgnored(
  tx: Prisma.TransactionClient,
  action: AgentTurn,
  id: string,
  reason: string,
  output?: Record<string, unknown>
) {
  const current = await tx.agentToolCall.findUniqueOrThrow({
    where: { id },
    select: { status: true }
  });
  assertToolCallTransition(current.status, "ignored");
  const updated = await tx.agentToolCall.update({
    where: { id },
    data: {
      status: "ignored",
      output: { ok: false, reason, ...(output ?? {}) },
      errorMessage: reason
    }
  });
  await appendToolResultItem(tx, action, updated);
  return updated;
}

async function markToolCommitted(
  tx: Prisma.TransactionClient,
  action: AgentTurn,
  toolCall: AgentToolCall,
  output: Record<string, unknown>
) {
  const current = await tx.agentToolCall.findUniqueOrThrow({
    where: { id: toolCall.id },
    select: { status: true }
  });
  assertToolCallTransition(current.status, "committed");
  await tx.agentToolCall.update({
    where: { id: toolCall.id },
    data: {
      status: "committed",
      output: { ok: true, ...output } as Prisma.InputJsonValue,
      errorMessage: null
    }
  });
  const updated = await tx.agentToolCall.findUniqueOrThrow({ where: { id: toolCall.id } });
  await appendToolResultItem(tx, action, updated);
  return updated;
}

async function commitOpenPost(
  tx: Prisma.TransactionClient,
  action: AgentTurn,
  journey: AgentJourney,
  audience: RunParticipant,
  toolCall: AgentToolCall,
  simulatedTime: number
): Promise<ToolExecutionResult> {
  const result = await openPost(tx, {
    runId: action.runId,
    contentVersionId: action.contentVersionId,
    actor: actorForAction(action, audience),
    journeyId: action.journeyId,
    journeyActionId: action.id,
    toolCallId: toolCall.id,
    simulatedTime
  });
  const updatedJourney = result.journey ?? await tx.agentJourney.findUniqueOrThrow({ where: { id: journey.id } });
  const contentVersion = await tx.contentVersion.findUniqueOrThrow({ where: { id: action.contentVersionId } });
  await markToolCommitted(tx, action, toolCall, {
    postId: contentVersion.id,
    post: {
      postId: contentVersion.id,
      title: contentVersion.title,
      author: postAuthorObservation(),
      bodyText: contentVersion.bodyText,
      postState: postStateView(result.postState)
    },
    transition: "post_detail_observed"
  });

  // Append post initial_observation so the agent sees the post_detail environment
  const [likeReaction, favReaction] = await Promise.all([
    tx.socialReaction.findUnique({
      where: {
        contentVersionId_actorUserId_platformAccountId_targetType_targetId_reactionType: {
          contentVersionId: action.contentVersionId,
          actorUserId: action.actorUserId,
          platformAccountId: action.platformAccountId,
          targetType: "post",
          targetId: action.contentVersionId,
          reactionType: "like"
        }
      }
    }),
    tx.socialReaction.findUnique({
      where: {
        contentVersionId_actorUserId_platformAccountId_targetType_targetId_reactionType: {
          contentVersionId: action.contentVersionId,
          actorUserId: action.actorUserId,
          platformAccountId: action.platformAccountId,
          targetType: "post",
          targetId: action.contentVersionId,
          reactionType: "favorite"
        }
      }
    })
  ]);
  const viewerState = {
    liked: likeReaction?.active ?? false,
    favorited: favReaction?.active ?? false
  };
  await appendInitialObservation(tx, journey.id, action.runId, buildPostObservation(contentVersion, result.postState, viewerState));
  const toolOutput = { postId: contentVersion.id, transition: "post_detail_observed" };
  const log = await createToolLog(tx, action, audience, toolCall.id, "open_post", `${participantDisplayName(audience)} 点开了帖子`, simulatedTime, "tool_call", { toolName: "open_post", input: {}, output: toolOutput });
  const events = [
    await recordLiveEvent(tx, {
      runId: action.runId,
      eventType: "action_log.created",
      payload: {
        contentVersionId: action.contentVersionId,
        simulatedTime,
        log: logView(log, audience)
      }
    }),
    await postStateEvent(tx, action, result.postState, simulatedTime),
    ...(await emitAudienceEvents(tx, action, updatedJourney, audience, "open_post", simulatedTime))
  ];
  return { status: "committed", events };
}

async function commitReadPost(
  tx: Prisma.TransactionClient,
  action: AgentTurn,
  journey: AgentJourney,
  audience: RunParticipant,
  toolCall: AgentToolCall,
  args: Record<string, unknown>,
  simulatedTime: number
): Promise<ToolExecutionResult> {
  const depth = (readDepthArg(args) ?? "skim") as ReadDepth;
  const focus = readFocusArg(args) ?? [];
  const result = await readPost(tx, {
    runId: action.runId,
    contentVersionId: action.contentVersionId,
    actor: actorForAction(action, audience),
    depth,
    focus,
    journeyId: action.journeyId,
    journeyActionId: action.id,
    toolCallId: toolCall.id,
    simulatedTime
  });
  const updatedJourney = result.journey ?? await tx.agentJourney.findUniqueOrThrow({ where: { id: journey.id } });
  await markToolCommitted(tx, action, toolCall, {
    postId: action.contentVersionId,
    status: "read",
    depth,
    focus
  });
  const toolInput = { postId: action.contentVersionId, depth, focus };
  const toolOutput = { postId: action.contentVersionId, status: "read", depth, focus };
  const log = await createToolLog(tx, action, audience, toolCall.id, "read_post", readPostLogText(participantDisplayName(audience), depth), simulatedTime, "tool_call", { toolName: "read_post", input: toolInput, output: toolOutput });
  const events = [
    await recordLiveEvent(tx, {
      runId: action.runId,
      eventType: "action_log.created",
      payload: {
        contentVersionId: action.contentVersionId,
        simulatedTime,
        log: logView(log, audience)
      }
    }),
    // read_post intentionally does NOT emit post_state.updated: it does not
    // modify any counters. See docs/features "read_post" §10.2.
    ...(await emitAudienceEvents(tx, action, updatedJourney, audience, "read_post", simulatedTime))
  ];
  return { status: "committed", events };
}

async function commitViewComments(
  tx: Prisma.TransactionClient,
  action: AgentTurn,
  journey: AgentJourney,
  audience: RunParticipant,
  toolCall: AgentToolCall,
  args: Record<string, unknown>,
  simulatedTime: number
): Promise<ToolExecutionResult> {
  const cursor = typeof args.cursor === "string" ? args.cursor : null;
  const sort = parseCommentSort(typeof args.sort === "string" ? args.sort : null);
  const result = await viewComments(tx, {
    runId: action.runId,
    contentVersionId: action.contentVersionId,
    actor: actorForAction(action, audience),
    limit: 10,
    cursor,
    sort,
    journeyId: action.journeyId,
    journeyActionId: action.id,
    toolCallId: toolCall.id,
    simulatedTime
  });
  const page = result.page;
  const updatedJourney = result.journey ?? await tx.agentJourney.findUniqueOrThrow({ where: { id: journey.id } });
  const audiences = await tx.runParticipant.findMany({ where: { runId: action.runId } });
  const audienceById = new Map(audiences.map((item) => [item.id, item]));
  const comments = page.comments.map((comment) => commentView(comment, comment.participantId ? audienceById.get(comment.participantId) : undefined));
  await markToolCommitted(tx, action, toolCall, { postId: action.contentVersionId, comments, cursor, nextCursor: page.nextCursor, hasMore: page.hasMore, sort });
  const toolInput = { postId: action.contentVersionId, cursor, sort };
  const toolOutput = { postId: action.contentVersionId, comments: comments.length, cursor, nextCursor: page.nextCursor, hasMore: page.hasMore, sort };
  const log = await createToolLog(tx, action, audience, toolCall.id, "view_comments", `${participantDisplayName(audience)} 浏览了评论区`, simulatedTime, "tool_call", { toolName: "view_comments", input: toolInput, output: toolOutput });
  const events = [
    await recordLiveEvent(tx, {
      runId: action.runId,
      eventType: "comments.page_loaded",
      payload: {
        contentVersionId: action.contentVersionId,
        simulatedTime,
        page: {
          journeyId: action.journeyId,
          audienceName: participantDisplayName(audience),
          cursor,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          sort,
          comments
        }
      }
    }),
    await recordLiveEvent(tx, {
      runId: action.runId,
      eventType: "action_log.created",
      payload: {
        contentVersionId: action.contentVersionId,
        simulatedTime,
        log: logView(log, audience)
      }
    }),
    ...(await emitAudienceEvents(tx, action, updatedJourney, audience, "view_comments", simulatedTime))
  ];
  return { status: "committed", events };
}

async function commitLikePost(
  tx: Prisma.TransactionClient,
  action: AgentTurn,
  journey: AgentJourney,
  toolCall: AgentToolCall,
  simulatedTime: number
): Promise<ToolExecutionResult> {
  const audience = await tx.runParticipant.findUniqueOrThrow({ where: { id: action.participantId } });
  await setPostReaction(tx, {
    runId: action.runId,
    contentVersionId: action.contentVersionId,
    actor: actorForAction(action, audience),
    reactionType: "like",
    active: true,
    journeyId: action.journeyId,
    journeyActionId: action.id,
    toolCallId: toolCall.id,
    simulatedTime
  });
  const state = await tx.simulatedPostState.findUniqueOrThrow({ where: { contentVersionId: action.contentVersionId } });
  const updatedJourney = await tx.agentJourney.findUniqueOrThrow({ where: { id: journey.id } });
  await markToolCommitted(tx, action, toolCall, { postId: action.contentVersionId, status: "liked", liked: true, likeCount: state.likeCount });
  const toolOutput = { postId: action.contentVersionId, status: "liked", liked: true, likeCount: state.likeCount };
  const log = await createToolLog(tx, action, audience, toolCall.id, "like_post", `${participantDisplayName(audience)} 点赞了这篇内容`, simulatedTime, "tool_call", { toolName: "like_post", input: { postId: action.contentVersionId }, output: toolOutput });
  const events = [
    await recordLiveEvent(tx, {
      runId: action.runId,
      eventType: "action_log.created",
      payload: {
        contentVersionId: action.contentVersionId,
        simulatedTime,
        log: logView(log, audience)
      }
    }),
    await postStateEvent(tx, action, state, simulatedTime),
    ...(await emitAudienceEvents(tx, action, updatedJourney, audience, "like_post", simulatedTime))
  ];
  return { status: "committed", events };
}

async function commitFavoritePost(
  tx: Prisma.TransactionClient,
  action: AgentTurn,
  journey: AgentJourney,
  toolCall: AgentToolCall,
  simulatedTime: number
): Promise<ToolExecutionResult> {
  const audience = await tx.runParticipant.findUniqueOrThrow({ where: { id: action.participantId } });
  await setPostReaction(tx, {
    runId: action.runId,
    contentVersionId: action.contentVersionId,
    actor: actorForAction(action, audience),
    reactionType: "favorite",
    active: true,
    journeyId: action.journeyId,
    journeyActionId: action.id,
    toolCallId: toolCall.id,
    simulatedTime
  });
  const state = await tx.simulatedPostState.findUniqueOrThrow({ where: { contentVersionId: action.contentVersionId } });
  const updatedJourney = await tx.agentJourney.findUniqueOrThrow({ where: { id: journey.id } });
  await markToolCommitted(tx, action, toolCall, { postId: action.contentVersionId, status: "favorited", favorited: true, favoriteCount: state.favoriteCount });
  const toolOutput = { postId: action.contentVersionId, status: "favorited", favorited: true, favoriteCount: state.favoriteCount };
  const log = await createToolLog(tx, action, audience, toolCall.id, "favorite_post", `${participantDisplayName(audience)} 收藏了这篇内容`, simulatedTime, "tool_call", { toolName: "favorite_post", input: { postId: action.contentVersionId }, output: toolOutput });
  const events = [
    await recordLiveEvent(tx, {
      runId: action.runId,
      eventType: "action_log.created",
      payload: {
        contentVersionId: action.contentVersionId,
        simulatedTime,
        log: logView(log, audience)
      }
    }),
    await postStateEvent(tx, action, state, simulatedTime),
    ...(await emitAudienceEvents(tx, action, updatedJourney, audience, "favorite_post", simulatedTime))
  ];
  return { status: "committed", events };
}

async function commitSharePost(
  tx: Prisma.TransactionClient,
  action: AgentTurn,
  journey: AgentJourney,
  audience: RunParticipant,
  toolCall: AgentToolCall,
  simulatedTime: number
): Promise<ToolExecutionResult> {
  const result = await sharePost(tx, {
    runId: action.runId,
    contentVersionId: action.contentVersionId,
    actor: actorForAction(action, audience),
    journeyId: action.journeyId,
    journeyActionId: action.id,
    toolCallId: toolCall.id,
    simulatedTime
  });
  await markToolCommitted(tx, action, toolCall, { postId: action.contentVersionId, status: "shared", shareCount: result.postState.shareCount });
  const toolOutput = { postId: action.contentVersionId, status: "shared", shareCount: result.postState.shareCount };
  const log = await createToolLog(tx, action, audience, toolCall.id, "share_post", `${participantDisplayName(audience)} 分享了这篇内容`, simulatedTime, "tool_call", { toolName: "share_post", input: { postId: action.contentVersionId }, output: toolOutput });
  const events = [
    await recordLiveEvent(tx, {
      runId: action.runId,
      eventType: "action_log.created",
      payload: {
        contentVersionId: action.contentVersionId,
        simulatedTime,
        log: logView(log, audience)
      }
    }),
    await postStateEvent(tx, action, result.postState, simulatedTime),
    ...(await emitAudienceEvents(tx, action, journey, audience, "share_post", simulatedTime))
  ];
  return { status: "committed", events };
}

async function commitWriteComment(
  tx: Prisma.TransactionClient,
  action: AgentTurn,
  journey: AgentJourney,
  audience: RunParticipant,
  toolCall: AgentToolCall,
  args: Record<string, unknown>,
  simulatedTime: number
): Promise<ToolExecutionResult> {
  const content = String(args.content ?? "").trim();
  const replyTo = replyToCommentIdArg(args);
  const result = await createComment(tx, {
    runId: action.runId,
    contentVersionId: action.contentVersionId,
    actor: actorForAction(action, audience),
    content,
    parentCommentId: replyTo,
    journeyId: action.journeyId,
    journeyActionId: action.id,
    toolCallId: toolCall.id,
    simulatedTime
  });
  const fixedComment = result.comment;
  const state = result.postState;
  const intent = commentIntentArg(args) ?? "agree";
  await markToolCommitted(tx, action, toolCall, { postId: action.contentVersionId, status: "commented", commentId: fixedComment.id, comment: commentView(fixedComment, audience), commentCount: state.commentCount, intent });
  const toolInput = { postId: action.contentVersionId, content, intent, replyToCommentId: replyTo };
  const toolOutput = { postId: action.contentVersionId, status: "commented", commentId: fixedComment.id, commentCount: state.commentCount, intent };
  const log = await createToolLog(tx, action, audience, toolCall.id, "write_comment", `${participantDisplayName(audience)} 评论：${content}`, simulatedTime, "tool_call", { toolName: "write_comment", input: toolInput, output: toolOutput });
  const events = [
    await recordLiveEvent(tx, {
      runId: action.runId,
      eventType: "comment.created",
      payload: {
        contentVersionId: action.contentVersionId,
        simulatedTime,
        comment: commentView(fixedComment, audience)
      }
    }),
    ...(result.parentComment ? [
      await recordLiveEvent(tx, {
        runId: action.runId,
        eventType: "comment.updated",
        payload: {
          contentVersionId: action.contentVersionId,
          simulatedTime,
          commentId: result.parentComment.id,
          patch: commentUpdatePatch(result.parentComment)
        }
      })
    ] : []),
    await recordLiveEvent(tx, {
      runId: action.runId,
      eventType: "action_log.created",
      payload: {
        contentVersionId: action.contentVersionId,
        simulatedTime,
        log: logView(log, audience)
      }
    }),
    await postStateEvent(tx, action, state, simulatedTime),
    ...(await emitAudienceEvents(tx, action, journey, audience, "write_comment", simulatedTime))
  ];
  return { status: "committed", events };
}

async function commitLikeComment(
  tx: Prisma.TransactionClient,
  action: AgentTurn,
  journey: AgentJourney,
  audience: RunParticipant,
  toolCall: AgentToolCall,
  args: Record<string, unknown>,
  simulatedTime: number
): Promise<ToolExecutionResult> {
  const commentId = commentIdArg(args);
  const result = await likeComment(tx, {
    runId: action.runId,
    contentVersionId: action.contentVersionId,
    actor: actorForAction(action, audience),
    commentId,
    active: true,
    journeyId: action.journeyId,
    journeyActionId: action.id,
    toolCallId: toolCall.id,
    simulatedTime
  });
  await markToolCommitted(tx, action, toolCall, { status: "liked_comment", commentId, liked: result.active, likeCount: result.comment.likeCount });
  const toolOutput = { status: "liked_comment", commentId, liked: result.active, likeCount: result.comment.likeCount };
  const log = await createToolLog(tx, action, audience, toolCall.id, "like_comment", `${participantDisplayName(audience)} 点赞了一条评论`, simulatedTime, "tool_call", { toolName: "like_comment", input: { commentId }, output: toolOutput });
  const events = [
    await recordLiveEvent(tx, {
      runId: action.runId,
      eventType: "comment.updated",
      payload: {
        contentVersionId: action.contentVersionId,
        simulatedTime,
        commentId: result.comment.id,
        patch: commentUpdatePatch(result.comment)
      }
    }),
    await recordLiveEvent(tx, {
      runId: action.runId,
      eventType: "action_log.created",
      payload: {
        contentVersionId: action.contentVersionId,
        simulatedTime,
        log: logView(log, audience)
      }
    }),
    ...(await emitAudienceEvents(tx, action, journey, audience, "like_comment", simulatedTime))
  ];
  return { status: "committed", events };
}

async function commitExitBrowsing(
  tx: Prisma.TransactionClient,
  action: AgentTurn,
  journey: AgentJourney,
  audience: RunParticipant,
  toolCall: AgentToolCall,
  args: Record<string, unknown>,
  simulatedTime: number
): Promise<ToolExecutionResult> {
  const hasOpenedPost = await journeyHasOpenedPost(tx, journey);
  const reasonCategory = (exitReasonCategoryArg(args) ?? "no_more_action") as ExitReasonCategory;
  const readingDepth = (exitReadingDepthArg(args) ?? (hasOpenedPost ? "skimmed" : "feed_only")) as ExitReadingDepth;
  const interestLevel = (interestTrustLevelArg(args.interestLevel) ?? "low") as InterestTrustLevel;
  const trustLevel = (interestTrustLevelArg(args.trustLevel) ?? "medium") as InterestTrustLevel;
  const exitOutcome = determineExitOutcomeFromArgs(hasOpenedPost, reasonCategory);
  const exitReason = exitReasonTextFromArgs(reasonCategory);
  const result = await exitBrowsing(tx, {
    runId: action.runId,
    contentVersionId: action.contentVersionId,
    actor: actorForAction(action, audience),
    exitOutcome,
    exitReason,
    journeyId: action.journeyId,
    journeyActionId: action.id,
    toolCallId: toolCall.id,
    simulatedTime
  });
  const updatedJourney = result.journey;
  await markToolCommitted(tx, action, toolCall, {
    status: "finished",
    finished: true,
    exitOutcome,
    reasonCategory,
    readingDepth,
    interestLevel,
    trustLevel
  });
  const toolOutput = { status: "finished", exitOutcome, reasonCategory, readingDepth, interestLevel, trustLevel };
  const log = await createToolLog(tx, action, audience, toolCall.id, "exit_browsing", `${participantDisplayName(audience)} 离开了内容`, simulatedTime, "tool_call", { toolName: "exit_browsing", input: { reasonCategory, readingDepth, interestLevel, trustLevel }, output: toolOutput });
  const events = [
    await recordLiveEvent(tx, {
      runId: action.runId,
      eventType: "action_log.created",
      payload: {
        contentVersionId: action.contentVersionId,
        simulatedTime,
        log: logView(log, audience)
      }
    }),
    await postStateEvent(tx, action, result.postState, simulatedTime),
    ...(await emitAudienceEvents(tx, action, updatedJourney, audience, "exit_browsing", simulatedTime))
  ];
  return { status: "committed", events };
}

/**
 * Derive the coarse-grained exitOutcome from the agent's structured
 * reasonCategory (plus whether the post was opened). This replaces the old
 * heuristic that inferred risk_exit from risk tags in the action log, since
 * the agent now states its reason explicitly via exit_browsing args.
 * See docs/features "exit_browsing" §10.9.
 */
function determineExitOutcomeFromArgs(
  hasOpenedPost: boolean,
  reasonCategory: ExitReasonCategory
): JourneyExitOutcome {
  if (!hasOpenedPost) return "skipped";
  if (reasonCategory === "low_trust" || reasonCategory === "too_ad_like" || reasonCategory === "need_more_evidence") {
    return "risk_exit";
  }
  return "browsed_and_left";
}

function exitReasonTextFromArgs(reasonCategory: ExitReasonCategory): string {
  switch (reasonCategory) {
    case "not_relevant": return "观众认为内容与自己关系不大，结束浏览。";
    case "not_interested": return "观众兴趣不足，结束浏览。";
    case "low_trust": return "观众信任感较低，结束浏览。";
    case "too_ad_like": return "观众觉得广告感较强，结束浏览。";
    case "content_too_long": return "观众觉得内容过长，结束浏览。";
    case "need_more_evidence": return "观众觉得证据不足，结束浏览。";
    case "finished_normally": return "观众正常浏览后离开。";
    case "no_more_action": return "观众没有更多动作，结束浏览。";
    default: return "观众结束浏览。";
  }
}

/**
 * Factual action-log text for read_post. Only records the behavior fact
 * (skim / partial / full read), no subjective motivation. Subjective
 * motivation lives in the assistant's thought_text.
 * See docs/features "read_post" §10.2 and §9 (action log 只记录行为事实).
 */
function readPostLogText(name: string, depth: ReadDepth): string {
  switch (depth) {
    case "skim": return `${name} 快速扫读了正文`;
    case "partial": return `${name} 认真看了一部分正文`;
    case "full": return `${name} 基本看完了正文`;
    default: return `${name} 阅读了正文`;
  }
}

async function postStateEvent(tx: Prisma.TransactionClient, action: AgentTurn, state: SimulatedPostState, simulatedTime: number) {
  return recordLiveEvent(tx, {
    runId: action.runId,
    eventType: "post_state.updated",
    payload: {
      contentVersionId: action.contentVersionId,
      simulatedTime,
      postState: postStateView(state)
    }
  });
}

async function finishJourneyWithoutToolTx(
  tx: Prisma.TransactionClient,
  journey: AgentJourney,
  action: AgentTurn,
  nextStep: number
) {
  const hasOpenedPost = await journeyHasOpenedPost(tx, journey);
  const exitOutcome: JourneyExitOutcome = hasOpenedPost ? "browsed_and_left" : "skipped";
  const exitReason = hasOpenedPost
    ? "观众浏览后自然结束本次试映。"
    : "观众在信息流阶段没有继续浏览。";
  await tx.agentJourney.update({
    where: { id: journey.id },
    data: {
      status: "finished",
      runnerStatus: "idle",
      lockedAt: null,
      lockedBy: null,
      heartbeatAt: null,
      finalSummary: exitReason,
      exitOutcome,
      exitReason,
      completedAt: new Date(),
      currentStepIndex: nextStep
    }
  });
  await tx.runParticipant.update({
    where: { id: journey.participantId },
    data: { runtimeStatus: exitOutcome === "skipped" ? "skipped" : "finished" }
  });
  const simulatedTime = await getRunSimulatedTime(tx, journey.runId);
  return audienceStatusEvent(tx, action, journey, exitOutcome === "skipped" ? "skipped" : "finished", simulatedTime, {
    exitOutcome,
    exitReason
  });
}

async function finishJourneyAtMaxStepsTx(
  tx: Prisma.TransactionClient,
  journey: AgentJourney,
  nextStep: number
) {
  const exitReason = "达到最大试映步数后结束浏览。";
  await tx.agentJourney.update({
    where: { id: journey.id },
    data: {
      status: "finished",
      runnerStatus: "idle",
      lockedAt: null,
      lockedBy: null,
      heartbeatAt: null,
      finalSummary: exitReason,
      exitOutcome: "max_steps",
      exitReason,
      completedAt: new Date(),
      currentStepIndex: nextStep
    }
  });
  await tx.runParticipant.update({
    where: { id: journey.participantId },
    data: { runtimeStatus: "finished" }
  });
  const action = await tx.agentTurn.findFirstOrThrow({
    where: { journeyId: journey.id },
    orderBy: { stepIndex: "desc" }
  });
  const simulatedTime = await getRunSimulatedTime(tx, journey.runId);
  return audienceStatusEvent(tx, action, journey, "finished", simulatedTime, {
    exitOutcome: "max_steps",
    exitReason
  });
}

async function audienceStatusEvent(
  tx: Prisma.TransactionClient,
  action: AgentTurn,
  journey: AgentJourney,
  status: "finished" | "skipped" | "failed",
  simulatedTime: number,
  extra: Record<string, unknown>
) {
  const run = await tx.testRun.findUniqueOrThrow({ where: { id: action.runId }, select: { audienceRevision: true } });
  return recordLiveEvent(tx, {
    runId: action.runId,
    eventType: "audience.status_updated",
    payload: {
      contentVersionId: action.contentVersionId,
      audienceRevision: run.audienceRevision,
      simulatedTime,
      participantId: action.participantId,
      status,
      ...extra
    }
  });
}

async function createToolLog(
  tx: Prisma.TransactionClient,
  action: AgentTurn,
  _audience: RunParticipant,
  toolCallId: string,
  actionName: string,
  text: string,
  simulatedTime: number,
  eventKind: string = "tool_call",
  eventPayload: Record<string, unknown> = {}
) {
  return tx.actionLog.create({
    data: {
      runId: action.runId,
      contentVersionId: action.contentVersionId,
      participantId: action.participantId,
      actorUserId: action.actorUserId,
      platformAccountId: action.platformAccountId,
      journeyId: action.journeyId,
      journeyActionId: action.id,
      toolCallId,
      simulatedTime,
      logText: text,
      action: actionName,
      topicTagsJson: [],
      riskTagsJson: inferRiskTags(text),
      eventKind,
      eventPayloadJson: eventPayload as Prisma.InputJsonValue
    }
  });
}

function idempotencyKeyFor(action: Pick<AgentTurn, "runId" | "participantId" | "id">, callIndex: number) {
  return `${action.runId}:${action.participantId}:${action.id}:${callIndex}`;
}

function assertExistingToolCallMatches(
  existing: AgentToolCall,
  call: { callIndex: number; toolName: ToolName; args: Record<string, unknown>; sdkCallId?: string }
): void {
  const mismatches: string[] = [];
  if (existing.toolName !== call.toolName) mismatches.push("toolName");
  // Normalize both sides to the canonical camelCase form before comparing, so
  // historical DB rows storing snake_case args don't falsely trigger conflicts.
  const existingToolName = existing.toolName as ToolName;
  if (stableJson(normalizeToolArgs(existingToolName, existing.input as Record<string, unknown>)) !== stableJson(normalizeToolArgs(call.toolName, call.args))) mismatches.push("input");
  if (existing.sdkCallId && call.sdkCallId && existing.sdkCallId !== call.sdkCallId) {
    mismatches.push("sdkCallId");
  }
  if (!mismatches.length) return;
  throw new Error(`Tool call idempotency conflict at callIndex ${call.callIndex}: ${mismatches.join(", ")}`);
}

function assertRegisteredToolCallMatches(
  existing: RegisteredToolIdentity,
  toolName: ToolName,
  args: Record<string, unknown>
): void {
  const mismatches: string[] = [];
  if (existing.toolName !== toolName) mismatches.push("toolName");
  if (stableJson(existing.args) !== stableJson(args)) mismatches.push("input");
  if (!mismatches.length) return;
  throw new Error(`AI SDK tool call identity conflict for ${existing.sdkCallId}: ${mismatches.join(", ")}`);
}

function normalizeToolArgs(toolName: ToolName, args: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...args };
  if (toolName === "write_comment") {
    const replyTo = replyToCommentIdArg(args);
    if (replyTo) {
      normalized.replyToCommentId = replyTo;
    }
    delete normalized.reply_to_comment_id;
    const intent = commentIntentArg(args);
    if (intent) normalized.intent = intent;
  }
  if (toolName === "like_comment") {
    const commentId = commentIdArg(args);
    if (commentId) {
      normalized.commentId = commentId;
    }
    delete normalized.comment_id;
  }
  if (toolName === "read_post") {
    const focus = readFocusArg(args);
    if (focus) normalized.focus = focus;
    else delete normalized.focus;
    const depth = readDepthArg(args);
    if (depth) normalized.depth = depth;
  }
  if (toolName === "exit_browsing") {
    const reasonCategory = exitReasonCategoryArg(args);
    if (reasonCategory) normalized.reasonCategory = reasonCategory;
    const readingDepth = exitReadingDepthArg(args);
    if (readingDepth) normalized.readingDepth = readingDepth;
    const interestLevel = interestTrustLevelArg(args.interestLevel);
    if (interestLevel) normalized.interestLevel = interestLevel;
    const trustLevel = interestTrustLevelArg(args.trustLevel);
    if (trustLevel) normalized.trustLevel = trustLevel;
  }
  return normalized;
}

function replyToCommentIdArg(args: Record<string, unknown>) {
  const camel = typeof args.replyToCommentId === "string" ? args.replyToCommentId.trim() : "";
  if (camel) return camel;
  const snake = typeof args.reply_to_comment_id === "string" ? args.reply_to_comment_id.trim() : "";
  return snake || null;
}

function commentIdArg(args: Record<string, unknown>) {
  const camel = typeof args.commentId === "string" ? args.commentId.trim() : "";
  if (camel) return camel;
  const snake = typeof args.comment_id === "string" ? args.comment_id.trim() : "";
  return snake;
}

const COMMENT_INTENTS = ["ask", "doubt", "share_experience", "agree", "joke", "pushback"] as const;
function commentIntentArg(args: Record<string, unknown>): string | null {
  const raw = typeof args.intent === "string" ? args.intent.trim() : "";
  return (COMMENT_INTENTS as readonly string[]).includes(raw) ? raw : null;
}

const READ_DEPTHS = ["skim", "partial", "full"] as const;
function readDepthArg(args: Record<string, unknown>): string | null {
  const raw = typeof args.depth === "string" ? args.depth.trim() : "";
  return (READ_DEPTHS as readonly string[]).includes(raw) ? raw : null;
}

/**
 * Returns the cleaned focus array, or [] when absent. Returns null when the
 * shape is invalid (not an array, too many entries, or entries too long) so
 * the caller can reject the tool call.
 */
function readFocusArg(args: Record<string, unknown>): string[] | null {
  if (args.focus === undefined || args.focus === null) return [];
  if (!Array.isArray(args.focus)) return null;
  if (args.focus.length > 3) return null;
  const cleaned: string[] = [];
  for (const item of args.focus) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > 20) return null;
    cleaned.push(trimmed);
  }
  return cleaned;
}

const EXIT_REASON_CATEGORIES = ["not_relevant", "not_interested", "low_trust", "too_ad_like", "content_too_long", "need_more_evidence", "finished_normally", "no_more_action"] as const;
function exitReasonCategoryArg(args: Record<string, unknown>): string | null {
  const raw = typeof args.reasonCategory === "string" ? args.reasonCategory.trim() : "";
  return (EXIT_REASON_CATEGORIES as readonly string[]).includes(raw) ? raw : null;
}

const EXIT_READING_DEPTHS = ["feed_only", "skimmed", "partial", "full"] as const;
function exitReadingDepthArg(args: Record<string, unknown>): string | null {
  const raw = typeof args.readingDepth === "string" ? args.readingDepth.trim() : "";
  return (EXIT_READING_DEPTHS as readonly string[]).includes(raw) ? raw : null;
}

const INTEREST_TRUST_LEVELS = ["low", "medium", "high"] as const;
function interestTrustLevelArg(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return (INTEREST_TRUST_LEVELS as readonly string[]).includes(raw) ? raw : null;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortJsonValue(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJsonValue(item)])
  );
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function emitAudienceEvents(
  tx: Prisma.TransactionClient,
  action: AgentTurn,
  journey: AgentJourney,
  audience: RunParticipant,
  toolName: ToolName,
  simulatedTime: number
) {
  const run = await tx.testRun.findUniqueOrThrow({ where: { id: action.runId }, select: { audienceRevision: true } });
  const interactionTypes = (
    await tx.socialInteractionEvent.findMany({
      where: { contentVersionId: action.contentVersionId, participantId: action.participantId },
      select: { interactionType: true },
      orderBy: [{ simulatedTime: "asc" }, { createdAt: "asc" }]
    })
  ).map((i: { interactionType: string }) => i.interactionType);

  const audienceLogs = await tx.actionLog.findMany({
    where: {
      runId: action.runId,
      contentVersionId: action.contentVersionId,
      participantId: action.participantId
    }
  });
  const hasDoubt = audienceLogs.some((log) => hasDoubtRisk(log.riskTagsJson));

  const status = deriveSeatStatus(journey, interactionTypes, hasDoubt);
  const animationMap: Record<string, "heart" | "star" | "comment" | "risk" | "skip" | "none"> = {
    open_post: "none",
    read_post: "none",
    like_post: "heart",
    favorite_post: "star",
    share_post: "none",
    write_comment: "comment",
    like_comment: "heart",
    exit_browsing: animationHintForExit(journey.exitOutcome)
  };

  const events = [];
  events.push(
    await recordLiveEvent(tx, {
      runId: action.runId,
      eventType: "audience.status_updated",
      payload: {
        contentVersionId: action.contentVersionId,
        audienceRevision: run.audienceRevision,
        simulatedTime,
        participantId: action.participantId,
        status,
        currentAction: toolName,
        exitOutcome: journey.exitOutcome,
        exitReason: journey.exitReason
      }
    })
  );
  if (toolName === "view_comments") return events;
  events.push(
    await recordLiveEvent(tx, {
      runId: action.runId,
      eventType: "audience.action_happened",
      payload: {
        contentVersionId: action.contentVersionId,
        audienceRevision: run.audienceRevision,
        simulatedTime,
        participantId: action.participantId,
        action: toolName,
        animationHint: animationMap[toolName] ?? "none",
        exitOutcome: journey.exitOutcome,
        exitReason: journey.exitReason,
        text: audienceActionText(participantDisplayName(audience), toolName, journey.exitOutcome ?? undefined)
      }
    })
  );
  return events;
}

function animationHintForExit(outcome?: JourneyExitOutcome | null): "risk" | "skip" | "none" {
  if (outcome === "skipped") return "skip";
  if (outcome === "risk_exit") return "risk";
  return "none";
}

function audienceActionText(name: string, toolName: ToolName, exitOutcome?: JourneyExitOutcome) {
  if (toolName === "open_post") return `${name} 点开了内容`;
  if (toolName === "read_post") return `${name} 阅读了正文`;
  if (toolName === "like_post") return `${name} 点赞了这篇内容`;
  if (toolName === "favorite_post") return `${name} 收藏了这篇内容`;
  if (toolName === "share_post") return `${name} 分享了这篇内容`;
  if (toolName === "write_comment") return `${name} 发表了评论`;
  if (toolName === "like_comment") return `${name} 点赞了一条评论`;
  if (toolName === "exit_browsing" && exitOutcome === "skipped") return `${name} 跳过了内容`;
  if (toolName === "exit_browsing" && exitOutcome === "risk_exit") return `${name} 离开了内容`;
  if (toolName === "exit_browsing") return `${name} 结束了浏览`;
  return `${name} 更新了状态`;
}

function participantDisplayName(audience: RunParticipant) {
  return audience.displayNameSnapshot;
}

function postAuthorObservation() {
  return {
    displayName: "陈琳",
    accountLabel: "家居研究所" // TODO: read from run config when multi-author support is added
  };
}

function inferRiskTags(text: string): string[] {
  const tags: string[] = [];
  if (text.includes("广告")) tags.push("ad_concern");
  if (text.includes("具体") || text.includes("来源") || text.includes("依据")) tags.push("trust_evidence");
  return tags;
}

function hasDoubtRisk(tags: unknown) {
  return Array.isArray(tags) && tags.some((tag) => tag === "ad_concern");
}

function sanitizeAuditJson(value: unknown): unknown {
  if (typeof value === "string") return sanitizeAuditString(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeAuditJson(item));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveAuditKey(key)) {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = sanitizeAuditJson(item);
  }
  return output;
}

function sanitizeAuditString(value: string) {
  if (!value.includes("data:image/")) return value;
  // Audit rows should explain that an image existed without storing large
  // base64 payloads that bloat SQLite and make prompt debugging unreadable.
  return value.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/g, (match) => {
    const mime = match.slice("data:".length, match.indexOf(";base64,"));
    return `[redacted ${mime} data url, chars=${match.length}]`;
  });
}

function isSensitiveAuditKey(key: string) {
  return /api[-_]?key|authorization|access[-_]?token|secret|password/i.test(key);
}
