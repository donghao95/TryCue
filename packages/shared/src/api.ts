/**
 * API envelope 契约：所有 API response 都使用 ApiResponse<T>，
 * 后端使用 ok()/fail() 构造，前端通过 success 字段做窄化。
 */

export type ApiSuccess<T> = {
  success: true;
  data: T;
};

export type ApiFailure = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function ok<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

export function fail(code: string, message: string, details?: unknown): ApiFailure {
  return { success: false, error: { code, message, details } };
}
