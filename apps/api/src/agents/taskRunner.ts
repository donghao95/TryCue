import type { LlmRuntimeConfig } from "../llmConfigStore.js";
import type { AgentProvider } from "./types.js";

export type AiTaskType =
  | "audience_plan"
  | "audience_plan_revision"
  | "audience_seat_revision"
  | "audience_profile_expansion"
  | "audience_persona"
  | "agent_turn"
  | "report";

export type AiModelTier = "fast" | "pro";

export type AiTaskUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type AiTaskRunContext = {
  model: string;
  modelTier: AiModelTier;
};

export type AiTaskRunRecord = {
  type: AiTaskType;
  modelTier: AiModelTier;
  model: string;
  runId?: string;
  contentVersionId?: string;
  durationMs: number;
  ok: boolean;
  error?: string;
  usage?: AiTaskUsage;
};

export const AI_TASK_MODEL_TIER = {
  audience_plan: "pro",
  audience_plan_revision: "pro",
  audience_seat_revision: "pro",
  audience_profile_expansion: "fast",
  audience_persona: "fast",
  agent_turn: "fast",
  report: "pro"
} as const satisfies Record<AiTaskType, AiModelTier>;

export class AiTaskRunner {
  constructor(
    private readonly getConfig: () => LlmRuntimeConfig,
    private readonly onRecord?: (record: AiTaskRunRecord) => void | Promise<void>
  ) {}

  modelTierFor(type: AiTaskType): AiModelTier {
    return AI_TASK_MODEL_TIER[type];
  }

  modelFor(type: AiTaskType): string {
    return modelForAiTask(this.getConfig(), type);
  }

  async run<T>(task: {
    type: AiTaskType;
    runId?: string;
    contentVersionId?: string;
    call: (context: AiTaskRunContext) => Promise<T>;
  }): Promise<T> {
    const modelTier = this.modelTierFor(task.type);
    const model = this.modelFor(task.type);
    const startedAt = Date.now();
    try {
      const result = await task.call({ model, modelTier });
      await this.record({
        type: task.type,
        modelTier,
        model,
        runId: task.runId,
        contentVersionId: task.contentVersionId,
        durationMs: Date.now() - startedAt,
        ok: true
      });
      return result;
    } catch (error) {
      await this.record({
        type: task.type,
        modelTier,
        model,
        runId: task.runId,
        contentVersionId: task.contentVersionId,
        durationMs: Date.now() - startedAt,
        ok: false,
        error: summarizeError(error)
      });
      throw error;
    }
  }

  private async record(record: AiTaskRunRecord) {
    await this.onRecord?.(record);
  }
}

export function modelForAiTask(config: LlmRuntimeConfig, type: AiTaskType): string {
  if (config.runtimeMode === "mock") return `mock-${AI_TASK_MODEL_TIER[type]}`;
  const tier = AI_TASK_MODEL_TIER[type];
  const model = tier === "fast" ? config.models.fast : config.models.pro;
  if (!model) throw new Error(`modelForAiTask: ${tier} model not configured for task "${type}"`);
  return model;
}

export function withAiTaskRunner(provider: AgentProvider, runner: AiTaskRunner): AgentProvider {
  return {
    generateAudienceSamplingPlan: (input) =>
      runner.run({
        type: "audience_plan",
        call: () => provider.generateAudienceSamplingPlan(input)
      }),
    generateAudienceSamplingPlanRevision: (input) =>
      runner.run({
        type: "audience_plan_revision",
        runId: input.plan.runId,
        call: () => provider.generateAudienceSamplingPlanRevision(input)
      }),
    generateAudienceSeatRevision: (input) =>
      runner.run({
        type: "audience_seat_revision",
        runId: input.plan?.runId ?? input.progress.runId,
        call: () => provider.generateAudienceSeatRevision(input)
      }),
    expandAudienceProfiles: (input) =>
      runner.run({
        type: "audience_profile_expansion",
        runId: input.plan.runId,
        call: () => provider.expandAudienceProfiles(input)
      }),
    generateAudiencePersona: (input) =>
      runner.run({
        type: "audience_persona",
        call: () => provider.generateAudiencePersona(input)
      }),
    runAudienceTurn: (context) =>
      runner.run({
        type: "agent_turn",
        runId: context.runId,
        call: () => provider.runAudienceTurn(context)
      })
  };
}

function summarizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}
