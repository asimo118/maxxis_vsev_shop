import { Router } from "express";
import type { AuthMiddleware } from "../modules/auth/auth.middleware";
import { asyncHandler, param } from "../platform/http";
import type { ConnectorRegistry } from "./registry";

/** Admin: connector status and "sync now". */
export function createConnectorsAdminRouter(registry: ConnectorRegistry, mw: AuthMiddleware): Router {
  const router = Router();
  router.get("/connectors", (_req, res) => {
    res.json(registry.list());
  });
  router.post(
    "/connectors/:name/sync",
    mw.allow("operator", "manager"),
    asyncHandler(async (req, res) => {
      res.json(await registry.syncNow(param(req, "name")));
    })
  );
  return router;
}
