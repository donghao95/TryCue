import type { FastifyReply } from "fastify";
import { fail } from "@trycue/shared/api";
import { log } from "./logger.js";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 500,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function sendApiError(reply: FastifyReply, error: unknown) {
  if (error instanceof ApiError) {
    // Log business errors at warn level (4xx) or error level (5xx)
    const logger = error.statusCode >= 500 ? log.error : log.warn;
    logger(
      { statusCode: error.statusCode, code: error.code, message: error.message, details: error.details },
      `API error: ${error.code}`
    );
    return reply.status(error.statusCode).send(fail(error.code, error.message, error.details));
  }
  const rawMessage = error instanceof Error ? error.message : "Unknown error";
  const err = error instanceof Error ? error : undefined;
  log.error({ err, statusCode: 500 }, `Unhandled error: ${rawMessage}`);
  // Don't leak internal details (Prisma errors, stack traces, file paths) to clients in production
  const clientMessage = process.env.NODE_ENV === "production"
    ? "服务器内部错误，请稍后重试"
    : rawMessage;
  return reply.status(500).send(fail("INTERNAL_ERROR", clientMessage));
}
