import type { FastifyPluginAsync } from "fastify";
import { ok } from "@trycue/shared/api";
import {
  ApplyRecommendedRequestSchema,
  ListModelsRequestSchema,
  LlmCapacityProbeRequestSchema,
  LlmSettingsRequestSchema
} from "@trycue/shared/llm";
import { ApiError, sendApiError } from "../errors.js";
import {
  LlmConfigStore,
  LlmConfigValidationError
} from "../llmConfigStore.js";
import { LlmCapacityProbeManager, ProbeAlreadyRunningError } from "../llm/capacityProbeManager.js";
import {
  getSharedCapacityManager,
  updateSharedCapacityManager
} from "../llm/rateLimitedFetch.js";

/**
 * Deps injected from buildApp. Both are runtime singletons owned by app.ts.
 */
export interface SettingsRoutesDeps {
  llmConfigStore: LlmConfigStore;
  probeManager: LlmCapacityProbeManager;
}

/**
 * Registers all LLM settings routes.
 *
 * Routes migrated from app.ts:
 * - GET  /api/settings/llm
 * - PUT  /api/settings/llm
 * - GET  /api/settings/llm/capacity/status
 * - POST /api/settings/llm/capacity/probe
 * - GET  /api/settings/llm/capacity/probe/:jobId
 * - POST /api/settings/llm/capacity/probe/:jobId/cancel
 * - POST /api/settings/llm/capacity/reset-learning
 * - POST /api/settings/llm/capacity/apply-recommended
 * - POST /api/settings/llm/models
 *
 * Error handling note: handlers with special error branches (LlmConfigValidationError,
 * ProbeAlreadyRunningError) keep their original try/catch structure instead of using
 * `wrapHandler`, because `wrapHandler` would coerce all errors through `sendApiError`
 * and lose the custom status codes / error codes.
 */
export function settingsRoutes(deps: SettingsRoutesDeps): FastifyPluginAsync {
  const { llmConfigStore, probeManager } = deps;
  return async (app) => {
    app.get("/api/settings/llm", async () => ok(llmConfigStore.view()));

    app.put("/api/settings/llm", async (request, reply) => {
      try {
        const parsed = LlmSettingsRequestSchema.safeParse(request.body);
        if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
        const view = await llmConfigStore.save(parsed.data);
        updateSharedCapacityManager(llmConfigStore.get().capacity);
        return ok(view);
      } catch (error) {
        if (error instanceof LlmConfigValidationError) {
          return sendApiError(reply, new ApiError("VALIDATION_ERROR", error.message, 400));
        }
        return sendApiError(reply, error);
      }
    });

    app.get("/api/settings/llm/capacity/status", async () => {
      return ok(getSharedCapacityManager().getStatus());
    });

    app.post("/api/settings/llm/capacity/probe", async (request, reply) => {
      try {
        const parsed = LlmCapacityProbeRequestSchema.safeParse(request.body ?? {});
        if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
        const current = llmConfigStore.get();
        const apiKey = parsed.data.apiKey || current.apiKey;
        const baseUrl = parsed.data.baseUrl || current.baseUrl;
        if (!baseUrl) throw new ApiError("VALIDATION_ERROR", "需要先填写 API base URL 才能校准", 400);
        if (!apiKey) throw new ApiError("VALIDATION_ERROR", "需要先填写 API key 才能校准", 400);
        const model = parsed.data.model || current.models.pro || current.models.fast;
        if (!model) throw new ApiError("VALIDATION_ERROR", "需要先选择模型才能校准", 400);
        const startView = probeManager.start({
          apiKey,
          baseUrl,
          model,
          request: {
            mode: parsed.data.mode,
            maxRpm: parsed.data.maxRpm,
            maxConcurrency: parsed.data.maxConcurrency
          },
          hardMaxRpm: current.capacity.shared.hardMaxRpm,
          hardMaxConcurrency: current.capacity.shared.hardMaxConcurrency
        });
        return ok(startView);
      } catch (error) {
        if (error instanceof ProbeAlreadyRunningError) {
          return sendApiError(reply, new ApiError("PROBE_ALREADY_RUNNING", "已有校准任务正在运行", 409, { jobId: error.jobId }));
        }
        return sendApiError(reply, error);
      }
    });

    app.get("/api/settings/llm/capacity/probe/:jobId", async (request, reply) => {
      const { jobId } = request.params as { jobId: string };
      const job = probeManager.get(jobId);
      if (!job) return sendApiError(reply, new ApiError("NOT_FOUND", "校准任务不存在", 404));
      return ok(job);
    });

    app.post("/api/settings/llm/capacity/probe/:jobId/cancel", async (request, reply) => {
      const { jobId } = request.params as { jobId: string };
      const job = probeManager.cancel(jobId);
      if (!job) return sendApiError(reply, new ApiError("NOT_FOUND", "校准任务不存在", 404));
      return ok(job);
    });

    app.post("/api/settings/llm/capacity/reset-learning", async () => {
      getSharedCapacityManager().resetLearning();
      return ok(getSharedCapacityManager().getStatus());
    });

    app.post("/api/settings/llm/capacity/apply-recommended", async (request, reply) => {
      try {
        const parsed = ApplyRecommendedRequestSchema.safeParse(request.body ?? {});
        if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "需要提供正整数 recommendedRpm 和 recommendedConcurrency", 400, parsed.error.flatten());
        const recommendedRpm = parsed.data.recommendedRpm ?? parsed.data.maxRpm!;
        const recommendedConcurrency = parsed.data.recommendedConcurrency ?? parsed.data.maxConcurrency!;
        getSharedCapacityManager().applyRecommendedValues(recommendedRpm, recommendedConcurrency, {
          rpm: parsed.data.testedMaxRpm,
          concurrency: parsed.data.testedMaxConcurrency
        });
        const updatedCapacity = getSharedCapacityManager().getSettings();
        const current = llmConfigStore.get();
        const view = await llmConfigStore.save({
          provider: current.provider,
          runtimeMode: current.runtimeMode,
          clearApiKey: false,
          baseUrl: current.baseUrl ?? "",
          models: current.models,
          capacity: updatedCapacity
        });
        return ok(view);
      } catch (error) {
        if (error instanceof LlmConfigValidationError) {
          return sendApiError(reply, new ApiError("VALIDATION_ERROR", error.message, 400));
        }
        return sendApiError(reply, error);
      }
    });

    app.post("/api/settings/llm/models", async (request, reply) => {
      try {
        const parsed = ListModelsRequestSchema.safeParse(request.body ?? {});
        if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "参数错误", 400, parsed.error.flatten());
        const current = llmConfigStore.get();
        const apiKey = parsed.data.apiKey || current.apiKey;
        const baseUrl = parsed.data.baseUrl || current.baseUrl;
        if (!baseUrl) throw new ApiError("VALIDATION_ERROR", "需要先填写 API base URL 才能获取模型列表", 400);
        if (!apiKey) throw new ApiError("VALIDATION_ERROR", "需要先填写 API key 才能获取模型列表", 400);
        const models = await fetchOpenAICompatibleModels({
          apiKey,
          baseUrl
        });
        return ok({ models });
      } catch (error) {
        return sendApiError(reply, error);
      }
    });
  };
}

/**
 * Fetch the model list from an OpenAI-compatible `/models` endpoint.
 * Migrated from app.ts module-level helper — only consumed by POST /api/settings/llm/models.
 */
async function fetchOpenAICompatibleModels({ apiKey, baseUrl }: { apiKey: string; baseUrl: string }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const endpoint = modelListEndpoint(baseUrl);
  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new ApiError("MODEL_LIST_FAILED", `模型列表获取失败：HTTP ${response.status}`, 502);
    }
    const text = await response.text();
    const payload = JSON.parse(text) as { data?: Array<{ id?: string; owned_by?: string }> };
    const models = (payload.data ?? [])
      .map((model) => ({ id: model.id ?? "", ownedBy: model.owned_by }))
      .filter((model) => model.id)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (!models.length) throw new ApiError("MODEL_LIST_FAILED", "模型列表为空或响应格式不兼容", 502);
    return models;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiError("MODEL_LIST_FAILED", `模型列表获取失败：${message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the `/models` endpoint URL from a base URL.
 * Migrated from app.ts module-level helper — only consumed by fetchOpenAICompatibleModels.
 */
function modelListEndpoint(baseUrl: string) {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new ApiError("VALIDATION_ERROR", "API base URL 格式不正确", 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError("VALIDATION_ERROR", "API base URL 只支持 http 或 https", 400);
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
