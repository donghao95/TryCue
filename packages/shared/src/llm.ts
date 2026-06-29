import { z } from "zod";

// ── LLM runtime mode ──

export const LlmRuntimeModeSchema = z.enum(["mock", "real"]);
export type LlmRuntimeMode = z.infer<typeof LlmRuntimeModeSchema>;

// ── 容量模式与预设 ──

export const LlmCapacityModeSchema = z.enum(["auto", "manual"]);
export type LlmCapacityMode = z.infer<typeof LlmCapacityModeSchema>;

export const LlmCapacityPresetSchema = z.enum(["conservative", "standard", "high_quota", "custom"]);
export type LlmCapacityPreset = z.infer<typeof LlmCapacityPresetSchema>;

export type LlmCapacityPresetValues = {
  initialRpm: number;
  minRpm: number;
  maxRpm: number;
  initialConcurrency: number;
  minConcurrency: number;
  maxConcurrency: number;
};

export const LLM_CAPACITY_PRESET_VALUES: Record<Exclude<LlmCapacityPreset, "custom">, LlmCapacityPresetValues> = {
  conservative: {
    initialRpm: 4,
    minRpm: 1,
    maxRpm: 30,
    initialConcurrency: 2,
    minConcurrency: 1,
    maxConcurrency: 2
  },
  standard: {
    initialRpm: 8,
    minRpm: 2,
    maxRpm: 60,
    initialConcurrency: 4,
    minConcurrency: 1,
    maxConcurrency: 4
  },
  high_quota: {
    initialRpm: 30,
    minRpm: 5,
    maxRpm: 300,
    initialConcurrency: 8,
    minConcurrency: 1,
    maxConcurrency: 16
  }
};

// ── 容量配置 schema ──

export const LlmCapacitySharedSchema = z.object({
  initialRpm: z.number().int().positive(),
  minRpm: z.number().int().positive(),
  maxRpm: z.number().int().positive(),
  hardMaxRpm: z.number().int().positive(),
  initialConcurrency: z.number().int().positive(),
  minConcurrency: z.number().int().positive(),
  maxConcurrency: z.number().int().positive(),
  hardMaxConcurrency: z.number().int().positive()
});
export type LlmCapacityShared = z.infer<typeof LlmCapacitySharedSchema>;

export const LlmCapacityRetrySchema = z.object({
  maxRetries: z.number().int().min(0).max(10)
});
export type LlmCapacityRetry = z.infer<typeof LlmCapacityRetrySchema>;

export const LlmCapacityAutoSchema = z.object({
  cooldownMs: z.number().int().positive(),
  successWindow: z.number().int().positive(),
  rpmIncreaseStep: z.number().int().positive()
});
export type LlmCapacityAuto = z.infer<typeof LlmCapacityAutoSchema>;

export const LlmCapacitySettingsSchema = z.object({
  mode: LlmCapacityModeSchema,
  preset: LlmCapacityPresetSchema,
  shared: LlmCapacitySharedSchema,
  retry: LlmCapacityRetrySchema,
  auto: LlmCapacityAutoSchema
});
export type LlmCapacitySettings = z.infer<typeof LlmCapacitySettingsSchema>;

// ── LLM 设置 API ──

export const LlmSettingsRequestSchema = z.object({
  provider: z.literal("openai-compatible").default("openai-compatible"),
  runtimeMode: LlmRuntimeModeSchema,
  apiKey: z.string().trim().optional(),
  clearApiKey: z.boolean().optional().default(false),
  baseUrl: z.string().trim().optional(),
  models: z.object({
    fast: z.string().trim().optional(),
    pro: z.string().trim().optional()
  }),
  capacity: LlmCapacitySettingsSchema.optional()
}).strict();
export type LlmSettingsRequest = z.infer<typeof LlmSettingsRequestSchema>;

export const ListModelsRequestSchema = z.object({
  apiKey: z.string().trim().optional(),
  baseUrl: z.string().trim().optional()
});
export type ListModelsRequest = z.infer<typeof ListModelsRequestSchema>;

export type LlmSettingsView = {
  provider: "openai-compatible";
  runtimeMode: LlmRuntimeMode;
  isConfigured: boolean;
  isRealConfigComplete: boolean;
  hasApiKey: boolean;
  apiKeyMasked: string;
  baseUrl: string;
  models: { fast: string; pro: string };
  capacity: LlmCapacitySettings;
  configPath: string;
};

export type ModelListItem = {
  id: string;
  ownedBy?: string;
};

// ── 容量运行时状态 ──

export type LlmCapacityStatus = {
  mode: LlmCapacityMode;
  effectiveRpm: number;
  effectiveConcurrency: number;
  configuredMaxRpm: number;
  configuredMaxConcurrency: number;
  inFlight: number;
  queueSize: number;
  cooldownUntil?: string;
  recentLimitCount: number;
  lastLimitAt?: string;
  lastLimitReason?: string;
};

// ── 容量探测（probe） ──

export const LlmCapacityProbeModeSchema = z.enum(["normal", "high_quota", "custom"]);
export type LlmCapacityProbeMode = z.infer<typeof LlmCapacityProbeModeSchema>;

export const LlmCapacityProbeRequestSchema = z.object({
  mode: LlmCapacityProbeModeSchema,
  maxRpm: z.number().int().positive().optional(),
  maxConcurrency: z.number().int().positive().optional(),
  model: z.string().trim().optional(),
  apiKey: z.string().trim().optional(),
  baseUrl: z.string().trim().optional()
}).strict();
export type LlmCapacityProbeRequest = z.infer<typeof LlmCapacityProbeRequestSchema>;

export type LlmCapacityProbeResult = {
  recommendedRpm: number;
  recommendedConcurrency: number;
  testedMaxRpm: number;
  testedMaxConcurrency: number;
  avgLatencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  levels: LlmCapacityProbeLevelResult[];
  warnings: string[];
};

export type LlmCapacityProbeLevelResult = {
  concurrency: number;
  sentRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rpm: number;
  successRate: number;
  avgLatencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  elapsedMs: number;
  selected: boolean;
  stopReason?: string;
};

export type LlmCapacityProbeJobStatus = "running" | "completed" | "failed" | "cancelled";
export type LlmCapacityProbeJobPhase = "starting" | "testing" | "cooldown" | "done";

export type LlmCapacityProbeJobStartView = {
  jobId: string;
  status: LlmCapacityProbeJobStatus;
};

export type LlmCapacityProbeJobView = {
  id: string;
  status: LlmCapacityProbeJobStatus;
  phase: LlmCapacityProbeJobPhase;
  currentRpm: number;
  currentConcurrency: number;
  currentLevelSentRequests: number;
  currentLevelSuccessfulRequests: number;
  currentLevelFailedRequests: number;
  currentLevelInputTokens: number;
  currentLevelOutputTokens: number;
  currentLevelTotalTokens: number;
  currentLevelAvgLatencyMs: number;
  currentLevelElapsedMs: number;
  currentLevelDurationMs: number;
  cooldownRemainingMs: number;
  cooldownTotalMs: number;
  sentRequests: number;
  elapsedMs: number;
  maxElapsedMs: number;
  successfulRequests: number;
  failedRequests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  stableRpm: number;
  stableConcurrency: number;
  levels: LlmCapacityProbeLevelResult[];
  message: string;
  result?: LlmCapacityProbeResult;
  error?: string;
};

// ── 应用探测推荐值 ──

export const ApplyRecommendedRequestSchema = z.object({
  recommendedRpm: z.number().int().positive().optional(),
  recommendedConcurrency: z.number().int().positive().optional(),
  testedMaxRpm: z.number().int().positive().optional(),
  testedMaxConcurrency: z.number().int().positive().optional(),
  maxRpm: z.number().int().positive().optional(),
  maxConcurrency: z.number().int().positive().optional()
}).strict().refine((value) => Boolean(value.recommendedRpm ?? value.maxRpm) && Boolean(value.recommendedConcurrency ?? value.maxConcurrency), {
  message: "需要提供正整数 recommendedRpm 和 recommendedConcurrency"
});
export type ApplyRecommendedRequest = z.infer<typeof ApplyRecommendedRequestSchema>;
