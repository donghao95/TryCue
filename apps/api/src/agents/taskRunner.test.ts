import { describe, expect, it } from "vitest";
import { AiTaskRunner, AI_TASK_MODEL_TIER } from "./taskRunner.js";
import { DEFAULT_CAPACITY_SETTINGS } from "../llm/capacityPresets.js";

describe("AiTaskRunner", () => {
  const config = {
    provider: "openai-compatible" as const,
    runtimeMode: "real" as const,
    models: {
      fast: "fast-model",
      pro: "pro-model"
    },
    capacity: DEFAULT_CAPACITY_SETTINGS
  };

  it("maps task types to the configured fast/pro model tiers", () => {
    const runner = new AiTaskRunner(() => config);

    expect(AI_TASK_MODEL_TIER).toMatchObject({
      audience_plan: "pro",
      audience_plan_revision: "pro",
      audience_seat_revision: "pro",
      audience_profile_expansion: "fast",
      audience_persona: "fast",
      agent_turn: "fast",
      report: "pro"
    });
    expect(runner.modelFor("agent_turn")).toBe("fast-model");
    expect(runner.modelFor("report")).toBe("pro-model");
  });

  it("does not limit concurrent tasks", async () => {
    const runner = new AiTaskRunner(() => config);
    let active = 0;
    let maxActive = 0;

    await Promise.all(Array.from({ length: 5 }, () =>
      runner.run({
        type: "agent_turn",
        call: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 20));
          active -= 1;
          return true;
        }
      })
    ));

    expect(maxActive).toBe(5);
  });

  it("does not retry failed tasks and records the failure", async () => {
    const records: Array<{ ok: boolean; error?: string }> = [];
    const runner = new AiTaskRunner(() => config, (record) => {
      records.push(record);
    });
    let attempts = 0;

    await expect(runner.run({
      type: "audience_persona",
      call: async () => {
        attempts += 1;
        throw new Error("temporary failure");
      }
    })).rejects.toThrow("temporary failure");

    expect(attempts).toBe(1);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ ok: false, error: "temporary failure" });
  });
});
