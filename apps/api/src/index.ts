import "./env.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";

const config = loadConfig();
const app = await buildApp(config);

await app.listen({ port: config.port, host: config.host });
log.info({ port: config.port, host: config.host }, "TryCue API listening");

// 安全提醒：监听所有网卡时写操作 endpoint 无应用层认证保护。
// V1 本地单用户工具默认不实现接口鉴权（见 docs/09_部署与运维.md）。
// 公网/局域网部署必须在请求到达 TryCue API 之前完成身份认证和访问控制
// （如反向代理 + 网络层 ACL），仅配置 CORS 不能替代服务端鉴权。
if (config.host === "0.0.0.0") {
  log.warn(
    "API 正在监听 0.0.0.0。V1 不提供应用层接口鉴权，" +
    "若部署到公网/局域网请通过反向代理或网络层 ACL 保护写操作 endpoint（如 PUT /api/settings/llm）。"
  );
}
