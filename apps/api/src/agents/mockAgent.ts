import type {
  AgentProvider,
  ParsedToolCall,
  AudienceSamplingDirectiveView,
  AudienceSamplingPlanViewForProvider,
  RunParticipantContext,
  GeneratedAudience
} from "./types.js";
import type {
  AudienceDemographics,
  AudienceGenerationProgressView,
  AudienceProfileExpansionFrame,
  AudienceSamplingPlanRevisionMessage,
  AudienceSamplingPlanRevisionProposal,
  AudienceSeatRevisionMessage,
  AudienceSeatRevisionProposal
} from "@trycue/shared/audience";
import type {
  CommentIntent,
  ExitReasonCategory,
  ExitReadingDepth,
  InterestTrustLevel,
  ReadDepth
} from "@trycue/shared/tool";
import { prisma } from "@trycue/db";
import type { StepResult, ToolSet } from "ai";
import {
  completeAiSdkStepAndPrepareNext,
  executeAiSdkPlannedToolCall,
  persistStep
} from "../tools/toolExecutor.js";
import { ALL_TOOLS, loadJourneyTranscript, renderSessionMessages } from "../runtime/agentSessions.js";
import { PROMPT_VERSION_AGENT } from "./promptVersions.js";
import {
  names,
  segmentMeta,
  demoCommentPools,
  segmentOrder,
  allocateDemoTemplateGroups,
  pickDemoTemplatesForSegment,
  shortContentSignal,
  contentClaimSignal,
  mockBackgroundForDemographics,
  hashString,
  mockDemographics,
  defaultDemographics,
  pick
} from "./mockTemplates.js";

function delay(minMs: number, maxMs: number): Promise<void> {
  if (process.env.NODE_ENV === "test") return Promise.resolve();
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockAgentProvider implements AgentProvider {
  async generateAudienceSamplingPlan(input: {
    title: string;
    coverImageUrl: string;
    imageUrls: string[];
    bodyText: string;
    count: number;
  }) {
    await delay(1200, 1800);
    const allocations = allocateDemoTemplateGroups(input.count);
    const directives = allocations.map(({ segment, items }) => {
      const meta = segmentMeta[segment];
      const rationale = segment === "核心用户"
        ? "核心高需求人群决定收藏、追问和真实转化信号，是试映的基本盘。重点观察是否收藏、追问型号价格、补充真实经验。"
        : segment === "相邻用户"
          ? "相邻潜在人群用来观察内容是否能触达非即时购买者。重点观察是否先收藏、转发给相关亲友或轻量浏览。"
          : segment === "挑剔用户"
            ? "挑剔和怀疑用户会暴露广告感、证据缺口和边界表达问题。重点观察是否质疑广告感、要求证据或指出适用边界。"
            : "低意向路人用于校准误触、秒退和弱相关场景。重点观察是否快速退出、沉默浏览或只留下低意向感叹。";
      return {
        name: segment,
        description: meta.groupBrief,
        quantity: items.length,
        diversityAxes: meta.diversityAxes,
        rationale
      };
    });
    const planSubject = shortContentSignal(input.title, "宝宝用品避坑清单");
    const planClaim = contentClaimSignal(input.bodyText);
    return {
      totalCount: input.count,
      planMarkdown: `这份采样计划把「${planSubject}」理解为一场发布前试映。

重点看${planClaim}这类建议是否像真实经验，而不是泛泛种草。

观众按准备购买、刚踩坑、谨慎质疑和低相关浏览拉开经验距离。

确认后，人设和试映证据会围绕收藏追问、经验补充、评论反驳和退出浏览展开。`,
      dimensions: ["需求强度", "内容相关度", "信任阈值", "广告敏感度", "预算压力", "互动倾向"],
      directives
    };
  }

  async generateAudienceSamplingPlanRevision(input: {
    title: string;
    coverImageUrl: string;
    imageUrls: string[];
    bodyText: string;
    plan: AudienceSamplingPlanViewForProvider;
    messages: AudienceSamplingPlanRevisionMessage[];
  }): Promise<AudienceSamplingPlanRevisionProposal> {
    await delay(350, 650);
    const latest = input.messages.at(-1)?.visibleText ?? "";
    const directive = input.plan.directives[0];
    if (!directive) {
      return {
        summary: "当前还没有可调整的人群分组，建议先重新生成采样计划。",
        operations: [],
        warnings: ["没有可引用的分组，不能生成可应用建议。"]
      };
    }
    if (latest.includes("删") && input.plan.directives.length > 1) {
      const target = input.plan.directives.at(-1)!;
      return {
        summary: `建议删除「${target.name}」，保留更相关的人群分组。`,
        operations: [{
          operationId: "mock_delete_directive_1",
          op: "delete_directive",
          directiveId: target.id,
          reason: "用户表达了删减低价值分组的意图，mock 选择最后一组作为删除建议。"
        }],
        totalCountChange: { before: input.plan.totalCount, after: input.plan.totalCount - target.quantity },
        warnings: []
      };
    }
    const wantsSplit = /拆|分出|调出|保持.*总|总.*不变/.test(latest);
    const splitCount = 1;
    const nextCoreCount = Math.max(1, directive.quantity - splitCount);
    const addedDirective = {
      name: "预算敏感用户",
      description: `从${directive.description}中补充的强需求但价格敏感用户，会重点质疑清单是否过度消费。`,
      quantity: splitCount,
      diversityAxes: ["预算极紧", "替代品比较", "家庭共同决策"],
      rationale: "单独观察这类用户是否追问价格、替代品和真实必要性。"
    };
    if (!wantsSplit) {
      return {
        summary: "建议新增一组预算敏感用户，并让当前计划总人数随新增分组增加。",
        operations: [{
          operationId: "mock_add_directive_1",
          op: "add_directive",
          directive: addedDirective,
          reason: "用户希望补充预算敏感视角；新增人群默认增加实时总人数，不从原分组扣减。"
        }],
        totalCountChange: { before: input.plan.totalCount, after: input.plan.totalCount + splitCount },
        warnings: []
      };
    }
    return {
      summary: `建议从「${directive.name}」中拆出一组预算敏感用户，并相应下调原分组人数。`,
      operations: [
        {
          operationId: "mock_add_directive_1",
          op: "add_directive",
          directive: {
            ...addedDirective,
            description: `从${directive.description}中拆出的强需求但价格敏感用户，会重点质疑清单是否过度消费。`
          },
          reason: "用户希望补充或拆出预算敏感视角。"
        },
        {
          operationId: "mock_update_directive_1",
          op: "update_directive",
          directiveId: directive.id,
          patch: { quantity: nextCoreCount },
          before: { quantity: directive.quantity },
          reason: "新增预算敏感组后，原分组保留非极端预算压力的用户。"
        }
      ],
      totalCountChange: { before: input.plan.totalCount, after: input.plan.totalCount },
      warnings: []
    };
  }

  async generateAudienceSeatRevision(input: {
    title: string;
    coverImageUrl: string;
    imageUrls: string[];
    bodyText: string;
    plan: AudienceSamplingPlanViewForProvider | null;
    progress: AudienceGenerationProgressView;
    messages: AudienceSeatRevisionMessage[];
  }): Promise<AudienceSeatRevisionProposal> {
    await delay(350, 650);
    const latest = input.messages.at(-1)?.visibleText ?? "";
    const profile = input.progress.profiles.find((item) => item.identityStatus === "identity_ready") ?? input.progress.profiles[0];
    if (!profile) {
      return {
        summary: "当前还没有可打磨的观众结果。",
        operations: [],
        warnings: ["观众身份尚未生成，不能生成可应用建议。"]
      };
    }
    if (/新增|增加|多加|补充/.test(latest)) {
      const planDirective = input.plan?.directives[0];
      const progressDirective = input.progress.directives[0];
      const directiveId = planDirective?.id ?? progressDirective?.directiveId;
      const directiveLabel = planDirective?.name ?? progressDirective?.description ?? "目标分组";
      if (!directiveId) {
        return {
          summary: "当前缺少可承载新增观众的分组。",
          operations: [],
          warnings: ["需要先有已确认的人群分组。"]
        };
      }
      return {
        summary: `建议在「${directiveLabel}」下新增 1 位预算敏感观众。`,
        operations: [{
          operationId: "mock_add_profile_1",
          op: "add_profile",
          directiveId,
          samplingLabel: "预算敏感补充观众",
          demographics: defaultDemographics("不限定"),
                reason: "用户表达了新增观众的意图，mock 建议直接增加一个具体观众结果。"
        }],
        warnings: []
      };
    }
    if (latest.includes("删")) {
      return {
        summary: `建议删除「${profile.samplingLabel}」，用于清理不合适的结果层观众。`,
        operations: [{
          operationId: "mock_delete_profile_1",
          op: "delete_profile",
          profileId: profile.id,
          reason: "用户表达了删除具体观众的意图。"
        }],
        warnings: []
      };
    }
    if (latest.includes("重生") || latest.includes("重新")) {
      return {
        summary: `建议重生「${profile.samplingLabel}」的人设，让同组表达更有差异。`,
        operations: [{
          operationId: "mock_regenerate_identity_1",
          op: "regenerate_identity",
          profileId: profile.id,
          reason: "用户希望拉开同组观众差异。"
        }],
        warnings: []
      };
    }
    const currentPersona = profile.identity?.personaJson && typeof profile.identity.personaJson === "object"
      ? profile.identity.personaJson as Record<string, unknown>
      : {};
    return {
      summary: `建议把「${profile.samplingLabel}」调整成更理性、重证据的观众。`,
      operations: [{
        operationId: "mock_update_identity_1",
        op: "update_identity",
        profileId: profile.id,
        patch: {
          personaJson: {
            profile: String(currentPersona.profile ?? profile.samplingLabel),
            personality: "更依赖价格、型号、真实使用证据和评论区补充信息，不会只因为清单完整就信任。",
            mbtiType: "INTJ",
            responseStyle: "表达克制直接，会用具体问题指出预算和证据缺口。倾向先看评论和细节，再决定是否收藏。"
          }
        },
        before: currentPersona,
        reason: "用户希望该观众更理性，并和同组其他观众拉开。"
      }],
      warnings: []
    };
  }

  async expandAudienceProfiles(input: {
    title: string;
    coverImageUrl: string;
    imageUrls: string[];
    bodyText: string;
    plan: AudienceSamplingPlanViewForProvider;
    directive: AudienceSamplingDirectiveView;
    chunkStart: number;
    chunkCount: number;
    onFrame: (frame: AudienceProfileExpansionFrame) => void | Promise<void>;
  }): Promise<void> {
    await delay(650, 950);
    const chunkStart = input.chunkStart;
    const chunkCount = input.chunkCount;
    const segment = segmentOrder.find((item) => input.directive.description.includes(item)) ?? "核心用户";
    const items = pickDemoTemplatesForSegment(segment, chunkStart + chunkCount).slice(chunkStart);
    for (const [index, { template, cycle }] of items.entries()) {
      const sampleIndex = chunkStart + index;
      const label = cycle > 0 ? `${template.label} ${cycle + 1}` : template.label;
      const profile = {
        samplingLabel: label,
        demographics: mockDemographics(template.segment, sampleIndex)
      };
      await input.onFrame({
        type: "profile_completed",
        sampleIndex,
        profile: { samplingLabel: label, demographics: profile.demographics as { gender: string; ageRange: string; cityTier: string; lifeStage: string; role: string; spendingPower: string } }
      });
    }
  }

  async generateAudiencePersona(input: {
    profile: {
      profileId: string;
      demographics: Record<string, unknown>;
    };
    platformName?: string;
  }): Promise<GeneratedAudience> {
    await delay(550, 850);
    const hash = hashString(input.profile.profileId ?? "");
    const displayName = names[hash % names.length]!;
    const demographics = input.profile.demographics as Record<string, string>;
    const role = demographics.role ?? "用户";
    const lifeStage = demographics.lifeStage ?? "";
    const spendingPower = demographics.spendingPower ?? "";
    const ageRange = demographics.ageRange ?? "不限定年龄";
    const cityTier = demographics.cityTier ?? "不限定城市";
    const gender = demographics.gender ?? "不限定";
    const background = mockBackgroundForDemographics({ ...demographics, gender, role, lifeStage, spendingPower, ageRange, cityTier });
    return {
      profileId: input.profile.profileId,
      displayName,
      persona: {
        profile: `${displayName}是一位${ageRange}的${role}，生活在${cityTier}，目前处于${lifeStage || "普通生活阶段"}。${background}长期消费习惯偏${spendingPower || "中等"}，做决定时会结合家庭节奏、过往经验和可承受成本。`,
        personality: "谨慎务实，会结合自身阶段、预算和真实评论判断可信度。",
        mbtiType: "ISFJ",
        responseStyle: "表达口语化，像真实用户的即时反馈，会围绕自己的具体疑问展开。会先看标题和正文结构，再决定是否点开评论、收藏或退出。"
      }
    };
  }

  async runAudienceTurn(context: RunParticipantContext) {
    const model = "mock-audience-agent";
    const promptVersion = PROMPT_VERSION_AGENT;
    if (!context.maxSteps) throw new Error("runAudienceTurn: maxSteps is required");
    const maxSteps = context.maxSteps;
    let currentContext = context;
    let currentActionId = context.actionId;
    let thoughtText = "";
    const executedSteps: Array<{ actionId: string; step: StepResult<ToolSet>; toolCalls: ParsedToolCall[] }> = [];

    for (let guard = context.stepIndex; guard < maxSteps; guard += 1) {
      await delay(1500, 3000);
      // 使用 participantId 的稳定 hash 叠加 stepIndex 作为 indexHint，
      // 避免 UUID 数字末位带来的随机性；同一观众同一 stepIndex 行为可复现，
      // 不同 stepIndex 仍有变化以覆盖 read_post / like_comment / write_comment 等分支
      const indexHint = hashString(currentContext.participantId) + currentContext.stepIndex;
      const toolCalls = enrichMockToolCalls(planMockTools(currentContext, indexHint), currentContext);
      thoughtText = buildThought(currentContext, toolCalls);
      const enrichedToolCalls = toolCalls.map((call, index) => enrichMockToolCall(currentContext, currentActionId, call, index));

      for (const call of enrichedToolCalls) {
        await executeAiSdkPlannedToolCall(currentActionId, {
          toolName: call.toolName,
          callIndex: call.callIndex ?? 0,
          sdkCallId: call.sdkCallId,
          idempotencyKey: call.idempotencyKey ?? idempotencyKeyForMock(currentContext, currentActionId, call.callIndex ?? 0),
          args: call.args,
          rawToolCall: call.rawToolCall
        });
      }

      const step = mockStepResult(model, thoughtText, enrichedToolCalls, currentContext);
      await persistStep(currentActionId, step, { promptVersion });
      executedSteps.push({ actionId: currentActionId, step, toolCalls: enrichedToolCalls });

      const nextTurnId = await completeAiSdkStepAndPrepareNext(currentActionId, step, maxSteps);
      if (!nextTurnId) break;
      const nextContext = await contextForNextMockTurn(currentContext, nextTurnId);
      if (!nextContext) break;
      currentContext = nextContext;
      currentActionId = nextTurnId;
    }

    const requestPayload: Record<string, unknown> = {
      model,
      messages: context.messages,
      hasOpenedPost: context.hasOpenedPost,
      stepIndex: context.stepIndex,
      maxSteps
    };

    const rawResponse: Record<string, unknown> = {
      provider: "mock",
      model,
      steps: executedSteps.map(({ actionId, toolCalls }) => ({ actionId, toolCalls }))
    };

    const allToolCalls = executedSteps.flatMap((step) => step.toolCalls);

    return {
      thoughtText,
      toolCalls: allToolCalls,
      managedRuntime: true,
      rawOutput: {
        provider: "mock",
        stepIndex: context.stepIndex,
        hasOpenedPost: context.hasOpenedPost,
        toolCalls: allToolCalls
      },
      model,
      promptVersion,
      requestJson: requestPayload,
      rawResponseJson: rawResponse,
      parsedToolCallsJson: allToolCalls
    };
  }
}

function enrichMockToolCalls(calls: ParsedToolCall[], context: RunParticipantContext): ParsedToolCall[] {
  const postId = postIdFromTranscript(context);
  return calls.map((call) => {
    const args = { ...call.args };
    if (postId && requiresPostId(call.toolName)) args.postId = postId;
    return { ...call, args };
  });
}

function enrichMockToolCall(
  context: RunParticipantContext,
  actionId: string,
  call: ParsedToolCall,
  callIndex: number
): ParsedToolCall {
  const sdkCallId = call.sdkCallId ?? `mock_call_${context.stepIndex}_${callIndex}`;
  const idempotencyKey = idempotencyKeyForMock(context, actionId, callIndex);
  return {
    ...call,
    sdkCallId,
    callIndex,
    idempotencyKey,
    rawToolCall: {
      id: sdkCallId,
      type: "function",
      function: {
        name: call.toolName,
        arguments: JSON.stringify(call.args)
      }
    }
  };
}

function idempotencyKeyForMock(context: RunParticipantContext, actionId: string, callIndex: number) {
  return `${context.runId}:${context.participantId}:${actionId}:${callIndex}`;
}

function requiresPostId(toolName: ParsedToolCall["toolName"]) {
  return toolName === "read_post"
    || toolName === "view_comments"
    || toolName === "like_post"
    || toolName === "favorite_post"
    || toolName === "share_post"
    || toolName === "write_comment";
}

function postIdFromTranscript(context: RunParticipantContext) {
  for (const message of [...context.messages].reverse()) {
    if (message.role !== "tool") continue;
    const content = message.content as unknown[];
    const resultPart = content.find(isToolResultWithOutput);
    if (!resultPart) continue;
    const output = toolResultOutputValue(resultPart.output);
    const result = output && typeof output === "object" && !Array.isArray(output) ? output as Record<string, unknown> : {};
    const postId = typeof result.postId === "string" ? result.postId.trim() : "";
    if (postId) return postId;
  }
  return null;
}

function isToolResultWithOutput(part: unknown): part is JsonToolResultPart {
  const record = part && typeof part === "object" ? part as Record<string, unknown> : {};
  return record.type === "tool-result" && "output" in record;
}

function mockStepResult(
  model: string,
  thoughtText: string,
  toolCalls: ParsedToolCall[],
  context: RunParticipantContext
): StepResult<ToolSet> {
  const aiSdkToolCalls = toolCalls.map((call) => ({
    type: "tool-call",
    toolCallId: call.sdkCallId,
    toolName: call.toolName,
    input: call.args
  }));
  return {
    text: thoughtText,
    reasoningText: undefined,
    toolCalls: aiSdkToolCalls,
    finishReason: toolCalls.length ? "tool-calls" : "stop",
    rawFinishReason: toolCalls.length ? "tool-calls" : "stop",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    request: {
      body: {
        provider: "mock",
        model,
        actionId: context.actionId,
        stepIndex: context.stepIndex,
        messages: context.messages
      }
    },
    response: {
      body: {
        provider: "mock",
        model,
        text: thoughtText,
        toolCalls
      }
    },
    model: { modelId: model }
  } as unknown as StepResult<ToolSet>;
}

async function contextForNextMockTurn(
  previous: RunParticipantContext,
  nextTurnId: string
): Promise<RunParticipantContext | null> {
  const turn = await prisma.agentTurn.findUnique({ where: { id: nextTurnId } });
  if (!turn?.journeyId) return null;
  const items = await loadJourneyTranscript(prisma, turn.journeyId);
  // Re-derive hasOpenedPost from DB: open_post interaction event is committed by the previous turn.
  const openPostEvent = await prisma.socialInteractionEvent.findFirst({
    where: {
      journeyId: turn.journeyId,
      interactionType: "open_post"
    },
    select: { id: true }
  });
  return {
    ...previous,
    actionId: turn.id,
    stepIndex: turn.stepIndex,
    journeyId: turn.journeyId,
    hasOpenedPost: previous.hasOpenedPost || !!openPostEvent,
    messages: await renderSessionMessages(items),
    availableTools: ALL_TOOLS
  };
}

export function planMockTools(context: RunParticipantContext, indexHint: number): ParsedToolCall[] {
  if (!context.hasOpenedPost) {
    if (context.stepIndex === 0 && indexHint % 5 === 0) {
      return [mockExit("not_relevant", "feed_only", "low", "low")];
    }
    return [{ toolName: "open_post", args: {} }];
  }

  if (context.hasOpenedPost) {
    const firstVisibleCommentId = firstCommentIdFromTranscript(context);
    if (context.stepIndex >= 3) return [mockExit("no_more_action", "skimmed", "low", "medium")];
    // ~20%: read and leave without interaction (read_post → exit)
    if (indexHint % 5 === 3) {
      const depth: ReadDepth = indexHint % 3 === 0 ? "skim" : indexHint % 3 === 1 ? "partial" : "full";
      // Vary risk exit reasons across participants
      const reason: ExitReasonCategory =
        depth === "skim" ? "not_interested"
        : depth === "partial" ? (indexHint % 2 === 0 ? "low_trust" : "too_ad_like")
        : (indexHint % 2 === 0 ? "finished_normally" : "need_more_evidence");
      const trust: InterestTrustLevel = reason === "low_trust" || reason === "too_ad_like" || reason === "need_more_evidence" ? "low" : "medium";
      return [mockReadPost(depth), mockExit(reason, depthToExitDepth(depth), "low", trust)];
    }
    if (indexHint % 5 === 0 && firstVisibleCommentId) {
      return [
        { toolName: "like_comment", args: { commentId: firstVisibleCommentId } },
        mockExit("finished_normally", "partial", "medium", "high")
      ];
    }
    if (indexHint % 3 === 0 && firstVisibleCommentId) {
      return [
        mockWriteComment("doubt", indexHint, firstVisibleCommentId),
        mockExit("finished_normally", "partial", "medium", "medium")
      ];
    }
    const calls: ParsedToolCall[] = [];
    // read_post before interacting (not everyone — ~67% read first)
    if (indexHint % 3 !== 1) calls.push(mockReadPost(indexHint % 2 === 0 ? "partial" : "full"));
    if (indexHint % 5 === 2) calls.push({ toolName: "share_post", args: {} });
    if (indexHint % 2 === 0) calls.push({ toolName: "favorite_post", args: {} });
    if (indexHint % 3 === 0) calls.push({ toolName: "like_post", args: {} });
    if (indexHint % 4 !== 1) calls.push({ toolName: "view_comments", args: { cursor: null } });
    if (indexHint % 4 === 1) calls.push(mockWriteComment(mockCommentForIndex(indexHint), indexHint, null));
    if (context.stepIndex >= 2) calls.push(mockExit("finished_normally", "full", "high", "high"));
    return calls.length ? calls : [mockExit("no_more_action", "skimmed", "low", "medium")];
  }

  return [];
}

type DemoCommentPoolName = keyof typeof demoCommentPools;

function mockComment(poolName: DemoCommentPoolName, indexHint: number) {
  const pool: readonly string[] = demoCommentPools[poolName];
  return pick(pool, indexHint);
}

function mockCommentForIndex(indexHint: number): DemoCommentPoolName {
  return indexHint % 4 === 0 ? "resonance"
    : indexHint % 4 === 1 ? "experience"
      : indexHint % 4 === 2 ? "question"
        : "lowIntent";
}

function intentForPool(poolName: DemoCommentPoolName): CommentIntent {
  switch (poolName) {
    case "question": return "ask";
    case "doubt": return "doubt";
    case "resonance": return "agree";
    case "experience": return "share_experience";
    case "lowIntent": return "joke";
  }
}

function mockReadPost(depth: ReadDepth): ParsedToolCall {
  return { toolName: "read_post", args: { depth, focus: [] } };
}

function mockExit(
  reasonCategory: ExitReasonCategory,
  readingDepth: ExitReadingDepth,
  interestLevel: InterestTrustLevel,
  trustLevel: InterestTrustLevel
): ParsedToolCall {
  return { toolName: "exit_browsing", args: { reasonCategory, readingDepth, interestLevel, trustLevel } };
}

function mockWriteComment(poolName: DemoCommentPoolName, indexHint: number, replyToCommentId: string | null): ParsedToolCall {
  // doubt pool splits into doubt / pushback for variety
  const intent: CommentIntent = poolName === "doubt" && indexHint % 3 === 0 ? "pushback" : intentForPool(poolName);
  return {
    toolName: "write_comment",
    args: {
      content: mockComment(poolName, indexHint),
      intent,
      replyToCommentId
    }
  };
}

function depthToExitDepth(depth: ReadDepth): ExitReadingDepth {
  switch (depth) {
    case "skim": return "skimmed";
    case "partial": return "partial";
    case "full": return "full";
  }
}

function buildThought(context: RunParticipantContext, calls: ParsedToolCall[]): string {
  const toolNames = calls.map((call) => call.toolName);
  if (!context.hasOpenedPost && toolNames.includes("exit_browsing")) {
    return `标题和封面都不太相关，先划走。`;
  }
  if (toolNames.includes("open_post")) {
    return `避坑清单有点意思，点开看看。`;
  }
  if (toolNames.includes("read_post") && !toolNames.includes("write_comment") && !toolNames.includes("like_post") && !toolNames.includes("favorite_post") && !toolNames.includes("share_post")) {
    const depth = calls.find((c) => c.toolName === "read_post")?.args.depth as string | undefined;
    if (depth === "skim") return `快速扫了一眼，没啥感觉。`;
    if (depth === "partial") return `看了部分，感觉不太对劲。`;
    return `基本看完了，没有特别想互动的。`;
  }
  if (toolNames.includes("write_comment")) {
    const intent = calls.find((c) => c.toolName === "write_comment")?.args.intent as string | undefined;
    if (intent === "doubt") return `这个结论有点绝对，想追问一下。`;
    if (intent === "ask") return `正好有疑问，评论区问问。`;
    if (intent === "share_experience") return `我也有类似经验，补充一下。`;
    return `想说点什么，留条评论。`;
  }
  if (toolNames.includes("share_post")) {
    return `这个清单转给待产的朋友正合适。`;
  }
  if (toolNames.includes("like_comment")) {
    return `这条评论说得太对了。`;
  }
  if (toolNames.includes("favorite_post")) {
    return `先收藏，下次买东西对照看。`;
  }
  return `看完了，差不多该走了。`;
}

function firstCommentIdFromTranscript(context: RunParticipantContext) {
  for (const message of [...context.messages].reverse()) {
    if (message.role !== "tool") continue;
    const resultPart = message.content.find(isViewCommentsToolResult) as JsonToolResultPart | undefined;
    if (!resultPart) continue;
    const output = toolResultOutputValue(resultPart.output);
    const result = output && typeof output === "object" && !Array.isArray(output) ? output as Record<string, unknown> : {};
    const comments = Array.isArray(result.comments) ? result.comments : [];
    const first = comments[0];
    if (first && typeof first === "object" && "id" in first && typeof first.id === "string") {
      return first.id;
    }
  }
  return null;
}

type JsonToolResultPart = {
  type: "tool-result";
  toolName: string;
  output:
    | { type: "json"; value: unknown }
    | { type: "text"; value: string }
    | { type: string; value?: unknown };
};

function isViewCommentsToolResult(part: unknown): part is JsonToolResultPart {
  const record = part && typeof part === "object" ? part as Record<string, unknown> : {};
  return record.type === "tool-result" && record.toolName === "view_comments" && "output" in record;
}

function toolResultOutputValue(output: JsonToolResultPart["output"]) {
  if (output.type === "json") return output.value;
  if (output.type === "text" && typeof output.value === "string") return safeJson(output.value);
  return null;
}

function safeJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
