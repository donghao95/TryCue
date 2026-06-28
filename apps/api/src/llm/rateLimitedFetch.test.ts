import { describe, expect, it } from "vitest";
import { capacityForPreset, DEFAULT_CAPACITY_SETTINGS } from "./capacityPresets.js";
import { LlmCapacityManager } from "./llmCapacityManager.js";

function makeSettings(overrides: Partial<typeof DEFAULT_CAPACITY_SETTINGS.shared> = {}) {
  return {
    ...DEFAULT_CAPACITY_SETTINGS,
    shared: { ...DEFAULT_CAPACITY_SETTINGS.shared, ...overrides }
  };
}

function makeOkResponse() {
  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
}

function makeRateLimitedResponse(status: number, retryAfterMs?: number) {
  const headers = new Headers();
  if (retryAfterMs !== undefined) {
    headers.set("retry-after-ms", String(retryAfterMs));
  }
  return new Response(`{"error":"rate limited"}`, { status, headers });
}

describe("LlmCapacityManager", () => {
  it("initializes with conservative initialRpm and initialConcurrency", () => {
    const manager = new LlmCapacityManager(makeSettings({ initialRpm: 5, initialConcurrency: 1 }));
    const status = manager.getStatus();
    expect(status.effectiveRpm).toBe(5);
    expect(status.effectiveConcurrency).toBe(1);
    expect(status.inFlight).toBe(0);
  });

  it("spaces concurrent requests according to effectiveRpm interval", async () => {
    const settings = makeSettings({ initialRpm: 600, initialConcurrency: 1 });
    const manager = new LlmCapacityManager(settings);
    const firedAt: number[] = [];
    const fetch = manager.getFetch(async () => {
      firedAt.push(Date.now());
      return makeOkResponse();
    });

    await Promise.all([
      fetch("https://example.test/1"),
      fetch("https://example.test/2"),
      fetch("https://example.test/3")
    ]);

    expect(firedAt).toHaveLength(3);
    const [first, second, third] = firedAt;
    expect(second! - first!).toBeGreaterThanOrEqual(80);
    expect(third! - second!).toBeGreaterThanOrEqual(80);
  });

  it("halves RPM and decreases concurrency on 429", async () => {
    const settings = makeSettings({ initialRpm: 60, initialConcurrency: 4 });
    const manager = new LlmCapacityManager(settings);
    const fetch = manager.getFetch(async () => makeRateLimitedResponse(429));

    await fetch("https://example.test/1").catch(() => undefined);

    const status = manager.getStatus();
    expect(status.effectiveRpm).toBe(30);
    expect(status.effectiveConcurrency).toBe(3);
    expect(status.recentLimitCount).toBe(1);
    expect(status.cooldownUntil).toBeDefined();
    expect(status.lastLimitReason).toContain("HTTP 429");
  });

  it("respects retry-after-ms header for cooldown", async () => {
    const settings = makeSettings({ initialRpm: 60, initialConcurrency: 2 });
    const manager = new LlmCapacityManager(settings);
    const fetch = manager.getFetch(async () => makeRateLimitedResponse(429, 5000));

    await fetch("https://example.test/1").catch(() => undefined);

    const status = manager.getStatus();
    expect(status.cooldownUntil).toBeDefined();
    const cooldownUntil = new Date(status.cooldownUntil!).getTime();
    expect(cooldownUntil).toBeGreaterThan(Date.now());
    expect(cooldownUntil - Date.now()).toBeLessThanOrEqual(5000);
  });

  it("increases RPM after consecutive successes in auto mode", async () => {
    const settings = {
      ...makeSettings({ initialRpm: 600, maxRpm: 6000 }),
      auto: { cooldownMs: 1000, successWindow: 3, rpmIncreaseStep: 1 }
    };
    const manager = new LlmCapacityManager(settings);
    const fetch = manager.getFetch(async () => makeOkResponse());

    // Fire 3 successful requests (successWindow = 3).
    for (let i = 0; i < 3; i++) {
      await fetch(`https://example.test/${i}`);
    }

    const status = manager.getStatus();
    expect(status.effectiveRpm).toBe(601);
  });

  it("does not auto-adjust in manual mode", async () => {
    const settings = {
      ...makeSettings({ initialRpm: 600, maxRpm: 6000 }),
      mode: "manual" as const
    };
    const manager = new LlmCapacityManager(settings);
    const fetch = manager.getFetch(async () => makeOkResponse());

    for (let i = 0; i < 10; i++) {
      await fetch(`https://example.test/${i}`);
    }

    const status = manager.getStatus();
    expect(status.effectiveRpm).toBe(600);
  });

  it("resets learning state on resetLearning()", () => {
    const settings = makeSettings({ initialRpm: 8, initialConcurrency: 1 });
    const manager = new LlmCapacityManager(settings);
    manager.resetLearning();

    const status = manager.getStatus();
    expect(status.effectiveRpm).toBe(8);
    expect(status.effectiveConcurrency).toBe(1);
    expect(status.recentLimitCount).toBe(0);
    expect(status.cooldownUntil).toBeUndefined();
  });

  it("clamps effective values on update with lower max", () => {
    const manager = new LlmCapacityManager(makeSettings({ initialRpm: 30, maxRpm: 60, initialConcurrency: 2, maxConcurrency: 4 }));
    manager.update(makeSettings({ maxRpm: 20, maxConcurrency: 2 }));

    const status = manager.getStatus();
    expect(status.effectiveRpm).toBeLessThanOrEqual(20);
    expect(status.effectiveConcurrency).toBeLessThanOrEqual(2);
  });

  it("getMaxRetries returns configured value", () => {
    const settings = { ...DEFAULT_CAPACITY_SETTINGS, retry: { maxRetries: 5 } };
    const manager = new LlmCapacityManager(settings);
    expect(manager.getMaxRetries()).toBe(5);
  });

  it("halves RPM and decreases concurrency on 503", async () => {
    const settings = makeSettings({ initialRpm: 60, initialConcurrency: 4 });
    const manager = new LlmCapacityManager(settings);
    const fetch = manager.getFetch(async () => makeRateLimitedResponse(503));

    await fetch("https://example.test/1").catch(() => undefined);

    const status = manager.getStatus();
    expect(status.effectiveRpm).toBe(30);
    expect(status.effectiveConcurrency).toBe(3);
    expect(status.recentLimitCount).toBe(1);
    expect(status.cooldownUntil).toBeDefined();
    expect(status.lastLimitReason).toContain("HTTP 503");
  });

  it("does not cancel in-flight requests when maxConcurrency is lowered via update", async () => {
    const settings = makeSettings({ initialRpm: 600, initialConcurrency: 2, maxConcurrency: 4 });
    const manager = new LlmCapacityManager(settings);
    let resolveFirst!: () => void;
    const firstFetchPromise = new Promise<void>((resolve) => { resolveFirst = resolve; });
    const fetch = manager.getFetch(async () => {
      await firstFetchPromise;
      return makeOkResponse();
    });

    // Start first request (in-flight).
    const firstRequest = fetch("https://example.test/1");
    // Wait for it to be dispatched.
    await new Promise((r) => setTimeout(r, 50));

    // Lower maxConcurrency to 1 while first request is still in-flight.
    manager.update(makeSettings({ maxConcurrency: 1 }));
    const statusAfterUpdate = manager.getStatus();
    expect(statusAfterUpdate.effectiveConcurrency).toBeLessThanOrEqual(1);
    // The in-flight request should still be counted.
    expect(statusAfterUpdate.inFlight).toBe(1);

    // Complete the first request.
    resolveFirst();
    await firstRequest;

    // After completion, inFlight should be 0.
    const statusAfterComplete = manager.getStatus();
    expect(statusAfterComplete.inFlight).toBe(0);
  });

  it("applyRecommendedValues applies recommended values and keeps tested max as ceiling", () => {
    const manager = new LlmCapacityManager(makeSettings({ maxRpm: 60, maxConcurrency: 4 }));
    manager.applyRecommendedValues(45, 3, { rpm: 60, concurrency: 4 });

    const settings = manager.getSettings();
    const status = manager.getStatus();
    expect(status.effectiveRpm).toBe(45);
    expect(status.effectiveConcurrency).toBe(3);
    expect(settings.shared.initialRpm).toBe(45);
    expect(settings.shared.initialConcurrency).toBe(3);
    expect(settings.shared.maxRpm).toBe(60);
    expect(settings.shared.maxConcurrency).toBe(4);
    expect(settings.preset).toBe("custom");
  });

  it("applyRecommendedValues clamps to hardMaxRpm and hardMaxConcurrency", () => {
    const manager = new LlmCapacityManager(makeSettings({ hardMaxRpm: 100, hardMaxConcurrency: 10 }));
    // Try to set values above hard caps.
    manager.applyRecommendedValues(500, 50, { rpm: 600, concurrency: 60 });

    const settings = manager.getSettings();
    const status = manager.getStatus();
    expect(status.effectiveRpm).toBe(100);
    expect(status.effectiveConcurrency).toBe(10);
    expect(settings.shared.initialRpm).toBe(100);
    expect(settings.shared.initialConcurrency).toBe(10);
    expect(settings.shared.maxRpm).toBe(100);
    expect(settings.shared.maxConcurrency).toBe(10);
  });

  it("capacityForPreset updates preset ceilings and keeps bounds valid", () => {
    const settings = capacityForPreset("conservative", makeSettings({
      initialRpm: 120,
      minRpm: 80,
      maxRpm: 300,
      initialConcurrency: 12,
      minConcurrency: 8,
      maxConcurrency: 16
    }));

    expect(settings.preset).toBe("conservative");
    expect(settings.shared.maxRpm).toBe(30);
    expect(settings.shared.minRpm).toBe(1);
    expect(settings.shared.initialRpm).toBe(4);
    expect(settings.shared.maxConcurrency).toBe(2);
    expect(settings.shared.minConcurrency).toBe(1);
    expect(settings.shared.initialConcurrency).toBe(2);
  });
});
