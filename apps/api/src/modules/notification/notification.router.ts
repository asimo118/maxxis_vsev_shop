import { templateUpdateBody } from "@vsev/shared";
import { Router } from "express";
import { asyncHandler, param, parseWith } from "../../platform/http";
import type { AuthMiddleware } from "../auth/auth.middleware";
import type { NotificationService } from "./notification.service";

export function createNotificationAdminRouter(svc: NotificationService, mw: AuthMiddleware): Router {
  const router = Router();
  router.get("/notifications/templates", asyncHandler(async (_req, res) => { res.json(await svc.listTemplates()); }));
  router.put(
    "/notifications/templates/:kind",
    mw.allow("manager"),
    asyncHandler(async (req, res) => {
      res.json(await svc.updateTemplate(param(req, "kind"), parseWith(templateUpdateBody, req.body)));
    })
  );
  router.get("/notifications/log", asyncHandler(async (_req, res) => { res.json(await svc.listLogs()); }));
  return router;
}
