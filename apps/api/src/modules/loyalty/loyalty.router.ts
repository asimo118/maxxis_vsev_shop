import { adjustPointsBody } from "@vsev/shared";
import { Router } from "express";
import { asyncHandler, parseWith } from "../../platform/http";
import { adminOf, userIdOf, type AuthMiddleware } from "../auth/auth.middleware";
import type { LoyaltyService } from "./loyalty.service";

/** Read-only for customers. There is deliberately no endpoint that lets a customer add points or test a code. */
export function createLoyaltyRouter(loyalty: LoyaltyService, mw: AuthMiddleware): Router {
  const router = Router();

  router.get(
    "/me/points",
    mw.requireUser,
    asyncHandler(async (req, res) => {
      res.json(await loyalty.summary(userIdOf(req)));
    })
  );

  return router;
}

export function createLoyaltyAdminRouter(loyalty: LoyaltyService, mw: AuthMiddleware): Router {
  const router = Router();

  router.post(
    "/points/adjust",
    mw.allow("manager"),
    asyncHandler(async (req, res) => {
      res.json(await loyalty.adjust(adminOf(req).adminId, parseWith(adjustPointsBody, req.body)));
    })
  );

  return router;
}
