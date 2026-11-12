import { trackBody } from "@vsev/shared";
import { Router } from "express";
import { asyncHandler, parseWith } from "../../platform/http";
import type { AuthMiddleware } from "../auth/auth.middleware";
import type { ReportingService } from "./reporting.service";

export function createTrackingRouter(svc: ReportingService): Router {
  const router = Router();
  router.post("/track", asyncHandler(async (req, res) => {
    await svc.track(parseWith(trackBody, req.body));
    res.status(204).end();
  }));
  return router;
}

export function createReportingAdminRouter(svc: ReportingService, _mw: AuthMiddleware): Router {
  const router = Router();
  router.get("/dashboard", asyncHandler(async (_req, res) => { res.json(await svc.dashboard()); }));
  router.get("/owners", asyncHandler(async (_req, res) => { res.json(await svc.owners()); }));
  return router;
}
