import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import type { LlmCapacitySettings, LlmRuntimeMode, LlmSettingsRequest, LlmSettingsView } from "@trycue/shared/llm";
import { capacityForPreset, DEFAULT_CAPACITY_SETTINGS, validateCapacitySettings } from "./llm/capacityPresets.js";

export type LlmRuntimeConfig = {
  provider: "openai-compatible";
  runtimeMode: LlmRuntimeMode;
  apiKey?: string;
  baseUrl?: string;
  models: {
    fast?: string;
    pro?: string;
  };
  capacity: LlmCapacitySettings;
};

const DEFAULT_LLM_CONFIG: LlmRuntimeConfig = {
  provider: "openai-compatible",
  runtimeMode: "mock",
  models: {},
  capacity: DEFAULT_CAPACITY_SETTINGS
};

const LlmConfigFileSchema = z.object({
  provider: z.literal("openai-compatible").default("openai-compatible"),
  runtimeMode: z.enum(["mock", "real"]),
  apiKey: z.string().trim().optional(),
  baseUrl: z.string().trim().optional(),
  models: z
    .object({
      fast: z.string().trim().optional(),
      pro: z.string().trim().optional()
    })
    .default({}),
  capacity: z
    .object({
      mode: z.enum(["auto", "manual"]).default("auto"),
      preset: z.enum(["conservative", "standard", "high_quota", "custom"]).default("standard"),
      shared: z
        .object({
          initialRpm: z.number().int().positive().default(DEFAULT_CAPACITY_SETTINGS.shared.initialRpm),
          minRpm: z.number().int().positive().default(DEFAULT_CAPACITY_SETTINGS.shared.minRpm),
          maxRpm: z.number().int().positive().default(DEFAULT_CAPACITY_SETTINGS.shared.maxRpm),
          hardMaxRpm: z.number().int().positive().default(DEFAULT_CAPACITY_SETTINGS.shared.hardMaxRpm),
          initialConcurrency: z.number().int().positive().default(DEFAULT_CAPACITY_SETTINGS.shared.initialConcurrency),
          minConcurrency: z.number().int().positive().default(DEFAULT_CAPACITY_SETTINGS.shared.minConcurrency),
          maxConcurrency: z.number().int().positive().default(DEFAULT_CAPACITY_SETTINGS.shared.maxConcurrency),
          hardMaxConcurrency: z.number().int().positive().default(DEFAULT_CAPACITY_SETTINGS.shared.hardMaxConcurrency)
        })
        .default(DEFAULT_CAPACITY_SETTINGS.shared),
      retry: z
        .object({
          maxRetries: z.number().int().min(0).max(10).default(DEFAULT_CAPACITY_SETTINGS.retry.maxRetries)
        })
        .default(DEFAULT_CAPACITY_SETTINGS.retry),
      auto: z
        .object({
          cooldownMs: z.number().int().positive().default(DEFAULT_CAPACITY_SETTINGS.auto.cooldownMs),
          successWindow: z.number().int().positive().default(DEFAULT_CAPACITY_SETTINGS.auto.successWindow),
          rpmIncreaseStep: z.number().int().positive().default(DEFAULT_CAPACITY_SETTINGS.auto.rpmIncreaseStep)
        })
        .default(DEFAULT_CAPACITY_SETTINGS.auto)
    })
    .default(DEFAULT_CAPACITY_SETTINGS)
});

export class LlmConfigStore {
  private current: LlmRuntimeConfig = DEFAULT_LLM_CONFIG;

  constructor(private readonly filePath = resolve("config/llm.local.yaml")) {}

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.current = normalizeConfig(LlmConfigFileSchema.parse(parse(raw) ?? {}));
    } catch (error) {
      if (isMissingFile(error)) {
        this.current = DEFAULT_LLM_CONFIG;
        return;
      }
      throw error;
    }
    // Fail-fast: AGENTS.md requires runtimeMode=real to have apiKey, baseUrl,
    // models.fast, models.pro all present. Surface misconfiguration at startup
    // instead of deferring to the first agent run.
    if (this.current.runtimeMode === "real") {
      const configError = validateRealLlmConfig(this.current);
      if (configError) throw new LlmConfigValidationError(`LLM config error: ${configError}`);
    }
    const capacityError = validateCapacitySettings(this.current.capacity);
    if (capacityError) throw new LlmConfigValidationError(`LLM capacity config error: ${capacityError}`);
  }

  get() {
    return this.current;
  }

  view(): LlmSettingsView {
    const isRealConfigComplete = isRealLlmConfigured(this.current);
    return {
      provider: this.current.provider,
      runtimeMode: this.current.runtimeMode,
      isConfigured: shouldUseRealLlm(this.current),
      isRealConfigComplete,
      hasApiKey: Boolean(this.current.apiKey),
      apiKeyMasked: maskApiKey(this.current.apiKey),
      baseUrl: this.current.baseUrl ?? "",
      models: {
        fast: this.current.models.fast ?? "",
        pro: this.current.models.pro ?? ""
      },
      capacity: this.current.capacity,
      configPath: this.filePath
    };
  }

  async save(input: LlmSettingsRequest) {
    const next: LlmRuntimeConfig = {
      provider: input.provider,
      runtimeMode: input.runtimeMode,
      apiKey: input.clearApiKey ? undefined : input.apiKey || this.current.apiKey,
      baseUrl: input.baseUrl,
      models: {
        fast: input.models.fast,
        pro: input.models.pro
      },
      capacity: input.capacity ? normalizeCapacityForSave(input.capacity) : this.current.capacity
    };
    const saveError = validateLlmSettingsForSave(next);
    if (saveError) throw new LlmConfigValidationError(saveError);
    await this.write(next);
    this.current = next;
    return this.view();
  }

  private async write(config: LlmRuntimeConfig) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    const content = stringify({
      provider: config.provider,
      runtimeMode: config.runtimeMode,
      apiKey: config.apiKey ?? "",
      baseUrl: config.baseUrl ?? "",
      models: {
        fast: config.models.fast ?? "",
        pro: config.models.pro ?? ""
      },
      capacity: config.capacity
    });
    await writeFile(tmpPath, content, "utf8");
    // 文件含明文 apiKey，限制为仅当前用户可读写（0o600）。
    // Windows 忽略 mode 参数，Linux/macOS 生效。
    await chmod(tmpPath, 0o600);
    await rename(tmpPath, this.filePath);
  }
}

export class LlmConfigValidationError extends Error {}

export function validateRealLlmConfig(config: LlmRuntimeConfig): string | null {
  if (!config.baseUrl) return "API base URL is required for real LLM runs.";
  if (!config.apiKey) return "API key is required for real LLM runs.";
  if (!config.models.fast) return "Fast model is required for real LLM runs.";
  if (!config.models.pro) return "Pro model is required for real LLM runs.";
  return null;
}

export function isRealLlmConfigured(config: LlmRuntimeConfig) {
  return !validateRealLlmConfig(config);
}

export function shouldUseRealLlm(config: LlmRuntimeConfig) {
  return config.runtimeMode === "real" && isRealLlmConfigured(config);
}

function validateLlmSettingsForSave(config: LlmRuntimeConfig) {
  if (config.runtimeMode === "mock") {
    return validateCapacitySettings(config.capacity);
  }
  if (!config.baseUrl) return "选择真实模型模式后，必须填写 API base URL。";
  if (!config.apiKey) return "选择真实模型模式后，必须填写 API key。";
  if (!config.models.fast) return "选择真实模型模式后，必须选择或输入快速模型。";
  if (!config.models.pro) return "选择真实模型模式后，必须选择或输入 Pro 模型。";
  return validateCapacitySettings(config.capacity);
}

function normalizeCapacityForSave(capacity: LlmCapacitySettings) {
  return capacity.preset === "custom" ? capacity : capacityForPreset(capacity.preset, capacity);
}

function normalizeConfig(config: z.infer<typeof LlmConfigFileSchema>): LlmRuntimeConfig {
  return {
    provider: "openai-compatible",
    runtimeMode: config.runtimeMode,
    apiKey: emptyToUndefined(config.apiKey),
    baseUrl: emptyToUndefined(config.baseUrl),
    models: {
      fast: emptyToUndefined(config.models.fast),
      pro: emptyToUndefined(config.models.pro)
    },
    capacity: config.capacity
  };
}

function emptyToUndefined(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isMissingFile(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}

function maskApiKey(key?: string): string {
  if (!key) return "";
  if (key.length <= 8) return "***";
  return `${key.slice(0, 3)}...${key.slice(-4)}`;
}
