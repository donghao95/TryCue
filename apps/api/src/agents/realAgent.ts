import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, hasToolCall, stepCountIs, streamText } from "ai";
import { getSharedCapacityManager, getSharedRateLimitedFetch } from "../llm/rateLimitedFetch.js";
import { aiSdkTrace } from "../llm/aiSdkTracing.js";
import { log } from "../logger.js";
import {
  AudiencePlanFrameSchema,
  AudienceProfileExpansionFrameSchema,
  AudienceSamplingPlanRevisionProposalSchema,
  AudienceSeatRevisionProposalSchema,
  MBTI_TYPES,
  type AudienceGenerationProgressView,
  type AudiencePlanFrame,
  type AudiencePlanPreview,
  type AudiencePlanProgressEvent,
  type AudienceProfileExpansionFrame,
  type AudienceSamplingPlanRevisionMessage,
  type AudienceSamplingPlanRevisionProposal,
  type AudienceSeatRevisionMessage,
  type AudienceSeatRevisionProposal
} from "@trycue/shared/audience";
import type { LlmRuntimeConfig } from "../llmConfigStore.js";
import { validateRealLlmConfig } from "../llmConfigStore.js";
import type {
  AgentProvider,
  ParsedToolCall,
  RunParticipantContext,
  AudienceSamplingDirectiveView,
  AudienceSamplingPlanDraft,
  AudienceSamplingPlanViewForProvider,
  GeneratedAudience,
  LlmTraceContext
} from "./types.js";
import { modelForAiTask, type AiTaskType } from "./taskRunner.js";
import {
  completeAiSdkStepAndPrepareNext,
  createAiSdkToolRuntimeContext,
  createAiSdkToolSet,
  persistStep
} from "../tools/toolExecutor.js";

const TEMPERATURE_CREATIVE = 0.9;
const TEMPERATURE_BALANCED = 0.8;
const TEMPERATURE_PRECISE = 0.45;

import {
  PROMPT_VERSION_AUDIENCE_PLAN,
  PROMPT_VERSION_AUDIENCE_PERSONA,
  PROMPT_VERSION_PROFILE_EXPANSION,
  PROMPT_VERSION_SAMPLING_PLAN_REVISION,
  PROMPT_VERSION_SEAT_REVISION
} from "./promptVersions.js";
import { DEFAULT_PLATFORM_NAME } from "@trycue/shared/report";
import { NdjsonLineBuffer, PlanFrameAccumulator } from "./planFrameAccumulator.js";
import {
  audiencePromptVersion,
  buildAudienceSystemPrompt,
  buildAudienceIdentityPrompt,
  buildSamplingPlanSystemPrompt
} from "./realAgentPrompts.js";

export class RealAgentProvider implements AgentProvider {
  private readonly aiSdkOpenaiCompatible: ReturnType<typeof createOpenAICompatible>;
  private readonly platformName: string;

  constructor(private readonly config: LlmRuntimeConfig, options?: { platformName?: string }) {
    const configError = validateRealLlmConfig(config);
    if (configError) throw new Error(configError);
    const rateLimitedFetch = getSharedRateLimitedFetch();
    this.aiSdkOpenaiCompatible = createOpenAICompatible({
      name: "trycue-openai-compatible",
      apiKey: config.apiKey!,
      baseURL: config.baseUrl!,
      includeUsage: true,
      fetch: rateLimitedFetch
    });
    this.platformName = options?.platformName ?? DEFAULT_PLATFORM_NAME;
  }

  private modelForTask(type: AiTaskType) {
    return modelForAiTask(this.config, type);
  }

  async generateAudienceSamplingPlan(input: {
    title: string;
    coverImageUrl: string;
    imageUrls: string[];
    bodyText: string;
    count: number;
    onReasoningDelta?: (delta: string, meta?: { tokens?: number; tokenEstimate?: number }) => void | Promise<void>;
    onProgress?: (event: AudiencePlanProgressEvent) => void | Promise<void>;
    onFrame?: (frame: AudiencePlanFrame, preview: AudiencePlanPreview) => void | Promise<void>;
    trace?: LlmTraceContext;
  }): Promise<AudienceSamplingPlanDraft> {
    const seenProgress = new Set<string>();
    const emitProgress = async (event: AudiencePlanProgressEvent) => {
      const key = [
        event.stage,
        event.directiveCount ?? "",
        event.quantityTotal ?? "",
        event.detail ?? ""
      ].join(":");
      if (seenProgress.has(key)) return;
      seenProgress.add(key);
      await input.onProgress?.(event);
    };
    await emitProgress({
      stage: "model_request",
      label: "正在请求观众规划模型",
      detail: `目标 ${input.count} 位观众，纳入 ${input.imageUrls.length} 张图片。`,
      targetCount: input.count
    });

    const modelName = this.modelForTask("audience_plan");
    const platformName = this.platformName;
    const result = streamText({
      model: this.aiSdkOpenaiCompatible.chatModel(modelName),
      system: buildSamplingPlanSystemPrompt(platformName),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `请为以下 ${platformName} 内容规划 ${input.count} 位 AI 试映观众的采样计划。

标题：${input.title}
正文：${input.bodyText}

请根据标题、图片和正文推断可能受众，并规划高差异观众分布。

要求：
- 每个 directive 需要有清晰人群描述、人数、组内差异、理由和预期观察。
- 输出聚焦整场分布和 directive 结构，姓名与单人采样 slot 由后续阶段生成。
- planMarkdown 写成试映采样设计 brief，必须引用标题、正文、图片或平台上下文里的具体信息点，避免重复分组卡片中已有的人群名称、人数和差异轴。
- planMarkdown 保持自然连贯，并使用 2-3 个短段落呈现，不要输出单个长段落。
- 采样计划必须围绕这篇内容的具体承诺、场景、对象和平台互动方式设计，不要输出可套用到任意内容的通用观众计划。
- 输出数量必须精确覆盖 ${input.count} 位观众。
- 使用 NDJSON frame protocol 输出：一行一个完整 JSON frame。`
            },
            ...input.imageUrls.flatMap((url) => {
              const imageUrl = absoluteUrlOrNull(url);
              return imageUrl
                ? [{
              type: "image" as const,
              image: imageUrl
            }]
                : [];
            })
          ]
        }
      ],
      temperature: TEMPERATURE_CREATIVE,
      maxRetries: getSharedCapacityManager().getMaxRetries(),
      ...aiSdkTrace({ ...input.trace, taskType: "audience_plan", promptVersion: PROMPT_VERSION_AUDIENCE_PLAN })
    });

    const lineBuffer = new NdjsonLineBuffer();
    const accumulator = new PlanFrameAccumulator(input.count);
    let providerReasoningEmitted = false;
    let reasoningTokenEstimate = 0;
    let reasoningTokens: number | undefined;

    for await (const part of result.fullStream) {
      if (part.type === "reasoning-delta") {
        providerReasoningEmitted = true;
        reasoningTokenEstimate += estimateReasoningDeltaTokens(part.text);
        reasoningTokens = extractReasoningTokenCount(part) ?? reasoningTokens;
        await input.onReasoningDelta?.(part.text, { tokens: reasoningTokens, tokenEstimate: reasoningTokenEstimate });
        await emitProgress({
          stage: "public_reasoning",
          label: "读取公开推理",
          detail: "正在接收 provider 返回的 reasoning 流。",
          targetCount: input.count
        });
      }
      if (part.type === "text-delta") {
        const lines = lineBuffer.push(part.text);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            const errFrame: AudiencePlanFrame = { type: "parser_error", line: trimmed.slice(0, 200), message: "JSON 解析失败" };
            accumulator.apply(errFrame);
            if (input.onFrame) await input.onFrame(errFrame, accumulator.toPreview());
            continue;
          }
          const result = AudiencePlanFrameSchema.safeParse(parsed);
          if (!result.success) {
            const errFrame: AudiencePlanFrame = { type: "parser_error", line: trimmed.slice(0, 200), message: `未知或非法 frame 类型` };
            accumulator.apply(errFrame);
            if (input.onFrame) await input.onFrame(errFrame, accumulator.toPreview());
            continue;
          }
          accumulator.apply(result.data);
          if (input.onFrame) await input.onFrame(result.data, accumulator.toPreview());

          // Emit compatible progress events for legacy consumers
          if (!providerReasoningEmitted) {
            await emitProgress({
              stage: "public_reasoning",
              label: "读取公开推理",
              detail: "正在接收 NDJSON frame 流。",
              targetCount: input.count
            });
          }
          if (result.data.type === "dimension_upsert") {
            await emitProgress({
              stage: "dimensions",
              label: "读取拆分维度",
              detail: `已读取维度：${accumulator.toPreview().dimensions.map(d => d.label).join("、")}`,
              targetCount: input.count
            });
          }
          if (result.data.type === "directive_started" || result.data.type === "directive_patch" || result.data.type === "directive_completed") {
            const preview = accumulator.toPreview();
            await emitProgress({
              stage: "directives",
              label: "读取观众分组",
              detail: `已读取 ${preview.directives.length} 个分组草稿。`,
              directiveCount: preview.directives.length,
              quantityTotal: preview.quantityTotal,
              targetCount: input.count
            });
          }
          if (result.data.type === "plan_completed") {
            const preview = accumulator.toPreview();
            await emitProgress({
              stage: "plan_summary",
              label: "读取计划说明",
              detail: `已完成 plan frame 流；${preview.directives.length} 组，人数合计 ${preview.quantityTotal}/${input.count}。`,
              directiveCount: preview.directives.length,
              quantityTotal: preview.quantityTotal,
              targetCount: input.count
            });
          }
        }
      }
    }

    // Flush remaining buffer
    const remaining = lineBuffer.flush();
    for (const line of remaining) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        const errFrame: AudiencePlanFrame = { type: "parser_error", line: trimmed.slice(0, 200), message: "JSON 解析失败" };
        accumulator.apply(errFrame);
        if (input.onFrame) await input.onFrame(errFrame, accumulator.toPreview());
        continue;
      }
      const result = AudiencePlanFrameSchema.safeParse(parsed);
      if (!result.success) {
        const errFrame: AudiencePlanFrame = { type: "parser_error", line: trimmed.slice(0, 200), message: "未知或非法 frame 类型" };
        accumulator.apply(errFrame);
        if (input.onFrame) await input.onFrame(errFrame, accumulator.toPreview());
        continue;
      }
      accumulator.apply(result.data);
      if (input.onFrame) await input.onFrame(result.data, accumulator.toPreview());
    }

    const draft = accumulator.compile();
    validateSamplingPlanDraft(draft, input.count);
    return draft;
  }


  async generateAudienceSamplingPlanRevision(input: {
    title: string;
    coverImageUrl: string;
    imageUrls: string[];
    bodyText: string;
    plan: AudienceSamplingPlanViewForProvider;
    messages: AudienceSamplingPlanRevisionMessage[];
    trace?: LlmTraceContext;
  }): Promise<AudienceSamplingPlanRevisionProposal> {
    const platformName = this.platformName;
    const result = await generateText({
      model: this.aiSdkOpenaiCompatible.chatModel(this.modelForTask("audience_plan_revision")),
      system: `你是"${platformName} 内容发布前 AI 试映会"的观众分布优化 agent。

你的任务是在当前未确认的 AudienceSamplingPlan 上，根据用户对话生成可预览、可应用的结构化修改建议。

你的输出只负责生成建议卡片；用户采纳后，系统会通过普通 API 写入数据库。
本阶段的操作对象是 AudienceSamplingDirective，包括新增分组、修改分组和删除分组。
整体重做适用于用户明确要求重新规划整场分布的场景。
响应只使用下面 schema 中列出的 operation。

响应必须是可 JSON.parse 的对象：
{
  "summary": string,
  "operations": Array<
    { "operationId": string, "op": "add_directive", "directive": { "name": string, "description": string, "quantity": number, "diversityAxes": string[], "rationale": string, "sortOrder"?: number }, "reason": string }
    | { "operationId": string, "op": "update_directive", "directiveId": string, "patch": { "name"?: string, "description"?: string, "quantity"?: number, "diversityAxes"?: string[], "rationale"?: string, "sortOrder"?: number }, "before"?: object, "reason": string }
    | { "operationId": string, "op": "delete_directive", "directiveId": string, "reason": string }
  >,
  "totalCountChange": { "before": number, "after": number } | null,
  "warnings": string[]
}

规则：
- totalCount 来源于当前 directive.quantity 合计，作为保存后的实时计划人数。
- 用户要求新增人群时，默认输出 add_directive，并让 totalCountChange.after 反映新增后的实时合计；新增分组独立增加计划人数。
- 用户明确说拆分、替换、合并、调出名额或保持总人数时，用配套 update/delete 操作表达人数转移。
- 用户要求删除人群时，默认减少总人数；只有用户明确要求保留总人数或重新分配时，才把删除人数分配到其他分组。
- update_directive 只在 patch 中输出实际要改的字段。
- 新增 directive 必须有自然语言 description、正整数 quantity、非空 diversityAxes 和 rationale。
- 如果用户 @ 了分组，相关 update/delete 使用该分组 directiveId。
- 讨论型回复可以返回 operations: []。
- 只输出 JSON 对象。

prompt_version=${PROMPT_VERSION_SAMPLING_PLAN_REVISION}`,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `内容标题：${input.title}
内容正文：${input.bodyText}

当前采样计划：
${JSON.stringify(input.plan, null, 2)}

本地对话历史（hiddenMentionContexts 是前端隐藏上下文，只帮助理解用户消息；后端应用时仍以 DB 为准）：
${JSON.stringify(input.messages, null, 2)}

请输出一个观众分布优化建议 proposal。`
            },
            ...input.imageUrls.flatMap((url) => {
              const imageUrl = absoluteUrlOrNull(url);
              return imageUrl
                ? [{ type: "image" as const, image: imageUrl }]
                : [];
            })
          ]
        }
      ],
      temperature: TEMPERATURE_PRECISE,
      maxRetries: getSharedCapacityManager().getMaxRetries(),
      ...aiSdkTrace({ ...input.trace, taskType: "audience_plan_revision", promptVersion: PROMPT_VERSION_SAMPLING_PLAN_REVISION })
    });
    const raw = result.text || "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch {
      throw new Error(`Failed to parse LLM response as JSON. Raw output: ${raw.slice(0, 200)}`);
    }
    return AudienceSamplingPlanRevisionProposalSchema.parse(parsed);
  }

  async generateAudienceSeatRevision(input: {
    title: string;
    coverImageUrl: string;
    imageUrls: string[];
    bodyText: string;
    plan: AudienceSamplingPlanViewForProvider | null;
    progress: AudienceGenerationProgressView;
    messages: AudienceSeatRevisionMessage[];
    trace?: LlmTraceContext;
  }): Promise<AudienceSeatRevisionProposal> {
    const platformName = this.platformName;
    const result = await generateText({
      model: this.aiSdkOpenaiCompatible.chatModel(this.modelForTask("audience_seat_revision")),
      system: `你是"${platformName} 内容发布前 AI 试映会"的观众席打磨 agent。

你的任务是在已确认采样计划和已生成观众结果的基础上，帮助用户讨论、解释并生成结果层修改建议。

你的输出只负责生成建议卡片；用户采纳后，系统会通过普通 API 写入数据库。
本阶段的操作对象是具体观众结果和观众人设。
可用 operation：update_identity、regenerate_identity、delete_profile、favorite_identity、retry_identity、add_profile。
新增观众使用 add_profile；系统会在对应分组下创建 AudienceProfile，同步该分组人数、计划总人数和试映观众数，并启动单个人设生成任务。
运行期 Journey、评论、互动由开始试映后的调度器生成；本阶段聚焦观众结果和人设准备。

响应必须是可 JSON.parse 的对象：
{
  "summary": string,
  "operations": Array<
    { "operationId": string, "op": "update_identity", "profileId": string, "patch": { "displayName"?: string, "avatarUrl"?: string | null, "personaJson"?: { "profile": string, "personality": string, "mbtiType": string, "responseStyle": string } }, "before"?: object, "reason": string }
    | { "operationId": string, "op": "regenerate_identity", "profileId": string, "reason": string }
    | { "operationId": string, "op": "delete_profile", "profileId": string, "reason": string }
    | { "operationId": string, "op": "favorite_identity", "profileId": string, "favorited": boolean, "reason": string }
    | { "operationId": string, "op": "retry_identity", "profileId": string, "reason": string }
    | { "operationId": string, "op": "add_profile", "directiveId": string, "samplingLabel": string, "demographics": object, "reason": string }
  >,
  "warnings": string[]
}

规则：
- update_identity 只输出实际要改的字段。
- personaJson 四段必须是完整自然语言字符串，mbtiType 必须是 16 种 MBTI 类型之一。
- 用户要求新增观众、增加人数或多加几个人时，输出 add_profile。
- 用户要求替换某个观众时，按意图组合 delete_profile 与 add_profile，或使用 regenerate_identity。
- 用户要求补齐失败/缺口时，优先使用 retry_identity；需要额外增加新观众时使用 add_profile。
- 讨论型回复可以返回 operations: []。
- 只输出 JSON 对象。

prompt_version=${PROMPT_VERSION_SEAT_REVISION}`,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `内容标题：${input.title}
内容正文：${input.bodyText}

已确认采样计划：
${JSON.stringify(input.plan, null, 2)}

观众生成进度与结果：
${JSON.stringify(input.progress, null, 2)}

本地对话历史：
${JSON.stringify(input.messages, null, 2)}

请输出一个观众席打磨建议 proposal。`
            },
            ...input.imageUrls.flatMap((url) => {
              const imageUrl = absoluteUrlOrNull(url);
              return imageUrl
                ? [{ type: "image" as const, image: imageUrl }]
                : [];
            })
          ]
        }
      ],
      temperature: TEMPERATURE_PRECISE,
      maxRetries: getSharedCapacityManager().getMaxRetries(),
      ...aiSdkTrace({ ...input.trace, taskType: "audience_seat_revision", promptVersion: PROMPT_VERSION_SEAT_REVISION })
    });
    const raw = result.text || "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch {
      throw new Error(`Failed to parse LLM response as JSON. Raw output: ${raw.slice(0, 200)}`);
    }
    return AudienceSeatRevisionProposalSchema.parse(parsed);
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
    trace?: LlmTraceContext;
  }): Promise<void> {
    const platformName = this.platformName ?? DEFAULT_PLATFORM_NAME;
    const chunkStart = input.chunkStart;
    const chunkCount = input.chunkCount;
    const modelName = this.modelForTask("audience_profile_expansion");
    const result = streamText({
      model: this.aiSdkOpenaiCompatible.chatModel(modelName),
      system: `你是"${platformName} 内容发布前 AI 试映会"的观众采样 slot 扩展 agent。

任务：把一个已确认的 audience directive 展开成指定数量的采样 slot。采样 slot 用于覆盖差异方向和减少重复。

输出格式是 NDJSON：一行一个完整 JSON frame。

支持的 frame 类型：
{ "type": "profile_completed", "sampleIndex": number, "profile": { "samplingLabel": string, "demographics": { "gender": string, "ageRange": string, "cityTier": string, "lifeStage": string, "role": string, "spendingPower": string } } }

字段标准：
- sampleIndex 是当前 directive 内的全局索引，从 ${chunkStart} 开始。
- samplingLabel 是 4-12 个中文字符的采样标签，便于用户扫读。
- demographics 六个字段全部存在；无法确定或不影响反应的字段填"不限定"。每个字段都用短词或短短语，不写解释句。
- demographics.role 只写基础身份或关系，通常 1-6 个中文字符，例如"准妈妈""新手妈妈""准爸爸""伴侣""长辈""送礼者""路人用户""专业从业者"。不要把阶段、动机、决策方式或采样差异写进 role。
- lifeStage 写当前阶段，例如"孕晚期""产后3个月""备孕期""带娃1年"。
- spendingPower 写消费能力或预算倾向，例如"预算敏感""中等""愿为省心付费"。
- 同一个 directive 下的 profiles 合起来覆盖 diversityAxes。
- 输出使用自然中文，保持具体、克制、可作为后续 persona 生成输入。

只输出 NDJSON frames。`,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `请基于以下 ${platformName} 内容和已确认采样计划，展开 directive 对应的 ${chunkCount} 个采样 slot（索引从 ${chunkStart} 到 ${chunkStart + chunkCount - 1}）。

标题：${input.title}
正文：${input.bodyText}

采样计划：
${JSON.stringify(input.plan)}

当前 directive：
${JSON.stringify(input.directive)}

要求：
- 输出数量必须等于 ${chunkCount}。
- sampleIndex 从 ${chunkStart} 开始递增。
- 每个 demographics 对象都包含 gender、ageRange、cityTier、lifeStage、role、spendingPower。
- role 只写基础身份或关系，不写"自主决策""集中采购""依赖评论区"等采样差异。
- 每个 slot 的采样角度清晰不同，并覆盖当前 directive.diversityAxes。`
            },
            ...input.imageUrls.flatMap((url) => {
              const imageUrl = absoluteUrlOrNull(url);
              return imageUrl
                ? [{
              type: "image" as const,
              image: imageUrl
            }]
                : [];
            })
          ]
        }
      ],
      temperature: TEMPERATURE_BALANCED,
      maxRetries: getSharedCapacityManager().getMaxRetries(),
      ...aiSdkTrace({
        ...input.trace,
        taskType: "audience_profile_expansion",
        promptVersion: PROMPT_VERSION_PROFILE_EXPANSION,
        metadata: {
          ...(input.trace?.metadata ?? {}),
          directiveId: input.directive.id,
          chunkStart,
          chunkCount
        }
      })
    });

    const lineBuffer = new NdjsonLineBuffer();

    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        const lines = lineBuffer.push(part.text);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            const errFrame: AudienceProfileExpansionFrame = { type: "parser_error", line: trimmed.slice(0, 200), message: "JSON 解析失败" };
            if (input.onFrame) await input.onFrame(errFrame);
            continue;
          }
          const result = AudienceProfileExpansionFrameSchema.safeParse(parsed);
          if (!result.success) {
            const errFrame: AudienceProfileExpansionFrame = { type: "parser_error", line: trimmed.slice(0, 200), message: "未知或非法 frame 类型" };
            if (input.onFrame) await input.onFrame(errFrame);
            continue;
          }
          if (result.data.type === "profile_completed") {
            // Validated below by the service as each frame is persisted.
          }
          await input.onFrame(result.data);
        }
      }
    }

    // Flush remaining buffer
    const remaining = lineBuffer.flush();
    for (const line of remaining) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        const errFrame: AudienceProfileExpansionFrame = { type: "parser_error", line: trimmed.slice(0, 200), message: "JSON 解析失败" };
        if (input.onFrame) await input.onFrame(errFrame);
        continue;
      }
      const result = AudienceProfileExpansionFrameSchema.safeParse(parsed);
      if (!result.success) {
        const errFrame: AudienceProfileExpansionFrame = { type: "parser_error", line: trimmed.slice(0, 200), message: "未知或非法 frame 类型" };
        if (input.onFrame) await input.onFrame(errFrame);
        continue;
      }
      if (result.data.type === "profile_completed") {
        // Validated below by the service as each frame is persisted.
      }
      await input.onFrame(result.data);
    }
  }

  async generateAudiencePersona(input: {
    profile: {
      profileId: string;
      demographics: Record<string, unknown>;
    };
    platformName?: string;
    trace?: LlmTraceContext;
  }): Promise<GeneratedAudience> {
    const platformName = input.platformName ?? this.platformName ?? DEFAULT_PLATFORM_NAME;
    const result = await generateText({
      model: this.aiSdkOpenaiCompatible.chatModel(this.modelForTask("audience_persona")),
      system: `你是"${platformName} 内容发布前 AI 试映会"的观众身份生成 agent。

任务：根据一个采样 slot，生成一个具体、稳定、可长期复用的 ${platformName} 用户人设。

采样 slot 是待覆盖的用户位置，不是完整人设。它提供人口信息、生活阶段、基础身份和消费倾向。你需要把这些基础信息扩展成一个自然、可信、有一致性的用户。

响应格式是可直接 JSON.parse 的对象：
{
  "profileId": string,
  "displayName": string,
  "persona": {
    "profile": string,
    "personality": string,
    "mbtiType": string,
    "responseStyle": string
  }
}

字段标准：
- displayName 是这个人的名字，像真实生活里会被别人称呼的名字，可以是中文姓名、小名或自然称呼，不承担身份说明功能。
- profile 是这个人的背景小传，写现实生活中的稳定背景、生活阶段、家庭或工作处境、消费处境、过往人生经历和长期生活习惯，让读者能想象这个人，并让人设丰满且可长期复用。可以合理补全职业经历、家庭结构、城市生活状态、照护支持、长期消费习惯和生活节奏。
- personality 写稳定性格、风险偏好、社交倾向、情绪表达和决策耐心，使用自然短句，不写成身份介绍。
- mbtiType 必须是 MBTI 16 型之一：${MBTI_TYPES.join("、")}。
- responseStyle 写这个人在 ${platformName} 上的浏览判断方式、互动倾向和评论表达习惯，使用平台行为习惯描述。
- persona 四个字段彼此一致，并自然继承采样 slot 的核心差异。

只输出 JSON 对象。`,
      messages: [
        {
          role: "user",
          content: `请根据这个采样 slot，生成一个 ${platformName} 用户 persona。

采样 slot：
${JSON.stringify({ profileId: input.profile.profileId, demographics: input.profile.demographics })}

输出要求：
- 带回 profileId。
- displayName 是这个人的名字，像真实生活里会被别人称呼的名字，不承担身份说明功能。
- profile、personality、responseStyle 都是完整自然语言字符串。
- profile 主要补充现实生活背景和人生经历，平台浏览和评论习惯放在 responseStyle。
- profile 使用背景小传写法，不使用第一人称。
- mbtiType 使用合法 16 型。`
        }
      ],
      temperature: TEMPERATURE_CREATIVE,
      maxRetries: getSharedCapacityManager().getMaxRetries(),
      ...aiSdkTrace({
        ...input.trace,
        taskType: "audience_persona",
        promptVersion: PROMPT_VERSION_AUDIENCE_PERSONA,
        profileId: input.trace?.profileId ?? input.profile.profileId
      })
    });
    const raw = result.text || "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch {
      throw new Error(`Failed to parse LLM response as JSON. Raw output: ${raw.slice(0, 200)}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("AUDIENCE_GENERATION_FAILED: model did not return a persona object.");
    }
    return normalizeGeneratedAudience(parsed as GeneratedAudience);
  }

  async runAudienceTurn(context: RunParticipantContext) {
    const promptVersion = audiencePromptVersion(context);
    const model = this.modelForTask("agent_turn");
    const messages = [
      { role: "user" as const, content: buildAudienceIdentityPrompt(context) },
      ...context.messages
    ];
    const runtimeContext = createAiSdkToolRuntimeContext({
      runId: context.runId,
      participantId: context.participantId,
      actionId: context.actionId
    });
    const steps: unknown[] = [];
    if (!context.maxSteps) throw new Error("runAudienceTurn: maxSteps is required");
    const maxSteps = context.maxSteps;
    const requestPayload: Record<string, unknown> = {
      model,
      system: buildAudienceSystemPrompt(context, this.platformName),
      messages,
      maxSteps,
      temperature: TEMPERATURE_BALANCED
    };

    const result = await generateText({
      model: this.aiSdkOpenaiCompatible.chatModel(model),
      system: buildAudienceSystemPrompt(context, this.platformName),
      messages,
      tools: createAiSdkToolSet(runtimeContext),
      stopWhen: [stepCountIs(maxSteps), hasToolCall("exit_browsing")],
      temperature: TEMPERATURE_BALANCED,
      maxRetries: getSharedCapacityManager().getMaxRetries(),
      abortSignal: context.signal,
      timeout: context.timeoutMs && context.timeoutMs > 0
        ? { totalMs: context.timeoutMs, stepMs: context.stepTimeoutMs }
        : undefined,
      // ai@7 默认不保留 step.request.body/messages 和 step.response.body，
      // 但 persistStep 依赖这两个字段写 AgentTurn.requestJson/rawResponseJson。
      // 显式开启以恢复 v6 默认行为，保证审计载荷不静默丢失。
      include: { requestBody: true, requestMessages: true, responseBody: true },
      ...aiSdkTrace({
        runId: context.runId,
        taskType: "agent_turn",
        promptVersion,
        agentTurnId: context.actionId,
        participantId: context.participantId,
        metadata: { journeyId: context.journeyId, stepIndex: context.stepIndex }
      }),
      onStepFinish: async (step) => {
        steps.push(step);
        try {
          await persistStep(runtimeContext.currentAgentTurnId, step, { promptVersion });
        } catch (err) {
          // AI SDK's notify() silently swallows callback errors — log explicitly so data loss is visible
          log.error({ err, turnId: runtimeContext.currentAgentTurnId, runId: context.runId },
            "[RealAgent] persistStep failed — step data may be lost from transcript");
        }
        const nextTurnId = await completeAiSdkStepAndPrepareNext(runtimeContext.currentAgentTurnId, step, maxSteps);
        if (nextTurnId) runtimeContext.currentAgentTurnId = nextTurnId;
      }
    });

    const toolCalls = parsedToolCallsFromAiSdkSteps(steps);
    const rawResponse: Record<string, unknown> = {
      provider: "ai-sdk",
      model,
      finishReason: result.finishReason,
      usage: result.usage,
      steps: steps.map(serializableAiSdkStep)
    };

    return {
      thoughtText: result.text.trim(),
      reasoningText: result.reasoningText?.trim() || undefined,
      toolCalls,
      managedRuntime: true,
      rawOutput: {
        provider: "ai-sdk",
        finalOutput: result.text,
        reasoningText: result.reasoning,
        toolCalls
      },
      model,
      promptVersion,
      requestJson: requestPayload,
      rawResponseJson: rawResponse,
      parsedToolCallsJson: toolCalls
    };
  }
}

function parsedToolCallsFromAiSdkSteps(steps: unknown[]): ParsedToolCall[] {
  return steps.flatMap((step) => {
    const toolCalls = Array.isArray((step as { toolCalls?: unknown }).toolCalls)
      ? (step as { toolCalls: unknown[] }).toolCalls
      : [];
    return toolCalls.map((toolCall, callIndex) => {
      const record = objectRecord(toolCall);
      const input = objectRecord(record.input);
      const toolName = typeof record.toolName === "string" ? record.toolName : "";
      const toolCallId = typeof record.toolCallId === "string" ? record.toolCallId : undefined;
      return {
        toolName: toolName as ParsedToolCall["toolName"],
        args: input,
        sdkCallId: toolCallId,
        callIndex,
        rawToolCall: {
          id: toolCallId,
          type: "function",
          function: { name: toolName, arguments: JSON.stringify(input) }
        }
      };
    }).filter((call) => Boolean(call.toolName));
  });
}

function serializableAiSdkStep(step: unknown) {
  const record = objectRecord(step);
  return {
    text: typeof record.text === "string" ? record.text : "",
    reasoningText: typeof record.reasoningText === "string" ? record.reasoningText : undefined,
    finishReason: record.finishReason,
    usage: record.usage,
    toolCalls: parsedToolCallsFromAiSdkSteps([step])
  };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function extractJson(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const jsonValue = firstCompleteJsonValue(trimmed);
  if (jsonValue) return jsonValue;
  return trimmed;
}

function firstCompleteJsonValue(raw: string) {
  const start = raw.search(/[\[{]/);
  if (start < 0) return null;
  const opener = raw[start];
  const closer = opener === "{" ? "}" : "]";
  const stack: string[] = [];
  let inString = false;
  let escaping = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]");
      continue;
    }
    if (char === "}" || char === "]") {
      if (stack.pop() !== char) return null;
      if (stack.length === 0 && char === closer) return raw.slice(start, index + 1);
    }
  }
  return null;
}

function validateSamplingPlanDraft(value: AudienceSamplingPlanDraft, count: number) {
  if (!value || typeof value !== "object") throw new Error("AUDIENCE_PLAN_FAILED: model did not return an object.");
  if (Number(value.totalCount) !== count) throw new Error("AUDIENCE_PLAN_FAILED: totalCount must match requested count.");
  if (!Array.isArray(value.directives) || value.directives.length === 0) throw new Error("AUDIENCE_PLAN_FAILED: directives must be non-empty.");
  const total = value.directives.reduce((sum, directive) => sum + Number(directive.quantity ?? 0), 0);
  if (total !== count) throw new Error("AUDIENCE_PLAN_FAILED: directive quantities must match requested count.");
  for (const directive of value.directives) {
    if (!directive.name?.trim() || !directive.description?.trim() || !directive.rationale?.trim()) {
      throw new Error("AUDIENCE_PLAN_FAILED: directive name, description, and rationale are required.");
    }
    if (!Number.isInteger(directive.quantity) || directive.quantity <= 0) throw new Error("AUDIENCE_PLAN_FAILED: directive quantity must be positive.");
    if (!Array.isArray(directive.diversityAxes) || directive.diversityAxes.filter((item) => typeof item === "string" && item.trim()).length === 0) {
      throw new Error("AUDIENCE_PLAN_FAILED: directive diversityAxes must be non-empty.");
    }
  }
}

function absoluteUrlOrNull(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "data:" ? url : null;
  } catch {
    return null;
  }
}

function normalizeGeneratedAudience(value: GeneratedAudience): GeneratedAudience {
  return {
    ...value,
    persona: {
      profile: requirePersonaString(value.persona?.profile, "profile"),
      personality: requirePersonaString(value.persona?.personality, "personality"),
      mbtiType: requireMbtiType(value.persona?.mbtiType),
      responseStyle: requirePersonaString(value.persona?.responseStyle, "responseStyle")
    }
  };
}

function requirePersonaString(value: unknown, field: keyof Omit<GeneratedAudience["persona"], "mbtiType">): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`AUDIENCE_GENERATION_FAILED: persona.${field} must be a non-empty string.`);
  }
  return value.trim();
}

const VALID_MBTI_TYPES = new Set(["INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP", "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP"]);

function requireMbtiType(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!VALID_MBTI_TYPES.has(raw)) {
    throw new Error(`AUDIENCE_GENERATION_FAILED: persona.mbtiType must be one of 16 MBTI types, received "${value}".`);
  }
  return raw;
}

function estimateReasoningDeltaTokens(text: string): number {
  const chars = Array.from(text.trim()).length;
  if (chars === 0) return 0;
  return Math.max(1, Math.ceil(chars / 1.8));
}

function extractReasoningTokenCount(part: unknown): number | undefined {
  const values = part && typeof part === "object" ? part as Record<string, unknown> : {};
  const candidates = [
    values.reasoningTokens,
    values.reasoningTokenCount,
    values.reasoning_tokens,
    typeof values.usage === "object" && values.usage ? (values.usage as Record<string, unknown>).reasoningTokens : undefined,
    typeof values.usage === "object" && values.usage ? (values.usage as Record<string, unknown>).reasoning_tokens : undefined
  ];
  const found = candidates.find((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  return found;
}

export { NdjsonLineBuffer, PlanFrameAccumulator } from "./planFrameAccumulator.js";
