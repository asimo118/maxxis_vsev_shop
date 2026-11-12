import type { RequestHandler } from "express";
import type { Clock } from "./clock";
import { AppError } from "./errors";

/**
 * Fixed-window per-IP limiter. In-process only — behind several API instances move the counters to Redis.
 * Used on credential endpoints (brute force) and the anonymous funnel beacon (write abuse).
 */
export function createRateLimiter(opts: { windowMs: number; max: number; clock: Clock }): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req, _res, next) => {
    const now = opts.clock.now().getTime();
    const key = req.ip ?? "unknown";
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > opts.max) {
      return next(new AppError("E1000", "請求太頻繁，請稍後再試。"));
    }
    next();
  };
}
