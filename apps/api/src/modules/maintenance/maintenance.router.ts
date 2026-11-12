import { mileageBody } from "@vsev/shared";
import { Router } from "express";
import { asyncHandler, parseWith } from "../../platform/http";
import { userIdOf, type AuthMiddleware } from "../auth/auth.middleware";
import type { MaintenanceService } from "./maintenance.service";

export function createMaintenanceRouter(svc: MaintenanceService, mw: AuthMiddleware): Router {
  const router = Router();
  router.get("/me/mileage", mw.requireUser, asyncHandler(async (req, res) => { res.json(await svc.summary(userIdOf(req))); }));
  router.post("/me/mileage", mw.requireUser, asyncHandler(async (req, res) => {
    res.status(201).json(await svc.record(userIdOf(req), parseWith(mileageBody, req.body)));
  }));
  return router;
}
