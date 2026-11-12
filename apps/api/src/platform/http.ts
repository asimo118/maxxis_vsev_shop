import { ERROR_CODES, ERROR_MESSAGES, type ApiErrorBody } from "@vsev/shared";
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import type { z, ZodTypeAny } from "zod";
import { AppError, errors } from "./errors";
import type { Logger } from "./logger";

/** Express 4 does not catch rejected promises — wrap every async handler. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Validate untrusted input with a zod schema; failures become E1000 with flattened details. */
export function parseWith<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw errors.validation(
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
    );
  }
  return result.data;
}

export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (!value) throw errors.validation({ path: name, message: "missing path parameter" });
  return value;
}

export function notFoundHandler(): RequestHandler {
  return (_req, _res, next) => next(errors.notFound("找不到這個網址。"));
}

export function errorMiddleware(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, _next) => {
    const rawId = (req as unknown as { id?: unknown }).id;
    const requestId = typeof rawId === "string" ? rawId : undefined;
    if (err instanceof AppError) {
      const body: ApiErrorBody = {
        error: { code: err.code, message: err.message, requestId, details: err.details }
      };
      res.status(err.status).json(body);
      return;
    }
    // body-parser errors (malformed JSON, payload too large)
    const status = (err as { status?: number } | null)?.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      const body: ApiErrorBody = {
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: ERROR_MESSAGES.E1000, requestId }
      };
      res.status(status).json(body);
      return;
    }
    logger.error({ err, requestId }, "unhandled error");
    const body: ApiErrorBody = {
      error: { code: ERROR_CODES.INTERNAL, message: ERROR_MESSAGES.E5000, requestId }
    };
    res.status(500).json(body);
  };
}
