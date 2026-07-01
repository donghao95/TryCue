import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type AppConfig = {
  appEnv: string;
  appUrl: string;
  port: number;
  // API 监听地址。默认 127.0.0.1（仅本机），显式设置 API_HOST=0.0.0.0 才绑所有网卡。
  // 本地单用户工具默认收紧，避免局域网误暴露导致 LLM 配置可被改写、prompt 窃取等风险。
  host: string;
  // 可选写操作鉴权 token。若设置，所有非 GET /health 请求必须带 X-TryCue-Token 头匹配。
  // 留空则不强制鉴权（仍受 host=127.0.0.1 的网络层约束）。
  apiAuthToken: string | null;
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
    // 默认只监听本机回环，避免局域网误暴露。
    // 需要容器内或局域网访问时显式设置 API_HOST=0.0.0.0。
    host: process.env.API_HOST ?? "127.0.0.1",
    // 可选写操作 token。留空则不强制鉴权，依赖 host 收紧网络层。
    apiAuthToken: process.env.API_AUTH_TOKEN ? process.env.API_AUTH_TOKEN.trim() : null,
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
