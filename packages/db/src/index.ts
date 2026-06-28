import "./env.js";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Production must not emit query events: params can carry sensitive data
// (API keys, user content) and the volume degrades logging throughput.
const enableQueryLogging = process.env.NODE_ENV !== "production";

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: enableQueryLogging
      ? [
          { level: "error" as const, emit: "event" as const },
          { level: "warn" as const, emit: "event" as const },
          { level: "query" as const, emit: "event" as const }
        ]
      : [
          { level: "error" as const, emit: "event" as const },
          { level: "warn" as const, emit: "event" as const }
        ]
  });

// ── Structured logger injection ──
// The db package is initialized before the application logger (pino) exists.
// Call setPrismaLogger() after initLogger() to route Prisma events through pino.
// Before injection, events fall back to console with raw JSON.

type PrismaLogFn = (obj: Record<string, unknown>, msg?: string) => void;
interface PrismaLogger {
  warn: PrismaLogFn;
  error: PrismaLogFn;
}

let _prismaLogger: PrismaLogger | null = null;

export function setPrismaLogger(logger: PrismaLogger) {
  _prismaLogger = logger;
}

function warnLog(obj: Record<string, unknown>, msg: string) {
  if (_prismaLogger) _prismaLogger.warn(obj, msg);
  else console.warn(JSON.stringify({ level: "warn", module: "prisma", ...obj }));
}

function errorLog(obj: Record<string, unknown>, msg: string) {
  if (_prismaLogger) _prismaLogger.error(obj, msg);
  else console.error(JSON.stringify({ level: "error", module: "prisma", ...obj }));
}

// Attach Prisma event handlers
if (!globalForPrisma.prisma) {
  if (enableQueryLogging) {
    prisma.$on("query" as never, (e: { query: string; params: string; duration: number; target: string }) => {
      if (e.duration > 200) {
        warnLog({
          query: e.query.substring(0, 200),
          params: e.params.substring(0, 100),
          duration: e.duration,
          target: e.target
        }, "slow query");
      }
    });
  }

  prisma.$on("error" as never, (e: { message: string; target: string }) => {
    errorLog({ message: e.message, target: e.target }, "prisma error");
  });

  prisma.$on("warn" as never, (e: { message: string; target: string }) => {
    warnLog({ message: e.message, target: e.target }, "prisma warning");
  });
}

if (enableQueryLogging) {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";
