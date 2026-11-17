import { assignShopsBody, coverageRequestBody, shopUpsertBody } from "@vsev/shared";
import { Router } from "express";
import { asyncHandler, param, parseWith } from "../../platform/http";
import type { AuthMiddleware } from "../auth/auth.middleware";
import type { ShopNetworkService } from "./shop-network.service";

/** Public: shoppers without a nearby install shop leave their city. */
export function createShopNetworkRouter(shops: ShopNetworkService): Router {
  const router = Router();

  router.post(
    "/coverage-requests",
    asyncHandler(async (req, res) => {
      await shops.submitCoverageRequest(parseWith(coverageRequestBody, req.body));
      res.status(202).json({ ok: true });
    })
  );

  return router;
}

/** Mounted under /api/v1/admin (guard already applied). */
export function createShopNetworkAdminRouter(shops: ShopNetworkService, mw: AuthMiddleware): Router {
  const router = Router();
  const canWrite = mw.allow("operator", "manager");

  router.get(
    "/shops",
    asyncHandler(async (_req, res) => {
      res.json(await shops.listAll());
    })
  );

  router.post(
    "/shops",
    canWrite,
    asyncHandler(async (req, res) => {
      res.status(201).json(await shops.create(parseWith(shopUpsertBody, req.body)));
    })
  );

  router.put(
    "/shops/:id",
    canWrite,
    asyncHandler(async (req, res) => {
      res.json(await shops.update(param(req, "id"), parseWith(shopUpsertBody, req.body)));
    })
  );

  router.get(
    "/campaigns/:id/shops",
    asyncHandler(async (req, res) => {
      res.json({ shopIds: await shops.assignedShopIds(param(req, "id")) });
    })
  );

  router.put(
    "/campaigns/:id/shops",
    canWrite,
    asyncHandler(async (req, res) => {
      const { shopIds } = parseWith(assignShopsBody, req.body);
      res.json({ shopIds: await shops.assignToCampaign(param(req, "id"), shopIds) });
    })
  );

  router.get(
    "/coverage-gaps",
    asyncHandler(async (_req, res) => {
      res.json(await shops.coverageGaps());
    })
  );

  return router;
}
