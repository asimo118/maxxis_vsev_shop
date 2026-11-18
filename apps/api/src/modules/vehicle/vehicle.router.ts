import { vehicleModelCreateBody, vehicleModelUpdateBody } from "@vsev/shared";
import { Router } from "express";
import { asyncHandler, param, parseWith } from "../../platform/http";
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

/** Mounted under /api/v1/admin (guard already applied). 車型資料: list, add, rename, (de)activate. */
export function createVehicleAdminRouter(vehicles: VehicleService, mw: AuthMiddleware): Router {
  const router = Router();
  const canWrite = mw.allow("operator", "manager");

  router.get(
    "/vehicle-models",
    asyncHandler(async (_req, res) => {
      res.json(await vehicles.listAdmin());
    })
  );

  router.post(
    "/vehicle-models",
    canWrite,
    asyncHandler(async (req, res) => {
      res.status(201).json(await vehicles.create(parseWith(vehicleModelCreateBody, req.body)));
    })
  );

  router.put(
    "/vehicle-models/:id",
    canWrite,
    asyncHandler(async (req, res) => {
      res.json(await vehicles.update(param(req, "id"), parseWith(vehicleModelUpdateBody, req.body)));
    })
  );

  return router;
}
