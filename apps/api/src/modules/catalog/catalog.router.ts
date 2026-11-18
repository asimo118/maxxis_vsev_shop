import { REGIONS, campaignUpsertBody, cloneCampaignBody, eligibleModelsBody } from "@vsev/shared";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, param, parseWith } from "../../platform/http";
import type { AuthMiddleware } from "../auth/auth.middleware";
import type { CatalogService } from "./catalog.service";

const regionQuery = z.object({ region: z.enum(REGIONS).optional() });

export function createCatalogRouter(catalog: CatalogService): Router {
  const router = Router();

  router.get(
    "/campaigns/:slug",
    asyncHandler(async (req, res) => {
      res.json(await catalog.getPage(param(req, "slug")));
    })
  );

  router.get(
    "/campaigns/:slug/shops",
    asyncHandler(async (req, res) => {
      const { region } = parseWith(regionQuery, req.query);
      res.json(await catalog.shopsForSlug(param(req, "slug"), region));
    })
  );

  return router;
}

export function createCatalogAdminRouter(catalog: CatalogService, mw: AuthMiddleware): Router {
  const router = Router();
  const canEdit = mw.allow("operator", "manager");
  const canPublish = mw.allow("manager");

  router.get(
    "/campaigns",
    asyncHandler(async (_req, res) => {
      res.json(await catalog.listAdmin());
    })
  );

  router.get(
    "/campaigns/:id",
    asyncHandler(async (req, res) => {
      res.json(await catalog.getAdmin(param(req, "id")));
    })
  );

  router.post(
    "/campaigns",
    canEdit,
    asyncHandler(async (req, res) => {
      res.status(201).json(await catalog.create(parseWith(campaignUpsertBody, req.body)));
    })
  );

  router.put(
    "/campaigns/:id",
    canEdit,
    asyncHandler(async (req, res) => {
      res.json(await catalog.update(param(req, "id"), parseWith(campaignUpsertBody, req.body)));
    })
  );

  router.put(
    "/campaigns/:id/eligible-models",
    canEdit,
    asyncHandler(async (req, res) => {
      const { modelIds } = parseWith(eligibleModelsBody, req.body);
      res.json(await catalog.setEligibleModels(param(req, "id"), modelIds));
    })
  );

  router.post(
    "/campaigns/:id/publish",
    canPublish,
    asyncHandler(async (req, res) => {
      res.json(await catalog.publish(param(req, "id")));
    })
  );

  router.post(
    "/campaigns/:id/end",
    canPublish,
    asyncHandler(async (req, res) => {
      res.json(await catalog.end(param(req, "id")));
    })
  );

  router.post(
    "/campaigns/:id/clone",
    canEdit,
    asyncHandler(async (req, res) => {
      const { slug } = parseWith(cloneCampaignBody, req.body);
      res.status(201).json(await catalog.clone(param(req, "id"), slug));
    })
  );

  return router;
}
