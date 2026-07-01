import { prisma, type Prisma } from "@trycue/db";
import type { LanguageModelUsage, Telemetry, TelemetryOptions } from "ai";
import { log } from "../logger.js";

export type AiSdkTraceInput = {
  runId?: string;
  taskType: string;
  promptVersion?: string;
  agentTurnId?: string;
  participantId?: string;
  jobId?: string;
  profileId?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

export function aiSdkTrace(input: AiSdkTraceInput): {
  telemetry?: TelemetryOptions;
} {
  if (!input.runId) return {};
  // ai@7 的 Telemetry 接口移除了 metadata 字段，调用方传入的 trace 维度
  // （如 journeyId/stepIndex/directiveId/chunkStart/chunkCount）无法再通过
  // telemetry metadata 传递。这里把 caller metadata 合并进 metadataJson，
  // 保证 usage attribution 和按这些标识符调试的能力不丢失。
  const callerMetadata = cleanTelemetryMetadata(input.metadata ?? {});
  return {
    telemetry: {
      isEnabled: true,
      recordInputs: false,
      recordOutputs: false,
      functionId: input.taskType,
      integrations: [createTraceIntegration(input, callerMetadata)]
    }
  };
}

function createTraceIntegration(
  input: Required<Pick<AiSdkTraceInput, "taskType">> & AiSdkTraceInput,
  callerMetadata: Record<string, string | number | boolean>
): Telemetry {
  return {
    onStepEnd: async (event) => {
      if (!input.runId) return;
      const usage = normalizeUsage(event.usage);
      try {
        await prisma.$transaction(async (tx) => {
          await tx.llmCallTrace.create({
            data: {
              runId: input.runId!,
              taskType: input.taskType,
              provider: event.model.provider,
              model: event.model.modelId,
              promptVersion: input.promptVersion,
              agentTurnId: input.agentTurnId,
              participantId: input.participantId,
              jobId: input.jobId,
              profileId: input.profileId,
              stepNumber: event.stepNumber,
              finishReason: stringValue(event.finishReason),
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
              reasoningTokens: usage.reasoningTokens,
              cacheReadTokens: usage.cacheReadTokens,
              cacheWriteTokens: usage.cacheWriteTokens,
              noCacheInputTokens: usage.noCacheInputTokens,
              rawUsageJson: usage.rawUsageJson,
              metadataJson: cleanJson({
                ...callerMetadata,
                functionId: input.taskType,
                toolCallCount: event.toolCalls.length,
                finishReason: event.finishReason,
                rawFinishReason: event.rawFinishReason
              }) as Prisma.InputJsonValue
            }
          });
          await tx.runLlmUsageSummary.upsert({
            where: { runId: input.runId! },
            create: {
              runId: input.runId!,
              callCount: 1,
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              totalTokens: usage.totalTokens ?? 0,
              reasoningTokens: usage.reasoningTokens ?? 0,
              cacheReadTokens: usage.cacheReadTokens ?? 0,
              cacheWriteTokens: usage.cacheWriteTokens ?? 0,
              noCacheInputTokens: usage.noCacheInputTokens ?? 0
            },
            update: {
              callCount: { increment: 1 },
              inputTokens: { increment: usage.inputTokens ?? 0 },
              outputTokens: { increment: usage.outputTokens ?? 0 },
              totalTokens: { increment: usage.totalTokens ?? 0 },
              reasoningTokens: { increment: usage.reasoningTokens ?? 0 },
              cacheReadTokens: { increment: usage.cacheReadTokens ?? 0 },
              cacheWriteTokens: { increment: usage.cacheWriteTokens ?? 0 },
              noCacheInputTokens: { increment: usage.noCacheInputTokens ?? 0 }
            }
          });
        });
      } catch (err) {
        log.warn({ err, runId: input.runId, taskType: input.taskType }, "[AI SDK trace] failed to persist LLM usage");
      }
    }
  };
}

function normalizeUsage(usage: LanguageModelUsage | undefined) {
  const record = objectRecord(usage);
  const inputDetails = objectRecord(record.inputTokenDetails);
  const outputDetails = objectRecord(record.outputTokenDetails);
  const inputTokens = numberValue(record.inputTokens ?? record.promptTokens);
  const outputTokens = numberValue(record.outputTokens ?? record.completionTokens);
  const totalTokens = numberValue(record.totalTokens) ?? (
    inputTokens !== null || outputTokens !== null
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : null
  );
  const reasoningTokens = numberValue(outputDetails.reasoningTokens ?? record.reasoningTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens,
    cacheReadTokens: numberValue(inputDetails.cacheReadTokens ?? record.cachedInputTokens),
    cacheWriteTokens: numberValue(inputDetails.cacheWriteTokens),
    noCacheInputTokens: numberValue(inputDetails.noCacheTokens),
    rawUsageJson: record.raw && typeof record.raw === "object"
      ? cleanJson(record.raw) as Prisma.InputJsonValue
      : undefined
  };
}

function cleanJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => cleanJson(item));
  if (typeof value === "undefined") return null;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => typeof item !== "undefined")
      .map(([key, item]) => [key, cleanJson(item)])
  );
}

function cleanTelemetryMetadata(input: Record<string, string | number | boolean | null | undefined>): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string | number | boolean] => {
      const value = entry[1];
      return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
    })
  );
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
