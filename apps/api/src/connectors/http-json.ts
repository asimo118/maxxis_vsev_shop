import type { ConnectorName } from "@vsev/shared";
import type { z } from "zod";
import { AppError } from "../platform/errors";

/**
 * Raised when an external system is unreachable, slow, answers non-2xx, or sends a payload that
 * does not match its contract. Customers see the generic E5001 message; `reason` goes to logs and
 * to the admin connector status page.
 */
export class ConnectorError extends AppError {
  constructor(
    readonly connector: ConnectorName,
    readonly reason: string
  ) {
    super("E5001", undefined, { connector });
    this.name = "ConnectorError";
  }
}

export interface HttpJsonClientOptions {
  name: ConnectorName;
  /** Sent as `Authorization: Bearer <token>` when set. */
  token?: string;
  timeoutMs: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export interface HttpJsonClient {
  get<S extends z.ZodTypeAny>(url: string, schema: S): Promise<z.output<S>>;
  post<S extends z.ZodTypeAny>(url: string, body: unknown, schema: S): Promise<z.output<S>>;
}

/** Minimal JSON-over-HTTP client: timeout, bearer auth, and zod validation of every response. */
export function createHttpJsonClient(opts: HttpJsonClientOptions): HttpJsonClient {
  const doFetch = opts.fetchImpl ?? fetch;

  async function request<S extends z.ZodTypeAny>(method: string, url: string, schema: S, body?: unknown): Promise<z.output<S>> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs)
      });
    } catch (err) {
      const why = err instanceof Error && err.name === "TimeoutError" ? `timed out after ${opts.timeoutMs} ms` : String(err);
      throw new ConnectorError(opts.name, `${method} ${url} failed: ${why}`);
    }
    if (!res.ok) throw new ConnectorError(opts.name, `${method} ${url} answered HTTP ${res.status}`);

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new ConnectorError(opts.name, `${method} ${url} returned a body that is not JSON`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new ConnectorError(opts.name, `${method} ${url} broke the contract — ${issues}`);
    }
    return parsed.data;
  }

  return {
    get: (url, schema) => request("GET", url, schema),
    post: (url, body, schema) => request("POST", url, schema, body)
  };
}

/** Host part only — safe to show in the admin console (no path, query or credentials). */
export function endpointHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
