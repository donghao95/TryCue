import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type AppConfig = {
  appEnv: string;
  appUrl: string;
  port: number;
  llmConfigPath: string;
  schedulerWorkerId: string;
  schedulerDefaultConcurrency: number;
  runClockScale: number;
  modelCallTimeoutSeconds: number;
  modelStepTimeoutSeconds: number;
  agentJourneyTimeoutSeconds: number;
  runnerHeartbeatIntervalSeconds: number;
  schedulerMaxRetry: number;
  defaultQuickAudienceCount: number;
  defaultStandardAudienceCount: number;
  maxJourneyActionsPerJourney: number;
  maxToolCallsPerAction: number;
  sseHeartbeatIntervalSeconds: number;
  maxCoverImageSizeMb: number;
  enableScheduler: boolean;
  enableReportGeneration: boolean;
  // 生产模式下是否由 API 托管前端 SPA 静态资源（apps/web/dist）。
  // dev 模式由 Vite dev server 自行托管，不需要此开关。
  // Docker 单容器部署时设为 true。
  serveWeb: boolean;
  webDistPath: string;
};

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): AppConfig {
  return {
    appEnv: process.env.APP_ENV ?? "local",
    appUrl: process.env.APP_URL ?? "http://localhost:3000",
    port: numberEnv("API_PORT", 4000),
    llmConfigPath: resolveWorkspacePath(process.env.LLM_CONFIG_PATH ?? "config/llm.local.yaml"),
    schedulerWorkerId: process.env.SCHEDULER_WORKER_ID ?? "local-worker-1",
    schedulerDefaultConcurrency: numberEnv("SCHEDULER_DEFAULT_CONCURRENCY", 2),
    runClockScale: numberEnv("RUN_CLOCK_SCALE", 10),
    modelCallTimeoutSeconds: numberEnv("MODEL_CALL_TIMEOUT_SECONDS", 600),
    modelStepTimeoutSeconds: numberEnv("MODEL_STEP_TIMEOUT_SECONDS", 300),
    agentJourneyTimeoutSeconds: numberEnv("AGENT_JOURNEY_TIMEOUT_SECONDS", 600),
    runnerHeartbeatIntervalSeconds: numberEnv("RUNNER_HEARTBEAT_INTERVAL_SECONDS", 5),
    schedulerMaxRetry: numberEnv("SCHEDULER_MAX_RETRY", 2),
    defaultQuickAudienceCount: numberEnv("DEFAULT_QUICK_AUDIENCE_COUNT", 12),
    defaultStandardAudienceCount: numberEnv("DEFAULT_STANDARD_AUDIENCE_COUNT", 30),
    maxJourneyActionsPerJourney: numberEnv("MAX_JOURNEY_ACTIONS_PER_JOURNEY", 10),
    maxToolCallsPerAction: numberEnv("MAX_TOOL_CALLS_PER_ACTION", 20),
    sseHeartbeatIntervalSeconds: numberEnv("SSE_HEARTBEAT_INTERVAL", 15),
    maxCoverImageSizeMb: numberEnv("MAX_COVER_IMAGE_SIZE_MB", 5),
    enableScheduler: process.env.ENABLE_SCHEDULER !== "false",
    enableReportGeneration: process.env.ENABLE_REPORT_GENERATION !== "false",
    serveWeb: process.env.SERVE_WEB === "true",
    webDistPath: resolveWorkspacePath(process.env.WEB_DIST_PATH ?? "apps/web/dist")
  };
}

export function resolveWorkspacePath(path: string) {
  if (isAbsolute(path)) return path;
  let current = process.cwd();
  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return resolve(current, path);
    const parent = dirname(current);
    if (parent === current) return resolve(path);
    current = parent;
  }
}
