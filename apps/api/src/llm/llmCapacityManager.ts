/**
 * LLM capacity manager: shared lane with RPM + concurrency limiting,
 * AIMD auto-tuning, 429/503 cooldown, and hot-reload support.
 *
 * Replaces the old singleton getSharedRateLimitedFetch(). All real LLM HTTP
 * attempts go through this single lane. The fetch function returned by
 * getFetch() enforces:
 *
 * 1. cooldownUntil: no dispatch while in cooldown after a 429/503.
 * 2. effectiveConcurrency: at most N in-flight requests.
 * 3. effectiveRpm: minimum interval between dispatches.
 *
 * On 429/503 or provider rate-limit errors, RPM and concurrency are halved
 * (AIMD multiplicative decrease) and a cooldown is applied. On consecutive
 * successes, RPM is increased additively (then concurrency).
 */

import type { LlmCapacitySettings, LlmCapacityStatus } from "@trycue/shared";
import { log } from "../logger.js";

type RuntimeState = {
  effectiveRpm: number;
  effectiveConcurrency: number;
  inFlight: number;
  nextAvailableAt: number;
  cooldownUntil: number;
  recentSuccessCount: number;
  recentLimitCount: number;
  lastLimitAt: number | null;
  lastLimitReason: string | null;
};

type PendingRequest = {
  resolve: () => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
};

export class LlmCapacityManager {
  private state: RuntimeState;
  private queue: PendingRequest[] = [];
  private currentSettings: LlmCapacitySettings;
  private pumpScheduled = false;
  private pumpScheduledDelay = Infinity;
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(settings: LlmCapacitySettings) {
    this.currentSettings = settings;
    this.state = {
      effectiveRpm: settings.shared.initialRpm,
      effectiveConcurrency: settings.shared.initialConcurrency,
      inFlight: 0,
      nextAvailableAt: 0,
      cooldownUntil: 0,
      recentSuccessCount: 0,
      recentLimitCount: 0,
      lastLimitAt: null,
      lastLimitReason: null
    };
  }

  /**
   * Hot-reload capacity settings. Does not cancel in-flight requests.
   * If maxConcurrency is lowered, existing in-flight requests finish naturally;
   * only new dispatches are blocked.
   */
  update(settings: LlmCapacitySettings): void {
    const oldSettings = this.currentSettings;
    this.currentSettings = settings;

    // Clamp effective values to new bounds.
    if (this.state.effectiveRpm > settings.shared.maxRpm) {
      this.state.effectiveRpm = settings.shared.maxRpm;
    }
    if (this.state.effectiveRpm < settings.shared.minRpm) {
      this.state.effectiveRpm = settings.shared.minRpm;
    }
    if (this.state.effectiveConcurrency > settings.shared.maxConcurrency) {
      this.state.effectiveConcurrency = settings.shared.maxConcurrency;
    }
    if (this.state.effectiveConcurrency < settings.shared.minConcurrency) {
      this.state.effectiveConcurrency = settings.shared.minConcurrency;
    }

    // If switching to manual mode, snap effective values to configured max.
    if (settings.mode === "manual" && oldSettings.mode === "auto") {
      this.state.effectiveRpm = settings.shared.maxRpm;
      this.state.effectiveConcurrency = settings.shared.maxConcurrency;
    }
    // If switching from manual to auto, reset to initial values.
    if (settings.mode === "auto" && oldSettings.mode === "manual") {
      this.state.effectiveRpm = settings.shared.initialRpm;
      this.state.effectiveConcurrency = settings.shared.initialConcurrency;
      this.state.recentSuccessCount = 0;
    }

    log.info(
      {
        mode: settings.mode,
        effectiveRpm: this.state.effectiveRpm,
        effectiveConcurrency: this.state.effectiveConcurrency
      },
      "[capacity] settings updated"
    );
    this.pump();
  }

  getSettings(): LlmCapacitySettings {
    return this.currentSettings;
  }

  /**
   * Returns a fetch function that enforces capacity limits.
   * All real LLM HTTP attempts should use this fetch.
   *
   * The fetch wrapper threads the caller's AbortSignal into the capacity
   * queue: if the caller aborts while still waiting for a slot, the queued
   * promise is rejected and removed from the queue, so the abort does not
   * waste a dispatch slot.
   */
  getFetch(underlyingFetch: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch {
    return async (input, init) => {
      const signal = init?.signal ?? undefined;
      // acquire() throws on abort; if it throws, we never entered the try
      // block, so handleError (which releases a slot) is not called.
      await this.acquire(signal);
      try {
        const response = await underlyingFetch(input, init);
        this.handleResponse(response);
        return response;
      } catch (error) {
        this.handleError(error);
        throw error;
      }
    };
  }

  /**
   * Returns the maxRetries value for AI SDK generateText/streamText.
   */
  getMaxRetries(): number {
    return this.currentSettings.retry.maxRetries;
  }

  /**
   * Resets auto-learning state back to initial values.
   */
  resetLearning(): void {
    this.state.effectiveRpm = this.currentSettings.shared.initialRpm;
    this.state.effectiveConcurrency = this.currentSettings.shared.initialConcurrency;
    this.state.recentSuccessCount = 0;
    this.state.recentLimitCount = 0;
    this.state.cooldownUntil = 0;
    this.state.lastLimitAt = null;
    this.state.lastLimitReason = null;
    log.info("[capacity] learning state reset");
  }

  /**
   * Applies probe output. Recommended values become the immediate runtime
   * capacity and next startup baseline; tested max values remain the ceiling.
   */
  applyRecommendedValues(
    recommendedRpm: number,
    recommendedConcurrency: number,
    testedMax?: { rpm?: number; concurrency?: number }
  ): void {
    const s = this.currentSettings.shared;
    const clampedRecommendedRpm = Math.min(recommendedRpm, s.hardMaxRpm);
    const clampedRecommendedConcurrency = Math.min(recommendedConcurrency, s.hardMaxConcurrency);
    const clampedMaxRpm = Math.min(Math.max(testedMax?.rpm ?? s.maxRpm, clampedRecommendedRpm), s.hardMaxRpm);
    const clampedMaxConcurrency = Math.min(Math.max(testedMax?.concurrency ?? s.maxConcurrency, clampedRecommendedConcurrency), s.hardMaxConcurrency);
    this.currentSettings = {
      ...this.currentSettings,
      preset: "custom",
      shared: {
        ...s,
        initialRpm: clampedRecommendedRpm,
        maxRpm: clampedMaxRpm,
        initialConcurrency: clampedRecommendedConcurrency,
        maxConcurrency: clampedMaxConcurrency
      }
    };
    this.state.effectiveRpm = clampedRecommendedRpm;
    this.state.effectiveConcurrency = clampedRecommendedConcurrency;
    this.state.recentSuccessCount = 0;
    log.info(
      {
        effectiveRpm: clampedRecommendedRpm,
        effectiveConcurrency: clampedRecommendedConcurrency,
        maxRpm: clampedMaxRpm,
        maxConcurrency: clampedMaxConcurrency
      },
      "[capacity] applied recommended values"
    );
    this.pump();
  }

  getStatus(): LlmCapacityStatus {
    const s = this.state;
    const settings = this.currentSettings;
    return {
      mode: settings.mode,
      effectiveRpm: s.effectiveRpm,
      effectiveConcurrency: s.effectiveConcurrency,
      configuredMaxRpm: settings.shared.maxRpm,
      configuredMaxConcurrency: settings.shared.maxConcurrency,
      inFlight: s.inFlight,
      queueSize: this.queue.length,
      cooldownUntil: s.cooldownUntil > Date.now() ? new Date(s.cooldownUntil).toISOString() : undefined,
      recentLimitCount: s.recentLimitCount,
      lastLimitAt: s.lastLimitAt ? new Date(s.lastLimitAt).toISOString() : undefined,
      lastLimitReason: s.lastLimitReason ?? undefined
    };
  }

  // ── Internal scheduling ──

  private async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new Error("Request aborted before acquiring capacity.");
    }
    return new Promise<void>((resolve, reject) => {
      const pending: PendingRequest = { resolve, reject, enqueuedAt: Date.now() };
      this.queue.push(pending);
      if (signal) {
        const onAbort = () => {
          // If still queued, remove and reject. If already dispatched
          // (removed from queue), resolve was called — do nothing.
          const idx = this.queue.indexOf(pending);
          if (idx >= 0) {
            this.queue.splice(idx, 1);
            reject(new Error("Request aborted while waiting for capacity."));
          }
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.pump();
    });
  }

  private pump(): void {
    while (this.queue.length > 0) {
      const s = this.state;
      const now = Date.now();

      // Check cooldown.
      if (s.cooldownUntil > now) {
        const delay = s.cooldownUntil - now;
        this.schedulePump(delay);
        return;
      }

      // Check concurrency.
      if (s.inFlight >= this.state.effectiveConcurrency) {
        return;
      }

      // Check RPM interval.
      if (s.nextAvailableAt > now) {
        const delay = s.nextAvailableAt - now;
        this.schedulePump(delay);
        return;
      }

      // Dispatch.
      const pending = this.queue.shift()!;
      s.inFlight += 1;
      s.nextAvailableAt = now + Math.floor(60_000 / s.effectiveRpm);
      pending.resolve();
    }
  }

  private schedulePump(delay: number): void {
    // If a timer is already pending and the new delay is not shorter,
    // keep the existing timer. This prevents a stall when a shorter
    // cooldown arrives after a longer one (e.g. 15s cooldown set, then
    // 5s cooldown arrives — must reschedule to the shorter delay).
    if (this.pumpScheduled && delay >= this.pumpScheduledDelay) return;
    if (this.pumpTimer !== null) clearTimeout(this.pumpTimer);
    this.pumpScheduled = true;
    this.pumpScheduledDelay = delay;
    this.pumpTimer = setTimeout(() => {
      this.pumpScheduled = false;
      this.pumpScheduledDelay = Infinity;
      this.pumpTimer = null;
      this.pump();
    }, delay);
  }

  private release(): void {
    this.state.inFlight = Math.max(0, this.state.inFlight - 1);
    this.pump();
  }

  private handleResponse(response: Response): void {
    const status = response.status;
    if (status === 429 || status === 503) {
      const retryAfter = this.parseRetryAfter(response.headers);
      this.onLimit(status, retryAfter, `HTTP ${status}`);
    } else if (response.ok) {
      this.onSuccess();
    }
    // Non-429/503 errors are treated as transient; don't penalize capacity.
    this.release();
  }

  private handleError(_error: unknown): void {
    // Network errors don't necessarily mean rate limiting.
    // Don't penalize capacity, just release the slot.
    this.release();
  }

  private onSuccess(): void {
    if (this.currentSettings.mode !== "auto") {
      return;
    }
    const s = this.state;
    s.recentSuccessCount += 1;
    const auto = this.currentSettings.auto;
    if (s.recentSuccessCount >= auto.successWindow) {
      s.recentSuccessCount = 0;
      const shared = this.currentSettings.shared;
      if (s.effectiveRpm < shared.maxRpm) {
        s.effectiveRpm = Math.min(shared.maxRpm, s.effectiveRpm + auto.rpmIncreaseStep);
        log.info({ effectiveRpm: s.effectiveRpm }, "[capacity] rpm increased");
      } else if (s.effectiveConcurrency < shared.maxConcurrency) {
        s.effectiveConcurrency = Math.min(shared.maxConcurrency, s.effectiveConcurrency + 1);
        log.info({ effectiveConcurrency: s.effectiveConcurrency }, "[capacity] concurrency increased");
      }
    }
  }

  private onLimit(status: number, retryAfterMs: number | null, reason: string): void {
    const s = this.state;
    const shared = this.currentSettings.shared;
    const auto = this.currentSettings.auto;

    // AIMD multiplicative decrease.
    s.effectiveRpm = Math.max(shared.minRpm, Math.floor(s.effectiveRpm / 2));
    s.effectiveConcurrency = Math.max(shared.minConcurrency, s.effectiveConcurrency - 1);

    // Cooldown.
    const cooldownMs = retryAfterMs ?? auto.cooldownMs;
    s.cooldownUntil = Date.now() + cooldownMs;
    s.recentSuccessCount = 0;
    s.recentLimitCount += 1;
    s.lastLimitAt = Date.now();
    s.lastLimitReason = `${reason} (cooldown ${cooldownMs}ms)`;

    log.warn(
      {
        status,
        effectiveRpm: s.effectiveRpm,
        effectiveConcurrency: s.effectiveConcurrency,
        cooldownMs,
        reason
      },
      "[capacity] rate limited, applying cooldown"
    );
  }

  private parseRetryAfter(headers: Headers): number | null {
    const retryAfterMs = headers.get("retry-after-ms");
    if (retryAfterMs) {
      const ms = Number(retryAfterMs);
      if (Number.isFinite(ms) && ms > 0) return Math.min(ms, 300_000);
    }
    const retryAfter = headers.get("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, 300_000);
      }
      // HTTP-date format.
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) {
        const ms = date - Date.now();
        if (ms > 0) return Math.min(ms, 300_000);
      }
    }
    return null;
  }
}
