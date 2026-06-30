import type { FastifyReply, FastifyRequest } from "fastify";
import { ok } from "@trycue/shared/api";
import { ApiError, sendApiError } from "../errors.js";

/**
 * Extract and validate `runId` from route params.
 * Throws RUN_NOT_FOUND (404) if missing — same semantics as the original inline helper in app.ts.
 */
export function getRunId(params: unknown): string {
  const value = (params as { runId?: string }).runId;
  if (!value) throw new ApiError("RUN_NOT_FOUND", "试映任务不存在", 404);
  return value;
}

/**
 * Parse pagination query params (`limit`, `cursor`) with clamping.
 * Mirrors the original inline helper in app.ts.
 */
export function parsePageQuery(query: unknown, defaultLimit = 10) {
  const value = query as { limit?: string; cursor?: string };
  const limit = Math.min(value.limit != null ? Number(value.limit) : defaultLimit, 100);
  const cursor = Math.max(value.cursor != null ? Number(value.cursor) : 0, 0);
  return { limit, cursor };
}

/**
 * Wrap an async handler with the standard try/catch → sendApiError pattern.
 * The handler returns the data payload; `wrapHandler` wraps it in `ok()` and
 * converts thrown errors via `sendApiError`.
 *
 * Use this for handlers that don't need to perform side effects (like
 * `pushLiveEvent`) after the main logic. Handlers that do can still call
 * `pushLiveEvent` inside the wrapped function before returning.
 */
export function wrapHandler<T>(
  handler: (request: FastifyRequest) => Promise<T>
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return ok(await handler(request));
    } catch (error) {
      return sendApiError(reply, error);
    }
  };
}
