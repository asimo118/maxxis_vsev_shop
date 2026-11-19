import type { AdminRole } from "@vsev/shared";
import type { RequestHandler } from "express";
import { asyncHandler } from "../../platform/http";
import { errors } from "../../platform/errors";
import type { AuthService } from "./auth.service";

export type AuthContext =
  | { kind: "user"; userId: string; sessionId: string }
  | { kind: "admin"; adminId: string; role: AdminRole; sessionId: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      /** Raw JSON body bytes, captured by express.json({ verify }) for webhook signature checks. */
      rawBody?: Buffer;
    }
  }
}

function bearer(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export interface AuthMiddleware {
  /** Storefront customer: STOREFRONT secret + audience, and the token's session must still be open. */
  requireUser: RequestHandler;
  /** Any active admin: ADMIN secret + audience, an open session, and an active admin row (re-read every request). */
  requireAdmin: RequestHandler;
  /** Role gate — use after requireAdmin. */
  allow: (...roles: AdminRole[]) => RequestHandler;
}

export function createAuthMiddleware(auth: AuthService): AuthMiddleware {
  const requireUser: RequestHandler = asyncHandler(async (req, _res, next) => {
    const token = bearer(req.header("authorization"));
    const claims = token ? await auth.authenticate("storefront", token) : null;
    if (!claims) return next(errors.unauthenticated());
    req.auth = { kind: "user", userId: claims.subject, sessionId: claims.sessionId };
    next();
  });

  const requireAdmin: RequestHandler = asyncHandler(async (req, _res, next) => {
    const token = bearer(req.header("authorization"));
    const claims = token ? await auth.authenticate("admin", token) : null;
    const admin = claims ? await auth.getActiveAdmin(claims.subject) : null;
    if (!claims || !admin) return next(errors.unauthenticated());
    req.auth = { kind: "admin", adminId: admin.id, role: admin.role, sessionId: claims.sessionId };
    next();
  });

  const allow =
    (...roles: AdminRole[]): RequestHandler =>
    (req, _res, next) => {
      if (req.auth?.kind !== "admin" || !roles.includes(req.auth.role)) return next(errors.forbidden());
      next();
    };

  return { requireUser, requireAdmin, allow };
}

/** Narrowing helpers for handlers that sit behind requireUser / requireAdmin. */
export function userIdOf(req: { auth?: AuthContext }): string {
  if (req.auth?.kind !== "user") throw errors.unauthenticated();
  return req.auth.userId;
}

export function adminOf(req: { auth?: AuthContext }): { adminId: string; role: AdminRole } {
  if (req.auth?.kind !== "admin") throw errors.unauthenticated();
  return { adminId: req.auth.adminId, role: req.auth.role };
}

/** The session behind the current request (logout ends exactly this one). */
export function sessionIdOf(req: { auth?: AuthContext }): string {
  if (!req.auth) throw errors.unauthenticated();
  return req.auth.sessionId;
}
