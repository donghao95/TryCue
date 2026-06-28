import type { LlmCapacityPreset, LlmCapacityPresetValues, LlmCapacitySettings } from "@trycue/shared";
import { LLM_CAPACITY_PRESET_VALUES } from "@trycue/shared";

/**
 * Preset defaults for LLM capacity configuration.
 *
 * Presets set a complete capacity lane: initial/min/max RPM and concurrency.
 * Hard caps, retry settings, and auto-tuning settings are preserved from the
 * current config when switching presets.
 */
export const CAPACITY_PRESETS: Record<LlmCapacityPreset, LlmCapacityPresetValues> = {
  ...LLM_CAPACITY_PRESET_VALUES,
  custom: LLM_CAPACITY_PRESET_VALUES.standard
};

export const DEFAULT_CAPACITY_SHARED = {
  initialRpm: 8,
  minRpm: 2,
  maxRpm: 60,
  hardMaxRpm: 1000,
  initialConcurrency: 4,
  minConcurrency: 1,
  maxConcurrency: 4,
  hardMaxConcurrency: 100
};

export const DEFAULT_CAPACITY_RETRY = {
  maxRetries: 4
};

export const DEFAULT_CAPACITY_AUTO = {
  cooldownMs: 15_000,
  successWindow: 5,
  rpmIncreaseStep: 2
};

export const DEFAULT_CAPACITY_SETTINGS: LlmCapacitySettings = {
  mode: "auto",
  preset: "standard",
  shared: { ...DEFAULT_CAPACITY_SHARED },
  retry: { ...DEFAULT_CAPACITY_RETRY },
  auto: { ...DEFAULT_CAPACITY_AUTO }
};

/**
 * Returns a capacity settings object for a preset, preserving non-preset fields
 * from the current config when available.
 */
export function capacityForPreset(preset: LlmCapacityPreset, current?: LlmCapacitySettings): LlmCapacitySettings {
  const base = current ?? DEFAULT_CAPACITY_SETTINGS;
  const presetValues = CAPACITY_PRESETS[preset];
  const maxRpm = Math.min(presetValues.maxRpm, base.shared.hardMaxRpm);
  const minRpm = Math.min(presetValues.minRpm, maxRpm);
  const initialRpm = clamp(presetValues.initialRpm, minRpm, maxRpm);
  const maxConcurrency = Math.min(presetValues.maxConcurrency, base.shared.hardMaxConcurrency);
  const minConcurrency = Math.min(presetValues.minConcurrency, maxConcurrency);
  const initialConcurrency = clamp(presetValues.initialConcurrency, minConcurrency, maxConcurrency);
  return {
    mode: base.mode,
    preset,
    shared: {
      ...base.shared,
      initialRpm,
      minRpm,
      maxRpm,
      initialConcurrency,
      minConcurrency,
      maxConcurrency
    },
    retry: { ...base.retry },
    auto: { ...base.auto }
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Validates that capacity field values are internally consistent.
 * Returns an error message string (first violation) or null if valid.
 */
export function validateCapacitySettings(capacity: LlmCapacitySettings): string | null {
  const s = capacity.shared;
  if (s.minRpm > s.initialRpm) return "capacity.shared.minRpm 不能大于 initialRpm。";
  if (s.initialRpm > s.maxRpm) return "capacity.shared.initialRpm 不能大于 maxRpm。";
  if (s.maxRpm > s.hardMaxRpm) return "capacity.shared.maxRpm 不能大于 hardMaxRpm。";
  if (s.minConcurrency > s.initialConcurrency) return "capacity.shared.minConcurrency 不能大于 initialConcurrency。";
  if (s.initialConcurrency > s.maxConcurrency) return "capacity.shared.initialConcurrency 不能大于 maxConcurrency。";
  if (s.maxConcurrency > s.hardMaxConcurrency) return "capacity.shared.maxConcurrency 不能大于 hardMaxConcurrency。";
  if (capacity.retry.maxRetries < 0) return "capacity.retry.maxRetries 不能为负数。";
  return null;
}
