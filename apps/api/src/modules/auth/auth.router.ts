import { loginBody, registerBody } from "@vsev/shared";
import { Router } from "express";
import { asyncHandler, parseWith } from "../../platform/http";
import { adminOf, userIdOf, type AuthMiddleware } from "./auth.middleware";
import type { AuthService } from "./auth.service";

/** Mounted at /api/v1 — customer authentication. */
export function createAuthRouter(auth: AuthService, mw: AuthMiddleware): Router {
  const router = Router();

  router.post(
    "/auth/register",
    asyncHandler(async (req, res) => {
      res.status(201).json(await auth.register(parseWith(registerBody, req.body)));
    })
  );

  router.post(
    "/auth/login",
    asyncHandler(async (req, res) => {
      res.json(await auth.login(parseWith(loginBody, req.body)));
    })
  );

  router.get(
    "/auth/me",
    mw.requireUser,
    asyncHandler(async (req, res) => {
      res.json(await auth.me(userIdOf(req)));
    })
  );

  return router;
}

/** Mounted at /api/v1/admin BEFORE the admin guard, because login itself must be public. */
export function createAdminAuthRouter(auth: AuthService, mw: AuthMiddleware): Router {
  const router = Router();

  router.post(
    "/auth/login",
    asyncHandler(async (req, res) => {
      res.json(await auth.adminLogin(parseWith(loginBody, req.body)));
    })
  );

  router.get(
    "/auth/me",
    mw.requireAdmin,
    asyncHandler(async (req, res) => {
      const admin = await auth.getActiveAdmin(adminOf(req).adminId);
      res.json(admin);
    })
  );

  return router;
}
