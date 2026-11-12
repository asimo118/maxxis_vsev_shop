import { bookingBody } from "@vsev/shared";
import { Router } from "express";
import { asyncHandler, param, parseWith } from "../../platform/http";
import { adminOf, userIdOf, type AuthMiddleware } from "../auth/auth.middleware";
import type { FulfillmentService } from "./fulfillment.service";

export function createFulfillmentRouter(fulfillment: FulfillmentService, mw: AuthMiddleware): Router {
  const router = Router();

  router.post(
    "/orders/:id/booking",
    mw.requireUser,
    asyncHandler(async (req, res) => {
      const { slotAt } = parseWith(bookingBody, req.body);
      res.status(201).json(await fulfillment.book(userIdOf(req), param(req, "id"), slotAt));
    })
  );

  router.delete(
    "/orders/:id/booking",
    mw.requireUser,
    asyncHandler(async (req, res) => {
      await fulfillment.cancelBooking(userIdOf(req), param(req, "id"));
      res.status(204).end();
    })
  );

  return router;
}

export function createFulfillmentAdminRouter(fulfillment: FulfillmentService, mw: AuthMiddleware): Router {
  const router = Router();
  const canReport = mw.allow("operator", "manager");

  router.post(
    "/orders/:id/ship",
    canReport,
    asyncHandler(async (req, res) => {
      res.json(await fulfillment.ship(param(req, "id"), adminOf(req).adminId));
    })
  );

  router.post(
    "/orders/:id/arrival",
    canReport,
    asyncHandler(async (req, res) => {
      res.json(await fulfillment.markArrived(param(req, "id"), adminOf(req).adminId));
    })
  );

  router.post(
    "/orders/:id/installed",
    canReport,
    asyncHandler(async (req, res) => {
      res.json(await fulfillment.markInstalled(param(req, "id"), adminOf(req).adminId));
    })
  );

  return router;
}
