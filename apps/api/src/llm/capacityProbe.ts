/**
 * LLM capacity probe (calibration).
 *
 * Tests concurrency levels from a practical starting point, maintaining each level
 * for 60 seconds and counting successful completions (= actual RPM).
 * Stops when a higher concurrency no longer improves measured RPM.
 *
 * Between concurrency levels, waits 60 seconds so that requests from
 * different levels do not land in the same provider rate-limit window.
 *
 * The probe does NOT go through the shared capacity manager — it uses
 * its own isolated fetch with direct rate limiting.
 */

import type { LlmCapacityProbeLevelResult, LlmCapacityProbeResult } from "@trycue/shared";
import { log } from "../logger.js";

const PROBE_PROMPT = "不思考，回复1";
const PROBE_MAX_TOKENS = 1;
export const PROBE_TIMEOUT_MS = 15_000;
export const PROBE_MAX_TOTAL_MS = 60 * 60_000;
const CONCURRENCY_TEST_DURATION_MS = 60_000;
const LEVEL_COOLDOWN_MS = 60_000;
const MAX_CONSECUTIVE_FAILURES = 3;

type ProbeInput = {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxConcurrency: number;
  startConcurrency?: number;
};

export type ProbeProgress = {
  phase: "starting" | "testing" | "cooldown" | "done";
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
};

export class ProbeCancelledError extends Error {
  constructor() {
    super("Probe cancelled.");
  }
}

type ProbeUsage = { inputTokens: number; outputTokens: number; totalTokens: number };
type SingleProbeResult = { status: number; latencyMs: number; detail: string; usage: ProbeUsage };
type ConcurrencyLevelResult = {
  sent: number;
  succeeded: number;
  failed: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  elapsedMs: number;
};

export async function probeLlmCapacity(
  input: ProbeInput,
  options?: {
    signal?: AbortSignal;
    onProgress?: (progress: ProbeProgress) => void;
  }
): Promise<LlmCapacityProbeResult> {
  const { apiKey, baseUrl, model, maxConcurrency } = input;
  const startConcurrency = clampInt(input.startConcurrency ?? 2, 1, maxConcurrency);
  const warnings: string[] = [];
  const overallStart = Date.now();
  const levels: LlmCapacityProbeLevelResult[] = [];
  let totalSentRequests = 0;
  let totalSuccessfulRequests = 0;
  let totalFailedRequests = 0;
  let totalLatencyMs = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let bestConcurrency = 0;
  let bestRpm = 0;

  const concurrencyPlan = buildConcurrencyPlan(maxConcurrency, startConcurrency);
  const maxElapsedMs = concurrencyPlan.length * CONCURRENCY_TEST_DURATION_MS + Math.max(0, concurrencyPlan.length - 1) * LEVEL_COOLDOWN_MS;

  const emit = (level: Partial<ConcurrencyLevelResult>, concurrency: number, startedAt: number) => {
    const levelSent = level.sent ?? 0;
    const levelSucceeded = level.succeeded ?? 0;
    const levelFailed = level.failed ?? 0;
    const levelLatencyMs = level.latencyMs ?? 0;
    const levelElapsedMs = Math.min(Date.now() - startedAt, CONCURRENCY_TEST_DURATION_MS);
    const levelAvgLatencyMs = levelSucceeded > 0 ? Math.floor(levelLatencyMs / levelSucceeded) : 0;
    options?.onProgress?.({
      phase: "testing",
      currentRpm: levelSucceeded,
      currentConcurrency: concurrency,
      currentLevelSentRequests: levelSent,
      currentLevelSuccessfulRequests: levelSucceeded,
      currentLevelFailedRequests: levelFailed,
      currentLevelInputTokens: level.inputTokens ?? 0,
      currentLevelOutputTokens: level.outputTokens ?? 0,
      currentLevelTotalTokens: level.totalTokens ?? 0,
      currentLevelAvgLatencyMs: levelAvgLatencyMs,
      currentLevelElapsedMs: levelElapsedMs,
      currentLevelDurationMs: CONCURRENCY_TEST_DURATION_MS,
      cooldownRemainingMs: 0,
      cooldownTotalMs: 0,
      sentRequests: totalSentRequests + levelSent,
      maxElapsedMs,
      successfulRequests: totalSuccessfulRequests + levelSucceeded,
      failedRequests: totalFailedRequests + levelFailed,
      inputTokens: totalInputTokens + (level.inputTokens ?? 0),
      outputTokens: totalOutputTokens + (level.outputTokens ?? 0),
      totalTokens: totalTokens + (level.totalTokens ?? 0),
      stableRpm: bestRpm,
      stableConcurrency: bestConcurrency,
      levels: markSelectedLevel(levels, bestConcurrency),
      message: `并发 ${concurrency} 测试中：已发 ${levelSent}，成功 ${levelSucceeded}，失败 ${levelFailed}`
    });
  };

  for (let index = 0; index < concurrencyPlan.length; index++) {
    const concurrency = concurrencyPlan[index];
    if (concurrency === undefined) break;
    throwIfCancelled(options?.signal);
    if (Date.now() - overallStart > PROBE_MAX_TOTAL_MS) {
      warnings.push(`已达到最大探测时长，提前停止。`);
      break;
    }

    if (index > 0) {
      await waitLevelCooldown({
        nextConcurrency: concurrency,
        maxElapsedMs,
        totals: () => ({
          totalSentRequests,
          totalSuccessfulRequests,
          totalFailedRequests,
          totalInputTokens,
          totalOutputTokens,
          totalTokens
        }),
        best: () => ({ bestRpm, bestConcurrency }),
        levels: () => markSelectedLevel(levels, bestConcurrency),
        signal: options?.signal,
        onProgress: options?.onProgress
      });
    }

    const levelStartedAt = Date.now();
    emit({}, concurrency, levelStartedAt);

    const result = await testConcurrencyLevel({
      concurrency,
      durationMs: CONCURRENCY_TEST_DURATION_MS,
      maxConsecutiveFailures: MAX_CONSECUTIVE_FAILURES,
      apiKey,
      baseUrl,
      model,
      signal: options?.signal,
      onProgress: (level) => emit(level, concurrency, levelStartedAt)
    });

    totalSentRequests += result.sent;
    totalSuccessfulRequests += result.succeeded;
    totalFailedRequests += result.failed;
    totalLatencyMs += result.latencyMs;
    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;
    totalTokens += result.totalTokens;

    const rpm = result.succeeded;
    const avgLatencyMs = result.succeeded > 0 ? Math.floor(result.latencyMs / result.succeeded) : 0;
    const levelResult: LlmCapacityProbeLevelResult = {
      concurrency,
      sentRequests: result.sent,
      successfulRequests: result.succeeded,
      failedRequests: result.failed,
      rpm,
      successRate: result.sent > 0 ? Math.round((result.succeeded / result.sent) * 100) : 0,
      avgLatencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
      elapsedMs: result.elapsedMs,
      selected: false
    };

    if (rpm > bestRpm) {
      bestConcurrency = concurrency;
      bestRpm = rpm;
    } else {
      levelResult.stopReason = bestRpm > 0
        ? `吞吐未超过当前最佳档位（并发 ${bestConcurrency}，RPM ${bestRpm}）`
        : "该档位没有稳定成功请求";
      levels.push(levelResult);
      if (bestRpm === 0 && concurrency > 1 && !concurrencyPlan.includes(1)) {
        concurrencyPlan.splice(index + 1, 0, 1);
        continue;
      }
      break;
    }

    levels.push(levelResult);
  }

  if (bestConcurrency === 0) {
    bestConcurrency = 1;
    bestRpm = 10;
    warnings.push("所有并发档位均失败，返回最低保守推荐值。");
  }

  const recommendedRpm = Math.max(2, Math.floor(bestRpm * 0.75));
  const recommendedConcurrency = bestConcurrency;
  const avgLatencyMs = totalSuccessfulRequests > 0 ? Math.floor(totalLatencyMs / totalSuccessfulRequests) : 0;

  log.info(
    { bestRpm, bestConcurrency, recommendedRpm, recommendedConcurrency, totalSentRequests, warnings },
    "[probe] calibration complete"
  );

  return {
    recommendedRpm,
    recommendedConcurrency,
    testedMaxRpm: bestRpm,
    testedMaxConcurrency: bestConcurrency,
    avgLatencyMs,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    totalTokens,
    levels: markSelectedLevel(levels, bestConcurrency),
    warnings
  };
}

async function testConcurrencyLevel(input: {
  concurrency: number;
  durationMs: number;
  maxConsecutiveFailures: number;
  apiKey: string;
  baseUrl: string;
  model: string;
  signal?: AbortSignal;
  onProgress?: (level: Partial<ConcurrencyLevelResult>) => void;
}): Promise<ConcurrencyLevelResult> {
  const { concurrency, durationMs, maxConsecutiveFailures, apiKey, baseUrl, model, signal, onProgress } = input;

  let sent = 0;
  let succeeded = 0;
  let failed = 0;
  let consecutiveFails = 0;
  let latencyMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  const inFlight = new Set<Promise<void>>();
  const startedAt = Date.now();

  const dispatchOne = () => {
    sent += 1;
    let p!: Promise<void>;
    p = probeSingleRequest({ apiKey, baseUrl, model, signal })
      .then((result) => {
        latencyMs += result.latencyMs;
        if (result.status === 200) {
          succeeded += 1;
          consecutiveFails = 0;
          inputTokens += result.usage.inputTokens;
          outputTokens += result.usage.outputTokens;
          totalTokens += result.usage.totalTokens;
        } else {
          failed += 1;
          consecutiveFails += 1;
        }
        onProgress?.({ sent, succeeded, failed, latencyMs, inputTokens, outputTokens, totalTokens });
      })
      .finally(() => {
        inFlight.delete(p);
      });
    inFlight.add(p);
  };

  // Fill initial concurrency
  for (let i = 0; i < concurrency; i++) {
    dispatchOne();
  }

  // Main loop: wait for completions, dispatch replacements
  while (inFlight.size > 0) {
    await Promise.race(inFlight);
    throwIfCancelled(signal);

    const elapsed = Date.now() - startedAt;
    if (elapsed >= durationMs) break;
    if (consecutiveFails >= maxConsecutiveFailures) break;

    dispatchOne();
  }

  // Wait for remaining in-flight requests
  while (inFlight.size > 0) {
    await Promise.race(inFlight);
    throwIfCancelled(signal);
  }

  return { sent, succeeded, failed, latencyMs, inputTokens, outputTokens, totalTokens, elapsedMs: Date.now() - startedAt };
}

async function waitLevelCooldown(input: {
  nextConcurrency: number;
  maxElapsedMs: number;
  totals: () => {
    totalSentRequests: number;
    totalSuccessfulRequests: number;
    totalFailedRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
  };
  best: () => { bestRpm: number; bestConcurrency: number };
  levels: () => LlmCapacityProbeLevelResult[];
  signal?: AbortSignal;
  onProgress?: (progress: ProbeProgress) => void;
}): Promise<void> {
  const startedAt = Date.now();
  while (true) {
    throwIfCancelled(input.signal);
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, LEVEL_COOLDOWN_MS - elapsed);
    const totals = input.totals();
    const best = input.best();
    input.onProgress?.({
      phase: "cooldown",
      currentRpm: 0,
      currentConcurrency: input.nextConcurrency,
      currentLevelSentRequests: 0,
      currentLevelSuccessfulRequests: 0,
      currentLevelFailedRequests: 0,
      currentLevelInputTokens: 0,
      currentLevelOutputTokens: 0,
      currentLevelTotalTokens: 0,
      currentLevelAvgLatencyMs: 0,
      currentLevelElapsedMs: Math.min(elapsed, LEVEL_COOLDOWN_MS),
      currentLevelDurationMs: LEVEL_COOLDOWN_MS,
      cooldownRemainingMs: remaining,
      cooldownTotalMs: LEVEL_COOLDOWN_MS,
      sentRequests: totals.totalSentRequests,
      maxElapsedMs: input.maxElapsedMs,
      successfulRequests: totals.totalSuccessfulRequests,
      failedRequests: totals.totalFailedRequests,
      inputTokens: totals.totalInputTokens,
      outputTokens: totals.totalOutputTokens,
      totalTokens: totals.totalTokens,
      stableRpm: best.bestRpm,
      stableConcurrency: best.bestConcurrency,
      levels: input.levels(),
      message: `档间冷却中，${Math.ceil(remaining / 1000)}s 后测试并发 ${input.nextConcurrency}`
    });
    if (remaining <= 0) return;
    await sleep(Math.min(1000, remaining), input.signal);
  }
}

function buildConcurrencyPlan(maxConcurrency: number, startConcurrency: number): number[] {
  const plan: number[] = [startConcurrency];
  let next = startConcurrency;
  while (next < maxConcurrency) {
    next = Math.min(maxConcurrency, next * 2);
    if (!plan.includes(next)) plan.push(next);
  }
  return plan;
}

function markSelectedLevel(levels: LlmCapacityProbeLevelResult[], selectedConcurrency: number): LlmCapacityProbeLevelResult[] {
  return levels.map((level) => ({
    ...level,
    selected: selectedConcurrency > 0 && level.concurrency === selectedConcurrency
  }));
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.floor(value), min), max);
}

async function probeSingleRequest(input: { apiKey: string; baseUrl: string; model: string; signal?: AbortSignal }): Promise<SingleProbeResult> {
  const { apiKey, baseUrl, model, signal } = input;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const start = Date.now();

  try {
    throwIfCancelled(signal);
    const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: PROBE_PROMPT }],
        max_tokens: PROBE_MAX_TOKENS,
        stream: false
      }),
      signal: controller.signal
    });
    const latencyMs = Date.now() - start;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { status: response.status, latencyMs, detail: text.slice(0, 200), usage: emptyUsage() };
    }
    const payload = await response.json().catch(() => ({})) as { usage?: Record<string, unknown> };
    return { status: 200, latencyMs, detail: "", usage: parseUsage(payload.usage) };
  } catch (error) {
    throwIfCancelled(signal);
    const latencyMs = Date.now() - start;
    const detail = error instanceof Error ? error.message : String(error);
    return { status: 0, latencyMs, detail, usage: emptyUsage() };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ProbeCancelledError();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new ProbeCancelledError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function parseUsage(usage: Record<string, unknown> | undefined): ProbeUsage {
  if (!usage) return emptyUsage();
  const inputTokens = numberFromUsage(usage.prompt_tokens) ?? numberFromUsage(usage.input_tokens) ?? 0;
  const outputTokens = numberFromUsage(usage.completion_tokens) ?? numberFromUsage(usage.output_tokens) ?? 0;
  const totalTokens = numberFromUsage(usage.total_tokens) ?? (inputTokens + outputTokens);
  return { inputTokens, outputTokens, totalTokens };
}

function numberFromUsage(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function emptyUsage(): ProbeUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}
