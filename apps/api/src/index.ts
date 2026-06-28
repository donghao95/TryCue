import "./env.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";

const config = loadConfig();
const app = await buildApp(config);

await app.listen({ port: config.port, host: "0.0.0.0" });
log.info({ port: config.port, host: "0.0.0.0" }, "TryCue API listening");
