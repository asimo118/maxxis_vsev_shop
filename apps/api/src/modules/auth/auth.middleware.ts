import type { AdminRole } from "@vsev/shared";
import type { RequestHandler } from "express";
import { asyncHandler } from "../../platform/http";
import { errors } from "../../platform/errors";
import type { TokenService } from "../../platform/tokens";
import type { AuthService } from "./auth.service";

export type AuthContext =
  | { kind: "user"; userId: string }
  | { kind: "admin"; adminId: string; role: AdminRole };

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
  /** Storefront customer. Verifies a token signed with the STOREFRONT secret + audience. */
  requireUser: RequestHandler;
  /** Any active admin. Verifies a token signed with the ADMIN secret + audience, and re-checks the admin row. */
  requireAdmin: RequestHandler;
  /** Role gate — use after requireAdmin. */
  allow: (...roles: AdminRole[]) => RequestHandler;
}

export function createAuthMiddleware(tokens: TokenService, auth: AuthService): AuthMiddleware {
  const requireUser: RequestHandler = (req, _res, next) => {
    const token = bearer(req.header("authorization"));
    const userId = token ? tokens.verify("storefront", token) : null;
    if (!userId) return next(errors.unauthenticated());
    req.auth = { kind: "user", userId };
    next();
  };

  const requireAdmin: RequestHandler = asyncHandler(async (req, _res, next) => {
    const token = bearer(req.header("authorization"));
    const adminId = token ? tokens.verify("admin", token) : null;
    const admin = adminId ? await auth.getActiveAdmin(adminId) : null;
    if (!admin) return next(errors.unauthenticated());
    req.auth = { kind: "admin", adminId: admin.id, role: admin.role };
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
