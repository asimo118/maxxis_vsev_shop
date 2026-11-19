import {
  adminChangePasswordBody,
  adminCreateBody,
  adminResetPasswordBody,
  adminUpdateBody,
  changePasswordBody,
  loginBody,
  registerBody
} from "@vsev/shared";
import { Router } from "express";
import { asyncHandler, param, parseWith } from "../../platform/http";
import { adminOf, sessionIdOf, userIdOf, type AuthMiddleware } from "./auth.middleware";
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

  /** Ends this session on the server; the token stops working immediately (CASA 3.3.1). */
  router.post(
    "/auth/logout",
    mw.requireUser,
    asyncHandler(async (req, res) => {
      await auth.logout(sessionIdOf(req));
      res.status(204).end();
    })
  );

  router.post(
    "/auth/password",
    mw.requireUser,
    asyncHandler(async (req, res) => {
      res.json(await auth.changeUserPassword(userIdOf(req), sessionIdOf(req), parseWith(changePasswordBody, req.body)));
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

  router.post(
    "/auth/logout",
    mw.requireAdmin,
    asyncHandler(async (req, res) => {
      await auth.logout(sessionIdOf(req));
      res.status(204).end();
    })
  );

  router.post(
    "/auth/password",
    mw.requireAdmin,
    asyncHandler(async (req, res) => {
      res.json(await auth.changeAdminPassword(adminOf(req).adminId, sessionIdOf(req), parseWith(adminChangePasswordBody, req.body)));
    })
  );

  return router;
}

/** Mounted under /api/v1/admin after the guard. 後台帳號: managers only (CASA 2.5.4 — personal accounts). */
export function createAdminAccountsRouter(auth: AuthService, mw: AuthMiddleware): Router {
  const router = Router();
  const managerOnly = mw.allow("manager");

  router.get(
    "/admins",
    managerOnly,
    asyncHandler(async (_req, res) => {
      res.json(await auth.listAdminAccounts());
    })
  );

  router.post(
    "/admins",
    managerOnly,
    asyncHandler(async (req, res) => {
      res.status(201).json(await auth.createAdmin(parseWith(adminCreateBody, req.body)));
    })
  );

  router.patch(
    "/admins/:id",
    managerOnly,
    asyncHandler(async (req, res) => {
      res.json(await auth.updateAdmin(adminOf(req).adminId, param(req, "id"), parseWith(adminUpdateBody, req.body)));
    })
  );

  router.post(
    "/admins/:id/password",
    managerOnly,
    asyncHandler(async (req, res) => {
      const { password } = parseWith(adminResetPasswordBody, req.body);
      res.json(await auth.resetAdminPassword(adminOf(req).adminId, param(req, "id"), password));
    })
  );

  return router;
}
