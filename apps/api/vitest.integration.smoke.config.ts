import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/tests/*.integration.test.ts"],
    fileParallelism: false,
    testTimeout: 60000,
    testNamePattern: [
      "smoke completes a small deterministic mock run with open and feed-only exit",
      "treats duplicate plan confirmation as idempotency conflict and creates only one expansion job",
      "emits audience.status_updated and audience.action_happened on open_post",
      "creates feed and post transcript items on open_post",
      "treats feed_card exit_browsing as skipped"
    ].join("|")
  }
});
