import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@trycue/db";
import { loadConfig, resolveWorkspacePath } from "../config.js";
import type { AgentProvider } from "../agents/types.js";
import { AiTaskRunner } from "../agents/taskRunner.js";
import { generateReportAndCompleteRun, buildFallbackReportOutput } from "../runtime/report.js";
import { Scheduler } from "../runtime/scheduler.js";
import { PROMPT_VERSION_AGENT } from "../agents/promptVersions.js";
import { DEFAULT_CAPACITY_SETTINGS } from "../llm/capacityPresets.js";
import {
  cleanupIntegrationTest,
  createToolTestBundle
} from "./helpers.js";

const testLlmConfig = {
  provider: "openai-compatible" as const,
  runtimeMode: "mock" as const,
  models: {},
  capacity: DEFAULT_CAPACITY_SETTINGS
};

describe("model image conversion integration", () => {
  beforeEach(cleanupIntegrationTest);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("converts local upload image urls before sending audience turn messages to the model", async () => {
    const uploadDir = resolveWorkspacePath("apps/api/uploads");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(resolve(uploadDir, "test.png"), Buffer.from([1, 2, 3]));
    const bundle = await createToolTestBundle(false);
    await prisma.agentTurn.update({ where: { id: bundle.action.id }, data: { status: "created" } });

    let capturedImageUrl: string | null = null;
    const provider: AgentProvider = {
      async generateAudienceSamplingPlan() {
        throw new Error("not used");
      },
      async generateAudienceSamplingPlanRevision() {
        throw new Error("not used");
      },
      async generateAudienceSeatRevision() {
        throw new Error("not used");
      },
      async expandAudienceProfiles(_input) {
        throw new Error("not used");
      },
      async generateAudiencePersona() {
        throw new Error("not used");
      },
      async runAudienceTurn(context) {
        const content = context.messages[0]?.content;
        if (Array.isArray(content)) {
          const image = content.find((part) => part.type === "image");
          capturedImageUrl = typeof image?.image === "string" ? image.image : null;
        }
        return {
          thoughtText: "我不想继续看，退出。",
          toolCalls: [{ toolName: "exit_browsing", args: { reasonCategory: "not_interested", readingDepth: "feed_only", interestLevel: "low", trustLevel: "low" } }],
          rawOutput: { provider: "test" },
          model: "test-model",
          promptVersion: PROMPT_VERSION_AGENT
        };
      }
    };
    const scheduler = new Scheduler(
      { ...loadConfig(), appEnv: "test", enableScheduler: false },
      () => testLlmConfig,
      () => provider,
      new AiTaskRunner(() => testLlmConfig),
      uploadDir
    );

    await scheduler.drain(bundle.run.id);

    expect(capturedImageUrl).toBe("data:image/png;base64,AQID");
  });

  it("converts local upload image urls before sending report images to the model", async () => {
    const uploadDir = resolveWorkspacePath("apps/api/uploads");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(resolve(uploadDir, "test.png"), Buffer.from([4, 5, 6]));
    const bundle = await createToolTestBundle(true);

    let capturedImageUrls: string[] | undefined;
    await generateReportAndCompleteRun(
      bundle.run.id,
      "real-report-model",
      true,
      "test-key",
      "http://example.invalid/v1",
      {
        uploadDir,
        reportGenerator: async (input) => {
          capturedImageUrls = input.imageUrls;
          const reportOutput = buildFallbackReportOutput(
            input.evidencePack,
            input.recommendationCandidate,
            input.mainBlocker,
            false
          );
          // Override headline to verify the mock return is persisted as-is.
          reportOutput.verdict.headline = "模型生成的解释性摘要";
          return {
            reportOutput,
            recommendation: reportOutput.verdict.recommendation,
            model: "real-report-model",
            promptVersion: "report_decision_dashboard_v1"
          };
        }
      }
    );

    expect(capturedImageUrls).toEqual(["data:image/png;base64,BAUG"]);
    const report = await prisma.report.findUniqueOrThrow({ where: { runId: bundle.run.id } });
    const reportOutput = report.reportOutputJson as Record<string, unknown>;
    const verdict = reportOutput.verdict as Record<string, unknown>;
    expect(verdict.headline).toBe("模型生成的解释性摘要");
    expect(report.model).toBe("real-report-model");
    expect(report.promptVersion).toBe("report_decision_dashboard_v1");
  });

  it("does not fall back to a mock report when real report generation fails", async () => {
    const bundle = await createToolTestBundle(true);
    const failingGenerator = async () => { throw new Error("模拟 LLM 连接失败"); };

    await expect(
      generateReportAndCompleteRun(
        bundle.run.id,
        "real-report-model",
        true,
        "test-key",
        "http://127.0.0.1:1/v1",
        { reportGenerator: failingGenerator }
      )
    ).rejects.toThrow("真实报告生成失败");

    const run = await prisma.testRun.findUniqueOrThrow({ where: { id: bundle.run.id } });
    expect(run.status).toBe("paused");
    expect(run.errorMessage).toBeTruthy();
    expect(await prisma.report.count({ where: { runId: bundle.run.id } })).toBe(0);
    const pausedEvent = await prisma.liveEvent.findFirst({ where: { runId: bundle.run.id, eventType: "run.paused" } });
    expect(pausedEvent?.payload).toMatchObject({
      reason: "system_error",
      error: { code: "REPORT_GENERATION_FAILED" }
    });
  }, 10000);
});
