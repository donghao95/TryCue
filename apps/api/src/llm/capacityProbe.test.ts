import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeLlmCapacity, ProbeCancelledError } from "./capacityProbe.js";

function makeFailResponse(status = 429) {
  return new Response('{"error":"rate limited"}', { status });
}

describe("probeLlmCapacity", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("throws ProbeCancelledError when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      probeLlmCapacity(
        { apiKey: "k", baseUrl: "https://api.test", model: "m", maxConcurrency: 1 },
        { signal: controller.signal }
      )
    ).rejects.toBeInstanceOf(ProbeCancelledError);
  });

  it("returns conservative recommendation when all requests fail", async () => {
    globalThis.fetch = vi.fn(async () => makeFailResponse(429)) as typeof globalThis.fetch;
    const result = await probeLlmCapacity(
      { apiKey: "k", baseUrl: "https://api.test", model: "m", maxConcurrency: 1 }
    );
    // All requests failed → fallback to conservative recommendation
    expect(result.recommendedConcurrency).toBe(1);
    expect(result.recommendedRpm).toBeGreaterThanOrEqual(2);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.totalTokens).toBe(0);
  });
});
