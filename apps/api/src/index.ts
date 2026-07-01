import "./env.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";

const config = loadConfig();
const app = await buildApp(config);

await app.listen({ port: config.port, host: config.host });
log.info({ port: config.port, host: config.host, authEnabled: config.apiAuthToken !== null }, "TryCue API listening");

// 安全提醒：监听所有网卡但未设置认证 token 时，写操作 endpoint 无保护
if (config.host === "0.0.0.0" && !config.apiAuthToken) {
  log.warn(
    "API 正在监听 0.0.0.0 但未设置 API_AUTH_TOKEN。写操作 endpoint（如 PUT /api/settings/llm）无认证保护，" +
    "若部署到公网请设置 API_AUTH_TOKEN 环境变量。"
  );
}
