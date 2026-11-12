import type { ApiErrorBody } from "./errors";

/** Error thrown for every non-2xx API response. `code` is one of ERROR_CODES (E1000…E5000). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken: () => string | null;
  /** Called on 401 so the app can clear its session. */
  onUnauthorized?: () => void;
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}

/** Tiny fetch wrapper shared by the storefront and admin SPAs. */
export function createApiClient(opts: ApiClientOptions): ApiClient {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    const token = opts.getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetch(`${opts.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch {
      throw new ApiError(0, "NETWORK", "網路連線失敗，請稍後再試。");
    }
    if (res.status === 204) return undefined as T;

    const text = await res.text();
    const data: unknown = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      if (res.status === 401) opts.onUnauthorized?.();
      const err = (data as Partial<ApiErrorBody> | undefined)?.error;
      throw new ApiError(res.status, err?.code ?? "E5000", err?.message ?? "發生未知錯誤。", err?.details);
    }
    return data as T;
  }

  return {
    get: (p) => request("GET", p),
    post: (p, b) => request("POST", p, b),
    put: (p, b) => request("PUT", p, b),
    patch: (p, b) => request("PATCH", p, b),
    del: (p) => request("DELETE", p)
  };
}
