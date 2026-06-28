/**
 * Centralized application logger.
 *
 * Initialized once at startup with the Fastify pino instance so that all
 * modules share the same JSON output, log level, and transport config.
 *
 * Usage:
 *   import { log } from "../logger.js";
 *   log.info({ runId }, "run started");
 *   log.warn({ err }, "non-critical failure");
 *   log.error({ err, journeyId }, "journey failed");
 *   log.debug({ promptTokens }, "LLM call details");
 *
 * Before `initLogger()` is called, a fallback console-based logger is used.
 */

type LogFn = (obj: Record<string, unknown> | string, msg?: string) => void;

interface Logger {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  debug: LogFn;
  child: (bindings: Record<string, unknown>) => Logger;
}

/** Fallback logger that outputs to console before Fastify initializes. */
function createFallbackLogger(): Logger {
  const wrap = (fn: typeof console.log) => (obj: Record<string, unknown> | string, msg?: string) => {
    if (typeof obj === "string") fn(obj);
    else fn(msg ?? "", obj);
  };
  return {
    info: wrap(console.log),
    warn: wrap(console.warn),
    error: wrap(console.error),
    debug: wrap(console.debug),
    child: () => createFallbackLogger()
  };
}

let _logger: Logger = createFallbackLogger();

/** Replace the fallback logger with the Fastify pino instance. */
export function initLogger(logger: Logger) {
  _logger = logger;
}

/**
 * Convenience proxy — `log.info(...)`, `log.error(...)`, etc.
 *
 * Delegates to the current logger instance so modules don't need to call
 * a getter on every log statement.
 */
export const log: Logger = new Proxy({} as Logger, {
  get(_target, prop) {
    const value = (_logger as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === "function") {
      return value.bind(_logger);
    }
    return value;
  }
});
