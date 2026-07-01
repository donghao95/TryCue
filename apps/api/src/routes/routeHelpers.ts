import type { FastifyReply, FastifyRequest } from "fastify";
import { ok } from "@trycue/shared/api";
import { ApiError, sendApiError } from "../errors.js";
import type { ZodType } from "zod";

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
 * 用 Zod schema 校验请求 body，失败时抛 VALIDATION_ERROR (400)。
 * 用于 route 层替代 `request.body as { ... }` 类型断言。
 */
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ApiError("VALIDATION_ERROR", `请求参数校验失败：${issues}`, 400, result.error.issues);
  }
  return result.data;
}

/**
 * Parse pagination query params (`limit`, `cursor`) with clamping.
 *
 * Guards against non-numeric / NaN / non-finite inputs by falling back to
 * defaults, and clamps to safe ranges. `limit` is clamped to [1, 100], cursor
 * to [0, MAX_SAFE_INTEGER]. Both are truncated to integers.
 */
export function parsePageQuery(query: unknown, defaultLimit = 10) {
  const value = query as { limit?: string; cursor?: string };
  return {
    limit: clampInt(value.limit, defaultLimit, 1, 100),
    cursor: clampInt(value.cursor, 0, 0, Number.MAX_SAFE_INTEGER)
  };
}

/**
 * Coerce an unknown query value to a clamped integer.
 * Falls back to `fallback` when the value is missing, non-numeric, NaN, or
 * non-finite; otherwise truncates to an integer and clamps to `[min, max]`.
 */
function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
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
