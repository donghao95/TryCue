import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { prisma } from "@trycue/db";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import {
  cleanupIntegrationTest,
  integrationLlmConfigPath,
  prepareAudienceReady
} from "./helpers.js";

describe("llm config integration", () => {
  const llmConfigPath = integrationLlmConfigPath;

  beforeEach(cleanupIntegrationTest);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("uses explicit mock mode even when real LLM fields are complete", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const settings = await app.inject({
      method: "PUT",
      url: "/api/settings/llm",
      payload: {
        provider: "openai-compatible",
        runtimeMode: "mock",
        apiKey: "test-key",
        baseUrl: "https://api.example.com/v1",
        models: { fast: "fast-model", pro: "pro-model" }
      }
    });
    expect(settings.statusCode).toBe(200);
    expect(settings.json().data.runtimeMode).toBe("mock");
    expect(settings.json().data.isRealConfigComplete).toBe(true);
    expect(settings.json().data.isConfigured).toBe(false);

    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "测试标题",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这是一段超过二十个字的正文，用于创建试映任务并测试显式 mock 模式。",
        scale: "quick"
      }
    });
    const runId = create.json().data.runId as string;
    const run = await prisma.testRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.configJson).toMatchObject({ runtimeMode: "mock" });

    await prepareAudienceReady(app, runId);
    const start = await app.inject({ method: "POST", url: `/api/runs/${runId}/start`, payload: {} });
    expect(start.statusCode).toBe(200);
    expect(start.json().data.status).toBe("running");
    await app.close();
  });

  it("accepts complete explicit real LLM settings without calling the provider", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const settings = await app.inject({
      method: "PUT",
      url: "/api/settings/llm",
      payload: {
        provider: "openai-compatible",
        runtimeMode: "real",
        apiKey: "test-key",
        baseUrl: "https://api.example.com/v1",
        models: { fast: "fast-model", pro: "pro-model" }
      }
    });
    expect(settings.statusCode).toBe(200);
    expect(settings.json().data).toMatchObject({
      runtimeMode: "real",
      isRealConfigComplete: true,
      isConfigured: true
    });
    expect(settings.json().data.execution).toBeUndefined();
    await app.close();
  });

  it("rejects LLM execution-pool settings", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const settings = await app.inject({
      method: "PUT",
      url: "/api/settings/llm",
      payload: {
        provider: "openai-compatible",
        runtimeMode: "mock",
        models: { fast: "", pro: "" },
        execution: { maxConcurrentAiTasks: 3, taskTimeoutSeconds: 90, maxRetry: 1 }
      }
    });
    expect(settings.statusCode).toBe(400);
    expect(settings.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("rejects partial explicit real LLM config", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const settings = await app.inject({
      method: "PUT",
      url: "/api/settings/llm",
      payload: {
        provider: "openai-compatible",
        runtimeMode: "real",
        baseUrl: "",
        models: { fast: "", pro: "" }
      }
    });
    expect(settings.statusCode).toBe(400);
    expect(settings.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("rejects legacy LLM settings requests without runtimeMode", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const settings = await app.inject({
      method: "PUT",
      url: "/api/settings/llm",
      payload: {
        provider: "openai-compatible",
        baseUrl: "",
        models: { fast: "", pro: "" }
      }
    });
    expect(settings.statusCode).toBe(400);
    expect(settings.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("rejects legacy LLM config files without runtimeMode", async () => {
    await writeFile(
      llmConfigPath,
      ["provider: openai-compatible", "apiKey: ''", "baseUrl: ''", "models:", "  fast: ''", "  pro: ''", ""].join("\n"),
      "utf8"
    );
    await expect(buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false })).rejects.toThrow();
  });

  it("rejects unsupported model-list base URL schemes", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const response = await app.inject({
      method: "POST",
      url: "/api/settings/llm/models",
      payload: {
        apiKey: "test-key",
        baseUrl: "file:///etc"
      }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });
});
