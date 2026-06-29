import type { ApiResponse } from "@trycue/shared/api";
import i18n from "../i18n.js";

function apiFailure(code: string, message: string, details?: unknown): ApiResponse<never> {
  return { success: false, error: { code, message, details } };
}

export async function parseApiResponse<T>(response: Response): Promise<ApiResponse<T>> {
  let text = "";
  try {
    text = await response.text();
  } catch {
    return apiFailure("RESPONSE_READ_FAILED", i18n.t("apiError.responseReadFailed"), { status: response.status });
  }

  if (!text.trim()) {
    return apiFailure(
      response.ok ? "EMPTY_RESPONSE" : "HTTP_ERROR",
      response.ok ? i18n.t("apiError.emptyResponse") : i18n.t("apiError.httpError", { status: response.status }),
      { status: response.status }
    );
  }

  try {
    return JSON.parse(text) as ApiResponse<T>;
  } catch {
    return apiFailure("INVALID_JSON_RESPONSE", i18n.t("apiError.invalidJsonResponse"), { status: response.status });
  }
}

export async function request<T>(url: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const headers = init?.body
    ? { "Content-Type": "application/json", ...(init?.headers ?? {}) }
    : init?.headers;
  try {
    const response = await fetch(url, {
      ...init,
      headers
    });
    return await parseApiResponse<T>(response);
  } catch (error) {
    return apiFailure("NETWORK_ERROR", i18n.t("apiError.networkError"), error instanceof Error ? error.message : error);
  }
}
