import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runDataLifecyclePolicies } from "./runDataLifecycle.js";

describe("run data lifecycle policies", () => {
  it("classifies every Prisma model", async () => {
    const schema = await readFile(resolve(process.cwd(), "../../packages/db/prisma/schema.prisma"), "utf8");
    const models = [...schema.matchAll(/^model\s+(\w+)\s+\{/gm)].map((match) => match[1]!).sort();
    expect(Object.keys(runDataLifecyclePolicies).sort()).toEqual(models);
  });
});
