import { Router } from "express";
import { asyncHandler } from "../../platform/http";
import { userIdOf, type AuthMiddleware } from "../auth/auth.middleware";
import type { VehicleService } from "./vehicle.service";

export function createVehicleRouter(vehicles: VehicleService, mw: AuthMiddleware): Router {
  const router = Router();

  router.get(
    "/vehicle-models",
    asyncHandler(async (_req, res) => {
      res.json(await vehicles.listModels());
    })
  );

  router.get(
    "/me/vehicles",
    mw.requireUser,
    asyncHandler(async (req, res) => {
      res.json(await vehicles.listMine(userIdOf(req)));
    })
  );

  return router;
}

/** Admin: the same model list, reachable through the admin port (which only serves /api/v1/admin/*). */
export function createVehicleAdminRouter(vehicles: VehicleService): Router {
  const router = Router();
  router.get(
    "/vehicle-models",
    asyncHandler(async (_req, res) => {
      res.json(await vehicles.listModels());
    })
  );
  return router;
}
